#!/usr/bin/env python3
"""Build the map layers that let every view (month, year, all years) sharpen as the reader zooms.

Run after build_tiles.py and build_fine.py.

Outputs (under webapp/public/data/):
  g/y/all.bin.gz            world layer, all years summed, 0.25 degree cells
  f1/all/<tx>_<ty>.bin.gz   0.05 degree cells (about 5.5 km), all years summed, per 10 degree tile
  f3/<tx>_<ty>.bin.gz       0.01 degree cells (about 1.1 km), per 2 degree tile, by month for the
                            whole record (the page sums months into a year or into all years)
  fine2.json                which files exist
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
con.execute(f"SET threads=10; SET memory_limit='14GB'; SET temp_directory='{DATA / 'tmp'}'")
con.execute("CREATE TABLE region(rx INTEGER, ry INTEGER, k DOUBLE, a DOUBLE)")
con.executemany("INSERT INTO region VALUES (?, ?, ?, ?)",
                [[int(key.split("_")[0]), int(key.split("_")[1]), k, a] for key, (k, a) in meta["regions"].items()])

MI = "((year(d) - 2000) * 12 + month(d) - 1)"
# one weighted point per detection that counts toward the harmonized record
con.execute(f"""
    CREATE TABLE pts AS
    WITH modis AS (
        SELECT lat, lon, d FROM '{DATA / 'events.parquet'}' WHERE instrument = 'MODIS'
        UNION ALL
        SELECT CAST(latitude AS DOUBLE), CAST(longitude AS DOUBLE), CAST(acq_date AS DATE)
        FROM read_csv('{DATA}/tmp/modis_late/modis/2012/*.csv', header=true, all_varchar=true, union_by_name=true)
        WHERE acq_date BETWEEN '2012-01-20' AND '2012-01-31'
    )
    SELECT CAST(LEAST(35999, GREATEST(0, floor((m.lon + 180) / 0.01))) AS INTEGER) AS col,
           CAST(LEAST(17999, GREATEST(0, floor((m.lat + 90) / 0.01))) AS INTEGER) AS row,
           CAST({MI} AS USMALLINT) AS mi,
           CAST(coalesce(r.k, {meta['kWorld']}) * (CASE WHEN {MI} < {MI_AQUA} THEN coalesce(r.a, {meta['aWorld']}) ELSE 1.0 END) AS FLOAT) AS w
    FROM modis m LEFT JOIN region r
      ON r.rx = LEAST(71, CAST(floor((m.lon + 180) / 5) AS INTEGER)) AND r.ry = LEAST(35, CAST(floor((m.lat + 90) / 5) AS INTEGER))
    UNION ALL
    SELECT CAST(LEAST(35999, GREATEST(0, floor((lon + 180) / 0.01))) AS INTEGER),
           CAST(LEAST(17999, GREATEST(0, floor((lat + 90) / 0.01))) AS INTEGER),
           CAST({MI} AS USMALLINT), CAST(1.0 AS FLOAT)
    FROM '{DATA / 'events.parquet'}'
    WHERE instrument = 'VIIRS' AND {MI} > {MI_SPLIT}
      AND (seen_snpp = 1 OR (d > DATE '2026-11-02' AND seen_noaa20 = 1))
""")
print(f"points: {con.execute('SELECT count(*) FROM pts').fetchone()[0]:,}  ({time.time() - t0:.0f}s)", flush=True)


def write_files(jobs):
    def one(job):
        path, payload = job
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wb", compresslevel=5) as f:
            f.write(payload)
        return path.stat().st_size
    with ThreadPoolExecutor(8) as pool:
        return sum(pool.map(one, jobs))


def slices(key):
    b = np.flatnonzero(np.diff(key)) + 1
    return zip(np.concatenate(([0], b)), np.concatenate((b, [len(key)])))


# ---- world layer, all years ----
g = con.execute("SELECT (row // 25) * 1440 + col // 25 AS idx, sum(w) AS h FROM pts GROUP BY 1 ORDER BY 1").fetchnumpy()
payload = b"".join([b"FCG1", struct.pack("<I", len(g["idx"])), np.asarray(g["idx"]).astype("<u4").tobytes(),
                    np.asarray(g["h"]).astype("<f4").tobytes()])
write_files([(OUT / "g" / "y" / "all.bin.gz", payload)])
print(f"world all-years layer: {len(g['idx']):,} cells", flush=True)

# ---- 0.05 degree, all years, per 10 degree tile ----
r = con.execute("""
    SELECT CAST((row // 1000) * 36 + col // 1000 AS INTEGER) AS key,
           CAST(((row // 5) % 200) * 200 + (col // 5) % 200 AS USMALLINT) AS cell, CAST(sum(w) AS FLOAT) AS h
    FROM pts GROUP BY ALL ORDER BY 1, 2
""").fetchnumpy()
key = np.asarray(r["key"]); f1_all, jobs = [], []
for a, b in slices(key):
    t = int(key[a]); name = f"{t % 36}_{t // 36}"
    f1_all.append(name)
    payload = b"".join([b"FCF1", struct.pack("<I", b - a), np.asarray(r["cell"][a:b]).astype("<u2").tobytes(),
                        np.clip(np.rint(np.asarray(r["h"][a:b])), 1, 65535).astype("<u2").tobytes(),
                        np.zeros(b - a, dtype="u1").tobytes()])
    jobs.append((OUT / "f1" / "all" / f"{name}.bin.gz", payload))
size = write_files(jobs)
print(f"5.5 km all-years: {len(jobs)} files, {size / 1e6:.0f} MB  ({time.time() - t0:.0f}s)", flush=True)
del r, key, jobs

# ---- 0.01 degree by month, per 2 degree tile, in latitude bands to bound memory ----
f3, total_n, total_size = [], 0, 0
for band in range(0, 90, 10):
    r = con.execute(f"""
        SELECT CAST((row // 200) * 180 + col // 200 AS INTEGER) AS key, mi,
               CAST((row % 200) * 200 + col % 200 AS USMALLINT) AS cell, CAST(sum(w) AS FLOAT) AS h
        FROM pts WHERE row // 200 >= {band} AND row // 200 < {band + 10}
        GROUP BY ALL ORDER BY 1, 2, 3
    """).fetchnumpy()
    key = np.asarray(r["key"])
    if not len(key):
        continue
    jobs = []
    for a, b in slices(key):
        k = int(key[a]); name = f"{k % 180}_{k // 180}"
        f3.append(name)
        payload = b"".join([b"FCF3", struct.pack("<I", b - a), np.asarray(r["cell"][a:b]).astype("<u2").tobytes(),
                            np.asarray(r["mi"][a:b]).astype("<u2").tobytes(),
                            np.clip(np.rint(np.asarray(r["h"][a:b])), 1, 255).astype("u1").tobytes()])
        jobs.append((OUT / "f3" / f"{name}.bin.gz", payload))
    total_n += len(key); total_size += write_files(jobs)
    print(f"  band {band}: {len(key):,} cell-months, {len(jobs)} files  ({time.time() - t0:.0f}s)", flush=True)
    del r, key, jobs
print(f"1 km by month: {total_n:,} cell-months in {len(f3):,} files, {total_size / 1e6:.0f} MB", flush=True)

f1 = json.loads((OUT / "fine.json").read_text())["f1"]
f1["all"] = f1_all
(OUT / "fine2.json").write_text(json.dumps({"f1": f1, "f3": f3}, separators=(",", ":")))
print(f"DONE in {time.time() - t0:.0f}s", flush=True)
