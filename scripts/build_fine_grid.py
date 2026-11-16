#!/usr/bin/env python3
"""Build fine/v1: harmonized fire counts per 0.05 degree cell (about 5.5 km), per year 2001-2026, as 5 degree tiles.

For every country in summary/v3 this writes OUT/<Country>/<tx>_<ty>.json (one file per 5x5 degree tile the country
has fire in, split into latitude bands <tx>_<ty>_<p>.json when a tile would be over 1 MB), OUT/<Country>/index.json
and OUT/index.json. Values are built by exactly the rule of cells/v1 (scripts/build_cells_monthly.py, whose functions
are reused), only on the 0.05 degree grid the v2 static mask already uses instead of the country's v3 grid:

  * 2001-01 .. 2012-01: MODIS x the country's per-calendar-month VIIRS/MODIS rate (r_t before July 2002, r_ta after,
    the rounded rates stored in summary/v3).
  * 2012-02 .. 2025-12: Suomi NPP as observed (v2 filters); in the months of v3 y2026.hist_gaps the cell's S-NPP
    detections on the outage days are replaced by its NOAA-20 detections on those days x the country's NOAA-20 rate.
  * 2026-01 .. 2026-11-14: build_v3.py's own 2026 cell tables (imported, same day classes): S-NPP on 'obs'
    country-days, NOAA-20 x rate on 'conv' days, the neighbour-day mean on 'interp' days.

Each cell-month is summed per calendar year. Each year is then rounded to 0.1 over all of the country's cells so that
the year's cell total is the rounded country total (largest remainder, as cells/v1 rounds each month).

Local outputs in WORK (for later builds, not published): monthly_cells.parquet (exact monthly value per country,
0.05 cell and month; rows that are 0 dropped) and yearly_cells.parquet (the rounded yearly values written to the tiles).

Checks (the run fails on any): raw T, A, V cell sums equal v3 monthly.T/A/V for every country-month 2001-2025; the
per-cell outage fills sum to v3's gap change; the exact values regridded to v3's grid equal v3 cell_rows per cell and
year (within v3's 0.05 rounding); each country-month's exact sum is within 0.05 (+ float noise) of the published
cells/v1 month sum; each country-year's tile sum is within rounding of the cells/v1 year sum.

Usage (deterministic; the per-year 0.05 degree extracts are cached in WORK/a):
  .venv/bin/python scripts/build_fine_grid.py --raw DIR --n20-work DIR --work DIR --cells-v1 DIR --out DIR
    --raw, --n20-work   as for build_cells_monthly.py (the 2026 fetch folder; build_v3.py's WORK folder)
    --cells-v1          a local copy of cells/v1 (the files build_cells_monthly.py wrote), for the cross-check
    --out               output folder (fine/v1)
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cells_monthly as bcm  # noqa: E402

V3 = bcm.V3
Y0, Y26 = 2001, 2026
NY = Y26 - Y0 + 1  # 26 years
YEARS = list(range(Y0, Y26 + 1))
CELL = 0.05
TILE = 100  # 0.05 degree cells per tile side: 5 degrees
LA_OFF, LO_OFF = 1800, 3600  # floor(lat / 0.05) + 1800 = floor((lat + 90) / 0.05), same for lon with 180
MAX_FILE = 1_000_000
LAST = "2026-11-14"
PARTIAL = {"y": 2026, "to": LAST, "note": "2026 is 1 January to 14 November"}


def num(t):
    """integer tenths -> int or float with one decimal (for the index files)"""
    return bcm.num1(int(t) / 10)


def tenths(t):
    """integer tenths -> JSON number text with at most one decimal"""
    q, r = divmod(int(t), 10)
    return str(q) if r == 0 else f"{q}.{r}"


def write_2026(B, path, countries):
    """build_v3's 2026 cell tables (0.05 degree la/lo, month), turned into harmonized values as cells/v1 does"""
    out = ["country,la,lo,i,h"]
    keep = set(countries)
    skipped = 0
    for c, la, lo, m, n in zip(B.snpp["country"], B.snpp["la"], B.snpp["lo"], B.snpp["m"], B.snpp["n"]):
        if c in keep:
            out.append(f"{c},{int(la)},{int(lo)},{B.I0 + int(m) - 1},{float(n)!r}")
        else:
            skipped += 1
    for c, la, lo, m, kc, n in zip(B.n20["country"], B.n20["la"], B.n20["lo"], B.n20["m"], B.n20["cls"], B.n20["n"]):
        if kc != "conv":
            continue
        if c in keep:
            r = B.rates["countries"][c]["r"]
            out.append(f"{c},{int(la)},{int(lo)},{B.I0 + int(m) - 1},{float(n * r[int(m) - 1])!r}")
        else:
            skipped += 1
    for c, la, lo, m, ms, sen, n in zip(B.interp["country"], B.interp["la"], B.interp["lo"], B.interp["m"],
                                         B.interp["ms"], B.interp["sensor"], B.interp["n"]):
        if c in keep:
            r = B.rates["countries"][c]["r"]
            h = n if sen == "V" else n * r[int(ms) - 1]
            out.append(f"{c},{int(la)},{int(lo)},{B.I0 + int(m) - 1},{float(h)!r}")
        else:
            skipped += 1
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return len(out) - 1, skipped


def build_tables(con, work, B, d3s):
    """the exact monthly table `mon` (country, la, lo, i, h, g) and its rounded yearly table `yr`"""
    countries = list(d3s)
    con.execute("CREATE OR REPLACE TABLE rt (country VARCHAR, mo INTEGER, r_t DOUBLE, r_ta DOUBLE, r_n DOUBLE)")
    rows = []
    for c, d3 in d3s.items():
        rn = B.rates["countries"][c]["r"]
        assert rn == d3["y2026"]["n20_rate"]["r"], c
        rows += [(c, mo, float(d3["r_t"][mo]), float(d3["r_ta"][mo]), float(rn[mo])) for mo in range(12)]
    con.executemany("INSERT INTO rt VALUES (?, ?, ?, ?, ?)", rows)
    n26, skipped = write_2026(B, work / "y2026_cells.csv", countries)
    print(f"  2026 cell-month rows: {n26} (outside v3's countries, skipped as in cells/v1: {skipped})", flush=True)
    a = f"{work}/a/cells_*.parquet"
    con.execute(f"""CREATE OR REPLACE VIEW hist AS SELECT country, ca AS la, co AS lo,
        (CAST(regexp_extract(filename, 'cells_([0-9]{{4}})', 1) AS INTEGER) - {Y0}) * 12 + m - 1 AS i, T, A, V, gV, gN
        FROM read_parquet('{a}', filename = true)""")
    con.execute(f"""CREATE OR REPLACE TABLE mon AS SELECT country, la, lo, i, sum(h) AS h, sum(g) AS g FROM (
          SELECT x.country, x.la, x.lo, x.i,
                 CASE WHEN x.i < {bcm.AQ0} THEN x.T * r.r_t WHEN x.i < {bcm.VI0} THEN (x.T + x.A) * r.r_ta
                      ELSE CAST(x.V AS DOUBLE) END AS h,
                 CASE WHEN x.i >= {bcm.VI0} THEN x.gN * r.r_n - x.gV ELSE 0.0 END AS g
            FROM hist x JOIN rt r ON r.country = x.country AND r.mo = x.i % 12
          UNION ALL
          SELECT country, la, lo, i, h, 0.0 AS g FROM read_csv('{work}/y2026_cells.csv', header = true,
                 columns = {{'country': 'VARCHAR', 'la': 'INTEGER', 'lo': 'INTEGER', 'i': 'INTEGER', 'h': 'DOUBLE'}})
        ) GROUP BY ALL""")
    # yearly, rounded to tenths per country-year by largest remainder (ties: lower la, then lower lo)
    con.execute(f"""CREATE OR REPLACE TABLE yr AS
        WITH y AS (SELECT country, la, lo, i // 12 AS yi, sum(h + g) AS ev FROM mon GROUP BY ALL),
        f AS (SELECT *, ev * 10 AS x, floor(ev * 10 + 1e-7) AS fl FROM y),
        need AS (SELECT country, yi, CAST(round(sum(x) - sum(fl)) AS BIGINT) AS need FROM f GROUP BY ALL),
        rk AS (SELECT f.*, row_number() OVER (PARTITION BY country, yi ORDER BY greatest(x - fl, 0) DESC, la, lo) AS rn FROM f)
        SELECT rk.country, rk.la, rk.lo, rk.yi, rk.ev,
               CAST(rk.fl AS BIGINT) + CASE WHEN rk.rn <= need.need THEN 1 ELSE 0 END AS t
          FROM rk JOIN need USING (country, yi)""")


def check_tables(con, work, B, d3s, cells_v1, stats):
    countries = list(d3s)
    # 1. raw T, A, V per country-month against v3 monthly, exactly
    got = {}
    for c, i, t, a, v in con.execute("SELECT country, i, sum(T), sum(A), sum(V) FROM hist GROUP BY ALL").fetchall():
        got[(c, i)] = (int(t), int(a), int(v))
    for c, d3 in d3s.items():
        m = d3["monthly"]
        for i in range(bcm.NM_HIST):
            exp = (m["T"][i], m["A"][i], m["V"][i])
            if got.get((c, i), (0, 0, 0)) != exp:
                raise SystemExit(f"{c} month {i}: raw T/A/V cell sums {got.get((c, i))} vs v3 {exp}")
    assert {c for c, _ in got} <= set(countries)
    # 2. outage fills per country-month against v3's gap change
    gsum = {(c, i): g for c, i, g in con.execute("SELECT country, i, sum(g) FROM mon WHERE g <> 0 GROUP BY ALL").fetchall()}
    gmax = 0.0
    for c in countries:
        for i in range(bcm.NM_HIST):
            e = B.gapm.get(c, {}).get(i, 0.0)
            gg = gsum.get((c, i), 0.0)
            if abs(gg - e) > 1e-6 * max(1.0, abs(e)):
                raise SystemExit(f"{c}: gap fill month {i}: cells {gg} vs v3 {e}")
            gmax = max(gmax, abs(gg - e))
    stats["gap_fill_max_abs_diff"] = gmax
    # 3. exact values (without the fill) regridded to v3's grid, per cell and year, against v3 cell_rows
    con.execute("CREATE OR REPLACE TABLE steps (country VARCHAR, step INTEGER)")
    con.executemany("INSERT INTO steps VALUES (?, ?)", [(c, round(d["cell"] * 100000) // bcm.BASE) for c, d in d3s.items()])
    lines = ["country,ca,co,yi,val"]
    for c, d3 in d3s.items():
        cells, cr = d3["cells"], d3["cell_rows"]
        for j in range(0, len(cr), 5):
            k = cr[j]
            lines.append(f"{c},{cells[2 * k]},{cells[2 * k + 1]},{cr[j + 1]},{cr[j + 2]!r}")
    (work / "v3_cell_rows.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    worst = con.execute(f"""
        WITH f AS (SELECT m.country, CAST(floor(m.la / CAST(s.step AS DOUBLE)) AS INTEGER) AS ca,
                          CAST(floor(m.lo / CAST(s.step AS DOUBLE)) AS INTEGER) AS co, m.i // 12 AS yi, sum(m.h) AS hv
                     FROM mon m JOIN steps s USING (country) GROUP BY ALL),
             v AS (SELECT country, ca, co, yi, sum(val) AS val FROM read_csv('{work}/v3_cell_rows.csv', header = true,
                     columns = {{'country': 'VARCHAR', 'ca': 'INTEGER', 'co': 'INTEGER', 'yi': 'INTEGER', 'val': 'DOUBLE'}})
                   GROUP BY ALL)
        SELECT country, ca, co, yi, coalesce(f.hv, 0) AS a, coalesce(v.val, 0) AS b
          FROM f FULL OUTER JOIN v USING (country, ca, co, yi) ORDER BY abs(a - b) DESC LIMIT 1""").fetchone()
    stats["v3_cell_year_max_abs_diff"] = abs(worst[4] - worst[5])
    if abs(worst[4] - worst[5]) > 0.051 + 1e-9:
        raise SystemExit(f"regridded to v3: {worst}")
    # 4. exact country-month sums against the published cells/v1 month sums (rounded so the month total is kept)
    ex = np.zeros((len(countries), 311))
    ci = {c: k for k, c in enumerate(countries)}
    for c, i, v in con.execute("SELECT country, i, sum(h + g) FROM mon GROUP BY ALL").fetchall():
        ex[ci[c], i] = v
    cv = np.zeros_like(ex)
    for c in countries:
        d = json.load(open(cells_v1 / f"{c}.json"))
        r = np.array(d["rows"], float).reshape(-1, 3)
        np.add.at(cv[ci[c]], r[:, 1].astype(int), r[:, 2])
    md = np.abs(ex - cv)
    k, i = np.unravel_index(np.argmax(md), md.shape)
    stats["cells_v1_month_max_abs_diff"] = float(md.max())
    stats["cells_v1_month_worst"] = [countries[k], int(i)]
    if md.max() > 0.05 + 1e-6:
        raise SystemExit(f"{countries[k]} month {i}: fine exact {ex[k, i]} vs cells/v1 {cv[k, i]}")
    # 5. rounded yearly sums: the rounded exact total, and within rounding of cells/v1's yearly sums
    ry = np.zeros((len(countries), NY))
    for c, yi, t, ev in con.execute("SELECT country, yi, sum(t), sum(ev) FROM yr GROUP BY ALL").fetchall():
        ry[ci[c], yi] = t / 10
        if abs(int(t) - ev * 10) > 0.5 + 1e-6:  # the rounded total (a .5 tie may go either way in floating point)
            raise SystemExit(f"{c} {Y0 + yi}: rounded tenths {t} vs exact {ev}")
    cy = np.stack([cv[:, y * 12:min(311, y * 12 + 12)].sum(1) for y in range(NY)], 1)
    ey = np.stack([ex[:, y * 12:min(311, y * 12 + 12)].sum(1) for y in range(NY)], 1)
    yd = np.abs(ry - cy)
    k, y = np.unravel_index(np.argmax(yd), yd.shape)
    stats["cells_v1_year_max_abs_diff"] = float(yd.max())
    stats["cells_v1_year_worst"] = [countries[k], Y0 + int(y), float(ry[k, y]), float(cy[k, y])]
    stats["exact_year_max_abs_diff"] = float(np.abs(ry - ey).max())
    if yd.max() > 0.65:  # at most 0.05 per month from cells/v1's monthly rounding plus 0.05 from this year's
        raise SystemExit(f"{countries[k]} {Y0 + y}: fine {ry[k, y]} vs cells/v1 {cy[k, y]}")
    return ry, cy


def encode_country(c, d3, con, out_dir):
    """write the country's tiles; returns its index entry"""
    t = con.execute("SELECT la, lo, yi, t FROM yr WHERE country = ? AND t > 0 ORDER BY la, lo, yi", [c]).fetchnumpy()
    la, lo, yi, tv = (np.asarray(t[x], np.int64) for x in ("la", "lo", "yi", "t"))
    cdir = out_dir / c
    cdir.mkdir(parents=True, exist_ok=True)
    head = {"v": 1, "country": c, "name": d3["name"], "cell": CELL, "tile_deg": 5, "years": YEARS, "partial": PARTIAL}
    if not len(la):
        idx = dict(head, bbox=None, cells=0, total=0, year_totals=[0] * NY, files=[])
        (cdir / "index.json").write_text(bcm.dumps(idx), encoding="utf-8")
        return idx
    # one record per cell: [r, c, total, k, y1, v1, ..., yk, vk]
    new = np.ones(len(la), bool)
    new[1:] = (la[1:] != la[:-1]) | (lo[1:] != lo[:-1])
    starts = np.nonzero(new)[0]
    ends = np.append(starts[1:], len(la))
    cla, clo = la[starts], lo[starts]
    ctot = np.add.reduceat(tv, starts)
    ty, tx = (cla + LA_OFF) // TILE, (clo + LO_OFF) // TILE
    lr, lc = (cla + LA_OFF) % TILE, (clo + LO_OFF) % TILE
    yl, tl = yi.tolist(), tv.tolist()
    recs = []
    for s, e, r_, c_, tot in zip(starts.tolist(), ends.tolist(), lr.tolist(), lc.tolist(), ctot.tolist()):
        parts = [f"{r_},{c_},{tenths(tot)},{e - s}"]
        for j in range(s, e):
            parts.append(f"{yl[j]},{tenths(tl[j])}")
        recs.append(",".join(parts))
    year_tot = np.bincount(yi, weights=tv, minlength=NY).astype(np.int64)
    order = np.lexsort((clo, cla, tx, ty))  # tile by tile, cells by la then lo
    files = []
    tkey = ty[order] * 1000 + tx[order]
    bounds = np.nonzero(np.diff(tkey))[0] + 1
    for grp in np.split(order, bounds):
        gy, gx = int(ty[grp[0]]), int(tx[grp[0]])
        sizes = np.array([len(recs[k]) + 1 for k in grp])
        base = {"v": 1, "country": c, "cell": CELL, "tile": [gx, gy], "part": None,
                "origin": [gy * TILE - LA_OFF, gx * TILE - LO_OFF], "bbox": None, "years": YEARS, "partial": PARTIAL}
        overhead = len(bcm.dumps(base)) + 200
        if sizes.sum() + overhead <= MAX_FILE:
            chunks = [grp]
        else:  # latitude bands of whole cell rows, greedily up to the limit
            chunks, cur, cur_b = [], [], 0
            rows_of = lr[grp]
            for row in np.unique(rows_of):
                sel = grp[rows_of == row]
                b = int(sizes[rows_of == row].sum())
                if cur and cur_b + b + overhead > MAX_FILE:
                    chunks.append(np.concatenate(cur))
                    cur, cur_b = [], 0
                cur.append(sel)
                cur_b += b
            chunks.append(np.concatenate(cur))
        for p, ch in enumerate(chunks):
            name = f"{gx}_{gy}.json" if len(chunks) == 1 else f"{gx}_{gy}_{p + 1}.json"
            bbox = [round(float(clo[ch].min()) * CELL, 2), round(float(cla[ch].min()) * CELL, 2),
                    round(float(clo[ch].max() + 1) * CELL, 2), round(float(cla[ch].max() + 1) * CELL, 2)]
            o = dict(base, part=None if len(chunks) == 1 else [p + 1, len(chunks)], bbox=bbox)
            if len(chunks) > 1:
                o["lat_rows"] = [int(lr[ch].min()), int(lr[ch].max())]
            text = bcm.dumps(o)[:-1] + ',"rows":[' + ",".join(recs[k] for k in ch) + "]}"
            nb = len(text.encode())
            if nb > MAX_FILE:
                raise SystemExit(f"{c} {name}: {nb} bytes")
            (cdir / name).write_text(text, encoding="utf-8")
            files.append({"file": name, "tile": [gx, gy], "part": o["part"], "bbox": bbox, "bytes": nb,
                          "cells": int(len(ch)), "total": num(ctot[ch].sum())})
    bbox = [round(float(clo.min()) * CELL, 2), round(float(cla.min()) * CELL, 2),
            round(float(clo.max() + 1) * CELL, 2), round(float(cla.max() + 1) * CELL, 2)]
    idx = dict(head, bbox=bbox, cells=int(len(starts)), total=num(tv.sum()),
               year_totals=[num(x) for x in year_tot], files=files)
    (cdir / "index.json").write_text(bcm.dumps(idx), encoding="utf-8")
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--n20-work", type=Path, required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--cells-v1", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    a.out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    B = bcm.load_build_v3(a.raw, a.n20_work, a.work / "unused_out")
    print(f"build_v3 tables loaded in {time.time() - t0:.0f}s; past gap days: {len(B.GAP)}", flush=True)
    idx3 = json.load(open(V3 / "index.json"))
    d3s = {e["country"]: json.load(open(V3 / f"{e['country']}.json")) for e in idx3["countries"]}
    con = bcm.stage_a(a.work / "a", {c: 1 for c in d3s}, B.GAP)  # step 1: the 0.05 degree grid itself
    print(f"stage A ready at {time.time() - t0:.0f}s", flush=True)
    (a.work / "duck_tmp").mkdir(exist_ok=True)
    con.execute(f"SET enable_progress_bar = false; SET preserve_insertion_order = false; "
                f"SET memory_limit = '8GB'; SET temp_directory = '{a.work / 'duck_tmp'}'")
    t1 = time.time()
    build_tables(con, a.work, B, d3s)
    n_mon, n_yr = (con.execute(f"SELECT count(*) FROM {x}").fetchone()[0] for x in ("mon", "yr"))
    print(f"tables built in {time.time() - t1:.0f}s: {n_mon} cell-months, {n_yr} cell-years", flush=True)
    t1 = time.time()
    stats = {}
    check_tables(con, a.work, B, d3s, a.cells_v1, stats)
    print(f"checks passed in {time.time() - t1:.0f}s: {json.dumps(stats)}", flush=True)
    t1 = time.time()
    con.execute(f"""COPY (SELECT country, la, lo, CAST(i AS SMALLINT) AS i, h + g AS v, g FROM mon WHERE h + g <> 0 OR g <> 0 ORDER BY ALL)
        TO '{a.work}/monthly_cells.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)""")
    con.execute(f"""COPY (SELECT country, la, lo, CAST(yi AS SMALLINT) AS yi, CAST(t AS INTEGER) AS t, ev FROM yr
        WHERE t > 0 ORDER BY ALL) TO '{a.work}/yearly_cells.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)""")
    print(f"parquet written in {time.time() - t1:.0f}s", flush=True)
    t1 = time.time()
    entries, tiles = [], {}
    for k, (c, d3) in enumerate(d3s.items()):
        idx = encode_country(c, d3, con, a.out)
        nb = sum(f["bytes"] for f in idx["files"])
        entries.append({"country": c, "name": d3["name"], "bbox": idx["bbox"], "cells": idx["cells"],
                        "total": idx["total"], "files": len(idx["files"]), "bytes": nb,
                        "max_file_bytes": max((f["bytes"] for f in idx["files"]), default=0)})
        for f in idx["files"]:
            key = f"{f['tile'][0]}_{f['tile'][1]}"
            lst = tiles.setdefault(key, [])
            if not lst or lst[-1][0] != k:
                lst.append([k, 1 if f["part"] is None else f["part"][1]])
    top = {"v": 1, "cell": CELL, "tile_deg": 5, "years": YEARS, "partial": PARTIAL,
           "files": "fine/v1/<country>/<tx>_<ty>.json, or <tx>_<ty>_<p>.json for p = 1..parts when a tile is split",
           "countries": entries, "tiles": tiles}
    (a.out / "index.json").write_text(bcm.dumps(top), encoding="utf-8")
    b = np.array([e["bytes"] for e in entries])
    print(f"tiles written in {time.time() - t1:.0f}s: {int(sum(e['files'] for e in entries))} files, "
          f"{int(b.sum())} bytes; largest country {entries[int(np.argmax(b))]['country']} {int(b.max())}; "
          f"largest file {max(e['max_file_bytes'] for e in entries)}", flush=True)
    json.dump({"stats": stats, "countries": entries}, open(a.work / "build_report.json", "w"))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
