#!/usr/bin/env python3
"""Build the finer map layers that load as the reader zooms in.

Run after build_tiles.py (it reads the harmonization factors from meta.json).

Outputs (under webapp/public/data/):
  f1/<year>/<tx>_<ty>.bin.gz   0.05 degree cells (about 5.5 km), one file per 10 degree tile and year,
                               harmonized count per cell and month
  f2/<tx>_<ty>.bin.gz          0.01 degree cells (about 1.1 km), one file per 2 degree tile,
                               harmonized count per cell and year
  fine.json                    which files exist

Harmonized count, as in build_tiles.py: MODIS detections weighted by the regional factor up to
Jan 2012, detections seen by the reference VIIRS satellite from Feb 2012.
"""
import gzip
import json
import struct
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "webapp" / "public" / "data"
meta = json.loads((OUT / "meta.json").read_text())
MI_SPLIT, MI_AQUA = meta["miSplit"], meta["miAqua"]

t0 = time.time()
con = duckdb.connect()
con.execute(f"SET threads=10; SET memory_limit='16GB'; SET temp_directory='{DATA / 'tmp'}'")
con.execute("CREATE TABLE region(rx INTEGER, ry INTEGER, k DOUBLE, a DOUBLE)")
con.executemany("INSERT INTO region VALUES (?, ?, ?, ?)",
                [[int(key.split("_")[0]), int(key.split("_")[1]), k, a] for key, (k, a) in meta["regions"].items()])

MI = "((year(d) - 2000) * 12 + month(d) - 1)"
con.execute(f"""
    CREATE VIEW pts AS
    WITH modis AS (
        SELECT lat, lon, d FROM '{DATA / 'events.parquet'}' WHERE instrument = 'MODIS'
        UNION ALL
        SELECT CAST(latitude AS DOUBLE), CAST(longitude AS DOUBLE), CAST(acq_date AS DATE)
        FROM read_csv('{DATA}/tmp/modis_late/modis/2012/*.csv', header=true, all_varchar=true, union_by_name=true)
        WHERE acq_date BETWEEN '2012-01-20' AND '2012-01-31'
    )
    SELECT m.lat, m.lon, m.d,
           coalesce(r.k, {meta['kWorld']}) * (CASE WHEN {MI} < {MI_AQUA} THEN coalesce(r.a, {meta['aWorld']}) ELSE 1.0 END) AS w
    FROM modis m LEFT JOIN region r
      ON r.rx = LEAST(71, CAST(floor((m.lon + 180) / 5) AS INTEGER)) AND r.ry = LEAST(35, CAST(floor((m.lat + 90) / 5) AS INTEGER))
    UNION ALL
    SELECT lat, lon, d, 1.0 AS w FROM '{DATA / 'events.parquet'}'
    WHERE instrument = 'VIIRS' AND {MI} > {MI_SPLIT}
      AND (seen_snpp = 1 OR (d > DATE '2026-11-02' AND seen_noaa20 = 1))
""")


def write_files(jobs):
    def one(job):
        path, payload = job
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wb", compresslevel=5) as f:
            f.write(payload)
        return path.stat().st_size
    with ThreadPoolExecutor(8) as pool:
        return sum(pool.map(one, jobs))


def u16(a):
    return np.clip(np.rint(a), 1, 65535).astype("<u2").tobytes()


def slices(key):
    b = np.flatnonzero(np.diff(key)) + 1
    return zip(np.concatenate(([0], b)), np.concatenate((b, [len(key)])))


# ---- level 1: 0.05 degree cells, per 10 degree tile and year, by month ----
print("level 1 (0.05 degree) ...", flush=True)
r = con.execute("""
    WITH c AS (
        SELECT LEAST(7199, GREATEST(0, CAST(floor((lon + 180) / 0.05) AS INTEGER))) AS col,
               LEAST(3599, GREATEST(0, CAST(floor((lat + 90) / 0.05) AS INTEGER))) AS row, d, w FROM pts
    )
    SELECT CAST((year(d) - 2000) * 1000 + (row // 200) * 36 + col // 200 AS INTEGER) AS key,
           CAST((row % 200) * 200 + col % 200 AS USMALLINT) AS cell,
           CAST(month(d) - 1 AS UTINYINT) AS mon, CAST(sum(w) AS FLOAT) AS h
    FROM c GROUP BY ALL ORDER BY 1, 2, 3
""").fetchnumpy()
key = np.asarray(r["key"])
index1, jobs = {}, []
for a, b in slices(key):
    k = int(key[a]); y, t = 2000 + k // 1000, k % 1000
    name = f"{t % 36}_{t // 36}"
    index1.setdefault(str(y), []).append(name)
    payload = b"".join([b"FCF1", struct.pack("<I", b - a), np.asarray(r["cell"][a:b]).astype("<u2").tobytes(),
                        u16(np.asarray(r["h"][a:b])), np.asarray(r["mon"][a:b]).astype("u1").tobytes()])
    jobs.append((OUT / "f1" / str(y) / f"{name}.bin.gz", payload))
size1 = write_files(jobs)
print(f"  {len(key):,} cell-months in {len(jobs):,} files, {size1 / 1e6:.0f} MB  ({time.time() - t0:.0f}s)", flush=True)
del r, key, jobs

# ---- level 2: 0.01 degree cells, per 2 degree tile, by year ----
print("level 2 (0.01 degree) ...", flush=True)
r = con.execute("""
    WITH c AS (
        SELECT LEAST(35999, GREATEST(0, CAST(floor((lon + 180) / 0.01) AS INTEGER))) AS col,
               LEAST(17999, GREATEST(0, CAST(floor((lat + 90) / 0.01) AS INTEGER))) AS row, d, w FROM pts
    )
    SELECT CAST((row // 200) * 180 + col // 200 AS INTEGER) AS key,
           CAST(year(d) - 2000 AS UTINYINT) AS y,
           CAST((row % 200) * 200 + col % 200 AS USMALLINT) AS cell, CAST(sum(w) AS FLOAT) AS h
    FROM c GROUP BY ALL ORDER BY 1, 2, 3
""").fetchnumpy()
key = np.asarray(r["key"])
index2, jobs = [], []
for a, b in slices(key):
    k = int(key[a])
    name = f"{k % 180}_{k // 180}"
    index2.append(name)
    payload = b"".join([b"FCF2", struct.pack("<I", b - a), np.asarray(r["cell"][a:b]).astype("<u2").tobytes(),
                        u16(np.asarray(r["h"][a:b])), np.asarray(r["y"][a:b]).astype("u1").tobytes()])
    jobs.append((OUT / "f2" / f"{name}.bin.gz", payload))
size2 = write_files(jobs)
print(f"  {len(key):,} cell-years in {len(jobs):,} files, {size2 / 1e6:.0f} MB  ({time.time() - t0:.0f}s)", flush=True)

(OUT / "fine.json").write_text(json.dumps({"f1": index1, "f2": index2}, separators=(",", ":")))
total = sum(1 for p in OUT.rglob("*") if p.is_file())
print(f"DONE in {time.time() - t0:.0f}s: {total:,} files under data/, {sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file()) / 1e6:.0f} MB", flush=True)
