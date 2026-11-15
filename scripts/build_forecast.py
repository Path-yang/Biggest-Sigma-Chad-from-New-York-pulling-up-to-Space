#!/usr/bin/env python3
"""Build forecast.js: monthly chance of fire for 2026 and 2027, per hexagon and per county.

The event is "at least one VIIRS fire hotspot in this hexagon (or county) in
this calendar month". The forecast is built from the fire history in data.js
alone. It knows nothing about weather, fuel or ignitions, so it says how often
a place has burned in a given month, adjusted for recent years and for its
neighbours; it cannot say whether next month will be unusual.

Inputs
  data.js                      window.BURN_DATA (parsed as the JSON after "window.BURN_DATA =")
  forecast_inputs/large.json   optional extra layers, e.g. {"CA": {"large": {...}}};
                               see CONTRACT / merge_layer() for the format.

Output
  forecast.js                  window.FORECAST = {...}

Method
  * Event per unit-month: at least one VIIRS hotspot (February 2012 to
    December 2025). VIIRS-era counts only, by choice. The harm() rule of
    src/model.ts makes a MODIS-era month "> 0" exactly when MODIS saw a
    hotspot, and harmonization fixes expected counts, not whether a small
    fire is seen at all: on the 2012-2025 overlap MODIS saw something in only
    11% (New York) and 42% (California) of the hexagon-months where VIIRS saw
    a hotspot. The backtest tries the MODIS years anyway (weight 0, 0.25, 0.5
    or 1, chosen like the other settings) and reports it as
    "with_modis_years". In the 2018-2025 backtest it gave the same Brier
    score in New York and a 0.2-0.3% lower one in California, and it pulled
    New York's mean hexagon chance down from 1.02% to 0.91% when 1.22% of
    hexagon-months burned. Too little gain for a known bias, so it is not used.
  * Not fire: the hexagons in NOT_FIRE (the Ivanpah solar towers in
    California) count as having no fire, and their hotspots are taken out of
    their county. The industrial mask in data.js misses them because VIIRS
    sees the towers by day.
  * Baseline, "history alone": the share of past VIIRS years (from 2012) with
    at least one hotspot in that unit and calendar month. This is what the
    page's "chance of fire" layer shows today.
  * Candidate model (every part can be switched off by the tuning):
      - recency weighting: year y gets weight 0.5 ** ((last_year - y) / half_life);
      - empirical-Bayes shrinkage: p = (a + alpha * prior) / (n + alpha), where
        a is the weighted count of fire years, n the weighted number of years,
        and prior the pooled rate of the unit's neighbourhood (hexagons within
        1, 2 or 3 rings, or the same county; for counties, the touching
        counties, counties two steps away, or the whole state), itself with
        beta pseudo-years of the state-wide rate so it is never exactly 0;
      - trend: a state-wide shift in log-odds, tau * b * (target_year - mean
        training year), where b is the yearly slope of the logit of the share
        of units with fire in VIIRS years, with one intercept per calendar month.
  * Rolling-origin backtest: for each target year Y in 2018-2025 train on
    years < Y (and <= Y-2 for the two-year horizon). The settings for Y are
    chosen on target years 2015..Y-1 only, each trained on the years before
    it, so no target year ever helps choose its own settings. The final
    settings are chosen the same way on 2015-2025 and fitted on all years
    through 2025. Settings are chosen by Brier score (--metric logloss to
    change).

Usage
  .venv/bin/python scripts/build_forecast.py [--data data.js] [--out forecast.js]
      [--large forecast_inputs/large.json] [--report report.json]
  .venv/bin/python scripts/build_forecast.py --merge-only [--large FILE]
      (add or replace extra layers in the existing forecast.js without rebuilding "any")
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import re
import sys
from dataclasses import dataclass

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATES = ("NY", "CA")
Y0 = 2001  # month index i = (year - 2001) * 12 + (month - 1)
TARGETS = list(range(2018, 2026))  # reported backtest years
INNER0 = 2015  # first year used to choose settings
OUT_YEARS = (2026, 2027)
CLIP = 1e-3  # log loss clip, the resolution of the published permille values
RELI_EDGES = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0]
# the settings the backtest chooses from
HALF_LIVES = [2, 3, 4, 6, 10, math.inf]  # recency half-life in years; inf = all years count the same
ALPHAS = [0, 1, 2, 4, 8, 16]  # pseudo-years of the neighbourhood prior; 0 = no smoothing
BETAS = [1, 4, 16]  # pseudo-years of the state-wide rate inside the neighbourhood prior
TAUS = [0, 0.5, 1]  # share of the state-wide trend applied
OMEGAS = [0, 0.25, 0.5, 1]  # weight of a MODIS-era year (2001-2011); tested, but the published model uses 0
HEX_HOODS = ["ring1", "ring2", "ring3", "county"]
COUNTY_HOODS = ["adj1", "adj2", "state"]
VERSION = 2
# Heat sources that are not fire and that the industrial mask in data.js misses: it drops 500 m spots seen in 5 or
# more years mostly at night, and these are seen by day. Every hexagon holding one of the points counts as having no
# fire, and its hotspots are taken out of its county too. Keep in step with NOT_FIRE in src/model.ts.
NOT_FIRE = {
    "CA": [
        # the three solar towers; VIIRS flags them in most sunny months since late 2013
        ("Ivanpah Solar Electric Generating System", [(35.534, -115.452), (35.557, -115.470), (35.575, -115.484)]),
    ],
}


# ---------------------------------------------------------------- data
def load_burn_data(path: str) -> dict:
    """Parse data.js: the JSON object after "window.BURN_DATA =" (spaces allowed)."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"window\.BURN_DATA\s*=\s*", text)
    if not m:
        raise ValueError(f"{path}: no window.BURN_DATA assignment")
    data, _ = json.JSONDecoder().raw_decode(text, m.end())
    return data


@dataclass
class Units:
    """One set of map units (hexagons or counties) of one state."""

    n: int
    hoods: dict  # name -> dense 0/1 neighbourhood matrix (n x n), self included
    X: np.ndarray  # uint8 [n, years 2001..y1, 12]: harmonized count > 0 (VIIRS > 0 from February 2012)


def viirs_from(meta: dict) -> int:
    return (meta["viirs_from"][0] - Y0) * 12 + meta["viirs_from"][1] - 1


def aqua_from(meta: dict) -> int:
    return (meta["aqua_from"][0] - Y0) * 12 + meta["aqua_from"][1] - 1


def event_cube(rows: np.ndarray, n: int, meta: dict) -> np.ndarray:
    """rows: [unit, month index, Terra, Aqua, VIIRS] -> uint8 [unit, year, month]: harmonized count > 0."""
    vi0, aq0 = viirs_from(meta), aqua_from(meta)
    X = np.zeros((n, meta["y1"] - Y0 + 1, 12), np.uint8)
    u, i, T, A, V = rows.T
    # harm() in src/model.ts: VIIRS as observed from vi0, else MODIS times a positive rate
    # (Terra alone before Aqua). So "h > 0" is V > 0, T > 0, or T + A > 0.
    pos = np.where(i >= vi0, V > 0, np.where(i < aq0, T > 0, (T + A) > 0))
    X[u[pos], i[pos] // 12, i[pos] % 12] = 1
    return X


def hex_neighbours(hexes: np.ndarray, d: int) -> np.ndarray:
    """0/1 matrix of hexagons within axial distance d (self included)."""
    q, r = hexes[:, 0], hexes[:, 1]
    key = {(int(a), int(b)): k for k, (a, b) in enumerate(zip(q, r))}
    n = len(hexes)
    W = np.zeros((n, n), np.float32)
    for dq in range(-d, d + 1):
        for dr in range(-d, d + 1):
            if (abs(dq) + abs(dr) + abs(dq + dr)) // 2 > d:
                continue
            for k in range(n):
                j = key.get((int(q[k]) + dq, int(r[k]) + dr))
                if j is not None:
                    W[k, j] = 1
    return W


def hex_at(s: dict, lat: float, lon: float) -> int:
    """Index of the hexagon holding a point, as hexAt() in src/model.ts (axial coordinates, cube rounding); -1 if none."""
    R, K = s["hex_r"], s["hex_k"]
    q = ((math.sqrt(3) / 3) * lon * K - lat / 3) / R
    r = (2 / 3) * lat / R
    c = -q - r
    rq, rr, rc = round(q), round(r), round(c)
    dq, dr, dc = abs(rq - q), abs(rr - r), abs(rc - c)
    if dq > dr and dq > dc:
        rq = -rr - rc
    elif dr > dc:
        rr = -rq - rc
    hexes = np.asarray(s["hexes"], np.int64).reshape(-1, 3)
    hit = np.nonzero((hexes[:, 0] == rq) & (hexes[:, 1] == rr))[0]
    return int(hit[0]) if len(hit) else -1


def not_fire_hexes(s: dict, st: str) -> list[int]:
    return sorted({k for _, pts in NOT_FIRE.get(st, []) for lat, lon in pts if (k := hex_at(s, lat, lon)) >= 0})


def drop_not_fire(s: dict, st: str) -> tuple[np.ndarray, np.ndarray]:
    """hex_rows and county_rows without the hotspots of the NOT_FIRE hexagons."""
    hrows = np.asarray(s["hex_rows"], np.int64).reshape(-1, 5)
    crows = np.asarray(s["county_rows"], np.int64).reshape(-1, 5).copy()
    bad = not_fire_hexes(s, st)
    if not bad:
        return hrows, crows
    county_of = np.asarray(s["hexes"], np.int64).reshape(-1, 3)[:, 2]
    drop = np.isin(hrows[:, 0], bad)
    take = {}
    for k, i, T, A, V in hrows[drop]:
        key = (int(county_of[k]), int(i))
        take[key] = take.get(key, np.zeros(3, np.int64)) + (T, A, V)
    for j, (c, i) in enumerate(crows[:, :2]):
        t = take.get((int(c), int(i)))
        if t is not None:
            crows[j, 2:] = np.maximum(0, crows[j, 2:] - t)
    return hrows[~drop], crows


def state_units(D: dict, st: str) -> tuple[Units, Units]:
    s, meta = D["states"][st], D["meta"]
    hexes = np.asarray(s["hexes"], np.int64).reshape(-1, 3)
    nh, nc = len(hexes), len(s["counties"])
    hrows, crows = drop_not_fire(s, st)
    hX = event_cube(hrows, nh, meta)
    cX = event_cube(crows, nc, meta)
    county = hexes[:, 2]
    same_county = (county[:, None] == county[None, :]).astype(np.float32)
    hex_hoods = {f"ring{d}": hex_neighbours(hexes, d) for d in (1, 2, 3)}
    hex_hoods["county"] = same_county
    # counties touch when any of their hexagons are neighbours
    adj = np.eye(nc, dtype=np.float32)
    ring1 = hex_hoods["ring1"]
    a, b = np.nonzero(ring1)
    adj[county[a], county[b]] = 1
    adj2 = ((adj @ adj) > 0).astype(np.float32)
    county_hoods = {"adj1": adj, "adj2": adj2, "state": np.ones((nc, nc), np.float32)}
    return Units(nh, hex_hoods, hX), Units(nc, county_hoods, cX)


def viirs_valid(meta: dict) -> np.ndarray:
    """[years 2001..y1, 12]: True where the month is VIIRS-observed (from February 2012)."""
    ny = meta["y1"] - Y0 + 1
    i = np.arange(ny)[:, None] * 12 + np.arange(12)[None, :]
    return i >= viirs_from(meta)


# ---------------------------------------------------------------- models
@dataclass(frozen=True)
class Config:
    half_life: float  # years; inf = all years count the same
    omega: float  # weight of a MODIS-era year relative to a VIIRS year (0 = VIIRS years only)
    hood: str
    alpha: float  # pseudo-years of the neighbourhood prior (0 = no smoothing)
    beta: float  # pseudo-years of the state rate inside the neighbourhood prior
    tau: float  # share of the state-wide trend applied (0 = none)

    def label(self) -> str:
        hl = "none" if math.isinf(self.half_life) else f"{self.half_life:g} y"
        hood = f", neighbourhood {self.hood}, alpha {self.alpha:g}, beta {self.beta:g}" if self.alpha > 0 else ", no smoothing"
        return f"half-life {hl}, MODIS weight {self.omega:g}{hood}, trend x{self.tau:g}"

    def as_dict(self) -> dict:
        return {
            "half_life_years": None if math.isinf(self.half_life) else self.half_life,
            "modis_year_weight": self.omega,
            "neighbourhood": self.hood if self.alpha > 0 else None,
            "alpha": self.alpha,
            "beta": self.beta if self.alpha > 0 else None,
            "trend_tau": self.tau,
        }


HISTORY = Config(math.inf, 0.0, "", 0.0, 0.0, 0.0)  # baseline: share of past VIIRS years with fire
HISTORY_HARM = Config(math.inf, 1.0, "", 0.0, 0.0, 0.0)  # reference: share of all past years, harmonized


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def trend_slope(X: np.ndarray, valid: np.ndarray, years: np.ndarray) -> float:
    """Yearly slope of logit(share of units with fire) over VIIRS months, with one intercept per calendar month."""
    n = X.shape[0]
    share = (X.sum(0) + 0.5) / (n + 1)  # [years, 12]
    yy, mm = np.nonzero(valid)
    if len(np.unique(yy)) < 3:
        return 0.0
    z = logit(share[yy, mm])
    t = years[yy].astype(float)
    zc, tc = z.copy(), t.copy()
    for m in range(12):  # month fixed effects: remove each month's mean, then an OLS slope
        s = mm == m
        if s.any():
            zc[s] -= z[s].mean()
            tc[s] -= t[s].mean()
    den = (tc * tc).sum()
    return float((tc * zc).sum() / den) if den > 0 else 0.0


class Fitter:
    """Weighted fire-year counts of every unit for one training cut-off, half-life and MODIS weight."""

    def __init__(self, units: Units, vmask, years, last: int, half_life: float, omega: float):
        tr = years <= last
        Xt, vt, yt = units.X[:, tr], vmask[tr], years[tr]
        w = np.ones(len(yt)) if math.isinf(half_life) else 0.5 ** ((last - yt) / half_life)
        wm = w[:, None] * np.where(vt, 1.0, omega)  # [years, 12]
        self.a = np.einsum("uym,ym->um", Xt, wm)  # weighted fire years
        self.nw = wm.sum(0)  # [12] weighted years
        wy = wm.sum(1)
        self.ybar = float((wy * yt).sum() / wy.sum())
        self.slope = trend_slope(Xt, vt, yt)
        self.hoods = units.hoods
        self._prior = {}

    def prior(self, hood: str, beta: float) -> np.ndarray:
        """Pooled rate of each unit's neighbourhood, plus beta pseudo-years of the state rate."""
        if hood not in self._prior:
            W = self.hoods[hood]
            self._prior[hood] = (W @ self.a, W.sum(1)[:, None] * self.nw[None, :])
        Wa, Wn = self._prior[hood]
        state_rate = self.a.sum(0) / (self.a.shape[0] * self.nw)
        return (Wa + beta * state_rate[None, :]) / (Wn + beta)

    def predict(self, cfg: Config, target: int) -> np.ndarray:
        """[unit, 12] probabilities for the target year."""
        if cfg.alpha > 0:
            p = (self.a + cfg.alpha * self.prior(cfg.hood, cfg.beta)) / (self.nw[None, :] + cfg.alpha)
        else:
            p = self.a / self.nw[None, :]
        if cfg.tau:
            z = logit(p) + cfg.tau * self.slope * (target - self.ybar)
            p = np.where(p > 0, 1 / (1 + np.exp(-z)), 0.0)
        return p


class Fits:
    """Cache of Fitters for one unit set, keyed by (cut-off year, half-life, MODIS weight)."""

    def __init__(self, units: Units, vmask, years):
        self.units, self.vmask, self.years, self.cache = units, vmask, years, {}

    def get(self, last: int, cfg: Config) -> Fitter:
        k = (last, cfg.half_life, cfg.omega)
        if k not in self.cache:
            self.cache[k] = Fitter(self.units, self.vmask, self.years, last, cfg.half_life, cfg.omega)
        return self.cache[k]

    def predict(self, cfg: Config, target: int, horizon: int = 1) -> np.ndarray:
        return self.get(target - horizon, cfg).predict(cfg, target)


# ---------------------------------------------------------------- metrics
def brier(p, x):
    return float(np.mean((p - x) ** 2))


def logloss(p, x):
    p = np.clip(p, CLIP, 1 - CLIP)
    return float(-np.mean(x * np.log(p) + (1 - x) * np.log(1 - p)))


def auc(p, x):
    """Mann-Whitney AUC, tied scores counted as half."""
    x = x.astype(bool)
    npos, nneg = int(x.sum()), int((~x).sum())
    if npos == 0 or nneg == 0:
        return None
    _, inv, cnt = np.unique(p, return_inverse=True, return_counts=True)
    rank = (np.cumsum(cnt) - (cnt - 1) / 2.0)[inv]  # average 1-based ranks
    return float((rank[x].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def reliability(p, x):
    out = []
    for lo, hi in zip(RELI_EDGES[:-1], RELI_EDGES[1:]):
        s = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        n = int(s.sum())
        out.append(
            {
                "bin": [lo, hi],
                "n": n,
                "mean_p": round(float(p[s].mean()), 4) if n else None,
                "observed": round(float(x[s].mean()), 4) if n else None,
            }
        )
    return out


def summary(p, x, with_reli=True):
    a = auc(p, x)
    d = {
        "n": int(x.size),
        "events": int(x.sum()),
        "base_rate": round(float(x.mean()), 5),
        "mean_p": round(float(np.mean(p)), 5),
        "brier": round(brier(p, x), 6),
        "logloss": round(logloss(p, x), 5),
        "auc": None if a is None else round(a, 4),
    }
    if with_reli:
        d["reliability"] = reliability(p, x)
    return d


# ---------------------------------------------------------------- backtest
def all_configs(hoods: list[str]) -> list[Config]:
    cfgs = []
    for hl, om, a, tau in itertools.product(HALF_LIVES, OMEGAS, ALPHAS, TAUS):
        if a == 0:
            cfgs.append(Config(hl, om, "", 0.0, 0.0, tau))
        else:
            cfgs += [Config(hl, om, h, a, b, tau) for h in hoods for b in BETAS]
    return cfgs


def target(units: Units, vmask, Y: int) -> tuple[np.ndarray, np.ndarray]:
    """Observed events of year Y (VIIRS months only) and the month mask."""
    yi = Y - Y0
    return units.X[:, yi, :][:, vmask[yi]].astype(float), vmask[yi]


def score_grid(fits: Fits, vmask, cfgs, targets) -> dict:
    """{(cfg, Y): (sum of squared errors, sum of clipped log loss, n)} at a one-year horizon."""
    out = {}
    for Y in targets:
        x, vm = target(fits.units, vmask, Y)
        for c in cfgs:
            p = fits.predict(c, Y)[:, vm]
            pc = np.clip(p, CLIP, 1 - CLIP)
            out[(c, Y)] = (
                float(((p - x) ** 2).sum()),
                float(-(x * np.log(pc) + (1 - x) * np.log(1 - pc)).sum()),
                x.size,
            )
    return out


def choose(grid: dict, cfgs, years_used, metric: int) -> Config:
    years_used = list(years_used)

    def loss(c):
        return sum(grid[(c, y)][metric] for y in years_used) / sum(grid[(c, y)][2] for y in years_used)

    return min(cfgs, key=loss)


def honest_choices(grid, cfgs, metric) -> dict:
    """{Y: settings chosen on target years INNER0..Y-1} for each reported year Y."""
    return {Y: choose(grid, cfgs, range(INNER0, Y), metric) for Y in TARGETS}


def pooled(fits: Fits, vmask, choices: dict, horizon=1) -> tuple[np.ndarray, np.ndarray]:
    """Predictions and outcomes over all reported years, flattened."""
    P, X = [], []
    for Y, cfg in choices.items():
        x, vm = target(fits.units, vmask, Y)
        P.append(fits.predict(cfg, Y, horizon)[:, vm].ravel())
        X.append(x.ravel())
    return np.concatenate(P), np.concatenate(X)


def backtest(units: Units, vmask, years, hood_names, metric: int):
    """Rolling-origin backtest; the settings for year Y are chosen on target years INNER0..Y-1 only.

    The published model uses VIIRS years only (MODIS weight 0). The same backtest with the MODIS
    years allowed in at a chosen weight is reported for comparison (see build_forecast docstring)."""
    fits = Fits(units, vmask, years)
    cfgs_all = all_configs(hood_names)
    cfgs = [c for c in cfgs_all if c.omega == 0]
    grid = score_grid(fits, vmask, cfgs_all, range(INNER0, TARGETS[-1] + 1))
    cols = {k: [] for k in ("x", "model", "history", "jeffreys", "harm", "model2", "history2")}
    per_year = []
    for Y in TARGETS:
        cfg = choose(grid, cfgs, range(INNER0, Y), metric)
        x, vm = target(units, vmask, Y)
        p = fits.predict(cfg, Y)[:, vm]
        b = fits.predict(HISTORY, Y)[:, vm]
        F = fits.get(Y - 1, HISTORY)
        jeff = ((F.a + 0.5) / (F.nw[None, :] + 1))[:, vm]  # history alone with half a pseudo-fire
        h = fits.predict(HISTORY_HARM, Y)[:, vm]
        p2 = fits.predict(cfg, Y, horizon=2)[:, vm]
        b2 = fits.predict(HISTORY, Y, horizon=2)[:, vm]
        for k, v in zip(cols, (x, p, b, jeff, h, p2, b2)):
            cols[k].append(v.ravel())
        a_m, a_b = auc(p.ravel(), x.ravel()), auc(b.ravel(), x.ravel())
        per_year.append(
            {
                "year": Y,
                "settings": cfg.label(),
                "events": int(x.sum()),
                "brier_model": round(brier(p, x), 6),
                "brier_history": round(brier(b, x), 6),
                "logloss_model": round(logloss(p, x), 5),
                "logloss_history": round(logloss(b, x), 5),
                "auc_model": None if a_m is None else round(a_m, 4),
                "auc_history": None if a_b is None else round(a_b, 4),
            }
        )
    C = {k: np.concatenate(v) for k, v in cols.items()}
    X = C["x"]
    m, b = summary(C["model"], X), summary(C["history"], X)
    oracle = choose(grid, cfgs, TARGETS, metric)
    wins = sum(r["brier_model"] < r["brier_history"] for r in per_year)
    rep = {
        "targets": [TARGETS[0], TARGETS[-1]],
        "settings_chosen_on": f"target years {INNER0}..Y-1, each trained on the years before it",
        "model": m,
        "history_alone": b,
        "brier_skill_vs_history": round(1 - m["brier"] / b["brier"], 4),
        "logloss_skill_vs_history": round(1 - m["logloss"] / b["logloss"], 4),
        "auc_gain_vs_history": round(m["auc"] - b["auc"], 4),
        "years_model_better_brier": f"{wins} of {len(per_year)}",
        "per_year": per_year,
        "other_references": {
            "history_alone_jeffreys": dict(
                summary(C["jeffreys"], X, with_reli=False),
                note="(fire years + 0.5) / (years + 1): history alone without exact 0 and 1, so its log loss is not dominated by the clip",
            ),
            "history_all_years_harmonized": dict(
                summary(C["harm"], X, with_reli=False),
                note="share of all years from 2001 with a harmonized count > 0 (MODIS years count when MODIS saw a hotspot)",
            ),
        },
        "horizon2": {
            "note": "Same settings, trained on years up to Y-2: the 2027 case.",
            "model": summary(C["model2"], X, with_reli=False),
            "history_alone": summary(C["history2"], X, with_reli=False),
            "brier_skill_vs_history": round(1 - brier(C["model2"], X) / brier(C["history2"], X), 4),
        },
        "with_modis_years": modis_comparison(fits, vmask, grid, cfgs_all, metric, X),
        "hindsight_best": {
            "note": "the single setting that would have scored best on 2018-2025 if chosen with hindsight; shows how much the honest choice gives up",
            "settings": oracle.label(),
            "brier": round(sum(grid[(oracle, y)][0] for y in TARGETS) / sum(grid[(oracle, y)][2] for y in TARGETS), 6),
        },
    }
    return rep, fits, cfgs, grid


def modis_comparison(fits: Fits, vmask, grid, cfgs_all, metric, X_ref) -> dict:
    choices = honest_choices(grid, cfgs_all, metric)
    P, X = pooled(fits, vmask, choices)
    assert np.array_equal(X, X_ref)
    d = summary(P, X, with_reli=False)
    d["settings_by_year"] = {str(Y): c.label() for Y, c in choices.items()}
    d["note"] = (
        "not published: the same model and backtest with the MODIS-era years (2001-2011; a year counts as a fire year "
        "when MODIS saw a hotspot) allowed in at a weight of 0, 0.25, 0.5 or 1, chosen the same way"
    )
    return d


# ---------------------------------------------------------------- forecast
def permille(p: np.ndarray) -> list[int]:
    return [int(v) for v in np.clip(np.rint(np.asarray(p) * 1000), 0, 1000).astype(int)]


def month_major(p_by_year: list[np.ndarray]) -> np.ndarray:
    """[unit, 12] per year -> flat month-major array: index t * n + unit, t = (year - 2026) * 12 + month - 1."""
    return np.concatenate([p.T for p in p_by_year], axis=0).ravel()


METHOD = (
    "Chance of at least one VIIRS fire hotspot in each hexagon, and in each county, in each month of 2026 and 2027. "
    "It is built from the fire history alone: how often the place burned in that calendar month, with recent years "
    "counted more, pulled toward its neighbours where its own history is thin, and with the state-wide trend where "
    "the backtest found it helped. The older MODIS years (2001-2011) are not used: MODIS misses many small fires, so "
    "a MODIS month without a hotspot does not mean the same as a VIIRS one, and the backtest found they did not help. It knows nothing about weather, fuel or ignitions, so it is a long-run chance for "
    "the month, not a warning that a given month will be unusual. Settings were chosen by a rolling backtest "
    "(predict each year from the years before it) and checked against 'history alone', the share of past VIIRS years "
    "with fire in that month. 2026 and 2027 differ only through the trend term, so where the backtest chose no trend "
    "the 2027 chances equal 2026's; 2027 is two years past the data and was backtested at that horizon. The two "
    "hexagons holding the Ivanpah solar power plant in California count as having no fire: VIIRS flags its solar "
    "towers by day in most months since 2014, which the industrial mask in data.js (spots seen mostly at night) misses."
)


def plain_text(name: str, unit: str, rep: dict) -> str:
    """One honest paragraph on how the model did against history alone."""
    m, b = rep["model"], rep["history_alone"]
    plural = {"hexagon": "hexagons", "county": "counties"}[unit]
    pct = 100 * rep["brier_skill_vs_history"]
    better = "better than" if pct > 0 else "no better than"
    auc = (
        f"It ranked {plural} by risk better (AUC {m['auc']:.3f} vs {b['auc']:.3f})"
        if m["auc"] > b["auc"] + 0.002
        else f"It ranked {plural} by risk about as well (AUC {m['auc']:.3f} vs {b['auc']:.3f})"
    )
    return (
        f"{name}, by {unit}: predicting each year 2018-2025 from the years before it, the model was {better} history alone "
        f"in {rep['years_model_better_brier']} years. Its Brier score was {m['brier']:.4f} against {b['brier']:.4f} "
        f"({abs(pct):.1f}% {'lower' if pct > 0 else 'higher'}). {auc}. Two years ahead (the 2027 case) the Brier score was "
        f"{100 * rep['horizon2']['brier_skill_vs_history']:.1f}% lower than history alone. "
        f"On average it expected {100 * m['mean_p']:.1f}% of {unit}-months to have fire; {100 * m['base_rate']:.1f}% did. "
        "Modestly better than history alone, and not a weather forecast."
        if pct > 0
        else f"{name}, by {unit}: the model was not better than history alone (Brier {m['brier']:.4f} vs {b['brier']:.4f})."
    )


def build(D: dict, metric: int = 0, log=print) -> dict:
    meta = D["meta"]
    years = np.arange(Y0, meta["y1"] + 1)
    vmask = viirs_valid(meta)
    last = meta["y1"]
    out = {
        "v": VERSION,
        "years": list(OUT_YEARS),
        "event": "at least one VIIRS hotspot in the month (vegetation fires at nominal or high confidence, static industrial sites removed, as in data.js)",
        "layout": (
            "p and county are month-major permille integers (0-1000). The value for unit u in month t is arr[t * n + u], "
            "t = (year - 2026) * 12 + (month - 1), t = 0..23. For p, n = n_hex and u is the hexagon index of "
            "BURN_DATA.states[st].hexes (rows of three); for county, n = n_county and u is the index of "
            "BURN_DATA.states[st].counties. 0 means below 0.05%. Every hexagon is included, even those with no fire history."
        ),
        "method": METHOD,
        "not_fire": {
            st: [{"name": name, "hexes": not_fire_hexes(D["states"][st], st)} for name, _ in NOT_FIRE.get(st, [])] for st in STATES
        },
        "settings_metric": ["brier", "logloss"][metric],
        "layers": {
            "any": "every fire; built by scripts/build_forecast.py",
            "large": "large fires only (CA); merged in by scripts/build_forecast.py from forecast_inputs/large.json; null until then",
        },
        "backtest": {},
    }
    for st in STATES:
        hexu, cu = state_units(D, st)
        arrays, bt = {}, {}
        for name, units, hoods in (("hex", hexu, HEX_HOODS), ("county", cu, COUNTY_HOODS)):
            rep, fits, cfgs, grid = backtest(units, vmask, years, hoods, metric)
            final = choose(grid, cfgs, range(INNER0, last + 1), metric)
            F = Fitter(units, vmask, years, last, final.half_life, final.omega)
            P = [F.predict(final, Y) for Y in OUT_YEARS]
            arrays[name] = P
            rep["final_settings"] = final.as_dict()
            rep["final_settings_label"] = final.label()
            rep["text"] = plain_text({"NY": "New York", "CA": "California"}[st], "hexagon" if name == "hex" else "county", rep)
            bt[name] = rep
            log(
                f"{st} {name}: Brier {rep['model']['brier']:.6f} vs history {rep['history_alone']['brier']:.6f} "
                f"(skill {rep['brier_skill_vs_history']:+.3f}, better in {rep['years_model_better_brier']} years), "
                f"log loss {rep['model']['logloss']:.4f} vs {rep['history_alone']['logloss']:.4f}, "
                f"AUC {rep['model']['auc']} vs {rep['history_alone']['auc']}; 2-year skill {rep['horizon2']['brier_skill_vs_history']:+.3f}; "
                f"final: {final.label()}"
            )
        # a county is at least as likely to burn as its likeliest hexagon; report how often the two models disagree
        county_of = np.asarray(D["states"][st]["hexes"], np.int64).reshape(-1, 3)[:, 2]
        viol = 0
        for Ph, Pc in zip(arrays["hex"], arrays["county"]):
            hmax = np.zeros_like(Pc)
            np.maximum.at(hmax, county_of, Ph)
            viol += int((Pc + 1e-9 < hmax).sum())
        bt["county_below_its_likeliest_hex"] = f"{viol} of {cu.n * 12 * len(OUT_YEARS)} county-months"
        out["backtest"][st] = bt
        out[st] = {
            "n_hex": hexu.n,
            "n_county": cu.n,
            "any": {"p": permille(month_major(arrays["hex"])), "county": permille(month_major(arrays["county"]))},
            "large": None,
        }
    return out


# ---------------------------------------------------------------- extra layers
def merge_layer(F: dict, st: str, name: str, layer: dict) -> None:
    """Add a layer (e.g. CA "large") to a built forecast. Checks the shape; raises ValueError if wrong.

    layer = {"p": [permille ints, month-major, 24 * n_hex], "county": [24 * n_county] or null,
             "event": str, "method": str, "backtest": {...}}  (extra keys are kept)
    """
    if st not in F:
        raise ValueError(f"unknown state {st}")
    if name == "any":
        raise ValueError('"any" is built by this script and cannot be replaced')
    S = F[st]
    n_t = 12 * len(F["years"])
    for key, n in (("p", S["n_hex"]), ("county", S["n_county"])):
        v = layer.get(key)
        if v is None and key == "county":
            continue
        if not isinstance(v, list) or len(v) != n_t * n:
            raise ValueError(f"{st}.{name}.{key}: expected a list of {n_t * n} values, got {type(v).__name__} of {len(v) if isinstance(v, list) else '-'}")
        if any((not isinstance(a, int)) or isinstance(a, bool) or a < 0 or a > 1000 for a in v):
            raise ValueError(f"{st}.{name}.{key}: values must be integers 0..1000 (permille)")
    for key in ("event", "method"):
        if not isinstance(layer.get(key), str) or not layer[key].strip():
            raise ValueError(f"{st}.{name}.{key}: a non-empty description is required")
    S[name] = layer


def merge_layers_file(F: dict, path: str) -> list[str]:
    """forecast_inputs/large.json: {"CA": {"large": {...layer...}}, ...}. Returns the layers added."""
    with open(path, encoding="utf-8") as f:
        extra = json.load(f)
    added = []
    for st, layers in extra.items():
        for name, layer in layers.items():
            merge_layer(F, st, name, layer)
            added.append(f"{st}.{name}")
    return added


def write_js(F: dict, path: str) -> int:
    body = json.dumps(F, separators=(",", ":"), ensure_ascii=False)
    text = (
        "/* Burn Calendar fire-chance forecast for 2026-2027. Generated by scripts/build_forecast.py; do not edit by hand. */\n"
        f"window.FORECAST = {body};\n"
    )
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
    return len(text.encode("utf-8"))


def load_forecast(path: str) -> dict:
    """Parse an existing forecast.js: the JSON object after "window.FORECAST =" (spaces allowed)."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"window\.FORECAST\s*=\s*", text)
    if not m:
        raise ValueError(f"{path}: no window.FORECAST assignment")
    return json.JSONDecoder().raw_decode(text, m.end())[0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.path.join(ROOT, "data.js"))
    ap.add_argument("--out", default=os.path.join(ROOT, "forecast.js"))
    ap.add_argument(
        "--large",
        default=os.path.join(ROOT, "forecast_inputs", "large.json"),
        help="extra layers to merge, e.g. CA large fires (skipped if the file does not exist)",
    )
    ap.add_argument(
        "--merge-only",
        action="store_true",
        help="do not rebuild: read the existing --out file, merge --large into it and write it back",
    )
    ap.add_argument("--metric", choices=["brier", "logloss"], default="brier", help="loss used to choose settings")
    ap.add_argument("--report", help="also write the backtest report as JSON here")
    a = ap.parse_args(argv)
    if a.merge_only:
        if not os.path.exists(a.large):
            ap.error(f"--merge-only needs a layers file; {a.large} does not exist")
        F = load_forecast(a.out)
    else:
        F = build(load_burn_data(a.data), metric=["brier", "logloss"].index(a.metric))
    if a.large and os.path.exists(a.large):
        print("merged layers:", ", ".join(merge_layers_file(F, a.large)))
    else:
        print("no extra layers file; CA.large stays null")
    size = write_js(F, a.out)
    print(f"wrote {a.out}: {size / 1e6:.2f} MB")
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(F["backtest"], f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
