#!/usr/bin/env python3
"""Step 2 of the VIIRS merge: combine the three satellites for one year and deduplicate.

Usage: viirs_dedupe.py YEAR THREADS [PARTS_DIR] [OUT_DIR]

Rule: rows are the same fire sighting if they share
  - the same ground cell (about 390 m: 0.0035 deg of latitude, longitude scaled by cos(latitude)),
  - the same acq_date,
  - the same daynight flag.
One row is kept per group: NOAA-21 first, then NOAA-20, then S-NPP; within a satellite, the
highest frp. Three columns record which satellites saw the group: seen_snpp, seen_noaa20,
seen_noaa21 (1 or 0). The satellite column is rewritten to one label per satellite
(SNPP, N20, N21), because the source files label S-NPP as both "N" and "SNPP".

Writes OUT_DIR/viirs_<YEAR>.csv (no header, sorted by date and time) and prints one STATS line.
Duplicates never cross dates, so each month is processed on its own to keep memory small.
"""
import sys
import time
from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parent.parent / "data"
year, threads = sys.argv[1], int(sys.argv[2])
parts = Path(sys.argv[3]) if len(sys.argv) > 3 else DATA / "parts"
out_dir = Path(sys.argv[4]) if len(sys.argv) > 4 else DATA / "merged_parts"
out_dir.mkdir(parents=True, exist_ok=True)
(DATA / "tmp").mkdir(exist_ok=True)

COLS = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
        "confidence,version,bright_ti5,frp,daynight,type").split(",")
CELL = 0.0035
PRIO = {"noaa21": 1, "noaa20": 2, "snpp": 3}   # lower wins

sources = []
for sensor, prio in PRIO.items():
    d = parts / sensor / f"yr={year}"
    if d.exists():
        sources.append(f"SELECT {', '.join(COLS)}, {prio} AS prio FROM read_parquet('{d}/*.parquet')")
if not sources:
    sys.exit(f"no input for {year}")

con = duckdb.connect()
con.execute(f"SET threads={threads}; SET memory_limit='6GB'; SET temp_directory='{DATA / 'tmp'}'; SET preserve_insertion_order=false;")
t = time.time()
SAT = "CASE prio WHEN 1 THEN 'N21' WHEN 2 THEN 'N20' ELSE 'SNPP' END"
row = ", ".join(f"{c} := {SAT if c == 'satellite' else c}" for c in COLS)
out_cols = ", ".join("nullif(r.type, '') AS type" if c == "type" else "r." + c for c in COLS)
out_path = out_dir / f"viirs_{year}.csv"
tmp_path = out_dir / f"viirs_{year}.month.tmp"
totals = [0] * 10
lo, hi = None, None

with open(out_path, "wb") as out:
    for month in range(1, 13):
        ym = f"{year}-{month:02d}"
        con.execute("DROP TABLE IF EXISTS merged")
        con.execute(f"""
            CREATE TEMP TABLE merged AS
            WITH src AS ({' UNION ALL '.join(sources)}),
            k AS (
                SELECT *, CAST(floor(CAST(latitude AS DOUBLE) / {CELL}) AS INTEGER) AS yb,
                       coalesce(TRY_CAST(frp AS DOUBLE), 0) AS f
                FROM src WHERE acq_date >= '{ym}-01' AND acq_date <= '{ym}-31'
            ),
            c AS (
                SELECT *, CAST(floor(CAST(longitude AS DOUBLE) * cos(radians((yb + 0.5) * {CELL})) / {CELL}) AS INTEGER) AS xb
                FROM k
            )
            SELECT arg_min(struct_pack({row}), prio * 10000000 - least(f, 9000000)) AS r,
                   max(CASE WHEN prio = 3 THEN 1 ELSE 0 END) AS seen_snpp,
                   max(CASE WHEN prio = 2 THEN 1 ELSE 0 END) AS seen_noaa20,
                   max(CASE WHEN prio = 1 THEN 1 ELSE 0 END) AS seen_noaa21,
                   count(*) AS n_in,
                   sum(CASE WHEN prio = 3 THEN 1 ELSE 0 END) AS in_snpp,
                   sum(CASE WHEN prio = 2 THEN 1 ELSE 0 END) AS in_noaa20,
                   sum(CASE WHEN prio = 1 THEN 1 ELSE 0 END) AS in_noaa21
            FROM c
            GROUP BY acq_date, daynight, yb, xb
        """)
        s = con.execute("""
            SELECT count(*), sum(n_in), sum(in_snpp), sum(in_noaa20), sum(in_noaa21),
                   sum(seen_snpp), sum(seen_noaa20), sum(seen_noaa21),
                   sum(CASE WHEN seen_snpp + seen_noaa20 + seen_noaa21 = 2 THEN 1 ELSE 0 END),
                   sum(CASE WHEN seen_snpp + seen_noaa20 + seen_noaa21 = 3 THEN 1 ELSE 0 END),
                   min(r.acq_date), max(r.acq_date)
            FROM merged
        """).fetchone()
        if not s[0]:
            continue
        con.execute(f"""
            COPY (
                SELECT {out_cols}, seen_snpp, seen_noaa20, seen_noaa21
                FROM merged ORDER BY r.acq_date, r.acq_time, r.latitude, r.longitude
            ) TO '{tmp_path}' (FORMAT csv, HEADER false)
        """)
        with open(tmp_path, "rb") as f:
            while True:
                buf = f.read(1 << 24)
                if not buf:
                    break
                out.write(buf)
        totals = [a + int(b) for a, b in zip(totals, s[:10])]
        lo = s[10] if lo is None else min(lo, s[10])
        hi = s[11] if hi is None else max(hi, s[11])

if tmp_path.exists():
    tmp_path.unlink()
s = totals
print(f"STATS {year} out={s[0]} in={s[1]} in_snpp={s[2]} in_noaa20={s[3]} in_noaa21={s[4]} "
      f"seen_snpp={s[5]} seen_noaa20={s[6]} seen_noaa21={s[7]} by2={s[8]} by3={s[9]} "
      f"dates={lo}..{hi} secs={time.time() - t:.0f}", flush=True)
