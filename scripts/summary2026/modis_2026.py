"""2026 MODIS (Terra, Aqua) detections per FIRMS country, for the raw T/A series only (from Feb 2012
the harmonized record is VIIRS; MODIS is shown, not used). Filters as close to v2 as the data allow:
confidence >= 30; SP rows (Jan-Aug) need FIRMS type 0; NRT rows (Sep-Nov) have no type; every row
in a 2026 static-source cell is dropped: the VIIRS 2026 mask (raw/mask_2026_cells.parquet) plus the
cells of 2026 MODIS SP type 1/2/3 detections at any confidence. Countries by the fetch task's
point-in-polygon (Natural Earth 10m, nearest shape within 0.01 degree).
Usage: modis_2026.py DL_DIR RAW_DIR PIP_SCRIPTS_DIR OUT_DIR"""
import glob, json, os, sys
import duckdb, numpy as np

DL, RAW, PIPDIR, OUT = sys.argv[1:5]
sys.path.insert(0, PIPDIR)
import firms_pip as P  # noqa: E402

LAST = "2026-11-14"
COLS = {"latitude": "DOUBLE", "longitude": "DOUBLE", "brightness": "DOUBLE", "scan": "DOUBLE", "track": "DOUBLE",
        "acq_date": "DATE", "acq_time": "INTEGER", "satellite": "VARCHAR", "instrument": "VARCHAR", "confidence": "INTEGER",
        "version": "VARCHAR", "bright_t31": "DOUBLE", "frp": "DOUBLE", "daynight": "VARCHAR"}
con = duckdb.connect()
con.execute(f"SET threads={os.cpu_count()}")
log = {}
parts = []
for src in ("MODIS_SP", "MODIS_NRT"):
    files = sorted(glob.glob(f"{DL}/{src}/*.csv.gz"))
    if not files:
        print("WARNING: no files for", src)
        continue
    cols = dict(COLS, **({"type": "TINYINT"} if src == "MODIS_SP" else {}))
    sel = "*" if src == "MODIS_SP" else "*, CAST(NULL AS TINYINT) AS type"
    con.execute(f"CREATE TEMP TABLE r_{src} AS SELECT {sel}, '{src[6:]}' AS source FROM read_csv($f, header=true, columns=$c)",
                {"f": files, "c": cols})
    n = con.execute(f"SELECT count(*) FROM r_{src}").fetchone()[0]
    nd = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT * FROM r_{src})").fetchone()[0]
    log[src] = {"files": len(files), "first": files[0][-17:-7], "last": files[-1][-17:-7], "rows": n, "exact_duplicates": n - nd}
    parts.append(f"SELECT DISTINCT * FROM r_{src}")
con.execute(f"CREATE TEMP TABLE m AS SELECT row_number() OVER () - 1 AS rid, * FROM ({' UNION ALL '.join(parts)})")
d = con.execute("SELECT latitude, longitude FROM m ORDER BY rid").fetchnumpy()
idx = P.load()
ci, how = P.assign(idx, d["longitude"], d["latitude"], 0.01)
names = np.array(idx["names"], dtype=object)
pip = {"rid": np.arange(len(ci), dtype=np.int64), "ci": ci.astype(np.int32)}
cn = {"ci": np.arange(len(names), dtype=np.int32), "country": names}
LA = "CAST(floor(round(latitude * 100000) / 5000) AS INTEGER)"
LO = "CAST(floor(round(longitude * 100000) / 5000) AS INTEGER)"
con.execute(f"CREATE TEMP TABLE mask AS SELECT la, lo FROM read_parquet('{RAW}/mask_2026_cells.parquet') "
            f"UNION SELECT DISTINCT {LA}, {LO} FROM m WHERE type <> 0")
con.execute(f"""CREATE TEMP TABLE f AS SELECT cn.country, m.latitude, m.longitude, {LA} AS la, {LO} AS lo, m.acq_date,
        CASE WHEN m.satellite IN ('Terra', 'T') THEN 'T' WHEN m.satellite IN ('Aqua', 'A') THEN 'A' END AS sat,
        m.confidence, m.type, m.source
    FROM m JOIN pip USING (rid) JOIN cn USING (ci)""")
log["rows_with_country"] = con.execute("SELECT count(*) FROM f").fetchone()[0]
log["no_country"] = int((ci < 0).sum())
log["satellite_values"] = con.execute("SELECT sat, count(*) FROM f GROUP BY 1").fetchall()
con.execute(f"""COPY (SELECT country, la, lo, acq_date, sat, count(*)::INTEGER AS n FROM f ANTI JOIN mask USING (la, lo)
        WHERE confidence >= 30 AND (type = 0 OR type IS NULL) AND acq_date <= DATE '{LAST}' GROUP BY ALL ORDER BY ALL)
    TO '{OUT}/modis_2026_cells_daily.parquet' (FORMAT parquet)""")
# per satellite and day: world rows in countries (all confidences), to spot gaps
con.execute(f"COPY (SELECT sat, acq_date, count(*) AS n, max(source) AS source FROM f GROUP BY ALL ORDER BY ALL) TO '{OUT}/modis_2026_days.csv' (HEADER)")
log["final_rows"] = con.execute(f"SELECT sum(n) FROM '{OUT}/modis_2026_cells_daily.parquet'").fetchone()[0]
log["mask_cells"] = con.execute("SELECT count(*) FROM mask").fetchone()[0]
json.dump(log, open(f"{OUT}/modis_2026_log.json", "w"), indent=1, default=str)
print(json.dumps(log, indent=1, default=str))
