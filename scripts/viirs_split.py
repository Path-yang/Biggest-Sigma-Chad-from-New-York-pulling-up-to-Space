#!/usr/bin/env python3
"""Step 1 of the VIIRS merge: split one sensor CSV into per-year Parquet files.

Usage: viirs_split.py SENSOR THREADS      (SENSOR: snpp, noaa20, noaa21)
Reads data/viirs_<SENSOR>.csv, writes data/parts/<SENSOR>/yr=<YYYY>/*.parquet.
All columns are kept as text so values come out exactly as they went in.
"""
import sys
import time
from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parent.parent / "data"
sensor, threads = sys.argv[1], int(sys.argv[2])

out = DATA / "parts" / sensor
out.mkdir(parents=True, exist_ok=True)
(DATA / "tmp").mkdir(exist_ok=True)

con = duckdb.connect()
con.execute(f"SET threads={threads}; SET memory_limit='6GB'; SET temp_directory='{DATA / 'tmp'}'; SET preserve_insertion_order=false;")
t = time.time()
con.execute(f"""
    COPY (
        SELECT *, substr(acq_date, 1, 4) AS yr
        FROM read_csv('{DATA / f'viirs_{sensor}.csv'}', header=true, all_varchar=true)
    ) TO '{out}' (FORMAT parquet, PARTITION_BY (yr), COMPRESSION snappy, OVERWRITE_OR_IGNORE)
""")
n = con.execute(f"SELECT count(*) FROM read_parquet('{out}/*/*.parquet')").fetchone()[0]
print(f"SPLIT {sensor}: {n:,} rows in {time.time() - t:.0f}s", flush=True)
