#!/usr/bin/env python3
"""Extend the New York and California state data in data.js (window.BURN_DATA) through 2026.

data.js was built by a pipeline that is not in this repository. This script first rebuilds the
2001-2025 rows from the FIRMS archive with the rule reverse-engineered below, checks that they match
data.js, and only then appends 2026. The 2001-2025 rows, the exchange rates and every other field are
copied from the base file unchanged.

Rule that data.js uses (reproduced exactly for New York; California within 0.01-0.1%, see the report):
  * Archive: build/hf/<sensor>/<year>/<sensor>_<year>_United_States.parquet (FIRMS's own US files).
  * State membership and county: point inside a county outline in data.js geo (the outlines are
    simplified to 0.001 degree, so a few points on county or state lines can land on the other side).
  * VIIRS Suomi NPP (V): type 0, confidence n or h. MODIS Terra (T) / Aqua (A): type 0, confidence >= 30.
  * Industrial mask: 0.005 degree cells (round(lat/0.005), round(lon/0.005)) where in-state type-0 n/h
    S-NPP detections occur in >= 5 distinct years of 2012-2025 and more than half of all in-state S-NPP
    detections in the cell (any type or confidence) are at night. These core cells are dilated by one cell
    (3 x 3) and every detection (T, A, V) inside them is dropped. New York has 30 core cells, as
    data.js mask.static_sites says.
  * Hexagon: hexKey(lon * hex_k, lat, hex_r) from src/model.ts, looked up in states.<st>.hexes.
  * detail.fine: the same for fine_r hexagons over the kept V detections; ym bit (year - 2012), mm bit month.
  * Month index i = (year - 2001) * 12 + month - 1. Rows are [unit, i, T, A, V], sorted by unit then i.

2026 (month indexes 300-310):
  * The mask stays frozen at the 2012-2025 cells, so no past value changes.
  * VIIRS from the 2026 world downloads (scratch y2026/raw/unmasked/*_all.parquet, CONTRACT.md there).
    SP rows (Jan-Jul) have FIRMS's type; NRT rows (Aug-Nov) have none, so the inferred `type_nonzero`
    (an archive or 2026 SP type != 0 detection within 0.01 degree) stands in for type != 0.
  * Each state-day has one source, by the rule in summary2026/daycls.py (shared with the country summaries):
    S-NPP on the days it delivered; NOAA-20 alone on days S-NPP missed (gaps, and every day after
    2026-11-01, as S-NPP stopped on 2 November) and on partial S-NPP days whose missing UTC hours hold the
    state's overpasses, converted into S-NPP terms with the state's own NOAA-20-to-S-NPP ratio for that
    calendar month (learned on 2018-2025 days when both satellites delivered normally); and, where both
    satellites missed the state's overpasses (12 Oct), the mean of the days either side, built from those
    days' detections at half weight each. The two satellites are never added. To keep integer counts that
    add up the same way in every county, hexagon and 2 km hexagon, converted and estimated detections get
    integer weights by cumulative rounding in time order within the state and month, so their sum is the
    rounded total. The unrounded value and its range are in states.<st>.y2026.
  * Past S-NPP outage days (2018-2025, world S-NPP under half of NOAA-20, as in the country summaries) are
    filled the same way, without changing the 2001-2025 rows: states.<st>.gap_county_rows / gap_hex_rows hold
    the change per unit-month, hist_gaps the state's months, and partial.state_filled / county_filled the
    same days of the partial month filled.
  * MODIS 2026 is not included: T and A are 0 in 2026 rows (meta.modis_through). They do not enter
    the harmonized value from February 2012 on, which is VIIRS as observed.
  * The data end at meta.last_date (the last complete NOAA-20 day). The month holding it is partial,
    and later months have no data (not zero). For the partial month, states.<st>.partial gives the
    S-NPP counts of the same days of the month in 2012-2025, for the state and each county.

Usage:
    .venv/bin/python scripts/extend_data_2026.py --raw <y2026/raw> --work <summary work dir with hist_daily.parquet>
        [--base data.js] [--out data.js] [--report r.json]

Needs duckdb, numpy and shapely. Reads only local files.
"""
import argparse
import csv
import datetime as dt
import json
import math
import sys
from pathlib import Path

import duckdb
import numpy as np
from shapely import MultiPolygon, Polygon, STRtree, points

sys.path.insert(0, str(Path(__file__).resolve().parent / "summary2026"))
import daycls  # noqa: E402  (the per-place day rule shared with the country summaries)

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
PREFIX = "window.BURN_DATA = "
STATES = ("NY", "CA")
BOX = {"NY": (40.3, 45.2, -80.0, -71.6), "CA": (32.3, 42.2, -124.7, -113.9)}  # lat0, lat1, lon0, lon1
Y0, Y_OLD, Y_NEW = 2001, 2025, 2026
VIIRS_Y0 = 2012
N20_FROM = dt.date(2018, 4, 1)
MASK_CELL, MASK_YEARS, MASK_NIGHT = 0.005, 5, 0.5
MODIS_CONF = 30
RATIO_PSEUDO = 200  # NOAA-20 detections of pull toward the state's all-month ratio
YEAR_PSEUDO = 50  # the same for one year's ratio, used for the range
CELL_OFF_LAT, CELL_OFF_LON, CELL_BASE = 20000, 40000, 100000
EQUIV_TOL_2025 = 0.002  # max share of 2025 V detections that may differ by hexagon-month
GOOD_LO, GOOD_HI, GAP_SHARE = 0.75, 1.35, 0.5  # world S-NPP/NOAA-20 per day: both normal; S-NPP outage (as summary v3)


# ---------------------------------------------------------------- data.js
def load_js(path):
    s = Path(path).read_text()
    if not s.startswith(PREFIX):
        sys.exit(f"{path} does not start with {PREFIX!r}")
    return json.loads(s[len(PREFIX):].rstrip().rstrip(";"))


def dump_js(D):
    return PREFIX + json.dumps(D, separators=(",", ":")) + ";\n"


def month_index(y, m):
    return (y - Y0) * 12 + m - 1


# ---------------------------------------------------------------- geometry
class Geo:
    def __init__(self, D, st):
        S = D["states"][st]
        gi = {g["f"]: g for g in D["geo"][st]}
        polys = []
        for c in S["counties"]:
            rings = [np.array(r, float).reshape(-1, 2) for r in gi[c["fips"]]["r"]]
            polys.append(MultiPolygon([Polygon(r) for r in rings]))
        self.tree = STRtree(polys)
        self.nc = len(polys)
        self.R, self.K = S["hex_r"], S["hex_k"]
        hx = np.array(S["hexes"], np.int64).reshape(-1, 3)
        self.nh = len(hx)
        self.hkeys = hx[:, 0] * 1_000_000 + hx[:, 1]
        self.horder = np.argsort(self.hkeys)
        self.fine_r = D["detail"][st]["fine_r"]

    def county(self, lat, lon):
        pi, gi = self.tree.query(points(lon, lat), predicate="within")
        c = np.full(len(lat), -1, np.int64)
        c[pi] = gi
        return c

    def hexagon(self, lat, lon):
        q, r = hex_key(lon * self.K, lat, self.R)
        k = q * 1_000_000 + r
        pos = np.searchsorted(self.hkeys, k, sorter=self.horder)
        pos = np.minimum(pos, len(self.hkeys) - 1)
        idx = self.horder[pos]
        return np.where(self.hkeys[idx] == k, idx, -1)

    def fine(self, lat, lon):
        return hex_key(lon * self.K, lat, self.fine_r)


def hex_key(X, Y, R):
    """Axial (q, r) of the hexagon of size R holding (X, Y): hexKey() in src/model.ts, with JS Math.round."""
    q = ((math.sqrt(3) / 3) * X - Y / 3) / R
    r = ((2 / 3) * Y) / R
    s = -q - r
    rq, rr, rs = np.floor(q + 0.5), np.floor(r + 0.5), np.floor(s + 0.5)
    dq, dr, ds = np.abs(rq - q), np.abs(rr - r), np.abs(rs - s)
    a = (dq > dr) & (dq > ds)
    b = ~a & (dr > ds)
    rq2 = np.where(a, -rr - rs, rq)
    rr2 = np.where(b, -rq - rs, rr)
    return rq2.astype(np.int64), rr2.astype(np.int64)


def cell_key(lat, lon):
    a = np.round(lat / MASK_CELL).astype(np.int64) + CELL_OFF_LAT
    b = np.round(lon / MASK_CELL).astype(np.int64) + CELL_OFF_LON
    return a * CELL_BASE + b


# ---------------------------------------------------------------- archive
def archive(st, sensor, y0, y1):
    la0, la1, lo0, lo1 = BOX[st]
    files = str(HF / sensor / "*" / f"{sensor}_*_United_States.parquet")
    r = duckdb.connect().execute(
        f"SELECT latitude, longitude, acq_date, acq_time, satellite, CAST(confidence AS VARCHAR) AS confidence, "
        f"daynight, type FROM read_parquet('{files}') WHERE latitude BETWEEN {la0} AND {la1} "
        f"AND longitude BETWEEN {lo0} AND {lo1} AND year(acq_date) BETWEEN {y0} AND {y1} "
        f"ORDER BY acq_date, acq_time, latitude, longitude").fetchnumpy()
    return {k: np.asarray(v) for k, v in r.items()}


def with_dates(r):
    day = r["acq_date"].astype("datetime64[D]")
    r["day"] = day
    r["year"] = day.astype("datetime64[Y]").astype(int) + 1970
    r["month"] = day.astype("datetime64[M]").astype(int) % 12 + 1
    r["mi"] = (r["year"] - Y0) * 12 + r["month"] - 1
    return r


def static_cells(snpp, county):
    """Dilated industrial mask cells (sorted cell keys) and the number of core cells."""
    ins = county >= 0
    use = ins & (snpp["type"] == 0) & np.isin(snpp["confidence"], ["n", "h"])
    key = cell_key(snpp["latitude"], snpp["longitude"])
    uk, inv = np.unique(key, return_inverse=True)
    seen = np.zeros((len(uk), Y_OLD - VIIRS_Y0 + 1), bool)
    seen[inv[use], snpp["year"][use] - VIIRS_Y0] = True
    night = snpp["daynight"] == "N"
    nt = np.bincount(inv[ins], weights=night[ins], minlength=len(uk))
    tt = np.bincount(inv[ins], minlength=len(uk))
    core = uk[(seen.sum(1) >= MASK_YEARS) & (nt / np.maximum(tt, 1) > MASK_NIGHT)]
    ring = np.array([dx * CELL_BASE + dy for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    return np.unique((core[:, None] + ring[None, :]).ravel()), len(core)


def keep_viirs(r):
    return (r["type"] == 0) & np.isin(r["confidence"], ["n", "h"])


def keep_modis(r):
    return (r["type"] == 0) & (r["confidence"].astype(int) >= MODIS_CONF)


# ---------------------------------------------------------------- rows
def unit_rows(unit, mi, w, n_units, i0, i1):
    """Counts [n_units, i1 - i0] of weight w per unit and month index."""
    M = np.zeros((n_units, i1 - i0), np.int64)
    ok = (unit >= 0) & (mi >= i0) & (mi < i1)
    np.add.at(M, (unit[ok], mi[ok] - i0), w[ok])
    return M


def flat_rows(T, A, V, i0):
    out = []
    n, m = T.shape
    for u in range(n):
        for j in range(m):
            if T[u, j] or A[u, j] or V[u, j]:
                out += [u, i0 + j, int(T[u, j]), int(A[u, j]), int(V[u, j])]
    return out


def grid_from_rows(rows, n_units, n_months, col):
    a = np.array(rows, np.int64).reshape(-1, 5)
    M = np.zeros((n_units, n_months), np.int64)
    M[a[:, 0], a[:, 1]] = a[:, col]
    return M


# ---------------------------------------------------------------- one state
def load_state_archive(st, geo):
    v = with_dates(archive(st, "viirs-snpp", VIIRS_Y0, Y_OLD))
    v["county"] = geo.county(v["latitude"], v["longitude"])
    cells, n_core = static_cells(v, v["county"])
    out = {"cells": cells, "n_core": n_core, "V": v}
    md = with_dates(archive(st, "modis", Y0, Y_OLD))
    for sat, name in (("Terra", "T"), ("Aqua", "A")):
        sel = md["satellite"] == sat
        out[name] = {k: a[sel] for k, a in md.items()}
        out[name]["county"] = geo.county(out[name]["latitude"], out[name]["longitude"])
    n20 = with_dates(archive(st, "viirs-jpss1", 2018, Y_OLD))
    n20["county"] = geo.county(n20["latitude"], n20["longitude"])
    out["N20"] = n20
    for name in ("V", "T", "A", "N20"):
        r = out[name]
        filt = keep_modis(r) if name in ("T", "A") else keep_viirs(r)
        r["masked"] = np.isin(cell_key(r["latitude"], r["longitude"]), cells)
        r["keep"] = filt & ~r["masked"] & (r["county"] >= 0)
        r["removed"] = filt & r["masked"] & (r["county"] >= 0)
        r["hex"] = geo.hexagon(r["latitude"], r["longitude"])
    return out


def equivalence(st, S, D, geo, A):
    """Rebuild 2001-2025 county_rows, hex_rows and detail.fine and compare them with data.js."""
    n_old = (Y_OLD - Y0 + 1) * 12
    rep = {"core_cells": A["n_core"], "data_js_static_sites": S["mask"]["static_sites"]}
    for kind, unit_key, n_units, ref_rows in (("county", "county", geo.nc, S["county_rows"]),
                                              ("hex", "hex", geo.nh, S["hex_rows"])):
        for col, name in ((2, "T"), (3, "A"), (4, "V")):
            r = A[name]
            mine = unit_rows(np.where(r["keep"], r[unit_key], -1), r["mi"], np.ones(len(r["mi"]), np.int64), n_units, 0, n_old)
            ref = grid_from_rows(ref_rows, n_units, n_old, col)
            d = np.abs(mine - ref)
            y25 = slice(month_index(2025, 1), n_old)
            rep[f"{kind}_{name}"] = {
                "data_js_total": int(ref.sum()), "rebuilt_total": int(mine.sum()),
                "abs_cell_month_diff_all": int(d.sum()), "abs_cell_month_diff_2025": int(d[:, y25].sum()),
                "data_js_2025": int(ref[:, y25].sum()), "rebuilt_2025": int(mine[:, y25].sum()),
                "cell_months_differing_2025": int((d[:, y25] > 0).sum())}
    rep["mask_removed"] = {n: int(A[n]["removed"].sum()) for n in ("T", "A", "V")}
    rep["data_js_mask_removed"] = S["mask"]["removed"]
    # fine detail
    v = A["V"]
    fq, fr = geo.fine(v["latitude"][v["keep"]], v["longitude"][v["keep"]])
    mine = {}
    for q, r, y, m in zip(fq.tolist(), fr.tolist(), v["year"][v["keep"]].tolist(), v["month"][v["keep"]].tolist()):
        e = mine.setdefault((q, r), [0, 0, 0])
        e[0] += 1
        e[1] |= 1 << (y - VIIRS_Y0)
        e[2] |= 1 << (m - 1)
    f = np.array(D["detail"][st]["fine"], np.int64).reshape(-1, 5)
    ref = {(int(a[0]), int(a[1])): [int(a[2]), int(a[3]), int(a[4])] for a in f}
    keys = set(ref) | set(mine)
    rep["fine"] = {"data_js_cells": len(ref), "rebuilt_cells": len(mine),
                   "cells_differing": sum(1 for k in keys if ref.get(k) != mine.get(k)),
                   "abs_count_diff": sum(abs(ref.get(k, [0])[0] - mine.get(k, [0])[0]) for k in keys)}
    return rep


def world_days(work):
    """Days of 2018-2025 on which both satellites delivered normally (world S-NPP/NOAA-20 within 0.75-1.35), and the
    S-NPP outage days (world S-NPP under half of NOAA-20), from the country summaries' daily history (hist_daily.parquet):
    the same two rules as scripts/summary2026/n20_rates.py and build_v3.py."""
    r = duckdb.connect().execute(
        f"SELECT d, sum(n) FILTER (WHERE sensor = 'V') v, sum(n) FILTER (WHERE sensor = 'N20') n "
        f"FROM read_parquet('{Path(work) / 'hist_daily.parquet'}') WHERE d >= DATE '2018-01-01' GROUP BY d").fetchall()
    good = {d for d, v, n in r if v and n and GOOD_LO < v / n < GOOD_HI}
    gap = {d for d, v, n in r if n and (v or 0) < GAP_SHARE * n}
    return good, gap


def on_days(r, days):
    dd = r["day"].astype("datetime64[D]")
    return np.isin(dd, np.array(sorted(days), dtype="datetime64[D]"))


def n20_ratios(A, good):
    """NOAA-20 to S-NPP: per calendar month, S-NPP / NOAA-20 detections in the state, Apr 2018 - Dec 2025, on days both
    satellites delivered normally (S-NPP outage days would pull the ratio down)."""
    v, n = A["V"], A["N20"]
    i_from = month_index(N20_FROM.year, N20_FROM.month)
    vg, ng = v["keep"] & on_days(v, good), n["keep"] & on_days(n, good)
    vm = unit_rows(np.where(vg, 0, -1), v["mi"], np.ones(len(v["mi"]), np.int64), 1, i_from, month_index(Y_OLD, 12) + 1)[0]
    nm = unit_rows(np.where(ng, 0, -1), n["mi"], np.ones(len(n["mi"]), np.int64), 1, i_from, month_index(Y_OLD, 12) + 1)[0]
    mon = (np.arange(i_from, month_index(Y_OLD, 12) + 1)) % 12
    yrs = (np.arange(i_from, month_index(Y_OLD, 12) + 1)) // 12 + Y0
    r_all = vm.sum() / nm.sum()
    out = {"r_all": round(float(r_all), 4), "r": [], "lo": [], "hi": [], "n20": [], "snpp": [], "by_year": []}
    for m in range(12):
        s = mon == m
        V, N = vm[s].sum(), nm[s].sum()
        r = (V + RATIO_PSEUDO * r_all) / (N + RATIO_PSEUDO)
        per_year = [(int(y), (vm[s & (yrs == y)].sum() + YEAR_PSEUDO * r) / (nm[s & (yrs == y)].sum() + YEAR_PSEUDO))
                    for y in np.unique(yrs[s])]
        ry = [x for _, x in per_year]
        out["r"].append(round(float(r), 4))
        out["lo"].append(round(float(min(ry)), 4))
        out["hi"].append(round(float(max(ry)), 4))
        out["n20"].append(int(N))
        out["snpp"].append(int(V))
        out["by_year"].append({str(y): round(float(x), 4) for y, x in per_year})
    return out


def same_days_history(A, geo, month, last_day, gap=None, ratios=None):
    """S-NPP detections (data.js filter) on days 1..last_day of `month` in each year 2012-2025. With `gap`, S-NPP outage
    days are filled from NOAA-20 times the state's ratio for the month, as 2026 is."""
    years = list(range(VIIRS_Y0, Y_OLD + 1))
    C = np.zeros((geo.nc, len(years)), np.float64)
    for name, w in (("V", 1.0), ("N20", None)):
        if w is None and gap is None:
            continue
        r = A[name]
        dom = (r["day"] - r["day"].astype("datetime64[M]").astype("datetime64[D]")).astype(int) + 1
        sel = r["keep"] & (r["month"] == month) & (dom <= last_day)
        if gap is not None:
            g = on_days(r, gap)
            sel &= ~g if name == "V" else g
        wt = 1.0 if name == "V" else ratios["r"][month - 1]
        np.add.at(C, (r["county"][sel], r["year"][sel] - VIIRS_Y0), wt)
    return years, C


def gap_rows(A, geo, gap, ratios, unit_key, n_units):
    """Change to each unit-month of 2018-2025 from filling S-NPP outage days with NOAA-20 times the state's ratio:
    flat [unit, i, delta]. Also the state's monthly S-NPP and NOAA-20 counts on those days."""
    i0, i1 = month_index(2018, 1), month_index(Y_OLD, 12) + 1
    out = np.zeros((n_units, i1 - i0))
    tot = {}
    for name in ("V", "N20"):
        r = A[name]
        sel = r["keep"] & on_days(r, gap)
        w = -np.ones(int(sel.sum())) if name == "V" else np.array([ratios["r"][m - 1] for m in r["month"][sel]])
        ok = (r[unit_key][sel] >= 0) & (r["mi"][sel] >= i0)
        np.add.at(out, (r[unit_key][sel][ok], r["mi"][sel][ok] - i0), w[ok])
        tot[name] = np.bincount(r["mi"][sel] - i0, minlength=i1 - i0)
    rows = []
    for u, j in zip(*np.nonzero(np.abs(out) > 1e-9)):
        rows += [int(u), int(i0 + j), round(float(out[u, j]), 2)]
    return rows, tot, i0


# ---------------------------------------------------------------- 2026
def coverage(raw):
    ok = {"viirs-snpp": set(), "viirs-noaa20": set()}
    status = {}
    with open(Path(raw) / "coverage_days.csv") as f:
        for row in csv.DictReader(f):
            d = dt.date.fromisoformat(row["date"])
            status[(row["sensor"], d)] = row["status"]
            if row["status"] == "ok":
                ok[row["sensor"]].add(d)
    return ok, status


def read_2026(raw, st, sensor):
    la0, la1, lo0, lo1 = BOX[st]
    f = Path(raw) / "unmasked" / f"{sensor}_2026_all.parquet"
    r = duckdb.connect().execute(
        f"SELECT latitude, longitude, acq_date, acq_time, confidence, daynight, source, type, type_nonzero "
        f"FROM read_parquet('{f}') WHERE latitude BETWEEN {la0} AND {la1} AND longitude BETWEEN {lo0} AND {lo1} "
        f"ORDER BY acq_date, acq_time, latitude, longitude").fetchnumpy()
    r = {k: np.asarray(v) for k, v in r.items()}
    return with_dates(r)


def cum_round(wf):
    """integer weights whose running sums are the rounded running sums of wf (so their total is round(sum wf))"""
    c = np.cumsum(wf)
    return (np.floor(c + 0.5 + 1e-9) - np.floor(np.concatenate([[0.0], c[:-1]]) + 0.5 + 1e-9)).astype(np.int64)


def take(r, sel):
    n = len(r["mi"])
    return {k: (a[sel] if isinstance(a, np.ndarray) and len(a) == n else a) for k, a in r.items()}


def build_2026(st, raw, geo, A, ratios, DY):
    """2026 detections by source: s (S-NPP on its days), n (NOAA-20 on converted days), i (days interpolated
    because both satellites missed the state's overpasses), each with integer weights w that add up by month."""
    last = DY.days[-1]
    full = {}
    for sensor in ("viirs-snpp", "viirs-noaa20"):
        r = read_2026(raw, st, sensor)
        r["county"] = geo.county(r["latitude"], r["longitude"])
        inr = r["day"].astype("datetime64[D]") <= np.datetime64(last)
        filt = np.isin(r["confidence"], ["n", "h"]) & ~r["type_nonzero"].astype(bool)
        r["masked"] = np.isin(cell_key(r["latitude"], r["longitude"]), A["cells"])
        keep = inr & filt & ~r["masked"] & (r["county"] >= 0)
        stats = {"rows_in_box": int(len(keep)), "kept_all_days": int(keep.sum()),
                 "dropped_type_or_conf": int((inr & ~filt & (r["county"] >= 0)).sum()),
                 "dropped_mask": int((inr & filt & r["masked"] & (r["county"] >= 0)).sum()),
                 "sp_rows": int((r["source"] == "SP").sum()), "nrt_rows": int((r["source"] == "NRT").sum())}
        r = take(r, keep)
        r["hex"] = geo.hexagon(r["latitude"], r["longitude"])
        r["dobj"] = r["day"].astype("datetime64[D]").astype(object)
        r["hour"] = np.array([int(t[:2]) for t in r["acq_time"]], np.int64)
        r["stats"] = stats
        full[sensor] = r
    S_, N_ = full["viirs-snpp"], full["viirs-noaa20"]
    daily, hourly = {}, {}
    for k, r in ((0, S_), (1, N_)):
        for d, h in zip(r["dobj"], r["hour"]):
            v = list(daily.get(d, (0, 0)))
            v[k] += 1
            daily[d] = tuple(v)
            key = ("V" if k == 0 else "N", d, int(h))
            hourly[key] = hourly.get(key, 0) + 1
    rr = ratios["r"]
    cls, why, src, rng = DY.classify(daily, hourly, rr)
    s = take(S_, np.array([cls[d] == "obs" for d in S_["dobj"]], bool))
    n = take(N_, np.array([cls[d] == "conv" for d in N_["dobj"]], bool))
    s["w"] = np.ones(len(s["mi"]), np.int64)
    n["wf"] = np.array([rr[m - 1] for m in n["month"]], np.float64)
    n["w"] = np.zeros(len(n["mi"]), np.int64)
    for mi in np.unique(n["mi"]):
        idx = np.where(n["mi"] == mi)[0]
        n["w"][idx] = cum_round(n["wf"][idx])
    # interpolated days: the source days' detections, each weighted by its share and its rate, moved to the day
    pieces = []
    for d, sd in sorted(src.items()):
        for x, wt in sd:
            base, f = (S_, lambda m: 1.0) if cls[x] == "obs" else (N_, lambda m: rr[m - 1])
            p = take(base, np.array([y == x for y in base["dobj"]], bool))
            p["wf"] = np.array([wt * f(m) for m in p["month"]], np.float64)
            p["mi"] = np.full(len(p["wf"]), month_index(d.year, d.month), np.int64)
            p["month"] = np.full(len(p["wf"]), d.month, np.int64)
            pieces.append(p)
    keys = ("latitude", "longitude", "county", "hex", "mi", "month", "wf")
    i_ = {k: (np.concatenate([p[k] for p in pieces]) if pieces else np.zeros(0)) for k in keys}
    for k in ("county", "hex", "mi", "month"):
        i_[k] = i_[k].astype(np.int64)
    i_["w"] = np.zeros(len(i_["mi"]), np.int64)
    for mi in np.unique(i_["mi"]):
        idx = np.where(i_["mi"] == mi)[0]
        i_["w"][idx] = cum_round(i_["wf"][idx])
    days = DY.days
    meta = {"last": last, "days": days, "cls": cls, "why": why, "rng": rng,
            "use_snpp": sorted(d for d in days if cls[d] == "obs"), "use_n20": sorted(d for d in days if cls[d] == "conv"),
            "use_interp": sorted(d for d in days if cls[d] == "interp"),
            "stats": {"snpp": S_["stats"], "noaa20": N_["stats"]}}
    return s, n, i_, meta


def monthly_2026(st, s, n, i_, ratios, meta, geo):
    i0, i1 = month_index(Y_NEW, 1), month_index(Y_NEW, meta["last"].month) + 1
    out = []
    for i in range(i0, i1):
        m = i % 12
        vs = int((s["mi"] == i).sum())
        nn = int((n["mi"] == i).sum())
        conv = int(n["w"][n["mi"] == i].sum())
        ii = int(i_["w"][i_["mi"] == i].sum())
        ie = float(i_["wf"][i_["mi"] == i].sum())
        r, lo, hi = ratios["r"][m], ratios["lo"][m], ratios["hi"][m]
        idays = [d for d in meta["use_interp"] if d.month == m + 1]
        ilo = sum(meta["rng"][d][0] for d in idays)
        ihi = sum(meta["rng"][d][2] for d in idays)
        e = {"i": i, "v": vs + conv + ii, "v_exact": round(vs + r * nn + ie, 2), "lo": round(vs + lo * nn + ilo, 2),
             "hi": round(vs + hi * nn + ihi, 2), "snpp": vs, "n20_raw": nn, "n20_converted": conv,
             "days_snpp": sum(1 for d in meta["use_snpp"] if d.month == m + 1),
             "days_n20": sum(1 for d in meta["use_n20"] if d.month == m + 1)}
        if idays:
            e.update({"days_interp": len(idays), "interp": ii, "interp_exact": round(ie, 2)})
        e["lo"], e["hi"] = min(e["lo"], e["v"]), max(e["hi"], e["v"])
        out.append(e)
    return out


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path, help="the 2026 download folder (y2026/raw)")
    ap.add_argument("--base", type=Path, default=ROOT / "data.js", help="data.js ending in 2025")
    ap.add_argument("--out", type=Path, default=ROOT / "data.js")
    ap.add_argument("--report", type=Path)
    ap.add_argument("--work", required=True, type=Path,
                    help="the country summaries' work folder holding hist_daily.parquet (build_summaries_2026.py --work)")
    a = ap.parse_args()

    D = load_js(a.base)
    if D["meta"]["y1"] != Y_OLD:
        sys.exit(f"base meta.y1 is {D['meta']['y1']}, expected {Y_OLD}; pass --base with the 2025 copy")
    base_text = a.base.read_text()
    ok_days, status = coverage(a.raw)
    good, gap = world_days(a.work)
    last_all = max(d for d in ok_days["viirs-noaa20"] if d.year == Y_NEW)
    DY = daycls.Days(a.raw, dt.date(Y_NEW, 1, 1), last_all, duckdb.connect())
    report = {"base": str(a.base), "states": {}, "good_overlap_days": len(good), "gap_days": sorted(str(d) for d in gap)}
    n_old = (Y_OLD - Y0 + 1) * 12

    for st in STATES:
        S = D["states"][st]
        geo = Geo(D, st)
        print(f"[{st}] reading archive", flush=True)
        A = load_state_archive(st, geo)
        eq = equivalence(st, S, D, geo, A)
        print(f"[{st}] equivalence: {json.dumps(eq)}", flush=True)
        hv = eq["hex_V"]
        if hv["abs_cell_month_diff_2025"] > EQUIV_TOL_2025 * max(hv["data_js_2025"], 1):
            sys.exit(f"[{st}] the rebuilt 2025 rows do not match data.js; not patching")
        ratios = n20_ratios(A, good)
        s, n, i_, meta = build_2026(st, a.raw, geo, A, ratios, DY)
        parts = (s, n, i_)
        last = meta["last"]
        i0, i1 = month_index(Y_NEW, 1), month_index(Y_NEW, last.month) + 1

        # rows
        def rows_for(unit_key, n_units):
            V = sum(unit_rows(p[unit_key], p["mi"], p["w"], n_units, i0, i1) for p in parts)
            Z = np.zeros_like(V)
            return flat_rows(Z, Z, V, i0)
        hex_missing = int(sum(p["w"][p["hex"] < 0].sum() for p in parts))
        S["county_rows"] = S["county_rows"] + rows_for("county", geo.nc)
        S["hex_rows"] = S["hex_rows"] + rows_for("hex", geo.nh)

        # fine detail: add 2026 weights; existing cells keep their order, new cells go at the end
        f = D["detail"][st]["fine"]
        pos = {(f[5 * j], f[5 * j + 1]): j for j in range(len(f) // 5)}
        n_new_cells = 0
        for part in parts:
            fq, fr = geo.fine(part["latitude"], part["longitude"])
            for q, r, m, w in zip(fq.tolist(), fr.tolist(), part["month"].tolist(), part["w"].tolist()):
                if w == 0:
                    continue
                j = pos.get((q, r))
                if j is None:
                    j = pos[(q, r)] = len(f) // 5
                    f += [q, r, 0, 0, 0]
                    n_new_cells += 1
                f[5 * j + 2] += w
                f[5 * j + 3] |= 1 << (Y_NEW - VIIRS_Y0)
                f[5 * j + 4] |= 1 << (m - 1)

        # partial month: same days in 2012-2025, state and counties
        pm, pd_ = last.month, last.day
        years, C = same_days_history(A, geo, pm, pd_)
        _, CF = same_days_history(A, geo, pm, pd_, gap, ratios)
        cur_c = np.zeros(geo.nc, np.int64)
        for part in parts:
            sel = part["mi"] == month_index(Y_NEW, pm)
            np.add.at(cur_c, part["county"][sel], part["w"][sel])
        st_hist = C.sum(0)
        monthly = monthly_2026(st, s, n, i_, ratios, meta, geo)
        cur = monthly[-1]
        S["partial"] = {
            "i": month_index(Y_NEW, pm), "y": Y_NEW, "m": pm, "day_from": 1, "day_to": pd_,
            "days_in_month": (dt.date(Y_NEW + (pm == 12), pm % 12 + 1, 1) - dt.timedelta(1)).day,
            "years": years, "state": [int(x) for x in st_hist], "state_median": float(np.median(st_hist)),
            "state_2026": cur["v"], "state_2026_lo": cur["lo"], "state_2026_hi": cur["hi"],
            "county": [[int(x) for x in C[c]] for c in range(geo.nc)],
            "county_median": [float(np.median(C[c])) for c in range(geo.nc)],
            "county_2026": [int(x) for x in cur_c],
            # gap-filled like 2026: S-NPP outage days of the past filled from NOAA-20 times the state's ratio
            "state_filled": [round(float(x), 1) for x in CF.sum(0)], "state_filled_median": float(np.median(CF.sum(0))),
            "county_filled": [[round(float(x), 1) for x in CF[c]] for c in range(geo.nc)],
            "county_filled_median": [float(np.median(CF[c])) for c in range(geo.nc)],
            "filled_years": sorted({d.year for d in gap if d.month == pm and d.day <= pd_}),
            "note": ("VIIRS S-NPP detections (type 0, confidence n/h, industrial mask) on the same days of the month, 2012-2025. "
                     "state/county: as observed; state_filled/county_filled: S-NPP outage days (world S-NPP under half of "
                     "NOAA-20) filled from NOAA-20 times the state's ratio for the month, as 2026 is."),
        }
        # past S-NPP outage months, filled the same way: deltas per county and hexagon, and the state's months
        S["gap_county_rows"], gtot, g0 = gap_rows(A, geo, gap, ratios, "county", geo.nc)
        S["gap_hex_rows"], _, _ = gap_rows(A, geo, gap, ratios, "hex", geo.nh)
        hg = []
        old = np.array(S["county_rows"], np.int64).reshape(-1, 5)
        for j in np.nonzero(gtot["V"] + gtot["N20"])[0]:
            i = int(g0 + j)
            v = int(old[old[:, 1] == i, 4].sum())
            m = i % 12
            nn = int(gtot["N20"][j])
            base = v - int(gtot["V"][j])
            hg.append({"i": i, "days": sorted(d.day for d in gap if month_index(d.year, d.month) == i),
                       "v": v, "snpp_gap": int(gtot["V"][j]), "n20_gap": nn, "filled": round(base + ratios["r"][m] * nn, 2),
                       "lo": round(base + min(ratios["lo"][m], ratios["r"][m]) * nn, 2),
                       "hi": round(base + max(ratios["hi"][m], ratios["r"][m]) * nn, 2)})
        S["hist_gaps"] = hg
        S["y2026"] = {
            "months": monthly,
            "n20_dates": [d.isoformat() for d in meta["use_n20"]],
            "interp_dates": [d.isoformat() for d in meta["use_interp"]],
            "why": {d.isoformat(): w for d, w in sorted(meta["why"].items())},
            "ratio_n20_to_snpp": {k: ratios[k] for k in ("r_all", "r", "lo", "hi", "n20", "snpp")},
            "ratio_note": ("S-NPP / NOAA-20 detections per calendar month, Apr 2018 - Dec 2025, on days both satellites "
                           "delivered normally (world S-NPP/NOAA-20 within 0.75-1.35), same filter, "
                           f"pulled toward the all-month ratio with {RATIO_PSEUDO} NOAA-20 detections; lo/hi = lowest and "
                           f"highest single-year ratio (each pulled toward the month's ratio with {YEAR_PSEUDO})"),
            "inputs": meta["stats"],
            "hexless_detections": hex_missing,
            "fine_new_cells": n_new_cells,
        }
        report["states"][st] = {"equivalence": eq, "ratios": ratios, "months_2026": monthly,
                                "inputs_2026": meta["stats"], "hexless_2026": hex_missing,
                                "fine_new_cells": n_new_cells, "partial": {k: S["partial"][k] for k in
                                ("i", "day_to", "years", "state", "state_median", "state_2026", "state_2026_lo", "state_2026_hi")}}
        print(f"[{st}] 2026: {json.dumps(monthly)}", flush=True)

    last = meta["last"]
    world_conv = sorted(d for d in DY.days if d not in DY.snpp_ok)
    D["meta"]["y1"] = Y_NEW
    D["meta"]["last_date"] = last.isoformat()
    D["meta"]["last_i"] = month_index(Y_NEW, last.month)
    D["meta"]["partial"] = {"i": month_index(Y_NEW, last.month), "y": Y_NEW, "m": last.month, "day_to": last.day,
                            "days_in_month": S["partial"]["days_in_month"]}
    D["meta"]["modis_through"] = [Y_OLD, 12]
    D["meta"]["viirs_2026"] = {
        "snpp_days": len(DY.days) - len(world_conv), "n20_days": len(world_conv),
        "n20_dates": [d.isoformat() for d in world_conv],
        "note": ("2026 VIIRS, day by day for each state (states.<st>.y2026): Suomi NPP on its complete days; NOAA-20 alone times "
                 "the state's NOAA-20-to-S-NPP ratio for the month on days Suomi NPP missed (n20_dates here: the days it missed "
                 "for the world, every day after 2026-11-01 among them), and on partial Suomi NPP days whose missing hours hold "
                 "the state's overpasses; where both satellites missed them (12 Oct), the mean of the days either side "
                 "(interp_dates). Never added together. SP Jan-Jul, NRT Aug-Nov (type inferred). MODIS columns are 0 in 2026. "
                 "Months after last_i have no data. Past Suomi NPP outage days (2018-2025) are filled the same way in "
                 "states.<st>.gap_county_rows / gap_hex_rows ([unit, i, change]) and hist_gaps."),
    }

    # validation: every 2001-2025 value unchanged
    B = load_js(a.base)
    for st in STATES:
        for key in ("county_rows", "hex_rows"):
            old, new = B["states"][st][key], D["states"][st][key]
            assert new[:len(old)] == old, f"{st} {key}: 2001-2025 changed"
            assert all(x >= month_index(Y_NEW, 1) for x in new[len(old) + 1::5]), f"{st} {key}: new rows before 2026"
        fo, fn = B["detail"][st]["fine"], D["detail"][st]["fine"]
        for j in range(len(fo) // 5):
            assert fo[5 * j:5 * j + 2] == fn[5 * j:5 * j + 2] and fn[5 * j + 2] >= fo[5 * j + 2]
        for k in B["states"][st]:
            if k not in ("county_rows", "hex_rows"):
                assert B["states"][st][k] == D["states"][st][k], f"{st}.{k} changed"
    for k in B:
        if k not in ("meta", "states", "detail"):
            assert B[k] == D[k], f"{k} changed"
    text = dump_js(D)
    json.loads(text[len(PREFIX):].rstrip().rstrip(";"))
    a.out.write_text(text)
    report["size_bytes"] = {"base": len(base_text), "out": len(text)}
    report["meta"] = D["meta"]
    if a.report:
        a.report.write_text(json.dumps(report, indent=1, default=str))
    print(f"wrote {a.out} ({len(text):,} bytes; base {len(base_text):,})")


if __name__ == "__main__":
    main()
