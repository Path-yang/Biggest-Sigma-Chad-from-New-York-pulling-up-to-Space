"""Daily VIIRS counts per FIRMS country, 2012-2025, with exactly the summary v2 filters
(type 0, confidence n/h, same-year 0.05 degree static-source cell mask built from all three sensors
of that country's own files). Reads the read-only archive build/hf (never writes there).
Output: <OUT>/hist_daily.parquet with country, sensor ('V' S-NPP, 'N20' NOAA-20), d (DATE), n."""
import csv, os, sys, time
import duckdb

from pathlib import Path
REPO = str(Path(__file__).resolve().parents[2])
HF = f"{REPO}/build/hf"
OUT = sys.argv[1]
Y0, Y1 = 2012, 2025
BASE_STEP = 5000
LA = f"CAST(floor(round(latitude * 100000) / {BASE_STEP}) AS INTEGER)"
LO = f"CAST(floor(round(longitude * 100000) / {BASE_STEP}) AS INTEGER)"

rows = list(csv.DictReader(open(f"{HF}/manifest.csv")))
con = duckdb.connect()
con.execute(f"SET threads={os.cpu_count()}")
con.execute("CREATE TABLE fmap (filename VARCHAR, country VARCHAR, sensor VARCHAR, year INTEGER)")
con.executemany("INSERT INTO fmap VALUES (?, ?, ?, ?)", [(f"{HF}/{r['path']}", r["country"], r["sensor"], int(r["year"])) for r in rows])
con.execute("CREATE TABLE daily (country VARCHAR, sensor VARCHAR, d DATE, n BIGINT)")
for y in range(Y0, Y1 + 1):
    t = time.time()
    paths = {s: [f"{HF}/{r['path']}" for r in rows if r["sensor"] == s and int(r["year"]) == y] for s in ("modis", "viirs-snpp", "viirs-jpss1")}
    allp = [p for v in paths.values() for p in v]
    con.execute(f"""CREATE OR REPLACE TEMP TABLE m AS SELECT DISTINCT f.country, {LA} AS la, {LO} AS lo
        FROM read_parquet($p, filename=true, union_by_name=true) d JOIN fmap f USING (filename)
        WHERE d.type <> 0 AND year(d.acq_date) = {y}""", {"p": allp})
    for s, code in (("viirs-snpp", "V"), ("viirs-jpss1", "N20")):
        if not paths[s]:
            continue
        con.execute(f"""INSERT INTO daily SELECT country, '{code}', acq_date, count(*) FROM (
            SELECT f.country, d.acq_date, {LA} AS la, {LO} AS lo
            FROM read_parquet($p, filename=true) d JOIN fmap f USING (filename)
            WHERE d.type = 0 AND d.confidence IN ('n', 'h') AND year(d.acq_date) = {y}) x
            ANTI JOIN m USING (country, la, lo) GROUP BY ALL""", {"p": paths[s]})
    nm = con.execute("SELECT count(*) FROM m").fetchone()[0]
    print(f"{y}: mask {nm:,} cells, {time.time() - t:.0f}s", flush=True)
con.execute(f"COPY (SELECT * FROM daily ORDER BY country, sensor, d) TO '{OUT}/hist_daily.parquet' (FORMAT parquet)")
print("done", con.execute("SELECT sensor, count(*), sum(n) FROM daily GROUP BY 1").fetchall())
