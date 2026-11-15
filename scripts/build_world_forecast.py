#!/usr/bin/env python3
"""Build forecast/v1: a 2026-2027 fire forecast for every country, from the summary/v2 files.

Inputs
  build/hf/summary/v2/<Country>.json   the per-country summaries (see src/types.ts CountrySummary)

Outputs (default --out build/hf/forecast/v1)
  <Country>.json   24 months (Jan 2026 .. Dec 2027) of expected hotspots, 80% range, P(any),
                   P(above the month's 2001-2025 median); per-cell yearly chance for 2026;
                   backtest metrics for the country; a method text.
  index.json       one small entry per country (expected 2026 total, ratio to the 2001-2025
                   average, headline metrics), small enough to colour a globe.
  --report FILE    the full backtest (every setting tried, nested choices, pooled scores).

Everything is built from the fire record alone. Nothing here knows about weather, fuel or
ignitions: the forecast says what a year looks like given how the country has burned, with more
weight on recent years. It cannot see a drought coming.

Method (all counts are harmonized as in harm() of src/model.ts: Suomi NPP VIIRS from Feb 2012,
MODIS times the country's monthly exchange rate before)

  Country, monthly. For target year Y and calendar month m the forecast is a weighted set of past
  values ("analog years"), one per training year y < Y:
      z_y = ((1 - alpha) * x[y, m] + alpha * A_y * g_m) * F
      weight 0.5 ** ((last training year - y) / half_life)
    * half_life: recency weighting (inf = every year counts the same).
    * F = exp(phi * b * (Y - weighted mean training year)), clipped to [1/3, 3]: a damped trend.
      b is the OLS slope of log(1 + annual total) over the last 10 training years, clipped to
      +-0.15 a year; phi in [0, 1] damps it (0 = no trend).
    * alpha = kappa / (kappa + weighted mean annual total): partial pooling for sparse countries.
      Each past year's total A_y is partly spread over the months in a reference seasonal shape
      g_m (the global shape, or that of the latitude band of the country's centre). Big
      countries get alpha ~ 0.
    The expected count is the weighted mean of z, the 80% range its weighted 10th-90th
    percentiles. P(any) is the weighted share of years with x > 0 and P(above median) the
    weighted share with x * F above the threshold (capped at P(any), since the median is >= 0),
    each shrunk toward 0.5 with `a` pseudo-years:
    p = (n_eff * share + a * 0.5) / (n_eff + a), n_eff the effective number of years. For P(any)
    the MODIS months can be left out (`modis_any` 0), because harmonization fixes the expected
    count, not whether a small fire is seen: a MODIS-era month is "> 0" only when MODIS saw it.

  Baseline "history alone": every past year of that calendar month with equal weight, no trend,
  no pooling, no shrinkage; P(any) and P(above median) are plain shares of years.

  Cells, yearly. cell_rows are yearly, so there is no monthly per-cell forecast. A cell's chance
  of at least one hotspot in 2026 is the recency-weighted share of years with a hotspot there,
  shrunk with `a` pseudo-years toward the country's mean cell chance; MODIS years can be left out
  the same way. Expected hotspots per cell = the cell's recency-weighted share of the country's
  hotspots times the country's expected 2026 total, so the cells add up to the country.
  Baselines: share of all years 2001..Y-1, and share of VIIRS years 2012..Y-1.

  Backtest: rolling origin, target years 2018-2025, train on years < Y (two-year lead: < Y-1).
  ONE setting is used for every country. Settings for target Y are chosen on target years
  2014..Y-1 only (nested), so no year helps choose its own settings; the published setting is
  chosen the same way on 2014-2025. Selection score (lower is better): mean over countries of
  log(CRPS / baseline CRPS) + log(pooled Brier P(any) / baseline) + log(pooled Brier P(above
  median) / baseline). Cells: mean over countries of log(Brier / baseline Brier).

Usage
  .venv/bin/python scripts/build_world_forecast.py [--src build/hf/summary/v2]
      [--out build/hf/forecast/v1] [--report report.json]
"""
import argparse
import itertools
import json
import math
import time
from pathlib import Path

import numpy as np
from scipy.stats import rankdata

ROOT = Path(__file__).resolve().parent.parent
Y0, Y1 = 2001, 2025
NY = Y1 - Y0 + 1
FC_YEARS = (2026, 2027)
TEST_YEARS = list(range(2018, 2026))
VAL_FIRST = 2014  # first target year used to choose settings
TREND_WINDOW = 10
TREND_MAX = 0.15
F_CLIP = 3.0
Q_LO, Q_HI = 0.1, 0.9
BANDS = [-23.5, 0.0, 23.5]  # latitude band edges of the country centre for the regional shape

HALF_LIVES = [math.inf, 2.0, 4.0, 8.0]
PHIS = [0.0, 0.5, 1.0]
POOLS = [(0.0, "global")] + [(k, s) for k in (10.0, 100.0, 1000.0) for s in ("global", "band")]
SHRINKS = [0.0, 1.0, 2.0]
MODIS_ANY = [1, 0]
CELL_HALF_LIVES = HALF_LIVES
CELL_SHRINKS = [0.0, 1.0, 2.0, 4.0]
CELL_MODIS = [1, 0]


# ---------------------------------------------------------------- loading
def harmonized_monthly(d):
    """(NY, 12) harmonized counts, the same rule as harmWith() in src/model.ts."""
    T, A, V = (np.asarray(d["monthly"][k], float) for k in ("T", "A", "V"))
    i = np.arange(T.size)
    m = i % 12
    vi0 = (d["viirs_from"][0] - d["y0"]) * 12 + d["viirs_from"][1] - 1
    aq0 = (d["aqua_from"][0] - d["y0"]) * 12 + d["aqua_from"][1] - 1
    r_t, r_ta = np.asarray(d["r_t"], float), np.asarray(d["r_ta"], float)
    h = np.where(i >= vi0, V, np.where(i < aq0, T * r_t[m], (T + A) * r_ta[m]))
    return h.reshape(NY, 12), vi0


def cell_matrix(d):
    """(ncell, NY) harmonized yearly counts per cell, in summary cell-index order."""
    n = len(d["cells"]) // 2
    H = np.zeros((n, NY))
    r = np.asarray(d["cell_rows"], float).reshape(-1, 5)
    if r.size:
        H[r[:, 0].astype(int), r[:, 1].astype(int)] = r[:, 2]
    return H


def load(src):
    names = sorted(p for p in Path(src).glob("*.json") if p.name != "index.json")
    C = []
    for p in names:
        d = json.loads(p.read_text())
        assert d["v"] == 2 and d["y0"] == Y0 and d["y1"] == Y1, p
        X, vi0 = harmonized_monthly(d)
        lat = (d["bbox"][1] + d["bbox"][3]) / 2
        C.append(dict(k=d["country"], name=d["name"], X=X, vi0=vi0, band=int(np.searchsorted(BANDS, lat)),
                      cell=d["cell"], H=cell_matrix(d), ncell=len(d["cells"]) // 2))
    return C


# ---------------------------------------------------------------- monthly model
def year_weights(years, h):
    last = years.max()
    w = np.ones(years.size) if math.isinf(h) else 0.5 ** ((last - years) / h)
    return w / w.sum()


def trend_slope(A, years):
    """(C,) OLS slope of log(1 + annual total) over the last TREND_WINDOW training years."""
    sel = years >= years.max() - TREND_WINDOW + 1
    t = years[sel] - years[sel].mean()
    L = np.log1p(A[:, sel])
    b = (L - L.mean(1, keepdims=True)) @ t / (t @ t)
    return np.clip(b, -TREND_MAX, TREND_MAX)


def shapes(X, tr, band):
    """(C, 12) reference seasonal shapes from the training years: global, and per latitude band."""
    S = X[:, tr, :].sum(1)  # C, 12
    g = S.sum(0)
    g = g / g.sum()
    out = {"global": np.tile(g, (S.shape[0], 1))}
    B = np.zeros((S.shape[0], 12))
    for b in np.unique(band):
        s = S[band == b].sum(0)
        B[band == b] = s / s.sum() if s.sum() > 0 else g
    out["band"] = B
    return out


def analogs(X, Y, train_last, h, phi, kappa, shape):
    """Weighted analog values for target year Y from training years <= train_last.
    Returns Z (C, 12, n) count samples, Zp (C, 12, n) trended but unpooled samples, w (n,),
    F (C,), years (n,)."""
    years = np.arange(Y0, train_last + 1)
    tr = years - Y0
    Xt = X[:, tr, :]  # C, n, 12
    A = Xt.sum(2)
    w = year_weights(years, h)
    b = trend_slope(A, years)
    ybar = (w * years).sum()
    F = np.exp(np.clip(phi * b * (Y - ybar), -math.log(F_CLIP), math.log(F_CLIP)))
    Abar = A @ w
    alpha = kappa / (kappa + Abar) if kappa > 0 else np.zeros(X.shape[0])
    pooled = (1 - alpha)[:, None, None] * Xt + alpha[:, None, None] * A[:, :, None] * shape[:, None, :]
    Z = np.transpose(pooled * F[:, None, None], (0, 2, 1))
    Zp = np.transpose(Xt * F[:, None, None], (0, 2, 1))
    return Z, Zp, w, F, years


def wquant(Z, w, qs):
    """Weighted quantiles along the last axis (Hazen-style plotting positions)."""
    o = np.argsort(Z, -1)
    zs = np.take_along_axis(Z, o, -1)
    ws = w[o]
    p = np.cumsum(ws, -1) - ws / 2
    out = []
    n = Z.shape[-1]
    for q in qs:
        j = (p < q).sum(-1)
        hi = np.clip(j, 0, n - 1)
        lo = np.clip(j - 1, 0, n - 1)
        zl, zh = np.take_along_axis(zs, lo[..., None], -1)[..., 0], np.take_along_axis(zs, hi[..., None], -1)[..., 0]
        pl, ph = np.take_along_axis(p, lo[..., None], -1)[..., 0], np.take_along_axis(p, hi[..., None], -1)[..., 0]
        t = np.where(ph > pl, np.clip((q - pl) / np.where(ph > pl, ph - pl, 1), 0, 1), 0.0)
        out.append(zl + t * (zh - zl))
    return out


def crps(Z, w, y):
    """CRPS of the weighted ensemble Z (..., n) against y (...)."""
    t1 = (np.abs(Z - y[..., None]) * w).sum(-1)
    D = np.abs(Z[..., :, None] - Z[..., None, :])
    t2 = 0.5 * np.einsum("...ij,i,j->...", D, w, w)
    return t1 - t2


def shrink_share(ind, W, a):
    """(n_eff * share + a * 0.5) / (n_eff + a), W the (unnormalized) weights broadcast to ind."""
    sw = W.sum(-1)
    share = (W * ind).sum(-1) / np.where(sw > 0, sw, 1)
    neff = np.where(sw > 0, sw ** 2 / np.maximum((W ** 2).sum(-1), 1e-300), 0)
    return (neff * share + a * 0.5) / (neff + a) if a > 0 else share


def prob_any(X, vi0s, train_last, h, a, modis_any):
    """(C, 12) P(any hotspot) from training years <= train_last."""
    years = np.arange(Y0, train_last + 1)
    w = year_weights(years, h)
    ind = np.transpose(X[:, years - Y0, :] > 0, (0, 2, 1)).astype(float)  # C,12,n
    W = np.broadcast_to(w, ind.shape).copy()
    if not modis_any:
        mi = (years - Y0)[None, :] * 12 + np.arange(12)[:, None]  # 12, n month indexes
        vis = (mi[None] >= vi0s[:, None, None])
        W2 = W * vis
        ok = W2.sum(-1) > 0  # months with no VIIRS year yet fall back to all years
        W = np.where(ok[..., None], W2, W)
    return shrink_share(ind, W, a)


def prob_above(Zp, w, thr, a):
    ind = (Zp > thr[..., None]).astype(float)
    return shrink_share(ind, np.broadcast_to(w, ind.shape), a)


def median_thr(X, train_last):
    return np.median(X[:, : train_last - Y0 + 1, :], axis=1)  # C, 12


# ---------------------------------------------------------------- monthly backtest
def monthly_scores(C, targets, lead=1, configs=None):
    """Per (setting, target year): per-country sums over 12 months of CRPS, coverage hits,
    Brier P(any), Brier P(above). Count settings and probability settings are scored separately
    (they do not interact except through half_life and phi)."""
    X = np.stack([c["X"] for c in C])
    vi0s = np.array([c["vi0"] for c in C])
    band = np.array([c["band"] for c in C])
    cnt, prb = {}, {}
    for Y in targets:
        tl = Y - lead
        y = X[:, Y - Y0, :]
        sh = shapes(X, np.arange(0, tl - Y0 + 1), band)
        thr = median_thr(X, tl)
        above = (y > thr).astype(float)
        anyo = (y > 0).astype(float)
        hp = configs["count"] if configs else itertools.product(HALF_LIVES, PHIS, POOLS)
        for h, phi, (kappa, sk) in hp:
            Z, Zp, w, F, _ = analogs(X, Y, tl, h, phi, kappa, sh[sk])
            lo, hi = wquant(Z, w, (Q_LO, Q_HI))
            cnt[(h, phi, kappa, sk, Y)] = dict(
                crps=crps(Z, w, y).sum(1), cover=((y >= lo) & (y <= hi)).sum(1).astype(float),
                ae=np.abs((Z * w).sum(-1) - y).sum(1))
        pp = configs["prob"] if configs else itertools.product(HALF_LIVES, PHIS, SHRINKS, MODIS_ANY)
        for h, phi, a, ma in pp:
            Z, Zp, w, F, _ = analogs(X, Y, tl, h, phi, 0.0, sh["global"])
            pa = prob_any(X, vi0s, tl, h, a, ma)
            pb = np.minimum(prob_above(Zp, w, thr, a), pa)  # the median is >= 0, so above-median implies any
            prb[(h, phi, a, ma, Y)] = dict(b_any=((pa - anyo) ** 2).sum(1), b_above=((pb - above) ** 2).sum(1))
    return cnt, prb


BASE_COUNT = (math.inf, 0.0, 0.0, "global")
BASE_PROB = (math.inf, 0.0, 0.0, 1)


def sum_years(tab, key, years, field):
    return sum(tab[key + (Y,)][field] for Y in years)


def monthly_objective(cnt, prb, ck, pk, years):
    """Selection score over target years (lower is better)."""
    c_m, c_b = sum_years(cnt, ck, years, "crps"), sum_years(cnt, BASE_COUNT, years, "crps")
    ok = c_b > 0
    j = np.mean(np.log(np.maximum(c_m[ok], 1e-12) / c_b[ok]))
    for f in ("b_any", "b_above"):
        m, b = sum_years(prb, pk, years, f).sum(), sum_years(prb, BASE_PROB, years, f).sum()
        j += math.log(max(m, 1e-12) / b) if b > 0 else 0.0
    return j


def monthly_choose(cnt, prb, years):
    best = None
    for h, phi, (kappa, sk) in itertools.product(HALF_LIVES, PHIS, POOLS):
        for a, ma in itertools.product(SHRINKS, MODIS_ANY):
            j = monthly_objective(cnt, prb, (h, phi, kappa, sk), (h, phi, a, ma), years)
            if best is None or j < best[0] - 1e-12:
                best = (j, dict(half_life=h, phi=phi, kappa=kappa, shape=sk, shrink=a, modis_any=ma))
    return best


def ckey(s):
    return (s["half_life"], s["phi"], s["kappa"], s["shape"])


def pkey(s):
    return (s["half_life"], s["phi"], s["shrink"], s["modis_any"])


# ---------------------------------------------------------------- cells
def cell_probs(H, train_last, h, a, modis):
    """(ncell,) chance of >= 1 hotspot in a year, and the hotspot share of each cell."""
    years = np.arange(Y0, train_last + 1)
    w = year_weights(years, h)
    if not modis:
        keep = years >= 2012
        w = np.where(keep, w, 0.0)
    Ht = H[:, years - Y0]
    ind = (Ht > 0).astype(float)
    share = ind @ w / w.sum()
    neff = w.sum() ** 2 / (w ** 2).sum()
    p0 = share.mean() if share.size else 0.0
    p = (neff * share + a * p0) / (neff + a) if a > 0 else share
    wc = year_weights(years, h)  # hotspot shares always use every year (harmonized counts)
    hs = Ht @ wc
    tot = hs.sum()
    return p, (hs / tot if tot > 0 else np.zeros_like(hs))


def auc(p, o):
    o = o.astype(bool)
    n1, n0 = o.sum(), (~o).sum()
    if n1 == 0 or n0 == 0:
        return None
    r = rankdata(p)
    return float((r[o].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def cell_scores(C, targets):
    out = {}
    for Y in targets:
        for h, a, mo in itertools.product(CELL_HALF_LIVES, CELL_SHRINKS, CELL_MODIS):
            b = np.zeros(len(C))
            for ci, c in enumerate(C):
                if c["ncell"] == 0:
                    continue
                p, _ = cell_probs(c["H"], Y - 1, h, a, mo)
                b[ci] = ((p - (c["H"][:, Y - Y0] > 0)) ** 2).sum()
            out[(h, a, mo, Y)] = b
    return out


BASE_CELL = (math.inf, 0.0, 1)
BASE_CELL_VIIRS = (math.inf, 0.0, 0)


def cell_objective(tab, key, years):
    m = sum(tab[key + (Y,)] for Y in years)
    b = sum(tab[BASE_CELL + (Y,)] for Y in years)
    ok = b > 0
    return float(np.mean(np.log(np.maximum(m[ok], 1e-12) / b[ok])))


def cell_choose(tab, years):
    best = None
    for h, a, mo in itertools.product(CELL_HALF_LIVES, CELL_SHRINKS, CELL_MODIS):
        j = cell_objective(tab, (h, a, mo), years)
        if best is None or j < best[0] - 1e-12:
            best = (j, dict(half_life=h, shrink=a, modis=mo))
    return best


# ---------------------------------------------------------------- helpers
def sig(x, n=3):
    if x is None or not np.isfinite(x):
        return None
    x = float(x)
    if x == 0:
        return 0
    d = n - 1 - int(math.floor(math.log10(abs(x))))
    v = round(x, d)
    return int(v) if d <= 0 or v == int(v) else v


def pr(x):
    return round(float(x), 3)


def hl(h):
    return None if math.isinf(h) else h


def skill(m, b):
    return None if b is None or b <= 0 else round(1 - m / b, 3)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "build/hf/summary/v2"))
    ap.add_argument("--out", default=str(ROOT / "build/hf/forecast/v1"))
    ap.add_argument("--report", default=None)
    args = ap.parse_args()
    t0 = time.time()
    C = load(args.src)
    print(f"{len(C)} countries loaded in {time.time() - t0:.1f}s")
    X = np.stack([c["X"] for c in C])
    vi0s = np.array([c["vi0"] for c in C])
    band = np.array([c["band"] for c in C])
    K = len(C)

    # ---- monthly: score every setting on every target year, then nested choice
    targets = list(range(VAL_FIRST, Y1 + 1))
    cnt, prb = monthly_scores(C, targets)
    print(f"monthly grid scored in {time.time() - t0:.1f}s")
    nested = {}
    for Y in TEST_YEARS:
        j, s = monthly_choose(cnt, prb, list(range(VAL_FIRST, Y)))
        nested[Y] = s
    jf, final = monthly_choose(cnt, prb, targets)
    print("final monthly setting", final, "score", round(jf, 4))
    print("nested choices", {Y: (hl(s["half_life"]), s["phi"], s["kappa"], s["shape"], s["shrink"], s["modis_any"]) for Y, s in nested.items()})

    def tot(key, tab, field, years=TEST_YEARS):
        return sum(tab[key + (Y,)][field] for Y in years)

    # nested (honest) pooled scores: each test year scored with the setting chosen before it
    nest = {f: sum(cnt[ckey(nested[Y]) + (Y,)][f] for Y in TEST_YEARS) for f in ("crps", "cover", "ae")}
    nest.update({f: sum(prb[pkey(nested[Y]) + (Y,)][f] for Y in TEST_YEARS) for f in ("b_any", "b_above")})
    fin = {f: tot(ckey(final), cnt, f) for f in ("crps", "cover", "ae")}
    fin.update({f: tot(pkey(final), prb, f) for f in ("b_any", "b_above")})
    base = {f: tot(BASE_COUNT, cnt, f) for f in ("crps", "cover", "ae")}
    base.update({f: tot(BASE_PROB, prb, f) for f in ("b_any", "b_above")})
    # VIIRS-years-only reference for P(any): history alone, MODIS months left out
    base_vany = tot((math.inf, 0.0, 0.0, 0), prb, "b_any")

    # lead 2 (train < Y-1) for the final setting and the baseline
    lead2_years = TEST_YEARS[1:]
    cfgs = dict(count=[(final["half_life"], final["phi"], (final["kappa"], final["shape"])), (math.inf, 0.0, (0.0, "global"))],
                prob=[pkey(final), BASE_PROB])
    cnt2, prb2 = monthly_scores(C, lead2_years, lead=2, configs=cfgs)
    fin2 = {f: tot(ckey(final), cnt2, f, lead2_years) for f in ("crps", "cover")}
    fin2.update({f: tot(pkey(final), prb2, f, lead2_years) for f in ("b_any", "b_above")})
    base2 = {f: tot(BASE_COUNT, cnt2, f, lead2_years) for f in ("crps", "cover")}
    base2.update({f: tot(BASE_PROB, prb2, f, lead2_years) for f in ("b_any", "b_above")})

    nmon = len(TEST_YEARS) * 12

    def pooled(m, b, cov_n):
        okc = b["crps"] > 0
        return dict(
            crps_skill_mean_country=round(float(np.mean(1 - m["crps"][okc] / b["crps"][okc])), 4),
            crps_ratio_geomean=round(float(np.exp(np.mean(np.log(np.maximum(m["crps"][okc], 1e-12) / b["crps"][okc])))), 4),
            countries_crps_better=int((m["crps"][okc] < b["crps"][okc]).sum()),
            countries_crps_worse=int((m["crps"][okc] > b["crps"][okc]).sum()),
            countries_scored=int(okc.sum()),
            crps_skill_pooled_sum=round(float(1 - m["crps"].sum() / b["crps"].sum()), 4),
            brier_any=round(float(m["b_any"].sum() / (K * cov_n)), 5),
            brier_any_base=round(float(b["b_any"].sum() / (K * cov_n)), 5),
            brier_above=round(float(m["b_above"].sum() / (K * cov_n)), 5),
            brier_above_base=round(float(b["b_above"].sum() / (K * cov_n)), 5),
            cover80=round(float(m["cover"].sum() / (K * cov_n)), 4),
            cover80_base=round(float(b["cover"].sum() / (K * cov_n)), 4),
        )

    # where it helps: CRPS skill by country size (2001-2025 yearly mean, harmonized)
    avg_all = X.sum(2).mean(1)
    by_size = []
    for lo_, hi_ in ((0, 100), (100, 1000), (1000, 10000), (10000, 100000), (100000, math.inf)):
        sel = (avg_all >= lo_) & (avg_all < hi_) & (base["crps"] > 0)
        if sel.any():
            r_ = nest["crps"][sel] / base["crps"][sel]
            by_size.append(dict(yearly_mean=[lo_, None if math.isinf(hi_) else hi_], countries=int(sel.sum()),
                                crps_ratio_geomean=round(float(np.exp(np.mean(np.log(np.maximum(r_, 1e-12))))), 3),
                                better=int((r_ < 1).sum()), worse=int((r_ > 1).sum()),
                                brier_above=round(float(nest["b_above"][sel].sum() / base["b_above"][sel].sum()), 3),
                                brier_any=round(float(nest["b_any"][sel].sum() / max(base["b_any"][sel].sum(), 1e-12)), 3),
                                cover80=round(float(nest["cover"][sel].sum() / (sel.sum() * nmon)), 3),
                                cover80_base=round(float(base["cover"][sel].sum() / (sel.sum() * nmon)), 3)))
    rep_month = dict(by_size_nested=by_size, final=dict(final, half_life=hl(final["half_life"])), score=round(jf, 4),
                     nested={Y: dict(s, half_life=hl(s["half_life"])) for Y, s in nested.items()},
                     test_years=TEST_YEARS, lead1_final=pooled(fin, base, nmon), lead1_nested=pooled(nest, base, nmon),
                     brier_any_base_viirs_years=round(float(base_vany.sum() / (K * nmon)), 5),
                     lead2_final=pooled(fin2, base2, len(lead2_years) * 12), lead2_years=lead2_years)
    print(json.dumps(rep_month, indent=1, default=str))

    # ---- cells
    ctab = cell_scores(C, targets)
    cnested = {Y: cell_choose(ctab, list(range(VAL_FIRST, Y)))[1] for Y in TEST_YEARS}
    cj, cfinal = cell_choose(ctab, targets)
    print("final cell setting", cfinal, "nested", cnested)

    # per-country cell metrics for the final setting and both baselines, on 2018-2025
    cm = []
    allp = {"m": [], "b": [], "v": [], "o": []}
    for ci, c in enumerate(C):
        r = dict(n=0)
        if c["ncell"]:
            P, Pb, Pv, O, eM, eB, Hy = [], [], [], [], [], [], []
            for Y in TEST_YEARS:
                p, sh_ = cell_probs(c["H"], Y - 1, cfinal["half_life"], cfinal["shrink"], cfinal["modis"])
                pb, shb = cell_probs(c["H"], Y - 1, math.inf, 0.0, 1)
                pv, _ = cell_probs(c["H"], Y - 1, math.inf, 0.0, 0)
                y = c["H"][:, Y - Y0]
                P.append(p); Pb.append(pb); Pv.append(pv); O.append(y > 0); Hy.append(y)
                # expected counts: model share x model country total vs plain mean per cell
                Z, _, w, F, _ = analogs(X[ci:ci + 1], Y, Y - 1, final["half_life"], final["phi"], final["kappa"],
                                        shapes(X, np.arange(0, Y - Y0), band)[final["shape"]][ci:ci + 1])
                eM.append(sh_ * float((Z * w).sum(-1).sum()))
                eB.append(c["H"][:, : Y - Y0].mean(1))
            P, Pb, Pv, O = map(np.concatenate, (P, Pb, Pv, O))
            eM, eB, Hy = map(np.concatenate, (eM, eB, Hy))
            r = dict(n=int(O.size), rate=round(float(O.mean()), 4),
                     brier=float(((P - O) ** 2).mean()), brier_base=float(((Pb - O) ** 2).mean()),
                     brier_viirs=float(((Pv - O) ** 2).mean()),
                     auc=auc(P, O), auc_base=auc(Pb, O), auc_viirs=auc(Pv, O),
                     mae=float(np.abs(eM - Hy).mean()), mae_base=float(np.abs(eB - Hy).mean()))
            for k_, v_ in (("m", P), ("b", Pb), ("v", Pv), ("o", O)):
                allp[k_].append(v_)
        cm.append(r)
    allp = {k_: np.concatenate(v_) for k_, v_ in allp.items()}
    # nested (honest) pooled cell Brier: each test year scored with the setting chosen before it
    nb = {"m": 0.0, "n": 0}
    for Y in TEST_YEARS:
        s_ = cnested[Y]
        for c in C:
            if c["ncell"]:
                p, _ = cell_probs(c["H"], Y - 1, s_["half_life"], s_["shrink"], s_["modis"])
                nb["m"] += float(((p - (c["H"][:, Y - Y0] > 0)) ** 2).sum())
                nb["n"] += c["ncell"]
    okc = [r for r in cm if r["n"] and r["brier_base"] > 0]
    rep_cell = dict(final=dict(cfinal, half_life=hl(cfinal["half_life"])), score=round(cj, 4),
                    nested={Y: dict(s, half_life=hl(s["half_life"])) for Y, s in cnested.items()},
                    pooled=dict(cell_years=int(allp["o"].size), rate=round(float(allp["o"].mean()), 4),
                                brier=round(float(((allp["m"] - allp["o"]) ** 2).mean()), 5),
                                brier_base=round(float(((allp["b"] - allp["o"]) ** 2).mean()), 5),
                                brier_viirs=round(float(((allp["v"] - allp["o"]) ** 2).mean()), 5),
                                brier_nested=round(nb["m"] / nb["n"], 5),
                                auc=round(auc(allp["m"], allp["o"]), 4), auc_base=round(auc(allp["b"], allp["o"]), 4),
                                auc_viirs=round(auc(allp["v"], allp["o"]), 4)),
                    countries_brier_better=sum(r["brier"] < r["brier_base"] for r in okc),
                    countries_brier_worse=sum(r["brier"] > r["brier_base"] for r in okc),
                    countries_brier_better_than_viirs=sum(r["brier"] < r["brier_viirs"] for r in okc),
                    countries_scored=len(okc),
                    mean_auc=round(float(np.mean([r["auc"] for r in okc if r["auc"] is not None])), 4),
                    mean_auc_base=round(float(np.mean([r["auc_base"] for r in okc if r["auc_base"] is not None])), 4),
                    mae_skill_pooled=round(1 - sum(r["mae"] * r["n"] for r in okc) / sum(r["mae_base"] * r["n"] for r in okc), 4))
    print(json.dumps(rep_cell, indent=1, default=str))

    # ---- final fit on 2001-2025 and write
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sh_all = shapes(X, np.arange(NY), band)
    fc = {}
    for Y in FC_YEARS:
        Z, Zp, w, F, _ = analogs(X, Y, Y1, final["half_life"], final["phi"], final["kappa"], sh_all[final["shape"]])
        lo, mid, hi = wquant(Z, w, (Q_LO, 0.5, Q_HI))
        thr = median_thr(X, Y1)
        fc[Y] = dict(mean=(Z * w).sum(-1), lo=lo, med=mid, hi=hi, F=F,
                     p_any=prob_any(X, vi0s, Y1, final["half_life"], final["shrink"], final["modis_any"]),
                     p_above=prob_above(Zp, w, thr, final["shrink"]))
        fc[Y]["p_above"] = np.minimum(fc[Y]["p_above"], fc[Y]["p_any"])
    same = all(np.allclose(fc[2026][k], fc[2027][k]) for k in ("mean", "lo", "hi", "p_any", "p_above"))
    hist_med = median_thr(X, Y1)
    hist_mean = X.mean(1)
    hist_any = (X > 0).mean(1)
    annual = X.sum(2)  # K, NY

    M_TXT = method_text(final, cfinal, same)
    m_cnt_c = {f: tot(ckey(final), cnt, f) for f in ("crps", "cover")}
    m_prb_c = {f: tot(pkey(final), prb, f) for f in ("b_any", "b_above")}
    index = []
    sizes = []
    for ci, c in enumerate(C):
        e26 = float(fc[2026]["mean"][ci].sum())
        e27 = float(fc[2027]["mean"][ci].sum())
        avg = float(annual[ci].mean())
        bc = float(base["crps"][ci])
        met = dict(
            years=f"{TEST_YEARS[0]}-{TEST_YEARS[-1]}", months=nmon,
            crps=sig(m_cnt_c["crps"][ci] / nmon), crps_base=sig(bc / nmon), crps_skill=skill(m_cnt_c["crps"][ci], bc),
            brier_any=round(float(m_prb_c["b_any"][ci] / nmon), 4), brier_any_base=round(float(base["b_any"][ci] / nmon), 4),
            brier_above=round(float(m_prb_c["b_above"][ci] / nmon), 4),
            brier_above_base=round(float(base["b_above"][ci] / nmon), 4),
            cover80=round(float(m_cnt_c["cover"][ci] / nmon), 3), cover80_base=round(float(base["cover"][ci] / nmon), 3),
        )
        r = cm[ci]
        cmet = None
        if r["n"]:
            cmet = dict(years=f"{TEST_YEARS[0]}-{TEST_YEARS[-1]}", cell_years=r["n"], rate=r["rate"],
                        brier=round(r["brier"], 4), brier_base=round(r["brier_base"], 4), brier_viirs=round(r["brier_viirs"], 4),
                        auc=None if r["auc"] is None else round(r["auc"], 3),
                        auc_base=None if r["auc_base"] is None else round(r["auc_base"], 3),
                        mae=sig(r["mae"]), mae_base=sig(r["mae_base"]))
        verdict = verdict_text(met, cmet)
        # cells for 2026
        p, shr = cell_probs(c["H"], Y1, cfinal["half_life"], cfinal["shrink"], cfinal["modis"])
        pb, _ = cell_probs(c["H"], Y1, math.inf, 0.0, 1)
        rows = []
        for k in range(c["ncell"]):
            rows += [k, pr(p[k]), pr(pb[k]), sig(shr[k] * e26) or 0]
        months = {Y: fc[Y] for Y in FC_YEARS}
        o = dict(
            v=1, country=c["k"], name=c["name"], made_from="summary/v2", data_through="2025-12",
            first=[2026, 1], n=24,
            month=dict(
                mean=[sig(months[Y]["mean"][ci, m]) or 0 for Y in FC_YEARS for m in range(12)],
                lo=[sig(months[Y]["lo"][ci, m]) or 0 for Y in FC_YEARS for m in range(12)],
                med=[sig(months[Y]["med"][ci, m]) or 0 for Y in FC_YEARS for m in range(12)],
                hi=[sig(months[Y]["hi"][ci, m]) or 0 for Y in FC_YEARS for m in range(12)],
                p_any=[pr(months[Y]["p_any"][ci, m]) for Y in FC_YEARS for m in range(12)],
                p_above=[pr(months[Y]["p_above"][ci, m]) for Y in FC_YEARS for m in range(12)],
            ),
            year={str(Y): dict(mean=sig(float(fc[Y]["mean"][ci].sum())) or 0, trend_factor=round(float(fc[Y]["F"][ci]), 3))
                  for Y in FC_YEARS},
            same_2027=bool(np.allclose(fc[2026]["mean"][ci], fc[2027]["mean"][ci])),
            hist=dict(years="2001-2025", median=[sig(v) or 0 for v in hist_med[ci]], mean=[sig(v) or 0 for v in hist_mean[ci]],
                      p_any=[pr(v) for v in hist_any[ci]], annual_mean=sig(avg) or 0, y2025=sig(float(annual[ci, -1])) or 0),
            cell=c["cell"], ncell=c["ncell"], cell_year=2026,
            cell_rows=rows,
            metrics=dict(month=met, cell=cmet),
            verdict=verdict,
            method=M_TXT,
        )
        s = json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        (out / f"{c['k']}.json").write_text(s)
        sizes.append(len(s.encode()))
        index.append(dict(
            country=c["k"], name=c["name"],
            e26=sig(e26) or 0, e27=sig(e27) or 0, avg=sig(avg) or 0, ratio=None if avg <= 0 else round(e26 / avg, 3),
            crps_skill=met["crps_skill"],
            b_any=met["brier_any"], b_any0=met["brier_any_base"], b_above=met["brier_above"], b_above0=met["brier_above_base"],
            cover80=met["cover80"],
            cell_auc=None if cmet is None else cmet["auc"], cell_auc0=None if cmet is None else cmet["auc_base"],
        ))
    idx = dict(v=1, made_from="summary/v2", data_through="2025-12", year=2026, same_2027=same,
               setting=dict(month=rep_month["final"], cell=rep_cell["final"]),
               pooled=dict(month=rep_month["lead1_nested"], month_lead2=rep_month["lead2_final"], cell=rep_cell["pooled"]),
               note=("e26/e27: expected hotspots in the year (VIIRS terms); avg: 2001-2025 yearly mean; ratio = e26 / avg. "
                     "crps_skill = 1 - CRPS / CRPS of history alone, monthly counts, 2018-2025 backtest (positive = better). "
                     "b_any/b_above: Brier of P(any)/P(above median), 0 = model, 0 suffix = history alone. "
                     "cell_auc: AUC of the 2018-2025 cell chances, cell_auc0 for history alone."),
               countries=index)
    s = json.dumps(idx, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    (out / "index.json").write_text(s)
    print(f"wrote {len(C)} files ({sum(sizes)/1e6:.2f} MB, max {max(sizes)/1e3:.0f} kB, median {np.median(sizes)/1e3:.0f} kB); "
          f"index {len(s.encode())/1e3:.1f} kB; same_2027={same}; {time.time() - t0:.0f}s")
    if args.report:
        Path(args.report).write_text(json.dumps(dict(month=rep_month, cell=rep_cell, same_2027=same,
                                                     per_country_cell=[dict(country=c["k"], **cm[i]) for i, c in enumerate(C)],
                                                     grid=dict(half_lives=[hl(h) for h in HALF_LIVES], phis=PHIS,
                                                               pools=POOLS, shrinks=SHRINKS, modis_any=MODIS_ANY,
                                                               cell_half_lives=[hl(h) for h in CELL_HALF_LIVES],
                                                               cell_shrinks=CELL_SHRINKS, cell_modis=CELL_MODIS)),
                                                indent=1, default=str))


def verdict_text(met, cmet):
    parts = []
    s = met["crps_skill"]
    if s is None:
        parts.append("No hotspots in the backtest years, so the counts could not be scored.")
    elif s > 0.02:
        parts.append(f"Monthly counts: {round(s * 100)}% better than history alone (CRPS, 2018-2025).")
    elif s < -0.02:
        parts.append(f"Monthly counts: {round(-s * 100)}% worse than history alone (CRPS, 2018-2025).")
    else:
        parts.append("Monthly counts: about as good as history alone (CRPS, 2018-2025).")
    for f, lab in (("brier_any", "chance of any hotspot"), ("brier_above", "chance of an above-median month")):
        m, b = met[f], met[f + "_base"]
        if m < 0.001 and b < 0.001:
            parts.append(f"The {lab} was right almost every month, as was history alone.")
            continue
        word = "better than" if m < b - 1e-4 else ("worse than" if m > b + 1e-4 else "the same as")
        parts.append(f"The {lab} scored {word} history alone (Brier {m} vs {b}).")
    parts.append(f"The 80% range held the actual month {round(met['cover80'] * 100)}% of the time "
                 f"(history alone: {round(met['cover80_base'] * 100)}%).")
    if cmet and cmet["auc"] is not None:
        parts.append(f"Cells: AUC {cmet['auc']} vs {cmet['auc_base']} for history alone; Brier {cmet['brier']} vs {cmet['brier_base']}.")
    return " ".join(parts)


def method_text(m, c, same):
    h = "every past year equally" if math.isinf(m["half_life"]) else f"recent years more (a year's weight halves every {m['half_life']:g} years back)"
    t = "no trend" if m["phi"] == 0 else f"a damped trend ({m['phi']:g} x the 10-year slope of the yearly total, at most x3 either way)"
    p = ("no pooling" if m["kappa"] == 0 else
         f"pooling toward the {'global' if m['shape'] == 'global' else 'latitude-band'} seasonal shape for sparse countries "
         f"(pseudo-count {m['kappa']:g} hotspots a year)")
    ch = "every past year equally" if math.isinf(c["half_life"]) else f"recent years more (half-life {c['half_life']:g} years)"
    txt = (
        f"Built from the fire record alone (2001-2025, VIIRS terms; MODIS years converted), with no weather, fuel or ignition data, "
        f"so it shows what a typical year looks like now, not whether 2026 will be unusual. Data end in December 2025. "
        f"Each month's forecast is the spread of the same calendar month in past years, counting {h}, with {t} and {p}. "
        f"The 80% range is the 10th to 90th percentile of that spread. "
        f"Chance of any hotspot and of an above-median month are the weighted share of past years where that happened"
        + (f", pulled toward 50% by {m['shrink']:g} pseudo-years" if m["shrink"] else "")
        + ("; for 'any hotspot' only VIIRS years (from 2012) count, because MODIS misses small fires" if not m["modis_any"] else "")
        + ". One setting for every country, chosen by a rolling backtest (train on years before Y, score Y, 2018-2025) against "
        f"'history alone' (every past year equally, no trend). "
        f"Cells: chance of at least one hotspot in 2026 from the share of past years with one, counting {ch}"
        + (f", pulled toward the country's average cell by {c['shrink']:g} pseudo-years" if c["shrink"] else "")
        + ("; VIIRS years only" if not c["modis"] else "")
        + ". Expected hotspots per cell split the country's expected total by each cell's share of past hotspots. "
        "Cells are yearly only, so there is no monthly map. "
        + ("2027 is the same as 2026: with no trend there is nothing to tell the two years apart."
           if same else "2027 differs from 2026 only through the trend; there is no other information about 2027.")
    )
    return txt


if __name__ == "__main__":
    main()
