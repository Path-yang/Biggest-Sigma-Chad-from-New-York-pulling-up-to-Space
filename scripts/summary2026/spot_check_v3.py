"""End-to-end spot check of v3 2026 monthly values against fresh FIRMS area requests.
For a box that holds one country's land and nothing else (other land cut out by simple rules), count API rows at
confidence n/h (and type 0 where the source has a type), drop the 2026 static-source mask cells, and compare with
v3 (y2026.v_obs for S-NPP on its complete days, monthly.N20 for NOAA-20). Usage: spot_v3.py RAW V3 OUT_TXT"""
import csv, datetime as dt, io, json, os, sys
import duckdb
sys.path.insert(0, os.environ["Y2026_FETCH_SCRIPTS"])  # the fetch task's FIRMS client (firms.py)
import firms

RAW, V3, OUT = sys.argv[1:4]
mask = {tuple(r) for r in duckdb.sql(f"SELECT la, lo FROM '{RAW}/mask_2026_cells.parquet'").fetchall()}
status = {}
for r in csv.DictReader(open(f"{RAW}/coverage_days.csv")):
    status[(r["sensor"], r["date"])] = r["status"]
BOXES = {
    # Madagascar; Comoros and Mayotte (north-west of 46E, 13.1S) cut out
    "Madagascar": ("43.0,-25.8,50.7,-11.8", lambda la, lo: not (la > -13.1 and lo < 46.0)),
    # Australia; Timor, Rote and PNG islands cut out
    "Australia": ("112.0,-44.0,154.0,-10.0", lambda la, lo: not ((la > -11.2 and lo < 129.0) or (la > -12.0 and lo > 143.6) or la > -10.6)),
}
CHECKS = [  # country, source, first day, last day
    ("Madagascar", "VIIRS_SNPP_NRT", "2026-09-01", "2026-09-30"), ("Madagascar", "VIIRS_NOAA20_NRT", "2026-09-01", "2026-09-30"),
    ("Madagascar", "VIIRS_NOAA20_NRT", "2026-11-01", "2026-11-14"),
    ("Madagascar", "VIIRS_SNPP_SP", "2026-06-01", "2026-06-30"), ("Madagascar", "VIIRS_NOAA20_SP", "2026-06-01", "2026-06-30"),
    ("Australia", "VIIRS_SNPP_NRT", "2026-09-01", "2026-09-30"), ("Australia", "VIIRS_NOAA20_NRT", "2026-09-01", "2026-09-30"),
    ("Australia", "VIIRS_NOAA20_NRT", "2026-11-01", "2026-11-14"),
]
cell = lambda x: int((round(x * 100000)) // 5000)
lines = []
for c, src, a, b in CHECKS:
    d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    box, keep = BOXES[c]
    sensor = "viirs-snpp" if "SNPP" in src else "viirs-noaa20"
    n = 0
    d = d0
    while d <= d1:
        span = min(5, (d1 - d).days + 1)
        body = firms.get(f"/api/area/csv/{{KEY}}/{src}/{box}/{span}/{d.isoformat()}").decode()
        assert body.startswith("latitude,"), firms.redact(body[:200])
        for r in csv.DictReader(io.StringIO(body)):
            la, lo = float(r["latitude"]), float(r["longitude"])
            if r["confidence"] not in ("n", "h") or ("type" in r and r["type"] != "0"):
                continue
            if not keep(la, lo) or (cell(la), cell(lo)) in mask:
                continue
            if sensor == "viirs-snpp" and status.get((sensor, r["acq_date"])) != "ok":
                continue  # v_obs counts S-NPP on complete days only
            n += 1
        d += dt.timedelta(span)
    v = json.load(open(f"{V3}/{c}.json"))
    i = (d0.year - 2001) * 12 + d0.month - 1
    ref = v["y2026"]["v_obs"][d0.month - 1] if sensor == "viirs-snpp" else v["monthly"]["N20"][i]
    lines.append(f"{c:11s} {src:17s} {a}..{b}: API box {n:7d}  v3 {ref:7d}  diff {(ref - n) / max(n, 1):+.3%}")
    print(lines[-1], flush=True)
open(OUT, "w").write("\n".join(lines) + "\n")
