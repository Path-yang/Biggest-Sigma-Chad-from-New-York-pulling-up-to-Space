#!/usr/bin/env python3
"""Build one small, harmonized fire summary per FIRMS country.

Reads the Parquet copy of the FIRMS yearly country files under build/hf/ and
writes, for each of the 238 FIRMS countries, build/hf/summary/v2/<Country>.json,
plus build/hf/summary/v2/index.json (or summary/v1/ with --summary-version 1). The Burn Calendar page fetches one of
these when a reader clicks a country, instead of hundreds of MB of raw files.

Method (the same one the page uses for New York and California, as far as
the world data allows):

  * Count vegetation fires at nominal or high confidence: type = 0, MODIS
    confidence >= 30, VIIRS confidence 'n' or 'h'. FIRMS's type flag stands
    in for the hand-made industrial-site mask used for the two states.
  * v2 only: a 0.05 degree cell is dropped for a whole calendar year, for every
    sensor, when any of the three sensors flags any detection there that year
    as a volcano, other static land source or offshore (type 1, 2 or 3). The
    sensors do not flag the same sources: MODIS often flags eruption lava and
    some flares as type 1 or 2 where Suomi NPP VIIRS gives them type 0, which
    in v1 put lava into VIIRS only and broke the exchange rates of Iceland
    and Reunion. v1 had no such mask and is kept as published.
  * Monthly counts per sensor: Terra, Aqua, Suomi NPP VIIRS, NOAA-20 VIIRS.
  * On the overlap, February 2012 to December 2025, learn one VIIRS-per-MODIS
    exchange rate per calendar month (Terra+Aqua, and Terra alone). Each
    monthly rate is shrunk toward the country's all-months rate, which is
    itself shrunk toward the global rate, with pseudo-counts chosen by
    leave-one-year-out error over all countries (see choose_pseudo_counts).
  * From February 2012 VIIRS is used as observed; before that MODIS times the
    rate (Terra alone, with its own rate, before July 2002).
  * Leave-one-year-out validation over 2012-2025 gives the error figures and
    the 90% range multipliers per size bin: the 5th and 95th percentile of
    observed / predicted over held-out months, taken from the country as a
    whole and from its 1 degree cells (so small areas inside a big country
    get the country's own small-count range). A bin with fewer than 30 such
    months uses the value pooled over all countries.
  * A grid of monthly-harmonized, yearly-summed counts per cell, at the finest
    of 0.1, 0.25, 0.5 or 1 degree that keeps the file small.

Usage:
    .venv/bin/python scripts/build_country_summaries.py [--summary-version 1|2] [--cache DIR] [--refresh] [--stage1-only]

Stage 1 reads the Parquet files once per country with DuckDB and keeps the
counts on a 0.05 degree grid in --cache (one cache per summary version) (reused on later runs unless
--refresh). Stage 2 computes rates, validation and grids from the cache.
Needs duckdb and numpy.
"""
import argparse
import csv
import json
import math
import os
import sys
import time
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
DATASET = "rogeryzd/firms-active-fire-by-country"

Y0, Y1 = 2001, 2025
NYR = Y1 - Y0 + 1
NM = NYR * 12
VIIRS_FROM = (2012, 2)
AQUA_FROM = (2002, 7)
VI0 = (VIIRS_FROM[0] - Y0) * 12 + VIIRS_FROM[1] - 1  # first month VIIRS is used as observed
AQ0 = (AQUA_FROM[0] - Y0) * 12 + AQUA_FROM[1] - 1  # first month Aqua flew
BINS = [10, 100, 1000]
OV_Y0 = VIIRS_FROM[0]
OV_NY = Y1 - OV_Y0 + 1  # overlap years, 2012..2025

BASE_STEP = 5000  # base grid: 0.05 degree, in units of 1e-5 degree
CELL_CHOICES = [0.1, 0.25, 0.5, 1.0]  # each a whole multiple of 0.05
TARGET_BYTES = 1_500_000
MAX_BYTES = 2_500_000
VAL_CELL = 1.0  # grid used for cell-level held-out months in the range multipliers

PSEUDO_GRID = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000]
NEAR_BEST = 0.01  # pseudo-counts: lightest pair within 1% of the best held-out score
MIN_BIN_MONTHS = 30  # fewer held-out months than this in a bin: use the pooled value
MIN_EVAL_V = 50  # countries with fewer overlap VIIRS detections do not vote on pseudo-counts
BOOT = 1000
SEED = 20120201

FILTER_V1 = ("Vegetation fires only (FIRMS type 0) at nominal or high confidence (MODIS confidence 30 or more, "
          "VIIRS confidence n or h); FIRMS's own type flag stands in for the hand-made industrial-site mask "
          "used for New York and California, and detections before 2001 are dropped.")
FILTER_V2 = ("Vegetation fires only (FIRMS type 0) at nominal or high confidence (MODIS confidence 30 or more, "
             "VIIRS confidence n or h), with every 0.05 degree cell dropped for a whole year, for all sensors, when any "
             "sensor flags a detection there that year as a volcano, static land source or offshore (type 1, 2 or 3), "
             "because MODIS and VIIRS do not flag the same sources (VIIRS gave the lava of several eruptions type 0); "
             "detections before 2001 are dropped.")
UNRELIABLE_WAPE = 1.0  # v2: held-out monthly error above this gets a warning in rate_note
HIGH_RATE = 2  # v2: an all-months rate above this many times the global one gets a note in rate_note

# Display names where swapping underscores for spaces reads wrong.
NAME_FIX = {
    "Brunei_Darussalam": "Brunei",
    "Cote_d_Ivoire": "Cote d'Ivoire",
    "Dem_Rep_Korea": "North Korea",
    "Republic_of_Korea": "South Korea",
    "Faeroe_Islands": "Faroe Islands",
    "Heard_I_and_McDonald_Islands": "Heard Island and McDonald Islands",
    "Lao_PDR": "Laos",
    "Macedonia_Former_Yugoslav_Republic_of": "North Macedonia",
    "Republic_of_Congo": "Republic of the Congo",
    "Russian_Federation": "Russia",
    "Saint-Barthelemy": "Saint Barthelemy",
    "Saint-Martin": "Saint Martin",
    "Swaziland": "Eswatini",
    "Wallis_and_Futuna_Islands": "Wallis and Futuna",
}


def display_name(country):
    return NAME_FIX.get(country, country.replace("_", " "))


def sig(x, n=4):
    """Round to n significant digits; None stays None."""
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0
    v = round(x, n - 1 - int(math.floor(math.log10(abs(x)))))
    return int(v) if v == int(v) and abs(v) < 1e15 else v


def num1(x):
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


# ---------------------------------------------------------------- stage 1

def read_manifest():
    files, updated = {}, {}
    with open(HF / "manifest.csv", newline="") as f:
        for row in csv.DictReader(f):
            c = row["country"]
            files.setdefault(c, {"modis": [], "viirs-snpp": [], "viirs-jpss1": []})[row["sensor"]].append(str(HF / row["path"]))
            updated[c] = max(updated.get(c, ""), row["firms_updated"])
    return files, updated


CELL_LA = f"CAST(floor(round(latitude * 100000) / {BASE_STEP}) AS INTEGER)"
CELL_LO = f"CAST(floor(round(longitude * 100000) / {BASE_STEP}) AS INTEGER)"
CELL_SQL = f"{CELL_LA} AS la, {CELL_LO} AS lo"
MONTH_SQL = f"CAST((year(acq_date) - {Y0}) * 12 + month(acq_date) - 1 AS SMALLINT) AS i"
WHEN = f"type = 0 AND acq_date >= DATE '{Y0}-01-01' AND acq_date < DATE '{Y1 + 1}-01-01'"


def src(files, masked):
    """FROM clause: the files, and in v2 without the cell-years in the mask table (see make_mask)."""
    if not masked:
        return "read_parquet($f)"
    return (f"(SELECT * FROM read_parquet($f) d ANTI JOIN static_mask m ON m.la = {CELL_LA} AND m.lo = {CELL_LO} "
            f"AND m.y = year(d.acq_date))")


def make_mask(con, files):
    """v2: every 0.05 degree cell and calendar year in which any sensor, at any confidence, has a detection
    that FIRMS does not class as vegetation fire (type 1 volcano, 2 static land source, 3 offshore)."""
    paths = [p for v in files.values() for p in v]
    con.execute("CREATE OR REPLACE TEMP TABLE static_mask (la INTEGER, lo INTEGER, y INTEGER)")
    if paths:
        con.execute(f"INSERT INTO static_mask SELECT DISTINCT {CELL_LA}, {CELL_LO}, year(acq_date) "
                    f"FROM read_parquet($f, union_by_name = true) WHERE type <> 0", {"f": paths})
    return con.execute("SELECT count(*) FROM static_mask").fetchone()[0]


def extract(con, files, path, masked):
    """Filtered counts for one country, on the 0.05 degree base grid, saved as .npz."""
    out = {}
    empty_i = np.zeros(0, np.int32)
    out["mask_cell_years"] = np.array(make_mask(con, files) if masked else 0, np.int64)
    if files["modis"]:
        r = con.execute(f"SELECT {CELL_SQL}, {MONTH_SQL}, CAST(satellite = 'Aqua' AS TINYINT) AS s, "
                        f"CAST(count(*) AS INTEGER) AS n FROM {src(files, masked)} WHERE {WHEN} AND confidence >= 30 "
                        f"GROUP BY ALL", {"f": files["modis"]}).fetchnumpy()
        for k in ("la", "lo", "i", "s", "n"):
            out["m_" + k] = np.asarray(r[k], np.int32)
    else:
        for k in ("la", "lo", "i", "s", "n"):
            out["m_" + k] = empty_i
    if files["viirs-snpp"]:
        r = con.execute(f"SELECT {CELL_SQL}, {MONTH_SQL}, CAST(count(*) AS INTEGER) AS n FROM {src(files, masked)} "
                        f"WHERE {WHEN} AND confidence IN ('n', 'h') GROUP BY ALL", {"f": files["viirs-snpp"]}).fetchnumpy()
        for k in ("la", "lo", "i", "n"):
            out["v_" + k] = np.asarray(r[k], np.int32)
    else:
        for k in ("la", "lo", "i", "n"):
            out["v_" + k] = empty_i
    n20 = np.zeros(NM, np.int64)
    if files["viirs-jpss1"]:
        r = con.execute(f"SELECT {MONTH_SQL}, count(*) AS n FROM {src(files, masked)} "
                        f"WHERE {WHEN} AND confidence IN ('n', 'h') GROUP BY ALL", {"f": files["viirs-jpss1"]}).fetchnumpy()
        np.add.at(n20, np.asarray(r["i"], np.int64), np.asarray(r["n"], np.int64))
    out["n20"] = n20
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, **out)
    os.replace(tmp, path)


def stage1(countries, files, cache, refresh, masked):
    cache.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(f"SET threads = {os.cpu_count()}")
    t0 = time.time()
    todo = [c for c in countries if refresh or not (cache / f"{c}.npz").exists()]
    for n, c in enumerate(todo, 1):
        t = time.time()
        extract(con, files[c], cache / f"{c}.npz", masked)
        print(f"  [{n}/{len(todo)}] {c}: {time.time() - t:.1f}s", flush=True)
    print(f"stage 1: {len(todo)} countries read in {time.time() - t0:.0f}s ({len(countries) - len(todo)} cached)")


# ---------------------------------------------------------------- stage 2

def load(cache, c):
    z = np.load(cache / f"{c}.npz")
    d = {k: z[k] for k in z.files}
    mon = np.zeros((4, NM), np.int64)  # T, A, V, N20
    np.add.at(mon[0], d["m_i"][d["m_s"] == 0], d["m_n"][d["m_s"] == 0])
    np.add.at(mon[1], d["m_i"][d["m_s"] == 1], d["m_n"][d["m_s"] == 1])
    np.add.at(mon[2], d["v_i"], d["v_n"])
    mon[3] = d["n20"]
    d["mon"] = mon
    return d


def overlap(mon):
    """V, T+A and T on the overlap, shaped (years 2012..2025, 12); January 2012 left out."""
    def ov(x):
        a = x[(OV_Y0 - Y0) * 12:].reshape(OV_NY, 12).astype(float)
        a[0, :VIIRS_FROM[1] - 1] = 0
        return a
    return ov(mon[2]), ov(mon[0] + mon[1]), ov(mon[0])


def shrunk_rates(V, D, G, k_all, k_m):
    """V and D are per calendar month (..., 12). Returns (all-months rate, monthly rates)."""
    r_all = (V.sum(-1) + k_all * G) / (D.sum(-1) + k_all)
    return r_all, (V + k_m * r_all[..., None]) / (D + k_m)


def loyo_predictions(Vo, Do, k_all, k_m):
    """Held-out monthly predictions for every country: pred[c, y, m] from rates learned without year y.
    Returns predictions and the held-out monthly rates r[c, y, m]."""
    Vs, Ds = Vo.sum(1), Do.sum(1)
    pred = np.zeros_like(Vo)
    rates = np.zeros_like(Vo)
    for j in range(OV_NY):
        Vt, Dt = Vs - Vo[:, j], Ds - Do[:, j]
        G = Vt.sum() / Dt.sum()
        _, r = shrunk_rates(Vt, Dt, G, k_all, k_m)
        rates[:, j] = r
        pred[:, j] = Do[:, j] * r
    return pred, rates


def choose_pseudo_counts(Vo, Do):
    """Score every pair of pseudo-counts by the mean held-out monthly WAPE over countries with at
    least MIN_EVAL_V VIIRS detections on the overlap (each country weighs the same), then take the
    lightest pooling whose score is within NEAR_BEST of the best one.

    On the 2026 data the score keeps falling, very slowly, as the all-months pseudo-count grows
    without limit (the global rate is a slightly better monthly prior than a mid-sized country's own
    average), so the plain minimum sits at the edge of the grid and would replace the all-months rate
    of every country but the largest with the global one. Taking the lightest near-best pair keeps
    each country's own average wherever it has a few thousand detections, at a cost of well under 1%
    in held-out error."""
    obs_tot = Vo.sum((1, 2))
    keep = obs_tot >= MIN_EVAL_V
    scores = {}
    for ka in PSEUDO_GRID:
        for km in PSEUDO_GRID:
            pred, _ = loyo_predictions(Vo, Do, ka, km)
            wape = np.abs(pred - Vo).sum((1, 2))[keep] / obs_tot[keep]
            scores[(ka, km)] = float(wape.mean())
    best = min(scores.values())
    near = [k for k, s in scores.items() if s <= best * (1 + NEAR_BEST)]
    return min(near), scores, int(keep.sum())


def year_mask():
    """Which overlap (year, month) slots count: all but January 2012."""
    m = np.ones((OV_NY, 12), bool)
    m[0, :VIIRS_FROM[1] - 1] = False
    return m


def cell_ids(la, lo, step):
    """Group base-grid indices into cells of `step` base cells; floor division keeps negatives right."""
    return np.floor_divide(la, step), np.floor_divide(lo, step)


def cell_heldout(d, rates_c):
    """Held-out monthly (pred, obs) for VAL_CELL cells of one country with any overlap detection.
    rates_c[y, m] are the country's leave-year-y-out Terra+Aqua rates."""
    step = round(VAL_CELL * 100000) // BASE_STEP
    i0 = VI0
    mm = d["m_i"] >= i0
    vm = d["v_i"] >= i0
    mla, mlo = cell_ids(d["m_la"][mm], d["m_lo"][mm], step)
    vla, vlo = cell_ids(d["v_la"][vm], d["v_lo"][vm], step)
    if mla.size + vla.size == 0:
        return np.zeros(0), np.zeros(0)
    keys = np.concatenate([mla.astype(np.int64) * 100000 + mlo, vla.astype(np.int64) * 100000 + vlo])
    uk, inv = np.unique(keys, return_inverse=True)
    nmo = NM - i0
    M = np.zeros((uk.size, nmo))
    V = np.zeros((uk.size, nmo))
    np.add.at(M, (inv[:mla.size], d["m_i"][mm] - i0), d["m_n"][mm])
    np.add.at(V, (inv[mla.size:], d["v_i"][vm] - i0), d["v_n"][vm])
    months = np.arange(i0, NM)
    r = rates_c[months // 12 - (OV_Y0 - Y0), months % 12]
    return (M * r).ravel(), V.ravel()


def bin_of(pred):
    """Size bin as harm() picks it: 0 for <=10, 1 for <=100, 2 for <=1000, 3 above; -1 for zero."""
    b = np.searchsorted(np.array(BINS, float), pred, side="left")
    return np.where(pred == 0, -1, b)


def ranges(pred, obs):
    """Per bin: 5th and 95th percentile of obs/pred, and the month count; plus obs when pred is 0."""
    b = bin_of(pred)
    out = []
    for k in range(len(BINS) + 1):
        sel = b == k
        n = int(sel.sum())
        if n:
            q = np.percentile(obs[sel] / pred[sel], [5, 95])
            out.append((float(q[0]), float(q[1]), n))
        else:
            out.append((None, None, 0))
    z = obs[b == -1]
    zero = (float(np.percentile(z, 95, method="higher")), int(z.size)) if z.size else (None, 0)
    return out, zero


def harmonized_cells(d, r_ta, r_t, cell, max_bytes=TARGET_BYTES):
    """(cells, rows) on a `cell` degree grid: per cell and year the harmonized count (same rule as
    harm(), month by month, then summed), raw MODIS Terra+Aqua and raw VIIRS."""
    step = round(cell * 100000) // BASE_STEP
    m_i, v_i = d["m_i"], d["v_i"]
    mla, mlo = cell_ids(d["m_la"], d["m_lo"], step)
    vla, vlo = cell_ids(d["v_la"], d["v_lo"], step)
    if mla.size + vla.size == 0:
        return [], []
    # harmonized contribution of every MODIS record before VIIRS, and every VIIRS record after
    m = m_i % 12
    terra = d["m_s"] == 0
    h_m = np.where(m_i < AQ0, np.where(terra, r_t[m], 0.0), r_ta[m]) * d["m_n"]
    h_m = np.where(m_i < VI0, h_m, 0.0)
    h_v = np.where(v_i >= VI0, d["v_n"], 0).astype(float)
    keys = np.concatenate([mla.astype(np.int64) * 100000 + mlo, vla.astype(np.int64) * 100000 + vlo])
    uk, inv = np.unique(keys, return_inverse=True)
    yi = np.concatenate([m_i // 12, v_i // 12])
    slot = inv.astype(np.int64) * NYR + yi
    nm = mla.size
    H = np.bincount(slot, weights=np.concatenate([h_m, h_v]), minlength=uk.size * NYR)
    M = np.bincount(slot[:nm], weights=d["m_n"], minlength=uk.size * NYR)
    V = np.bincount(slot[nm:], weights=d["v_n"], minlength=uk.size * NYR)
    # keys are la * 100000 + lo with |lo| < 50000 (pack_keys_ok); a plain floor division would give
    # la - 1 and lo + 100000 for every cell west of Greenwich
    lo_c = (uk + 50000) % 100000 - 50000
    la_c = (uk - lo_c) // 100000
    cells = np.empty(uk.size * 2, np.int64)
    cells[0::2], cells[1::2] = la_c, lo_c
    nz = np.nonzero((H > 0) | (M > 0) | (V > 0))[0]
    if nz.size * 12 > max_bytes:  # each row takes at least 12 characters; too big, skip the work
        return None, None
    Hr = np.round(H[nz], 1)
    rows = []
    for s, hv, mv, vv in zip(nz.tolist(), Hr.tolist(), M[nz].astype(np.int64).tolist(), V[nz].astype(np.int64).tolist()):
        rows += [s // NYR, s % NYR, int(hv) if hv == int(hv) else hv, mv, vv]
    return cells.tolist(), rows


def pack_keys_ok(d):
    """The cell key packs lat and lon indices as lat * 100000 + lon; lon indices on the 0.05 grid
    stay within +-3600, so this is unambiguous. Fail loudly if that ever changes."""
    for k in ("m_lo", "v_lo"):
        if d[k].size and np.abs(d[k]).max() >= 50000:
            raise SystemExit("longitude index out of range for key packing")


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def stage2(countries, files, updated, cache, out_dir, version):
    t0 = time.time()
    data = {}
    for c in countries:
        data[c] = load(cache, c)
        pack_keys_ok(data[c])
    C = len(countries)
    Vo, Do, To = (np.stack(a) for a in zip(*(overlap(data[c]["mon"]) for c in countries)))
    G = Vo.sum() / Do.sum()
    Gt = Vo.sum() / To.sum()
    (k_all, k_m), scores, n_eval = choose_pseudo_counts(Vo, Do)
    print(f"global rates: V/(T+A) {G:.3f}, V/T {Gt:.3f}")
    print(f"pseudo-counts chosen by held-out WAPE over {n_eval} countries: all-months {k_all}, monthly {k_m} "
          f"(mean WAPE {scores[(k_all, k_m)]:.4f}; best on the grid {min(scores.values()):.4f}; "
          f"with almost none, 1/1: {scores[(1, 1)]:.4f}; "
          f"heavy, 100000/100000: {scores[(100000, 100000)]:.4f})")
    for ka in PSEUDO_GRID:
        print("   k_all %5d: " % ka + " ".join(f"{scores[(ka, km)]:.4f}" for km in PSEUDO_GRID))

    # final rates
    Vs, Ds, Ts = Vo.sum(1), Do.sum(1), To.sum(1)
    r_all, r_ta = shrunk_rates(Vs, Ds, G, k_all, k_m)
    _, r_t = shrunk_rates(Vs, Ts, Gt, k_all, k_m)
    w_all = k_all / (Ds.sum(-1) + k_all)  # weight of the prior in the all-months rate
    w_m = k_m / (Ds + k_m)  # weight of the all-months rate in each monthly rate

    # bootstrap over overlap years for the 90% range on r_ta
    rng = np.random.default_rng(SEED)
    W = rng.multinomial(OV_NY, np.full(OV_NY, 1 / OV_NY), size=BOOT).astype(float)
    Vb = np.einsum("by,cym->cbm", W, Vo)
    Db = np.einsum("by,cym->cbm", W, Do)
    _, rb = shrunk_rates(Vb, Db, G, k_all, k_m)
    r_lo, r_hi = np.percentile(rb, [5, 95], axis=1)

    # leave-one-year-out
    pred, held_rates = loyo_predictions(Vo, Do, k_all, k_m)
    ym = year_mask()
    held = []  # per country: (pred, obs) over country months and VAL_CELL cell months
    for ci, c in enumerate(countries):
        cp, co = cell_heldout(data[c], held_rates[ci])
        held.append((np.concatenate([pred[ci][ym], cp]), np.concatenate([Vo[ci][ym], co])))
    pooled, pooled_zero = ranges(np.concatenate([h[0] for h in held]), np.concatenate([h[1] for h in held]))
    print("pooled range multipliers per bin (lo, hi, months):", [(sig(a), sig(b), n) for a, b, n in pooled],
          "zero_hi:", pooled_zero)

    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for ci, c in enumerate(countries):
        d = data[c]
        mon = d["mon"]
        own, own_zero = ranges(*held[ci])
        pi = []
        for (lo, hi, n), (plo, phi, _) in zip(own, pooled):
            lo, hi = (lo, hi) if n >= MIN_BIN_MONTHS else (plo, phi)
            # a range that leaves out the estimate itself reads as nonsense; a few small countries
            # whose held-out months all miss one way would otherwise get one
            pi.append([sig(min(lo, 1.0)), sig(max(hi, 1.0))])
        zero_hi = own_zero[0] if own_zero[1] >= MIN_BIN_MONTHS else pooled_zero[0]
        if version >= 2:
            zero_hi = max(zero_hi, 1.0)  # a range of exactly 0 to 0 for a month with no MODIS overstates what is known

        obs_y = (Vo[ci] * ym).sum(1)
        pred_y = (pred[ci] * ym).sum(1)
        mod_y = (Do[ci] * ym).sum(1)
        errs = [abs(p - o) / o for p, o in zip(pred_y, obs_y) if o > 0]
        tot_obs = obs_y.sum()
        val = {
            "raw_factor": sig(Vs[ci].sum() / Ds[ci].sum()) if Ds[ci].sum() > 0 else None,
            "annual_med_err": sig(float(np.median(errs))) if errs else None,
            "annual_max_err": sig(float(max(errs))) if errs else None,
            "monthly_wape": sig(float((np.abs(pred[ci] - Vo[ci]) * ym).sum() / tot_obs)) if tot_obs > 0 else None,
            "loyo": [{"y": OV_Y0 + j, "obs": int(obs_y[j]), "pred": num1(pred_y[j]), "modis": int(mod_y[j])}
                     for j in range(OV_NY)],
        }

        rt = [sig(x) for x in r_t[ci]]
        rta = [sig(x) for x in r_ta[ci]]
        # harmonized monthly values with the rounded rates, exactly as harm() will compute them
        i = np.arange(NM)
        m = i % 12
        h = np.where(i >= VI0, mon[2], np.where(i < AQ0, mon[0] * np.array(rt)[m], (mon[0] + mon[1]) * np.array(rta)[m]))
        total = float(h.sum())

        own_share = 1 - float(w_m[ci].mean())
        rate_note = (
            f"No counted detections on the overlap, so the rates are the global ones." if Ds[ci].sum() + Vs[ci].sum() == 0 else
            f"Learned from {int(Ds[ci].sum()):,} MODIS and {int(Vs[ci].sum()):,} VIIRS detections on the overlap. "
            f"Each monthly rate is shrunk toward the country's all-months rate with a pseudo-count of {k_m:,} MODIS "
            f"detections, and that rate toward the global rate ({G:.2f}) with {k_all:,}; the country's own months carry "
            f"{own_share:.0%} of the weight in the monthly rates on average, and its own all-months rate "
            f"{1 - w_all[ci]:.0%} against the global one."
        )
        if version >= 2 and val["monthly_wape"] is not None and val["monthly_wape"] > UNRELIABLE_WAPE:
            rate_note += (f" Warning: tested on 2012-2025 with each year held out, the converted months were off by "
                          f"{val['monthly_wape']:.0%} of the observed VIIRS count (size-weighted), so converted years "
                          f"before 2012 are not reliable here.")
        if version >= 2 and r_all[ci] > HIGH_RATE * G:
            rate_note += (f" The all-months rate is more than {HIGH_RATE} times the global one. That can be real (small "
                          f"fires only VIIRS sees), or come from gas flares and other industrial heat that VIIRS reports "
                          f"as vegetation fire and MODIS flags or misses; converted years before 2012 may then be too high.")

        # grid: finest cell that keeps the file under TARGET_BYTES
        base = {
            "v": version, "country": c, "name": display_name(c),
            "y0": Y0, "y1": Y1, "viirs_from": list(VIIRS_FROM), "aqua_from": list(AQUA_FROM), "bins": BINS,
            "filter": FILTER_V2 if version >= 2 else FILTER_V1,
            "monthly": {"T": mon[0].tolist(), "A": mon[1].tolist(), "V": mon[2].tolist(), "N20": mon[3].tolist()},
            "r_ta": rta, "r_t": rt, "r_ta_lo": [sig(x) for x in r_lo[ci]], "r_ta_hi": [sig(x) for x in r_hi[ci]],
            "r_all": sig(r_all[ci]),
            "pi": pi, "zero_hi": sig(zero_hi),
            "rate_note": rate_note,
            "val": val,
        }
        bbox = bbox_of(d) or raw_bbox(files[c])
        tail_src = {"dataset": DATASET, "firms_updated": updated[c],
                    "files": sum(len(v) for v in files[c].values())}
        totals = {"T": int(mon[0].sum()), "A": int(mon[1].sum()), "V": int(mon[2].sum()), "N20": int(mon[3].sum())}
        text = None
        for cell in CELL_CHOICES:
            cells, rows = harmonized_cells(d, np.array(rta), np.array(rt), cell, TARGET_BYTES if cell != CELL_CHOICES[-1] else 10 ** 12)
            if rows is None:
                continue
            o = dict(base, bbox=bbox, cell=cell, cells=cells, cell_rows=rows, totals=totals, source=tail_src)
            text = dumps(o)
            if len(text.encode()) <= TARGET_BYTES:
                break
        nbytes = len(text.encode())
        if nbytes > MAX_BYTES:
            raise SystemExit(f"{c}: {nbytes} bytes even at {cell} degree")
        (out_dir / f"{c}.json").write_text(text, encoding="utf-8")
        index.append({"country": c, "name": display_name(c), "file": f"summary/v{version}/{c}.json", "bytes": nbytes,
                      "bbox": bbox, "total": int(round(total))})
    (out_dir / "index.json").write_text(dumps({"v": version, "countries": index}), encoding="utf-8")
    masked = sum(int(data[c]["mask_cell_years"]) for c in countries if "mask_cell_years" in data[c])
    if version >= 2:
        print(f"static-source mask: {masked:,} cell-years over all countries")
    print(f"stage 2: {len(countries)} files written to {out_dir} in {time.time() - t0:.0f}s")


def bbox_of(d):
    """[w, s, e, n] of the counted detections, to the 0.05 degree base grid (rounded outward)."""
    la = np.concatenate([d["m_la"], d["v_la"]])
    lo = np.concatenate([d["m_lo"], d["v_lo"]])
    if la.size == 0:
        return None
    s = BASE_STEP / 100000
    return [round(float(lo.min()) * s, 2), round(float(la.min()) * s, 2),
            round(float(lo.max() + 1) * s, 2), round(float(la.max() + 1) * s, 2)]


def raw_bbox(files):
    """Fallback for a country with no counted detections: [w, s, e, n] of every row in its files,
    whatever the sensor, type or confidence, rounded outward to 0.01 degree."""
    paths = [p for v in files.values() for p in v]
    w, s, e, n = duckdb.execute("SELECT min(longitude), min(latitude), max(longitude), max(latitude) "
                                "FROM read_parquet($f, union_by_name = true)", {"f": paths}).fetchone()
    return [math.floor(w * 100) / 100, math.floor(s * 100) / 100, math.ceil(e * 100) / 100, math.ceil(n * 100) / 100]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--summary-version", type=int, choices=(1, 2), default=2,
                    help="1: the published v1 method (type 0 only); 2 (default): also drop static-source cell-years")
    ap.add_argument("--cache", type=Path, default=None,
                    help="where stage 1 keeps per-country counts (default build/summary_cache/v<N>)")
    ap.add_argument("--out", type=Path, default=None, help="default build/hf/summary/v<N>")
    ap.add_argument("--refresh", action="store_true", help="read the Parquet files again even if cached")
    ap.add_argument("--stage1-only", action="store_true")
    args = ap.parse_args()
    ver = args.summary_version
    cache = args.cache or ROOT / "build" / "summary_cache" / f"v{ver}"
    out = args.out or HF / "summary" / f"v{ver}"
    files, updated = read_manifest()
    countries = sorted(files)
    print(f"{len(countries)} countries in the manifest")
    stage1(countries, files, cache, args.refresh, ver >= 2)
    if not args.stage1_only:
        stage2(countries, files, updated, cache, out, ver)


if __name__ == "__main__":
    sys.exit(main())
