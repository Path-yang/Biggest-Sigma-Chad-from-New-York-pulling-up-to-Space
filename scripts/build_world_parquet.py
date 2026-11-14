#!/usr/bin/env python3
"""Convert the whole NASA FIRMS yearly country archive to Parquet.

FIRMS publishes active-fire detections as one CSV per sensor, year and country,
bundled into one zip per sensor and year. No login or key is needed. This
script downloads every zip, converts each CSV to a Parquet file with the same
columns and the same rows in the same order, and writes the result under
build/hf/, laid out the way FIRMS lays it out:

    build/hf/<sensor>/<year>/<sensor>_<year>_<Country>.parquet
    build/hf/AttributesReadme.txt    FIRMS's own notes on the columns
    build/hf/firms_index.csv         FIRMS's file index the data was built from
    build/hf/manifest.csv            rows, dates, sizes and source checksum per file

Sensors: modis (Terra and Aqua), viirs-snpp (Suomi NPP), viirs-jpss1 (NOAA-20).

A file counts as done only if the CSV has the size FIRMS lists for it and the
CSV text regenerated from the Parquet file is byte-for-byte the CSV FIRMS
served. A file that cannot be reproduced exactly fails the run.

Usage:
    .venv/bin/python scripts/build_world_parquet.py                  # everything
    .venv/bin/python scripts/build_world_parquet.py --only modis_2000
    .venv/bin/python scripts/build_world_parquet.py --only viirs-snpp

The job can be stopped and restarted: a finished sensor-year is skipped as long
as FIRMS still lists the same files for it and its Parquet files are intact,
and is converted again otherwise. The exit code is 0 only when build/hf holds
every file in the index. Run one copy at a time. Needs the duckdb package.
"""
import argparse
import csv
import hashlib
import io
import os
import shutil
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
INDEX_URL = f"{BASE}/yearly_summary_files.txt"
README_NAME = "AttributesReadme.txt"
ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ZIPS = BUILD / "zips"
TMP = BUILD / "tmp"
STATE = BUILD / "state"
OUT = BUILD / "hf"
USER_AGENT = "firms-yearly-download/1.0 (python-urllib)"
CHUNK = 1 << 20
RETRIES = 4
REGENERATE_ROWS = 200_000

# Column names and types, in file order. Numbers are stored as 64-bit floats so
# every value reads back exactly as FIRMS wrote it.
MODIS = [("latitude", "DOUBLE"), ("longitude", "DOUBLE"), ("brightness", "DOUBLE"),
         ("scan", "DOUBLE"), ("track", "DOUBLE"), ("acq_date", "DATE"),
         ("acq_time", "VARCHAR"), ("satellite", "VARCHAR"), ("instrument", "VARCHAR"),
         ("confidence", "SMALLINT"), ("version", "VARCHAR"), ("bright_t31", "DOUBLE"),
         ("frp", "DOUBLE"), ("daynight", "VARCHAR"), ("type", "TINYINT")]
VIIRS = [("latitude", "DOUBLE"), ("longitude", "DOUBLE"), ("bright_ti4", "DOUBLE"),
         ("scan", "DOUBLE"), ("track", "DOUBLE"), ("acq_date", "DATE"),
         ("acq_time", "VARCHAR"), ("satellite", "VARCHAR"), ("instrument", "VARCHAR"),
         ("confidence", "VARCHAR"), ("version", "VARCHAR"), ("bright_ti5", "DOUBLE"),
         ("frp", "DOUBLE"), ("daynight", "VARCHAR"), ("type", "TINYINT")]
SCHEMAS = {"modis": MODIS, "viirs-snpp": VIIRS, "viirs-jpss1": VIIRS}
MANIFEST_FIELDS = ["path", "sensor", "year", "country", "rows", "first_date", "last_date",
                   "csv_bytes", "csv_sha256", "parquet_bytes", "source_zip", "firms_updated"]


def open_url(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=180)


def get(url):
    """Return a small file's body, failing if it arrives shorter than announced."""
    with open_url(url) as response:
        announced = response.headers.get("Content-Length")
        body = response.read()
    if announced is not None and int(announced) != len(body):
        raise IOError(f"{url}: got {len(body)} bytes, server announced {announced}")
    return body


def download(url, path, size):
    """Stream a large file to disk and check it has the size the index lists."""
    if path.exists() and path.stat().st_size == size:
        return
    partial = path.with_suffix(".part")
    for attempt in range(1, RETRIES + 1):
        try:
            with open_url(url) as response, open(partial, "wb") as handle:
                while True:
                    block = response.read(CHUNK)
                    if not block:
                        break
                    handle.write(block)
            if partial.stat().st_size != size:
                raise IOError(f"got {partial.stat().st_size} bytes, index lists {size}")
            partial.replace(path)
            return
        except Exception as error:
            if attempt == RETRIES:
                raise IOError(f"{url}: {error}") from error
            time.sleep(10 * attempt)


def write_atomically(path, data):
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    partial.replace(path)


def csv_line_query(schema, parquet):
    """SQL giving each Parquet row as the CSV line FIRMS wrote, in file order."""
    fields = []
    for column, kind in schema:
        if kind == "DOUBLE":
            # FIRMS writes whole numbers without a decimal point.
            fields.append(f"regexp_replace({column}::VARCHAR, '\\.0$', '')")
        elif kind == "DATE":
            fields.append(f"strftime({column}, '%Y-%m-%d')")
        else:
            fields.append(f"{column}::VARCHAR")
    return (f"SELECT concat_ws(',', {', '.join(fields)}) "
            f"FROM read_parquet('{parquet}', file_row_number = true) ORDER BY file_row_number")


def convert(job):
    """Convert one CSV inside a zip to Parquet. Runs in a worker process."""
    import duckdb

    zip_path, member, sensor, year, country, listed_size, updated = job
    with zipfile.ZipFile(zip_path) as archive:
        raw = archive.read(member)
    if len(raw) != listed_size:
        raise ValueError(f"{member}: CSV is {len(raw)} bytes, index lists {listed_size}")
    schema = SCHEMAS[sensor]
    header = (",".join(column for column, _ in schema) + "\n").encode()
    if not raw.startswith(header):
        raise ValueError(f"{member}: unexpected header {raw[:200]!r}")
    source_sha256 = hashlib.sha256(raw).hexdigest()

    name = Path(member).stem
    out = OUT / sensor / str(year) / f"{name}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    scratch = TMP / f"{name}.{os.getpid()}.csv"
    partial = TMP / f"{name}.{os.getpid()}.parquet"
    scratch.write_bytes(raw)
    columns = ", ".join(f"'{column}': '{kind}'" for column, kind in schema)
    connection = duckdb.connect()
    try:
        connection.execute("SET threads = 2")
        connection.execute("SET memory_limit = '2GB'")
        connection.execute(
            f"CREATE TABLE detections AS SELECT * FROM read_csv('{scratch}', header = true, "
            f"delim = ',', quote = '\"', auto_detect = false, columns = {{{columns}}})")
        connection.execute(
            f"COPY detections TO '{partial}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9)")
        regenerated, rows = hashlib.sha256(header), 0
        lines = connection.execute(csv_line_query(schema, partial))
        while True:
            batch = lines.fetchmany(REGENERATE_ROWS)
            if not batch:
                break
            regenerated.update(("\n".join(line for (line,) in batch) + "\n").encode())
            rows += len(batch)
        first, last = connection.execute(
            f"SELECT min(acq_date), max(acq_date) FROM read_parquet('{partial}')").fetchone()
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        connection.close()
        scratch.unlink(missing_ok=True)
    if regenerated.hexdigest() != source_sha256:
        partial.unlink(missing_ok=True)
        raise ValueError(f"{member}: the Parquet file does not reproduce the CSV exactly")
    partial.replace(out)
    return {"path": out.relative_to(OUT).as_posix(), "sensor": sensor, "year": year,
            "country": country, "rows": rows, "first_date": first or "", "last_date": last or "",
            "csv_bytes": len(raw), "csv_sha256": source_sha256,
            "parquet_bytes": out.stat().st_size, "source_zip": zip_path.name,
            "firms_updated": updated}


def read_state(state):
    with open(state, newline="") as handle:
        return list(csv.DictReader(handle))


def state_problem(sensor, year, listed):
    """Say why a sensor-year needs converting, or return None if it is done and current."""
    state = STATE / f"{sensor}_{year}.csv"
    if not state.exists():
        return "not converted yet"
    rows = read_state(state)
    prefix = f"{sensor}_{year}_"
    wanted = {name: entry for name, entry in listed.items() if name.startswith(prefix)}
    recorded = {Path(row["path"]).stem + ".csv": (int(row["csv_bytes"]), row.get("firms_updated"))
                for row in rows}
    if recorded != wanted:
        return "FIRMS lists different files than were converted"
    for row in rows:
        parquet = OUT / row["path"]
        if not parquet.is_file() or parquet.stat().st_size != int(row["parquet_bytes"]):
            return f"{row['path']} is missing or has changed"
    return None


def process_zip(entry, listed, pool, keep_zips):
    """Download one sensor-year zip, convert every CSV in it, record the result."""
    sensor, year, zip_name = entry["sensor"], entry["year"], entry["filename"]
    state = STATE / f"{sensor}_{year}.csv"
    problem = state_problem(sensor, year, listed)
    if problem is None:
        return f"done before  {sensor} {year}"
    # Start the sensor-year from nothing so no file from an earlier attempt survives.
    state.unlink(missing_ok=True)
    shutil.rmtree(OUT / sensor / str(year), ignore_errors=True)

    zip_path = ZIPS / zip_name
    download(f"{BASE}/zips/{zip_name}", zip_path, entry["size"])
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.namelist() if m.endswith(".csv")]
    prefix = f"{sensor}_{year}_"
    jobs = []
    for member in members:
        base = Path(member).name
        if not base.startswith(prefix) or base not in listed:
            raise ValueError(f"{zip_name}: member {member} is not in the FIRMS index")
        size, updated = listed[base]
        jobs.append((zip_path, member, sensor, year, base[len(prefix):-4], size, updated))
    missing = {name for name in listed if name.startswith(prefix)} - {Path(m).name for m in members}
    if missing:
        raise ValueError(f"{zip_name}: index lists files the zip lacks: {sorted(missing)[:5]}")
    if not jobs:
        raise ValueError(f"{zip_name}: no CSV files inside")
    rows = sorted(pool.map(convert, jobs), key=lambda row: row["path"])
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=MANIFEST_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    write_atomically(state, buffer.getvalue().encode())
    if not keep_zips:
        zip_path.unlink()
    total = sum(row["rows"] for row in rows)
    size = sum(row["parquet_bytes"] for row in rows)
    return f"converted    {sensor} {year}: {len(rows)} files, {total:,} rows, {size / 1e6:.0f} MB ({problem})"


def finish(zips, listed, index_bytes, readme_bytes):
    """Check build/hf against the index and, if complete, write its manifest and index."""
    problems, rows = [], []
    for entry in zips:
        problem = state_problem(entry["sensor"], entry["year"], listed)
        if problem:
            problems.append(f"{entry['sensor']} {entry['year']}: {problem}")
        else:
            rows.extend(read_state(STATE / f"{entry['sensor']}_{entry['year']}.csv"))
    on_disk = {path.relative_to(OUT).as_posix() for path in OUT.rglob("*.parquet")}
    stray = sorted(on_disk - {row["path"] for row in rows})
    if stray:
        problems.append(f"{len(stray)} Parquet files not accounted for, e.g. {stray[:3]}")
    if problems:
        print(f"build/hf is NOT complete ({len(problems)} problems):")
        for problem in problems[:20]:
            print("  " + problem)
        return False
    rows.sort(key=lambda row: row["path"])
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=MANIFEST_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    write_atomically(OUT / "manifest.csv", buffer.getvalue().encode())
    write_atomically(OUT / "firms_index.csv", index_bytes)
    write_atomically(OUT / README_NAME, readme_bytes)
    print(f"build/hf is complete: {len(rows)} files, {sum(int(r['rows']) for r in rows):,} detections, "
          f"{sum(int(r['parquet_bytes']) for r in rows) / 1e9:.2f} GB of Parquet "
          f"from {sum(int(r['csv_bytes']) for r in rows) / 1e9:.2f} GB of CSV")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", nargs="*", default=[],
                        help="limit to sensor-years starting with these, e.g. modis_2000 viirs-snpp")
    parser.add_argument("--workers", type=int, default=4, help="CSV files converted at once")
    parser.add_argument("--downloads", type=int, default=2, help="zips handled at once")
    parser.add_argument("--keep-zips", action="store_true", help="do not delete zips when done")
    args = parser.parse_args()
    shutil.rmtree(TMP, ignore_errors=True)  # leftovers from a run that was killed
    for folder in (ZIPS, TMP, STATE, OUT):
        folder.mkdir(parents=True, exist_ok=True)

    index_bytes = get(INDEX_URL)
    readme_bytes = get(f"{BASE}/{README_NAME}")
    listed, zips = {}, []
    for entry in csv.DictReader(io.StringIO(index_bytes.decode("utf-8"))):
        name = entry["filename"]
        if name.endswith(".csv"):
            listed[name] = (int(entry["size"]), entry["updated"])
        elif name.endswith("_all_countries.zip"):
            sensor, year = name.split("_")[:2]
            zips.append({"filename": name, "sensor": sensor, "year": int(year),
                         "size": int(entry["size"])})
    unknown = sorted({z["sensor"] for z in zips} - set(SCHEMAS))
    if unknown:
        sys.exit(f"The index lists sensors this script has no schema for: {unknown}")
    zips.sort(key=lambda z: (z["size"], z["filename"]))
    chosen = [z for z in zips if not args.only
              or any(f"{z['sensor']}_{z['year']}".startswith(p) for p in args.only)]

    failed = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool, \
            ThreadPoolExecutor(max_workers=args.downloads) as downloads:
        futures = [(z, downloads.submit(process_zip, z, listed, pool, args.keep_zips)) for z in chosen]
        for entry, future in futures:
            try:
                print(future.result(), flush=True)
            except Exception as error:  # report every failure, then exit non-zero
                failed += 1
                print(f"FAILED       {entry['filename']}: {error}", flush=True)

    complete = finish(zips, listed, index_bytes, readme_bytes)
    if failed:
        sys.exit(f"{failed} sensor-years failed. Run again to retry them.")
    if not complete:
        sys.exit(1)


if __name__ == "__main__":
    main()
