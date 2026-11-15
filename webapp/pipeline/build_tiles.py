#!/usr/bin/env python3
"""Build the web app's data files from the hotspot records.

Inputs (all under data/):
  events.parquet                      the combined file (MODIS to 19 Jan 2012, merged VIIRS after)
  tmp/modis_late/modis/<year>/*.csv   MODIS 2012-2025 yearly country files (for the overlap years)
  tmp/modis_arch/*.csv                MODIS archive download (2026)

Outputs (under webapp/public/data/):
  meta.json            grid description, tile list, world monthly series, harmonization factors
  t/<tx>_<ty>.bin.gz   one file per 10x10 degree tile: monthly counts per 0.25 degree cell
  g/y/<year>.bin.gz    world map layer: harmonized count per cell for one year
  g/m/<mi>.bin.gz      world map layer: harmonized count per cell for one month

Counts stored per cell and month:
  m  MODIS detections (Terra + Aqua), whole record 2000-2026
  v  VIIRS detections, three satellites merged and deduplicated
  s  VIIRS reference series: detections seen by S-NPP (by NOAA-20 after S-NPP ended, 2 Nov 2026)

Harmonized count h ("S-NPP-equivalent"):
  months up to Jan 2012:  h = m * k_region * a_region (a only before Jul 2002, Terra flying alone)
  months from Feb 2012:   h = s
  k_region = S-NPP-seen / MODIS over Feb 2012 - Dec 2025 in a 5 degree region (shrunk to the world ratio)
  a_region = (Terra + Aqua) / Terra over 2003-2011 in the same region (shrunk to the world ratio)
"""
import gzip
import json
import struct
import time
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "webapp" / "public" / "data"
RES = 0.25
NCOL, NROW = 1440, 720
TILE = 40            # cells per tile side (10 degrees)
REGION = 20          # cells per harmonization region side (5 degrees)
MI_SPLIT = 144       # Jan 2012: last month taken from MODIS
MI_AQUA = 30         # Jul 2002: first month with Aqua
MI_K0, MI_K1 = 145, 311   # Feb 2012 .. Dec 2025: overlap used for k
MI_A0, MI_A1 = 36, 143    # Jan 2003 .. Dec 2011: used for the Terra-only factor
SHRINK = 500.0

t0 = time.time()
con = duckdb.connect()
con.execute(f"SET threads=10; SET memory_limit='16GB'; SET temp_directory='{DATA / 'tmp'}'")

KEY = ("LEAST(1439, GREATEST(0, CAST(floor((lon + 180) / 0.25) AS INTEGER))) AS col, "
       "LEAST(719, GREATEST(0, CAST(floor((lat + 90) / 0.25) AS INTEGER))) AS row, "
       "(year(d) - 2000) * 12 + month(d) - 1 AS mi")

print("aggregating MODIS ...", flush=True)
con.execute(f"""
    CREATE TABLE modis AS
    WITH early AS (
        SELECT lat, lon, d, satellite FROM '{DATA / 'events.parquet'}' WHERE instrument = 'MODIS'
    ), late AS (
        SELECT CAST(latitude AS DOUBLE) lat, CAST(longitude AS DOUBLE) lon, CAST(acq_date AS DATE) d, satellite
        FROM read_csv('{DATA}/tmp/modis_late/modis/*/*.csv', header=true, all_varchar=true, union_by_name=true)
        WHERE acq_date >= '2012-01-20'
    ), arch AS (
        SELECT CAST(latitude AS DOUBLE) lat, CAST(longitude AS DOUBLE) lon, CAST(acq_date AS DATE) d, satellite
        FROM read_csv('{DATA}/tmp/modis_arch/*.csv', header=true, all_varchar=true, union_by_name=true)
        WHERE acq_date >= '2026-01-01'
    ), allm AS (SELECT * FROM early UNION ALL SELECT * FROM late UNION ALL SELECT * FROM arch)
    SELECT {KEY}, count(*) AS m,
           count(*) FILTER (satellite = 'Terra') AS terra,
           count(*) FILTER (satellite = 'Aqua') AS aqua
    FROM allm GROUP BY ALL
""")
print("  modis rows", con.execute("SELECT sum(m), sum(terra), sum(aqua), count(*) FROM modis").fetchone(), flush=True)

print("aggregating VIIRS ...", flush=True)
con.execute(f"""
    CREATE TABLE viirs AS
    SELECT {KEY}, count(*) AS v,
           count(*) FILTER (seen_snpp = 1 OR (d > DATE '2026-11-02' AND seen_noaa20 = 1)) AS s
    FROM '{DATA / 'events.parquet'}' WHERE instrument = 'VIIRS' GROUP BY ALL
""")
print("  viirs rows", con.execute("SELECT sum(v), sum(s), count(*) FROM viirs").fetchone(), flush=True)

con.execute("""
    CREATE TABLE agg AS
    SELECT coalesce(a.col, b.col) AS col, coalesce(a.row, b.row) AS row, coalesce(a.mi, b.mi) AS mi,
           coalesce(a.m, 0) AS m, coalesce(a.terra, 0) AS terra, coalesce(a.aqua, 0) AS aqua,
           coalesce(b.v, 0) AS v, coalesce(b.s, 0) AS s
    FROM modis a FULL OUTER JOIN viirs b ON a.col = b.col AND a.row = b.row AND a.mi = b.mi
""")

# ---- harmonization factors per 5 degree region ----
kg, ag = con.execute(f"""
    SELECT (SELECT sum(s)::DOUBLE / sum(m) FROM agg WHERE mi BETWEEN {MI_K0} AND {MI_K1}),
           (SELECT (sum(terra) + sum(aqua))::DOUBLE / sum(terra) FROM agg WHERE mi BETWEEN {MI_A0} AND {MI_A1})
""").fetchone()
con.execute(f"""
    CREATE TABLE region AS
    SELECT col // {REGION} AS rx, row // {REGION} AS ry,
           (coalesce(sum(s) FILTER (mi BETWEEN {MI_K0} AND {MI_K1}), 0) + {SHRINK}::DOUBLE * {kg}::DOUBLE)
             / (coalesce(sum(m) FILTER (mi BETWEEN {MI_K0} AND {MI_K1}), 0) + {SHRINK}::DOUBLE) AS k,
           (coalesce(sum(terra + aqua) FILTER (mi BETWEEN {MI_A0} AND {MI_A1}), 0) + {SHRINK}::DOUBLE * {ag}::DOUBLE)
             / (coalesce(sum(terra) FILTER (mi BETWEEN {MI_A0} AND {MI_A1}), 0) + {SHRINK}::DOUBLE) AS a,
           coalesce(sum(m) FILTER (mi BETWEEN {MI_K0} AND {MI_K1}), 0) AS m_overlap,
           coalesce(sum(s) FILTER (mi BETWEEN {MI_K0} AND {MI_K1}), 0) AS s_overlap
    FROM agg GROUP BY ALL
""")
con.execute(f"""
    CREATE TABLE full_agg AS
    SELECT g.col, g.row, g.mi, g.m, g.v, g.s,
           CASE WHEN g.mi <= {MI_SPLIT} THEN g.m::DOUBLE * r.k * (CASE WHEN g.mi < {MI_AQUA} THEN r.a ELSE 1.0 END)
                ELSE g.s::DOUBLE END AS h,
           g.m::DOUBLE * r.k AS mk
    FROM agg g JOIN region r ON r.rx = g.col // {REGION} AND r.ry = g.row // {REGION}
""")
print(f"world factors: k={kg:.3f} (VIIRS per MODIS detection), a={ag:.3f} (Terra+Aqua per Terra)", flush=True)

# ---- validation over the overlap years: scaled MODIS against the VIIRS reference ----
val = con.execute(f"""
    WITH ry AS (
        SELECT col // {REGION} rx, row // {REGION} ry, mi // 12 y, sum(mk) pm, sum(s) ps
        FROM full_agg WHERE mi BETWEEN {MI_K0} AND {MI_K1} GROUP BY ALL
    ), wm AS (
        SELECT mi, sum(mk) pm, sum(s) ps FROM full_agg WHERE mi BETWEEN {MI_K0} AND {MI_K1} GROUP BY mi
    ), wy AS (SELECT mi // 12 y, sum(pm) pm, sum(ps) ps FROM wm GROUP BY 1)
    SELECT (SELECT corr(pm, ps) FROM ry), (SELECT corr(pm, ps) FROM wm),
           (SELECT avg(abs(pm - ps) / ps) FROM wm), (SELECT avg(abs(pm - ps) / ps) FROM wy),
           (SELECT max(abs(pm - ps) / ps) FROM wy)
""").fetchone()
print("validation: region-year r=%.4f, world-month r=%.4f, world-month MAPE=%.3f, world-year MAPE=%.3f, worst year=%.3f" % val, flush=True)


def write_gz(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=6) as f:
        f.write(payload)


# ---- tiles ----
print("writing tiles ...", flush=True)
r = con.execute(f"""
    SELECT (row // {TILE}) * 36 + (col // {TILE}) AS tile, (row % {TILE}) * {TILE} + (col % {TILE}) AS cell,
           mi, m, v, s
    FROM full_agg ORDER BY 1, 2, 3
""").fetchnumpy()
tile = np.asarray(r["tile"]).astype(np.int64)
bounds = np.flatnonzero(np.diff(tile)) + 1
starts = np.concatenate(([0], bounds))
ends = np.concatenate((bounds, [len(tile)]))
tiles, raw_bytes = [], 0
for a, b in zip(starts, ends):
    t = int(tile[a])
    tx, ty = t % 36, t // 36
    n = b - a
    payload = b"".join([
        b"FCT1", struct.pack("<I", n),
        np.asarray(r["cell"][a:b]).astype("<u2").tobytes(),
        np.asarray(r["mi"][a:b]).astype("<u2").tobytes(),
        np.asarray(r["m"][a:b]).astype("<u4").tobytes(),
        np.asarray(r["v"][a:b]).astype("<u4").tobytes(),
        np.asarray(r["s"][a:b]).astype("<u4").tobytes(),
    ])
    raw_bytes += len(payload)
    write_gz(OUT / "t" / f"{tx}_{ty}.bin.gz", payload)
    tiles.append(f"{tx}_{ty}")
print(f"  {len(tiles)} tiles, {len(tile):,} cell-months, {raw_bytes / 1e6:.0f} MB before gzip", flush=True)
del r

# ---- world map layers ----
print("writing world layers ...", flush=True)


def write_layers(sql, sub):
    g = con.execute(sql).fetchnumpy()
    key = np.asarray(g["key"]).astype(np.int64)
    b = np.flatnonzero(np.diff(key)) + 1
    for a, e in zip(np.concatenate(([0], b)), np.concatenate((b, [len(key)]))):
        n = e - a
        payload = b"".join([b"FCG1", struct.pack("<I", n),
                            np.asarray(g["idx"][a:e]).astype("<u4").tobytes(),
                            np.asarray(g["h"][a:e]).astype("<f4").tobytes()])
        write_gz(OUT / "g" / sub / f"{int(key[a])}.bin.gz", payload)
    return len(key)


n_y = write_layers(f"SELECT 2000 + mi // 12 AS key, row * {NCOL} + col AS idx, sum(h) AS h FROM full_agg GROUP BY ALL HAVING sum(h) > 0 ORDER BY 1, 2", "y")
n_m = write_layers(f"SELECT mi AS key, row * {NCOL} + col AS idx, h FROM full_agg WHERE h > 0 ORDER BY 1, 2", "m")
print(f"  year layers {n_y:,} cells, month layers {n_m:,} cells", flush=True)

# ---- meta ----
mi0, mi1 = con.execute("SELECT min(mi), max(mi) FROM full_agg").fetchone()
world = con.execute("SELECT mi, sum(m), sum(v), sum(s), sum(h), sum(mk) FROM full_agg GROUP BY mi ORDER BY mi").fetchall()
series = {k: [0] * (mi1 + 1) for k in "mvshk"}
for mi, m, v, s, h, mk in world:
    series["m"][mi], series["v"][mi], series["s"][mi] = int(m), int(v), int(s)
    series["h"][mi], series["k"][mi] = round(float(h), 1), round(float(mk), 1)
regions = {f"{rx}_{ry}": [round(k, 4), round(a, 4)]
           for rx, ry, k, a in con.execute("SELECT rx, ry, k, a FROM region").fetchall()}
meta = {
    "res": RES, "ncol": NCOL, "nrow": NROW, "tile": TILE, "region": REGION,
    "mi0": int(mi0), "mi1": int(mi1), "miSplit": MI_SPLIT, "miAqua": MI_AQUA,
    "firstDate": "2000-11-01", "lastDate": "2026-11-07", "viirsStart": "2012-01-20",
    "tiles": tiles, "world": series, "regions": regions,
    "kWorld": round(kg, 4), "aWorld": round(ag, 4),
    "validation": {"regionYearR": round(val[0], 4), "worldMonthR": round(val[1], 4),
                   "worldMonthMape": round(val[2], 4), "worldYearMape": round(val[3], 4),
                   "worldYearWorst": round(val[4], 4), "overlap": "Feb 2012 - Dec 2025"},
    "totals": {"modis": int(sum(series["m"])), "viirs": int(sum(series["v"]))},
}
(OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
print(f"DONE in {time.time() - t0:.0f}s: {size / 1e6:.0f} MB in {sum(1 for p in OUT.rglob('*') if p.is_file())} files", flush=True)
