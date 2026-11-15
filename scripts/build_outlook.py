#!/usr/bin/env python3
"""Build outlook.js: a 14-day fire outlook per county for New York and California.

The page computes the outlook live: it asks Open-Meteo for the next two weeks
of weather (plus the past 30 days) at one point per county, and turns that into
a probability with the small logistic model written here.

Event: at least one VIIRS (Suomi NPP) hotspot in the county in the 14 days that
start on the issue day (the issue day and the 13 days after it).

Steps:

  1. Daily truth. VIIRS Suomi NPP hotspots 2012-2025 from build/hf (United
     States files), filtered as in the README: type 0, confidence n or h. Spots
     that look industrial are removed: a 0.005 degree cell (about 500 m) seen by
     VIIRS (any detection) in 5 or more calendar years, more than half of them at
     night. This reproduces the monthly VIIRS county counts in data.js to within
     about 2% (NY) and 0.3% (CA); the script prints the check. Points are put in
     counties with the county outlines in data.js (point inside polygon).
  2. Climatology. For each county and day of the year, the share of years in
     which the 14-day window starting that day had a hotspot, pooled over
     issue days within +/- W days and shrunk toward the county's average with
     A pseudo-samples. W and A are chosen by leave-one-year-out Brier score.
  3. Weather. Open-Meteo historical archive (ERA5 reanalysis), daily
     precipitation_sum and et0_fao_evapotranspiration, at one interior point per
     county, local time zone. Only two variables over 2018-12 to 2025-12 are
     fetched, so the whole download costs about 4,400 of the free tier's
     10,000 daily API calls (the archive charges per 14 days per 10
     variables per location). Batches of 10 locations, 75 s apart, cached.
  4. Model, per state: logistic regression on
       logit(climatology), log1p(rain next 14 d), share of dry days next 14 d,
       mean ET0 next 14 d, log1p(rain prior 30 d), mean (ET0 - rain) prior 30 d.
     Fitted on issue days in 2019-2025 with a small ridge penalty. Each training
     row uses a climatology that leaves its own year out, as the page will
     forecast a year the climatology has not seen. A second fit on
     logit(climatology) alone (norm_coef) gives the model's "normal" without
     weather, so the page can show how much of a change comes from the weather.
  5. Backtest: leave one year out over 2019-2025. The climatology of a held-out
     year never includes that year, and training rows use a climatology that
     leaves out both their own year and the held-out year. Compared with the
     climatology alone. The weather for the next 14 days is the reanalysis,
     i.e. observed weather, so this is an upper bound on skill: a real forecast
     is worse, mostly after day 5-7. The "prior 30 days only" variant needs no
     forecast at all and is a lower bound.

Usage:
    .venv/bin/python scripts/build_outlook.py [--cache DIR] [--out outlook.js] [--fetch-only]

Needs duckdb, numpy, scipy and shapely. Network: archive-api.open-meteo.com only.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import duckdb
import numpy as np
from scipy.stats import rankdata
from shapely import MultiPolygon, Polygon, STRtree, points

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
STATES = ("NY", "CA")
BOX = {"NY": (40.4, 45.1, -79.9, -71.7), "CA": (32.4, 42.1, -124.6, -114.0)}
USER_AGENT = "burn-calendar-build/1.0"

FIRE_Y0, FIRE_Y1 = 2012, 2025
FIRE_START = dt.date(2012, 2, 1)  # first issue day used (VIIRS used from February 2012, as in data.js)
TRAIN_Y0 = 2019  # issue days used to fit and backtest the weather model
WX_START = dt.date(2018, 12, 1)  # 30 days before the first training issue day, plus slack
WX_END = dt.date(2025, 12, 31)
HORIZON = 14
PRIOR = 30
WX_VARS = ("precipitation_sum", "et0_fao_evapotranspiration")
BATCH = 10
SLEEP_S = 75
RIDGE = 1.0
P_CLIP = (0.001, 0.999)
DRY_MM = 1.0

MASK_CELL = 0.005
MASK_YEARS = 5
MASK_NIGHT = 0.5

FEATURES = [
    {"id": "clim", "label": "logit of the county's usual chance for this time of year"},
    {"id": "rain14", "label": "log(1 + rain over the next 14 days, mm)"},
    {"id": "dry14", "label": "share of the next 14 days with under 1 mm of rain"},
    {"id": "et14", "label": "mean reference evapotranspiration (ET0) over the next 14 days, mm/day"},
    {"id": "rain30", "label": "log(1 + rain over the past 30 days, mm)"},
    {"id": "def30", "label": "mean (ET0 - rain) over the past 30 days, mm/day"},
]


# ---------------------------------------------------------------- dates
def doy365(d):
    """Day of year 0..364 ignoring 29 February (which shares 28 February's index)."""
    j = d.timetuple().tm_yday - 1
    if d.month > 2 and d.year % 4 == 0 and (d.year % 100 != 0 or d.year % 400 == 0):
        j -= 1
    return j


def day_range(a, b):
    return [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]


# ---------------------------------------------------------------- data.js
def load_burn_data():
    s = (ROOT / "data.js").read_text()
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))


def county_polys(D, st):
    gi = {g["f"]: g for g in D["geo"][st]}
    out = []
    for c in D["states"][st]["counties"]:
        rings = [np.array(r, float).reshape(-1, 2) for r in gi[c["fips"]]["r"]]
        out.append(MultiPolygon([Polygon(r) for r in rings]))
    return out


def county_point(poly):
    """Area-weighted centroid of the largest part, or a guaranteed interior point if that falls outside."""
    part = max(poly.geoms, key=lambda g: g.area)
    p = part.centroid
    if not part.contains(p):
        p = part.representative_point()
    return round(p.y, 3), round(p.x, 3)


# ---------------------------------------------------------------- 1. daily truth
def daily_truth(D, st, polys):
    files = str(HF / "viirs-snpp" / "*" / "viirs-snpp_*_United_States.parquet")
    la0, la1, lo0, lo1 = BOX[st]
    con = duckdb.connect()
    r = con.execute(
        f"SELECT latitude, longitude, acq_date, daynight, type, confidence FROM read_parquet('{files}') "
        f"WHERE latitude BETWEEN {la0} AND {la1} AND longitude BETWEEN {lo0} AND {lo1} "
        f"AND year(acq_date) BETWEEN {FIRE_Y0} AND {FIRE_Y1}").fetchnumpy()
    lat, lon = r["latitude"], r["longitude"]
    day = r["acq_date"].astype("datetime64[D]")
    yr = day.astype("datetime64[Y]").astype(int) + 1970
    keep = (r["type"] == 0) & np.isin(r["confidence"], ["n", "h"])

    # industrial mask: 500 m cells seen in >= 5 years, mostly at night (all detections count)
    key = np.round(lat / MASK_CELL).astype(np.int64) * 10_000_000 + np.round(lon / MASK_CELL).astype(np.int64)
    uk, inv = np.unique(key, return_inverse=True)
    seen = np.zeros((len(uk), FIRE_Y1 - FIRE_Y0 + 1), bool)
    seen[inv, yr - FIRE_Y0] = True
    night = np.bincount(inv, weights=(r["daynight"] == "N"), minlength=len(uk))
    tot = np.bincount(inv, minlength=len(uk))
    static = (seen.sum(1) >= MASK_YEARS) & (night / np.maximum(tot, 1) > MASK_NIGHT)
    keep &= ~static[inv]

    tree = STRtree(polys)
    pi, gi = tree.query(points(lon[keep], lat[keep]), predicate="within")
    idx = np.where(keep)[0][pi]
    cty = gi

    t0 = np.datetime64(dt.date(FIRE_Y0, 1, 1))
    nd = (dt.date(FIRE_Y1, 12, 31) - dt.date(FIRE_Y0, 1, 1)).days + 1
    hot = np.zeros((len(polys), nd), np.int32)
    np.add.at(hot, (cty, (day[idx] - t0).astype(int)), 1)

    # check against data.js monthly VIIRS county counts
    ref = np.zeros((len(polys), 300))
    rows = np.array(D["states"][st]["county_rows"]).reshape(-1, 5)
    np.add.at(ref, (rows[:, 0].astype(int), rows[:, 1].astype(int)), rows[:, 4])
    mi = (yr[idx] - 2001) * 12 + (day[idx].astype("datetime64[M]").astype(int) % 12)
    mine = np.zeros_like(ref)
    np.add.at(mine, (cty, mi), 1)
    check = {"hotspots": int(hot.sum()), "data_js_viirs": int(ref.sum()),
             "abs_month_diff": int(np.abs(mine - ref).sum()), "static_cells": int(static.sum())}
    print(f"[{st}] truth: {check}", flush=True)
    return hot, check


def events(hot):
    """ev[c, t] = 1 if any hotspot in days t..t+13, NaN where the window runs past the data."""
    c = np.cumsum(np.pad(hot, ((0, 0), (1, 0))), axis=1)
    n = hot.shape[1]
    ev = np.full(hot.shape, np.nan)
    ev[:, : n - HORIZON + 1] = (c[:, HORIZON:] - c[:, : n - HORIZON + 1]) > 0
    first = (FIRE_START - dt.date(FIRE_Y0, 1, 1)).days
    ev[:, :first] = np.nan
    return ev


def by_year_doy(ev):
    """E[c, y, d]: the event for issue day d (0..364) of year y; 29 February is dropped."""
    days = day_range(dt.date(FIRE_Y0, 1, 1), dt.date(FIRE_Y1, 12, 31))
    E = np.full((ev.shape[0], FIRE_Y1 - FIRE_Y0 + 1, 365), np.nan)
    for i, d in enumerate(days):
        if d.month == 2 and d.day == 29:
            continue
        E[:, d.year - FIRE_Y0, doy365(d)] = ev[:, i]
    return E


# ---------------------------------------------------------------- 2. climatology
class Climatology:
    """Pooled counts per year so that any set of years can be left out cheaply."""

    def __init__(self, E, W):
        valid = ~np.isnan(E)
        k = np.where(valid, E, 0.0)
        ks = np.zeros_like(k)
        ns = np.zeros_like(k)
        for o in range(-W, W + 1):
            ks += np.roll(k, -o, axis=2)
            ns += np.roll(valid.astype(float), -o, axis=2)
        self.k, self.n = ks, ns  # [c, y, d]

    def rate(self, A, exclude=()):
        ex = [y - FIRE_Y0 for y in exclude]
        K = self.k.sum(1) - (self.k[:, ex].sum(1) if ex else 0)
        N = self.n.sum(1) - (self.n[:, ex].sum(1) if ex else 0)
        p0 = K.sum(1, keepdims=True) / np.maximum(N.sum(1, keepdims=True), 1)
        return np.clip((K + A * p0) / (N + A), *P_CLIP)


def choose_climatology(E):
    """Pick the smoothing half-width and pseudo-count by leave-one-year-out Brier over all years."""
    best = None
    for W in (3, 7, 10, 15, 21, 30, 45, 60):
        cl = Climatology(E, W)
        for A in (0, 5, 20, 60, 200):
            se, m = 0.0, 0
            for y in range(FIRE_Y0, FIRE_Y1 + 1):
                p = cl.rate(A, (y,))
                e = E[:, y - FIRE_Y0]
                ok = ~np.isnan(e)
                se += ((p[ok] - e[ok]) ** 2).sum()
                m += ok.sum()
            b = se / m
            if best is None or b < best[0]:
                best = (b, W, A)
    return {"W": best[1], "A": best[2], "loyo_brier": best[0]}


# ---------------------------------------------------------------- 3. weather
def fetch_archive(pts, cache, tag):
    """Daily weather at each point over WX_START..WX_END, batched and cached. Returns [c, day, var]."""
    cache.mkdir(parents=True, exist_ok=True)
    out = []
    for b in range(0, len(pts), BATCH):
        chunk = pts[b: b + BATCH]
        qs = {
            "latitude": ",".join(f"{p[0]:.3f}" for p in chunk),
            "longitude": ",".join(f"{p[1]:.3f}" for p in chunk),
            "start_date": WX_START.isoformat(),
            "end_date": WX_END.isoformat(),
            "daily": ",".join(WX_VARS),
            "timezone": "auto",
        }
        url = "https://archive-api.open-meteo.com/v1/archive?" + "&".join(f"{k}={v}" for k, v in qs.items())
        f = cache / f"wx_{tag}_{hashlib.sha1(url.encode()).hexdigest()[:12]}.json"
        if not f.exists():
            for attempt in range(40):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                    with urllib.request.urlopen(req, timeout=300) as r:
                        body = r.read()
                        cost = r.headers.get("X-RateLimit-Cost")
                    f.write_bytes(body)
                    print(f"[{tag}] batch {b // BATCH} fetched ({len(body)} bytes, cost {cost})", flush=True)
                    break
                except urllib.error.HTTPError as e:
                    wait = int(e.headers.get("Retry-After") or 0) or SLEEP_S
                    print(f"[{tag}] batch {b // BATCH}: HTTP {e.code} {e.read()[:200]!r}; waiting {wait}s", flush=True)
                    time.sleep(wait)
                except (urllib.error.URLError, TimeoutError) as e:
                    print(f"[{tag}] batch {b // BATCH}: {e}; waiting {SLEEP_S}s", flush=True)
                    time.sleep(SLEEP_S)
            else:
                sys.exit(f"[{tag}] batch {b // BATCH}: gave up")
            time.sleep(SLEEP_S)
        js = json.loads(f.read_text())
        js = js if isinstance(js, list) else [js]
        for loc in js:
            dl = loc["daily"]
            arr = np.array([[np.nan if v is None else v for v in dl[k]] for k in WX_VARS], float).T
            if dl["time"][0] != WX_START.isoformat() or len(dl["time"]) != (WX_END - WX_START).days + 1:
                sys.exit(f"[{tag}] unexpected time axis")
            out.append(arr)
    return np.stack(out)


# ---------------------------------------------------------------- 4. features and model
def weather_features(wx, t_idx):
    """Features for issue days at indexes t_idx of the weather axis. wx: [c, day, (rain, et0)]."""
    rain = np.maximum(np.nan_to_num(wx[..., 0]), 0.0)
    et0 = np.maximum(np.nan_to_num(wx[..., 1]), 0.0)
    cr = np.cumsum(np.pad(rain, ((0, 0), (1, 0))), axis=1)
    ce = np.cumsum(np.pad(et0, ((0, 0), (1, 0))), axis=1)
    cd = np.cumsum(np.pad((rain < DRY_MM).astype(float), ((0, 0), (1, 0))), axis=1)
    t = np.asarray(t_idx)
    r14 = cr[:, t + HORIZON] - cr[:, t]
    e14 = (ce[:, t + HORIZON] - ce[:, t]) / HORIZON
    d14 = (cd[:, t + HORIZON] - cd[:, t]) / HORIZON
    r30 = cr[:, t] - cr[:, t - PRIOR]
    e30 = ce[:, t] - ce[:, t - PRIOR]
    r7 = cr[:, t + 7] - cr[:, t]
    e7 = (ce[:, t + 7] - ce[:, t]) / 7
    return {"rain14": np.log1p(r14), "dry14": d14, "et14": e14,
            "rain30": np.log1p(r30), "def30": (e30 - r30) / PRIOR,
            "rain7": np.log1p(r7), "et7": e7}  # rain7, et7: backtest sensitivity only


def logit(p):
    return np.log(p / (1 - p))


def fit_logistic(X, y, ridge=RIDGE):
    """Ridge-penalized logistic regression by Newton's method on standardized columns.
    Returns coefficients on the raw scale: [intercept, b1, b2, ...]."""
    mu, sd = X.mean(0), X.std(0)
    sd[sd == 0] = 1
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    P = np.eye(Z.shape[1]) * ridge
    P[0, 0] = 0
    for _ in range(50):
        p = 1 / (1 + np.exp(-(Z @ w)))
        g = Z.T @ (p - y) + P @ w
        H = (Z * (p * (1 - p))[:, None]).T @ Z + P
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-9:
            break
    b = w[1:] / sd
    return np.concatenate([[w[0] - (b * mu).sum()], b])


def predict(beta, X):
    return 1 / (1 + np.exp(-(beta[0] + X @ beta[1:])))


def metrics(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    brier = float(np.mean((p - y) ** 2))
    ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    ranks = rankdata(p)
    n1 = y.sum()
    n0 = len(y) - n1
    auc = float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")
    return {"brier": brier, "logloss": ll, "auc": auc}


# ---------------------------------------------------------------- 5. backtest and output
VARIANTS = {
    "climatology": None,
    "recalibrated climatology": ["clim"],
    "climatology + past 30 days": ["clim", "rain30", "def30"],
    "past 30 days + observed next 7 days": ["clim", "rain7", "et7", "rain30", "def30"],
    "full model (observed next 14 days)": [f["id"] for f in FEATURES],
}
SHIPPED = "full model (observed next 14 days)"
EXAMPLES = [("NY", "Suffolk", "2025-03-01"), ("CA", "Los Angeles", "2025-01-07")]


def issue_days():
    return day_range(dt.date(TRAIN_Y0, 1, 1), dt.date(FIRE_Y1, 12, 31) - dt.timedelta(days=HORIZON - 1))


def design(st_wx, ev, days):
    """Rows (county, issue day) for the training years: weather features, event, doy, year."""
    t_wx = np.array([(d - WX_START).days for d in days])
    t_ev = np.array([(d - dt.date(FIRE_Y0, 1, 1)).days for d in days])
    f = weather_features(st_wx, t_wx)  # each [c, t]
    nc = ev.shape[0]
    cols = {k: v.ravel() for k, v in f.items()}
    y = ev[:, t_ev].ravel()
    doy = np.tile([doy365(d) for d in days], nc)
    yr = np.tile([d.year for d in days], nc)
    cty = np.repeat(np.arange(nc), len(days))
    ok = ~np.isnan(y)
    return {k: v[ok] for k, v in cols.items()}, y[ok], doy[ok], yr[ok], cty[ok]


def matrix(cols, clim_logit, ids):
    return np.column_stack([clim_logit if i == "clim" else cols[i] for i in ids])


def backtest(cl, A, cols, y, doy, yr, cty):
    years = sorted(set(yr.tolist()))
    preds = {k: np.zeros(len(y)) for k in VARIANTS}
    per_year = {k: {} for k in VARIANTS}
    for Y in years:
        te = yr == Y
        base_te = cl.rate(A, (Y,))[cty[te], doy[te]]
        tr_logit = np.zeros((~te).sum())
        tri = np.where(~te)[0]
        for yy in years:
            if yy == Y:
                continue
            m = yr[tri] == yy
            tr_logit[m] = logit(cl.rate(A, (yy, Y))[cty[tri][m], doy[tri][m]])
        for k, ids in VARIANTS.items():
            if ids is None:
                preds[k][te] = base_te
                continue
            beta = fit_logistic(matrix({c: v[tri] for c, v in cols.items()}, tr_logit, ids), y[tri])
            preds[k][te] = predict(beta, matrix({c: v[te] for c, v in cols.items()}, logit(base_te), ids))
        for k in VARIANTS:
            per_year[k][Y] = metrics(preds[k][te], y[te])["brier"]
    out = {}
    ref = metrics(preds["climatology"], y)
    for k in VARIANTS:
        m = metrics(preds[k], y)
        m["bss"] = 1 - m["brier"] / ref["brier"]
        m["bss_by_year"] = {str(Y): round(1 - per_year[k][Y] / per_year["climatology"][Y], 4) for Y in years}
        out[k] = {a: (round(b, 4) if isinstance(b, float) else b) for a, b in m.items()}
    p = preds[SHIPPED]
    bins = np.minimum((p * 10).astype(int), 9)
    rel = [[round(float(p[bins == b].mean()), 4), round(float(y[bins == b].mean()), 4), int((bins == b).sum())]
           for b in range(10) if (bins == b).any()]
    return out, rel, {"rows": int(len(y)), "events": int(y.sum()), "years": years}


def build(D, polys, pts, wx, out_path):
    res = {
        "v": 1,
        "built": dt.date.today().isoformat(),
        "event": f"at least one VIIRS (Suomi NPP) hotspot in the county in the {HORIZON} days starting on the issue day",
        "horizon": HORIZON,
        "prior": PRIOR,
        "dry_mm": DRY_MM,
        "p_clip": list(P_CLIP),
        "api": {
            "url": "https://api.open-meteo.com/v1/forecast",
            "params": {"daily": ",".join(WX_VARS), "forecast_days": 16, "past_days": PRIOR,
                       "timezone": "auto", "models": "ecmwf_ifs025"},
            "fallback_models": "best_match",
        },
        "features": FEATURES,
        "method": METHOD,
        "states": {},
    }
    days = issue_days()
    for st in STATES:
        hot, check = daily_truth(D, st, polys[st])
        ev = events(hot)
        E = by_year_doy(ev)
        ch = choose_climatology(E)
        cl = Climatology(E, ch["W"])
        cols, y, doy, yr, cty = design(wx[st], ev, days)
        bt, rel, size = backtest(cl, ch["A"], cols, y, doy, yr, cty)
        own = np.zeros(len(y))
        for yy in sorted(set(yr.tolist())):
            m = yr == yy
            own[m] = logit(cl.rate(ch["A"], (yy,))[cty[m], doy[m]])
        beta = fit_logistic(matrix(cols, own, VARIANTS[SHIPPED]), y)
        norm = fit_logistic(own[:, None], y)  # recalibrated climatology: the model's "normal" without weather
        base = np.round(cl.rate(ch["A"]) * 10000).astype(int)  # [c, 365]
        print(f"[{st}] climatology {ch}", flush=True)
        for k, m in bt.items():
            print(f"[{st}] {k:38s} brier {m['brier']:.4f} logloss {m['logloss']:.4f} auc {m['auc']:.4f} bss {m['bss']:+.4f}",
                  flush=True)
        print(f"[{st}] coefficients {np.round(beta, 4).tolist()}", flush=True)
        res["states"][st] = {
            "fips": [c["fips"] for c in D["states"][st]["counties"]],
            "names": [c["name"] for c in D["states"][st]["counties"]],
            "pts": [list(p) for p in pts[st]],
            "base": base.ravel().tolist(),
            "coef": [round(float(b), 5) for b in beta],
            "norm_coef": [round(float(b), 5) for b in norm],
            "climatology": {"years": [FIRE_Y0, FIRE_Y1], "half_width_days": ch["W"], "pseudo_samples": ch["A"]},
            "metrics": {"backtest": bt, "reliability": rel, **size, "truth_check": check},
        }
    res["examples"] = worked_example(res, wx, EXAMPLES)
    out_path.write_text("window.OUTLOOK = " + json.dumps(res, separators=(",", ":")) + ";\n")
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")


def outlook_from_daily(S, ci, date_iso, rain, et0):
    """The page's computation, step for step as in CONTRACT.md.
    S: one state's entry of outlook.js; ci: county index; rain, et0: the location's daily
    values from the forecast response (30 past days, then today, then the days after);
    date_iso: that response's time[30], i.e. today in the county's time zone."""
    T = PRIOR
    r = [max(0.0, v) for v in rain]
    e = [max(0.0, v) for v in et0]
    rain14 = sum(r[T: T + HORIZON])
    dry14 = sum(1 for v in r[T: T + HORIZON] if v < DRY_MM) / HORIZON
    et14 = sum(e[T: T + HORIZON]) / HORIZON
    rain30 = sum(r[0:T])
    def30 = (sum(e[0:T]) - rain30) / PRIOR
    d = doy365(dt.date.fromisoformat(date_iso))
    base = S["base"][ci * 365 + d] / 10000
    x = [math.log(base / (1 - base)), math.log1p(rain14), dry14, et14, math.log1p(rain30), def30]
    z = S["coef"][0] + sum(b * v for b, v in zip(S["coef"][1:], x))
    p = 1 / (1 + math.exp(-z))
    a = S["norm_coef"]
    norm = 1 / (1 + math.exp(-(a[0] + a[1] * x[0])))
    return {"doy": d, "base": base, "x": x, "z": z, "p": p, "ratio": p / base, "norm": norm, "wx_ratio": p / norm}


def worked_example(res, wx, cases):
    """Worked examples from the ERA5 record, laid out exactly like a forecast response (46 days)."""
    out = []
    for st, name, date_iso in cases:
        S = res["states"][st]
        ci = S["names"].index(name)
        t = (dt.date.fromisoformat(date_iso) - WX_START).days
        rain = [round(float(v), 2) for v in wx[st][ci, t - PRIOR: t + 16, 0]]
        et0 = [round(float(v), 2) for v in wx[st][ci, t - PRIOR: t + 16, 1]]
        o = outlook_from_daily(S, ci, date_iso, rain, et0)
        out.append({"st": st, "ci": ci, "name": name, "today": date_iso,
                    "time0": (dt.date.fromisoformat(date_iso) - dt.timedelta(days=PRIOR)).isoformat(),
                    "precipitation_sum": rain, "et0_fao_evapotranspiration": et0,
                    "expect": {"doy": o["doy"], "base": round(o["base"], 6), "x": [round(v, 6) for v in o["x"]],
                               "z": round(o["z"], 6), "p": round(o["p"], 6), "ratio": round(o["ratio"], 6),
                               "norm": round(o["norm"], 6), "wx_ratio": round(o["wx_ratio"], 6)}})
    return out


METHOD = (
    "Logistic regression per state. Inputs: the county's usual chance of a hotspot in a 14-day window "
    "starting on this day of the year (VIIRS 2012-2025), and Open-Meteo daily rain and reference "
    "evapotranspiration (ET0) for the past 30 days and the next 14. Fitted on 2019-2025 with ERA5 "
    "reanalysis weather. The backtest leaves one year out at a time and uses observed weather for the "
    "next 14 days, so it is an upper bound: with forecast weather, skill is lower, especially after the "
    "first week."
)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", type=Path, default=ROOT / "build" / "outlook_cache")
    ap.add_argument("--out", type=Path, default=ROOT / "outlook.js")
    ap.add_argument("--fetch-only", action="store_true", help="only download (or check the cache of) the weather")
    a = ap.parse_args()

    D = load_burn_data()
    polys = {st: county_polys(D, st) for st in STATES}
    pts = {st: [county_point(p) for p in polys[st]] for st in STATES}
    wx = {st: fetch_archive(pts[st], a.cache, st) for st in STATES}
    if a.fetch_only:
        return
    build(D, polys, pts, wx, a.out)


if __name__ == "__main__":
    main()
