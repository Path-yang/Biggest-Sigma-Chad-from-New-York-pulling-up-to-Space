#!/usr/bin/env python3
"""Build cells/v1: monthly harmonized fire counts per grid cell, one file per country, 2001-01 to 2026-11 (partial).

For every country in summary/v3 this writes OUT/<Country>.json and OUT/index.json. Each file holds, for every cell of
the country's v3 grid (same `cell` size and the same `cells` list and indexes as summary/v3/<Country>.json) and every
month, the harmonized count, built by exactly the rule of the country series:

  * 2001-01 .. 2012-01: MODIS times the country's VIIRS-per-MODIS rate for the calendar month, Terra alone with r_t
    before July 2002, Terra+Aqua with r_ta after (the rounded rates stored in the v3 file, as the site uses them).
  * 2012-02 .. 2025-12: Suomi NPP as observed (v2 filters: type 0, confidence n/h, same-year 0.05 degree static-source
    mask from all three sensors of the country's own files). In the months listed in v3 y2026.hist_gaps (past S-NPP
    outage days from 2018) the outage days are filled per cell, exactly: the cell's S-NPP detections on those days
    are replaced by its NOAA-20 detections on those days times the country's NOAA-20-to-S-NPP rate for the month,
    which is how v3 builds hist_gaps[].filled (the value the site shows; monthly.V keeps v2's).
  * 2026-01 .. 2026-11 (to 14 Nov): the v3 2026 rule cell by cell, taken from build_v3.py itself (imported, so the
    day classes are the same): S-NPP on 'obs' country-days, NOAA-20 x rate on 'conv' days, the neighbour-day mean on
    'interp' days.

Values are rounded to 0.1 and only nonzero ones are written. If a file would be over MAX_BYTES the grid is
coarsened 2x2 (cell doubled, indexes floor(k/2)) until it fits; the file says so in `note` and `same_grid_as_v3`.

Checks (the run fails on any): per country and month the cell sums of raw T, A, V reproduce v3 monthly.T/A/V
for 2001-2025 exactly; the per-cell gap fills sum to v3's gap change; the unrounded per-cell monthly values,
summed per year, match v3 cell_rows' harmonized value (to rounding, after taking the gap fill back out); the
rounded cell sums match the site's monthly value (v3 harmonized, hist_gaps filled) within the reported error.

Usage (deterministic; stage A is cached in --work):
  .venv/bin/python scripts/build_cells_monthly.py --raw DIR --work DIR --n20-work DIR --out DIR
    --raw       the 2026 fetch folder (viirs-snpp_2026.parquet, coverage_days.csv, ...) as for build_v3.py
    --n20-work  build_v3.py's WORK folder (n20_rates.json, hist_daily.parquet, modis_2026_cells_daily.parquet)
    --work      scratch for the per-year cell extracts (cells_<year>.parquet, a few MB each)
    --out       output folder (cells/v1)
"""
import argparse
import importlib.util
import json
import math
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
V2 = HF / "summary" / "v2"
V3 = HF / "summary" / "v3"
Y0, Y1 = 2001, 2025
NM_HIST = (Y1 - Y0 + 1) * 12  # 300
VI0 = (2012 - Y0) * 12 + 1  # Feb 2012
AQ0 = (2002 - Y0) * 12 + 6  # Jul 2002
BASE = 5000
MAX_BYTES = 4_000_000
LA = f"CAST(floor(round(latitude * 100000) / {BASE}) AS INTEGER)"
LO = f"CAST(floor(round(longitude * 100000) / {BASE}) AS INTEGER)"


def num1(x):
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def load_build_v3(raw, n20_work, scratch):
    """Run build_v3.py's module-level part (day classes, 2026 cell tables, past gap days) without its main()."""
    path = ROOT / "scripts" / "summary2026" / "build_v3.py"
    argv = sys.argv
    sys.argv = [str(path), str(V2), str(raw), str(n20_work), str(scratch)]
    try:
        spec = importlib.util.spec_from_file_location("build_v3", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv
    return mod


# ---------------------------------------------------------------- stage A: 2001-2025 per cell and month

def stage_a(work, steps, gap_days):
    """Per year: counts per country, v3 grid cell and calendar month for Terra, Aqua, S-NPP, and S-NPP / NOAA-20 on
    the past outage days, with v2's filters. Cached as work/cells_<year>.parquet."""
    import csv
    rows = list(csv.DictReader(open(HF / "manifest.csv")))
    con = duckdb.connect()
    con.execute(f"SET threads = {os.cpu_count()}")
    con.execute("CREATE TABLE fmap (filename VARCHAR, country VARCHAR)")
    con.executemany("INSERT INTO fmap VALUES (?, ?)", [(str(HF / r["path"]), r["country"]) for r in rows])
    con.execute("CREATE TABLE steps (country VARCHAR, step INTEGER)")
    con.executemany("INSERT INTO steps VALUES (?, ?)", sorted(steps.items()))
    con.execute("CREATE TABLE gapd (gd DATE)")
    con.executemany("INSERT INTO gapd VALUES (?)", [(f"{y:04d}-{m:02d}-{d:02d}",) for y, m, d in sorted(gap_days)])
    cell = ("CAST(floor(la / CAST(s.step AS DOUBLE)) AS INTEGER) AS ca, "
            "CAST(floor(lo / CAST(s.step AS DOUBLE)) AS INTEGER) AS co")
    for y in range(Y0, Y1 + 1):
        out = work / f"cells_{y}.parquet"
        if out.exists():
            continue
        t = time.time()
        paths = {s: [str(HF / r["path"]) for r in rows if r["sensor"] == s and int(r["year"]) == y]
                 for s in ("modis", "viirs-snpp", "viirs-jpss1")}
        allp = [p for v in paths.values() for p in v]
        con.execute(f"""CREATE OR REPLACE TEMP TABLE mk AS SELECT DISTINCT f.country, {LA} AS la, {LO} AS lo
            FROM read_parquet($p, filename = true, union_by_name = true) d JOIN fmap f USING (filename)
            WHERE d.type <> 0 AND year(d.acq_date) = {y}""", {"p": allp})

        def part(sensor, where, cols):
            return f"""SELECT x.country, {cell}, month(x.acq_date) AS m, {cols} FROM (
                SELECT f.country, r.acq_date, r.satellite, (r.acq_date IN (SELECT gd FROM gapd)) AS g, {LA} AS la, {LO} AS lo
                FROM read_parquet($p_{sensor.replace('-', '_')}, filename = true) r
                JOIN fmap f USING (filename) WHERE r.type = 0 AND year(r.acq_date) = {y} AND {where}) x
                ANTI JOIN mk USING (country, la, lo) JOIN steps s ON s.country = x.country GROUP BY ALL"""
        z = "CAST(0 AS BIGINT)"
        parts, params = [], {}
        if paths["modis"]:
            parts.append(part("modis", "r.confidence >= 30",
                              f"count(*) FILTER (WHERE x.satellite <> 'Aqua') AS T, count(*) FILTER (WHERE x.satellite = 'Aqua') AS A, "
                              f"{z} AS V, {z} AS gV, {z} AS gN"))
            params["p_modis"] = paths["modis"]
        if paths["viirs-snpp"]:
            parts.append(part("viirs-snpp", "r.confidence IN ('n', 'h')",
                              f"{z} AS T, {z} AS A, count(*) AS V, count(*) FILTER (WHERE x.g) AS gV, {z} AS gN"))
            params["p_viirs_snpp"] = paths["viirs-snpp"]
        if paths["viirs-jpss1"]:
            parts.append(part("viirs-jpss1", "r.confidence IN ('n', 'h') AND r.acq_date IN (SELECT gd FROM gapd)",
                              f"{z} AS T, {z} AS A, {z} AS V, {z} AS gV, count(*) AS gN"))
            params["p_viirs_jpss1"] = paths["viirs-jpss1"]
        tmp = work / f"cells_{y}.tmp.parquet"
        con.execute(f"""COPY (SELECT country, ca, co, m, sum(T)::INTEGER T, sum(A)::INTEGER A, sum(V)::INTEGER V,
            sum(gV)::INTEGER gV, sum(gN)::INTEGER gN FROM ({' UNION ALL '.join(parts)}) GROUP BY ALL
            ORDER BY country, ca, co, m) TO '{tmp}' (FORMAT parquet, ROW_GROUP_SIZE 20000)""", params)
        os.replace(tmp, out)
        print(f"  stage A {y}: {time.time() - t:.0f}s", flush=True)
    return con


# ---------------------------------------------------------------- stage B: one file per country

def round_tenths(a):
    """Round each value to 0.1 so that every month's (column's) total is the rounded total of the exact values:
    floor to tenths, then give the leftover tenths to the cells with the largest remainders (ties: lower cell index).
    Plain rounding drifts by up to ~0.1% per month in big countries, because a converted month multiplies small
    counts by one fixed rate and its rounding errors all lean the same way. No value moves by 0.1 or more."""
    x = a * 10
    f = np.floor(x + 1e-7)
    rem = np.clip(x - f, 0, None)
    out = f.copy()
    for j in range(a.shape[1]):
        need = int(round(x[:, j].sum() - f[:, j].sum()))
        if need > 0:
            top = np.argsort(-rem[:, j], kind="stable")[:need]
            out[top, j] += 1
    return out / 10


def note_for(c, agg, cell, v3cell):
    s = ("Harmonized hotspots per cell and month, by the rule of the country series in summary/v3: MODIS x the "
         "country's monthly VIIRS/MODIS rate (r_t before Jul 2002, r_ta after) to Jan 2012; Suomi NPP as observed from "
         "Feb 2012; past S-NPP outage days (v3 y2026.hist_gaps) and 2026 days S-NPP missed filled per cell from NOAA-20 "
         "x the country's monthly NOAA-20 rate; 12 Oct 2026 neighbour-day mean where v3 uses it. Cell sums equal the "
         "site's monthly values to rounding (0.1 per cell). November 2026 is days 1-14 only.")
    if agg > 1:
        s += (f" Grid coarsened {agg}x{agg} from v3's {v3cell} degree to {cell} degree to keep the file under 4 MB: "
              f"cells and indexes differ from summary/v3.")
    return s


def build_country(c, d3, con, work, B, out_dir, stats):
    cell3 = d3["cell"]
    step = round(cell3 * 100000) // BASE
    cells3 = list(d3["cells"])
    key = {(cells3[2 * k], cells3[2 * k + 1]): k for k in range(len(cells3) // 2)}
    t = con.execute(f"SELECT * FROM read_parquet('{work}/cells_*.parquet', filename = true) WHERE country = ?", [c]).fetchnumpy()
    # a cell with only NOAA-20 detections on past S-NPP outage days is not on v3's grid (v3 cells come from MODIS and
    # S-NPP): such cells are appended after v3's, sorted, so every v3 index keeps its meaning
    extra = sorted({(a, b) for a, b in zip(t["ca"].tolist(), t["co"].tolist())} - set(key))
    for x in extra:
        key[x] = len(cells3) // 2
        cells3 += list(x)
    stats["extra_cells"] = stats.get("extra_cells", 0) + len(extra)
    nc3 = len(cells3) // 2
    nmon = d3["n_months"]
    H = np.zeros((nc3, nmon))  # harmonized, unrounded
    G = np.zeros((nc3, nmon))  # change from the past gap fill
    raw = np.zeros((3, nmon), np.int64)  # cell sums of T, A, V (hist) to check against v3 monthly
    r_ta, r_t = np.array(d3["r_ta"], float), np.array(d3["r_t"], float)
    r_n20 = B.rates["countries"][c]["r"]
    assert r_n20 == d3["y2026"]["n20_rate"]["r"]
    if len(t["country"]):
        yr = np.array([int(Path(f).stem.split("_")[1]) for f in t["filename"]])
        i = (yr - Y0) * 12 + t["m"].astype(np.int64) - 1
        k = np.array([key[(a, b)] for a, b in zip(t["ca"].tolist(), t["co"].tolist())], np.int64)
        T, A, V, gV, gN = (t[x].astype(float) for x in ("T", "A", "V", "gV", "gN"))
        mo = i % 12
        h = np.where(i < VI0, np.where(i < AQ0, T * r_t[mo], (T + A) * r_ta[mo]), V)
        np.add.at(H, (k, i), h)
        gd = np.where(i >= VI0, gN * np.array(r_n20)[mo] - gV, 0.0)
        np.add.at(G, (k, i), gd)
        for j, x in enumerate((T, A, V)):
            np.add.at(raw[j], i, x.astype(np.int64))
    # 2001-2025 raw sums must be v3's monthly values exactly
    for j, s in enumerate("TAV"):
        exp = np.array(d3["monthly"][s][:NM_HIST], np.int64)
        if not np.array_equal(raw[j][:NM_HIST], exp):
            bad = np.nonzero(raw[j][:NM_HIST] != exp)[0]
            raise SystemExit(f"{c}: {s} cell sums differ from v3 in months {bad[:10].tolist()} "
                             f"({raw[j][bad[:3]].tolist()} vs {exp[bad[:3]].tolist()})")
    # gap fill sums must be v3's gap change
    gapm = B.gapm.get(c, {})
    for i_ in range(NM_HIST):
        if abs(G[:, i_].sum() - gapm.get(i_, 0.0)) > 1e-6 * max(1.0, abs(gapm.get(i_, 0.0))):
            raise SystemExit(f"{c}: gap fill month {i_}: cells {G[:, i_].sum()} vs v3 {gapm.get(i_, 0.0)}")

    # 2026, cell by cell, as build_v3.harm_cells but kept per month
    I0 = B.I0

    def kid(la, lo):
        kk = (int(la) // step, int(lo) // step)
        if kk not in key:
            raise SystemExit(f"{c}: 2026 cell {kk} not in v3 cells")
        return key[kk]
    if c in B.ix_s:
        ix = B.ix_s[c]
        for la, lo, m, n in zip(B.snpp["la"][ix], B.snpp["lo"][ix], B.snpp["m"][ix], B.snpp["n"][ix]):
            H[kid(la, lo), I0 + m - 1] += n
    if c in B.ix_n:
        ix = B.ix_n[c]
        for la, lo, m, kc, n in zip(B.n20["la"][ix], B.n20["lo"][ix], B.n20["m"][ix], B.n20["cls"][ix], B.n20["n"][ix]):
            if kc == "conv":
                H[kid(la, lo), I0 + m - 1] += n * r_n20[m - 1]
    if c in B.ix_i:
        ix = B.ix_i[c]
        for la, lo, m, ms, sen, n in zip(B.interp["la"][ix], B.interp["lo"][ix], B.interp["m"][ix], B.interp["ms"][ix],
                                         B.interp["sensor"][ix], B.interp["n"][ix]):
            H[kid(la, lo), I0 + m - 1] += n if sen == "V" else n * r_n20[ms - 1]

    # per-cell yearly sums against v3 cell_rows (harmonized without the gap fill)
    ny = nmon // 12 + (1 if nmon % 12 else 0)
    Hy = np.zeros((nc3, ny))
    for y in range(ny):
        Hy[:, y] = H[:, y * 12:min(nmon, y * 12 + 12)].sum(1)
    R = np.zeros((nc3, ny))
    cr = d3["cell_rows"]
    for j in range(0, len(cr), 5):
        R[cr[j], cr[j + 1]] = cr[j + 2]
    ydiff = np.abs(Hy - R).max() if nc3 else 0.0
    if ydiff > 0.051 + 1e-9:
        kk, yy = np.unravel_index(np.argmax(np.abs(Hy - R)), Hy.shape)
        raise SystemExit(f"{c}: cell {kk} year {Y0 + yy}: monthly sum {Hy[kk, yy]} vs v3 cell_rows {R[kk, yy]}")
    stats["ydiff"] = max(stats.get("ydiff", 0.0), float(ydiff))

    # site monthly value: v3 harmonized with hist_gaps filled
    mon = d3["monthly"]
    tgt = []
    for i_ in range(nmon):
        mo = i_ % 12
        if i_ < AQ0:
            v = mon["T"][i_] * r_t[mo]
        elif i_ < VI0:
            v = (mon["T"][i_] + mon["A"][i_]) * r_ta[mo]
        else:
            v = mon["V"][i_]
        tgt.append(v)
    for g in d3["y2026"]["hist_gaps"]:
        tgt[g["i"]] = g["filled"]
    tgt = np.array(tgt, float)
    Hf = H + G

    # grid: v3's, coarsened 2x2 while the file is too big
    agg = 1
    while True:
        if agg == 1:
            cells, kmap, cell = cells3, np.arange(nc3), cell3
        else:
            ck = [(cells3[2 * k] // agg, cells3[2 * k + 1] // agg) for k in range(nc3)]
            uk = sorted(set(ck))
            ci = {x: j for j, x in enumerate(uk)}
            kmap = np.array([ci[x] for x in ck], np.int64)
            cells = [v for x in uk for v in x]
            cell = round(cell3 * agg, 6)
        nc = len(cells) // 2
        A_ = np.zeros((nc, nmon))
        np.add.at(A_, kmap, Hf)
        Ar = round_tenths(A_)
        kk, ii = np.nonzero(Ar != 0)  # row-major: sorted by cell, then month
        rows = []
        for a, b, v in zip(kk.tolist(), ii.tolist(), Ar[kk, ii].tolist()):
            rows += [a, b, num1(v)]
        o = {"v": 1, "country": c, "name": d3["name"], "cell": cell, "y0": Y0, "n_months": nmon,
             "partial": d3.get("partial"), "cells": cells, "rows": rows, "same_grid_as_v3": agg == 1,
             "note": note_for(c, agg, cell, cell3)}
        text = dumps(o)
        if len(text.encode()) <= MAX_BYTES:
            break
        agg *= 2
    # rounded cell sums against the site's monthly value
    stats["cell_err"] = max(stats.get("cell_err", 0.0), float(np.abs(Ar - A_).max()) if A_.size else 0.0)
    if agg == 1 and nc3:
        ry = np.zeros((nc3, ny))
        for y in range(ny):
            ry[:, y] = (Ar - G)[:, y * 12:min(nmon, y * 12 + 12)].sum(1)
        stats["ydiff_rounded"] = max(stats.get("ydiff_rounded", 0.0), float(np.abs(ry - R).max()))
    s = Ar.sum(0)
    diff = np.abs(s - tgt)
    rel = diff / np.maximum(tgt, 1.0)
    stats["mdiff"] = max(stats.get("mdiff", 0.0), float(diff.max()))
    stats["mrel"] = max(stats.get("mrel", 0.0), float(rel.max()))
    stats.setdefault("per", []).append((c, float(diff.max()), float(rel.max()), float(np.abs(s.sum() - tgt.sum()))))
    gd = np.abs(Hf.sum(0) - tgt)
    stats["udiff"] = max(stats.get("udiff", 0.0), float(gd.max()))  # unrounded: only from v3's own integer rounding
    (out_dir / f"{c}.json").write_text(text, encoding="utf-8")
    return {"country": c, "name": d3["name"], "cell": cell, "bytes": len(text.encode())}, agg, len(rows) // 3


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--n20-work", type=Path, required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", default="", help="comma-separated countries (testing)")
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    a.out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    B = load_build_v3(a.raw, a.n20_work, a.work / "unused_out")
    print(f"build_v3 tables loaded in {time.time() - t0:.0f}s; past gap days: {len(B.GAP)}", flush=True)
    idx3 = json.load(open(V3 / "index.json"))
    countries = [e["country"] for e in idx3["countries"]]
    d3s = {}
    steps = {}
    for c in countries:
        d = json.load(open(V3 / f"{c}.json"))
        steps[c] = round(d["cell"] * 100000) // BASE
    con = stage_a(a.work, steps, B.GAP)
    only = [x for x in a.only.split(",") if x]
    index, stats, aggs = [], {}, {}
    for c in countries:
        if only and c not in only:
            continue
        d3 = json.load(open(V3 / f"{c}.json"))
        e, agg, nrows = build_country(c, d3, con, a.work, B, a.out, stats)
        index.append(e)
        if agg > 1:
            aggs[c] = (d3["cell"], e["cell"])
    if not only:
        (a.out / "index.json").write_text(dumps({"v": 1, "countries": index}), encoding="utf-8")
    b = np.array([e["bytes"] for e in index])
    print(f"{len(index)} files; bytes min {b.min()} median {int(np.median(b))} p90 {int(np.percentile(b, 90))} "
          f"max {b.max()} total {b.sum()}")
    print("coarsened grids:", aggs, "| cells appended for past-gap NOAA-20 only:", stats.get("extra_cells", 0))
    print(f"max |monthly sum of unrounded cells - site value|: {stats['udiff']:.3f}; rounded: {stats['mdiff']:.2f} "
          f"(max relative {stats['mrel']:.2e}); max |cell-year sum - v3 cell_rows|: {stats['ydiff']:.3f} unrounded, "
          f"{stats.get('ydiff_rounded', 0):.2f} from the rounded values; max |rounded - exact| per cell-month {stats['cell_err']:.3f}")
    worst = sorted(stats["per"], key=lambda x: -x[1])[:5]
    print("worst countries (max abs monthly diff, max rel, |total diff|):", [(c, round(x, 2), f"{r:.1e}", round(t, 1)) for c, x, r, t in worst])
    json.dump({"bytes": b.tolist(), "aggs": aggs, "stats": {k: v for k, v in stats.items() if k != "per"},
               "per": stats["per"]}, open(a.work / "build_report.json", "w"))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
