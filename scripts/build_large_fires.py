#!/usr/bin/env python3
"""Build the California large-fire layer from CAL FIRE's official fire perimeters.

FIRMS hotspots carry no fire size, so "large fires only" needs mapped
perimeters. This script uses CAL FIRE FRAP's "California Fire Perimeters (all)"
layer, which is CAL FIRE's own compilation of perimeters from CAL FIRE, the US
Forest Service, BLM, the National Park Service and local agencies.

Definition
  A large fire is a perimeter in that layer with GIS_ACRES >= 1,000 and a
  year from 2001 to 2025. It belongs to the month of its ALARM_DATE (the day
  it was reported); if that is missing, the month of CONT_DATE (containment).
  Counts at 300 and 5,000 acres are reported too.

What it writes (into --out, all aligned with data.js state "CA")
  large_hex_months.json  [hexIndex, monthIndex] pairs: a large fire that
                         started in that month overlaps that 7.8 km hexagon,
                         plus per-county monthly counts and metadata.
  large_forecast.json    the chance of at least one large fire per hexagon and
                         month for 2026-2027 (permille), with a rolling
                         backtest on 2018-2025 against "history alone".

A perimeter "overlaps" a hexagon when the shared area is at least 1% of the
hexagon (about 1.6 km2, 390 acres) or the hexagon holds the largest share of
that perimeter, so tiny edge slivers do not light up neighbours.

Hexagon index k and month index i = (year-2001)*12 + (month-1) are the ones in
data.js; centres follow hexState() in src/model.ts:
  X = R*sqrt(3)*(q + r/2), Y = R*1.5*r, lon = X/K, lat = Y  (pointy-top).

Usage
  .venv/bin/python scripts/build_large_fires.py --out DIR \
      [--data-js data.js] [--cache DIR] [--refresh] [--skip-firms]

Reads the hexagons, counties and hotspot counts of California from data.js.
The FIRMS check reads build/hf/ (read-only). Needs numpy, shapely and duckdb:
  uv pip install --python .venv/bin/python numpy shapely duckdb
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union

SOURCE_LAYER = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/"
    "California_Historic_Fire_Perimeters/FeatureServer/0"
)
SOURCE_NAME = "CAL FIRE FRAP, California Fire Perimeters (all)"
SOURCE_PAGE = "https://www.fire.ca.gov/what-we-do/fire-resource-assessment-program/fire-perimeters"
USER_AGENT = "Mozilla/5.0 (compatible; burn-calendar-build/1.0)"

Y0, Y1 = 2001, 2025
NY = Y1 - Y0 + 1
NM = NY * 12
LARGE_ACRES = 1000
REPORT_ACRES = (300, 1000, 5000)
FETCH_MIN_ACRES = 300
MIN_HEX_SHARE = 0.01
REPO = Path(__file__).resolve().parent.parent
FIRMS_DIR = REPO / "build" / "hf"
CA_BBOX = (-124.6, 32.4, -114.0, 42.1)


# ---------------------------------------------------------------- download
def http_json(url: str, params: dict, tries: int = 4) -> dict:
    body = urllib.parse.urlencode(params).encode()
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            if "error" in d:
                raise RuntimeError(d["error"])
            return d
        except Exception as e:  # network hiccups: retry with back-off
            if attempt == tries - 1:
                raise
            print(f"  retry after {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise AssertionError


FIELDS = "OBJECTID,YEAR_,STATE,AGENCY,FIRE_NAME,INC_NUM,ALARM_DATE,CONT_DATE,CAUSE,OBJECTIVE,GIS_ACRES,COMPLEX_NAME"


def fetch_layer(where: str, geometry: bool, page: int) -> list[dict]:
    feats: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": FIELDS,
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": page,
            "returnGeometry": "true" if geometry else "false",
            "f": "geojson" if geometry else "json",
        }
        if geometry:
            # about 100 m of generalization: far finer than the 7.8 km hexagons
            params.update(outSR=4326, maxAllowableOffset=0.001, geometryPrecision=5)
        d = http_json(SOURCE_LAYER + "/query", params)
        got = d["features"]
        feats += got if geometry else [{"properties": f["attributes"]} for f in got]
        print(f"  {len(feats)} features", file=sys.stderr)
        more = d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")
        if not got or (not more and len(got) < page):
            break
        offset += len(got)
    return feats


def load_source(cache: Path, refresh: bool) -> tuple[list[dict], list[dict], str]:
    cache.mkdir(parents=True, exist_ok=True)
    attr_f, geo_f = cache / "perimeters_attrs.json", cache / "perimeters_geo.json"
    if refresh or not attr_f.exists() or not geo_f.exists():
        print("downloading attributes", file=sys.stderr)
        attrs = fetch_layer(f"YEAR_ >= {Y0} AND YEAR_ <= {Y1}", False, 2000)
        print("downloading perimeters", file=sys.stderr)
        geos = fetch_layer(f"YEAR_ >= {Y0} AND YEAR_ <= {Y1} AND GIS_ACRES >= {FETCH_MIN_ACRES}", True, 200)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
        attr_f.write_text(json.dumps({"retrieved": stamp, "features": attrs}))
        geo_f.write_text(json.dumps({"retrieved": stamp, "features": geos}))
    a, g = json.loads(attr_f.read_text()), json.loads(geo_f.read_text())
    return a["features"], g["features"], a["retrieved"]


# ---------------------------------------------------------------- fires
def ms_to_date(ms) -> dt.date | None:
    if ms is None:
        return None
    return (dt.datetime(1970, 1, 1) + dt.timedelta(milliseconds=ms)).date()


def fire_start(p: dict) -> tuple[dt.date | None, str]:
    """(start date, which field). The month index comes from this date."""
    a, c = ms_to_date(p.get("ALARM_DATE")), ms_to_date(p.get("CONT_DATE"))
    if a and Y0 <= a.year <= Y1:
        return a, "alarm"
    if c and Y0 <= c.year <= Y1:
        return c, "containment"
    return None, "none"


def clean_geom(gj: dict):
    """a valid (Multi)Polygon from GeoJSON; generalization can leave rings collapsed to lines"""
    polys = [gj["coordinates"]] if gj["type"] == "Polygon" else gj["coordinates"]
    parts = []
    for rings in polys:
        rings = [r for r in rings if len(r) >= 4]
        if not rings:
            continue
        try:
            g = shapely.make_valid(Polygon(rings[0], rings[1:]))
        except shapely.errors.GEOSException:
            g = Polygon(rings[0]).buffer(0)
        parts += [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon") and not p.is_empty]
    return unary_union(parts) if parts else None


def dedupe_key(p: dict) -> tuple:
    return (p.get("YEAR_"), (p.get("FIRE_NAME") or "").strip().upper(), p.get("ALARM_DATE"), round(p.get("GIS_ACRES") or 0))


# ---------------------------------------------------------------- hexagons
class Grid:
    def __init__(self, st: dict):
        h = np.asarray(st["hexes"], dtype=np.int64).reshape(-1, 3)
        self.q, self.r, self.c = h[:, 0], h[:, 1], h[:, 2]
        self.n = len(h)
        self.R, self.K = float(st["hex_r"]), float(st["hex_k"])
        s3 = math.sqrt(3)
        self.X = self.R * s3 * (self.q + self.r / 2)
        self.Y = self.R * 1.5 * self.r
        self.lon, self.lat = self.X / self.K, self.Y
        ang = np.radians(30 + 60 * np.arange(6))
        self.ox, self.oy = self.R * np.cos(ang), self.R * np.sin(ang)
        # hexagons in map space (x = lon*K, y = lat), the space the page draws in
        self.polys = np.array([Polygon(list(zip(x + self.ox, y + self.oy))) for x, y in zip(self.X, self.Y)])
        self.area = 1.5 * math.sqrt(3) * self.R**2
        self.tree = shapely.STRtree(self.polys)
        self.key = {(int(a), int(b)): k for k, (a, b) in enumerate(zip(self.q, self.r))}

    def to_map(self, g):
        K = self.K
        return shapely.transform(g, lambda xy: np.column_stack([xy[:, 0] * K, xy[:, 1]]))

    def km2_per_unit(self) -> float:
        # one map-space square unit (degree of latitude squared) in km2
        return 110.95**2

    def hex_of(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """axial rounding of points to hexagon index, -1 outside the state's hexagons"""
        x, y = lon * self.K, lat
        rf = y / (1.5 * self.R)
        qf = x / (self.R * math.sqrt(3)) - rf / 2
        sf = -qf - rf
        q, r, s = np.round(qf), np.round(rf), np.round(sf)
        dq, dr, ds = abs(q - qf), abs(r - rf), abs(s - sf)
        fq = (dq > dr) & (dq > ds)
        fr = ~fq & (dr > ds)
        q = np.where(fq, -r - s, q)
        r = np.where(fr, -q - s, r)
        out = np.full(len(lon), -1, dtype=np.int64)
        for j, (a, b) in enumerate(zip(q.astype(int), r.astype(int))):
            out[j] = self.key.get((a, b), -1)
        return out

    def neighbours(self, rings: int) -> list[np.ndarray]:
        """for each hexagon, the indices within `rings` steps and their hex distances"""
        out = []
        for k in range(self.n):
            dq, dr = self.q - self.q[k], self.r - self.r[k]
            d = (abs(dq) + abs(dr) + abs(dq + dr)) // 2
            j = np.nonzero(d <= rings)[0]
            out.append(np.stack([j, d[j]]))
        return out


def overlap_hexes(grid: Grid, g_map) -> list[tuple[int, float]]:
    """(hexIndex, share of hexagon covered) for the hexagons a perimeter counts in"""
    idx = grid.tree.query(g_map, predicate="intersects")
    if len(idx) == 0:
        return []
    a = shapely.area(shapely.intersection(grid.polys[idx], g_map)) / grid.area
    keep = a >= MIN_HEX_SHARE
    keep[np.argmax(a)] |= a.max() > 0
    return [(int(k), float(s)) for k, s, ok in zip(idx, a, keep) if ok]


# ---------------------------------------------------------------- counties
def county_shapes(st: dict, grid: Grid) -> list:
    by_fips = {g["f"]: g for g in st["geo"]}
    shapes = []
    for c in st["counties"]:
        g = by_fips.get(c["fips"])
        polys = []
        for ring in g["r"] if g else []:
            xy = np.asarray(ring, dtype=float).reshape(-1, 2)
            if len(xy) >= 3:
                p = shapely.make_valid(Polygon(xy))
                polys.append(p)
        shapes.append(grid.to_map(unary_union(polys)) if polys else None)
    return shapes


# ---------------------------------------------------------------- FIRMS check
def firms_points(grid: Grid) -> dict:
    import duckdb

    w, s, e, n = CA_BBOX
    out = {}
    specs = {
        "modis": ("modis", "confidence >= 30", range(Y0, Y1 + 1)),
        "viirs": ("viirs-snpp", "confidence IN ('n', 'h')", range(2012, Y1 + 1)),
    }
    for name, (folder, conf, years) in specs.items():
        files = [str(p) for y in years for p in sorted((FIRMS_DIR / folder / str(y)).glob("*_United_States.parquet"))]
        if not files:
            continue
        q = f"""select longitude, latitude, acq_date::DATE as d, satellite
                from read_parquet({files!r}, union_by_name=true)
                where type = 0 and {conf}
                  and longitude between {w} and {e} and latitude between {s} and {n}"""
        df = duckdb.sql(q).fetchnumpy()
        lon, lat = np.asarray(df["longitude"], float), np.asarray(df["latitude"], float)
        k = grid.hex_of(lon, lat)
        m = k >= 0
        d = np.asarray(df["d"]).astype("datetime64[D]")[m]
        out[name] = {"lon": lon[m], "lat": lat[m], "hex": k[m], "date": d, "sat": np.asarray(df["satellite"])[m]}
        print(f"  {name}: {m.sum()} hotspots in CA hexagons", file=sys.stderr)
    return out


def firms_check(grid: Grid, st: dict, pts: dict, fires: list[dict]) -> dict:
    """share of hotspots inside a large-fire perimeter, and a hex-assignment check against data.js"""
    res: dict = {}
    geoms = np.array([f["geom"] for f in fires])
    tree = shapely.STRtree(geoms)
    lo = np.array([np.datetime64(f["start"]) - np.timedelta64(1, "D") for f in fires])
    end = []
    for f in fires:
        c = f["cont"]
        end.append(np.datetime64(c) + np.timedelta64(1, "D") if c and c >= f["start"] else np.datetime64(f["start"]) + np.timedelta64(90, "D"))
    hi = np.array(end)
    years = np.array([f["start"].year for f in fires])
    for name, p in pts.items():
        P = shapely.points(p["lon"], p["lat"])
        pi, fi = tree.query(P, predicate="within")
        d = p["date"]
        in_window = (d[pi] >= lo[fi]) & (d[pi] <= hi[fi])
        same_year = d[pi].astype("datetime64[Y]").astype(int) + 1970 == years[fi]
        n = len(P)
        hit_w = np.zeros(n, bool)
        hit_w[pi[in_window]] = True
        hit_y = np.zeros(n, bool)
        hit_y[pi[same_year]] = True
        yr = d.astype("datetime64[Y]").astype(int) + 1970
        res[name] = {
            "hotspots": int(n),
            "inside_during_fire": int(hit_w.sum()),
            "share_inside_during_fire": round(float(hit_w.mean()), 4),
            "share_inside_same_year": round(float(hit_y.mean()), 4),
            "by_year_share_inside_during_fire": {int(y): round(float(hit_w[yr == y].mean()), 4) for y in np.unique(yr)},
            "note": "inside a >=1,000 acre perimeter, between the day before alarm and the day after containment (alarm + 90 days if no containment date)",
        }
    # hexagon assignment check: VIIRS monthly counts per hexagon vs data.js hex_rows
    if "viirs" in pts:
        p = pts["viirs"]
        mi = (p["date"].astype("datetime64[M]").astype(int) - (Y0 - 1970) * 12)
        mine = np.zeros((grid.n, NM))
        np.add.at(mine, (p["hex"], mi), 1)
        rows = np.asarray(st["hex_rows"], dtype=np.int64).reshape(-1, 5)
        ref = np.zeros((grid.n, NM))
        ref[rows[:, 0], rows[:, 1]] = rows[:, 4]
        sel = np.arange(NM) >= (2012 - Y0) * 12 + 1
        a, b = mine[:, sel], ref[:, sel]
        res["hex_assignment_check"] = {
            "viirs_total_this_script": int(a.sum()),
            "viirs_total_data_js": int(b.sum()),
            "hex_months_equal_share": round(float((a == b).mean()), 5),
            "hex_months_with_fire_equal_share": round(float((a == b)[(a + b) > 0].mean()), 4),
            "hex_months_where_this_script_counts_fewer": int((a < b).sum()),
            "note": "data.js also removes industrial heat sources, so this script can only count more, never fewer, if hexagons are assigned the same way",
        }
    return res


# ---------------------------------------------------------------- forecast
def harmonized_counts(st: dict, key: str, n: int) -> np.ndarray:
    """harmonized monthly hotspots (VIIRS terms) per unit from data.js hex_rows or county_rows"""
    rows = np.asarray(st[key], dtype=float).reshape(-1, 5)
    meta = st["meta"]
    vi0 = (meta["viirs_from"][0] - Y0) * 12 + meta["viirs_from"][1] - 1
    aq0 = (meta["aqua_from"][0] - Y0) * 12 + meta["aqua_from"][1] - 1
    i = rows[:, 1].astype(int)
    m = i % 12
    rt, rta = np.asarray(st["r_t"]), np.asarray(st["r_ta"])
    h = np.where(i >= vi0, rows[:, 4], np.where(i < aq0, rows[:, 2] * rt[m], (rows[:, 2] + rows[:, 3]) * rta[m]))
    H = np.zeros((n, NM))
    H[rows[:, 0].astype(int), i] = h
    return H


class Features:
    """everything a forecast made at the end of year T may use: years 2001..T only"""

    NAMES = [
        "log unit x calendar-month large-fire rate (smoothed)",
        "log unit any-month large-fire rate (smoothed)",
        "log recency-weighted unit large-fire rate (half-life 5 y, smoothed)",
        "log state calendar-month large-fire rate",
        "log unit x calendar-month FIRMS hotspots (harmonized, smoothed)",
        "large fire in unit in last 3 years",
        "large fire in unit 4-10 years ago",
    ]

    def __init__(self, L: np.ndarray, H: np.ndarray, S: np.ndarray):
        """L, H: [unit, month index]; S: row-normalized spatial smoothing between units"""
        self.L = L.reshape(L.shape[0], NY, 12)
        self.H = H.reshape(H.shape[0], NY, 12)
        self.S = S
        mw = np.zeros((12, 12))
        for m in range(12):
            mw[m, m] = 1
            mw[m, (m - 1) % 12] = mw[m, (m + 1) % 12] = 0.5
        self.mw = mw / mw.sum(1, keepdims=True)

    def at(self, T: int) -> np.ndarray:
        """features [hex, month, f] for a forecast made with years 2001..T"""
        ny = T - Y0 + 1
        L, H = self.L[:, :ny], self.H[:, :ny]
        eps = 1e-4
        cm = L.mean(1) @ self.mw.T  # hex x calendar month, +-1 month window
        f1 = np.log(self.S @ cm + eps)
        anym = L.max(2).mean(1)
        f2 = np.log(self.S @ anym + eps)
        w = 0.5 ** ((ny - 1 - np.arange(ny)) / 5.0)
        rec = (L.max(2) * w).sum(1) / w.sum()
        f3 = np.log(self.S @ rec + eps)
        f4 = np.log(L.mean((0, 1)) + eps)
        hcm = np.log1p(H.mean(1)) @ self.mw.T
        f5 = self.S @ hcm
        last3 = L[:, max(0, ny - 3):].max((1, 2))
        older = L[:, max(0, ny - 10):max(0, ny - 3)].max((1, 2)) if ny > 3 else np.zeros(L.shape[0])
        n = L.shape[0]
        F = np.stack(
            [f1, np.repeat(f2[:, None], 12, 1), np.repeat(f3[:, None], 12, 1), np.repeat(f4[None, :], n, 0), f5,
             np.repeat(last3[:, None], 12, 1).astype(float), np.repeat(older[:, None], 12, 1).astype(float)],
            axis=2,
        )
        return F


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 30):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    b = np.zeros(Z.shape[1])
    b[0] = math.log((y.mean() + 1e-6) / (1 - y.mean() + 1e-6))
    P = np.eye(Z.shape[1]) * l2
    P[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Z @ b)))
        g = Z.T @ (p - y) + P @ b
        Hs = (Z * (p * (1 - p))[:, None]).T @ Z + P
        step = np.linalg.solve(Hs, g)
        b -= step
        if np.abs(step).max() < 1e-7:
            break
    return {"b": b, "mu": mu, "sd": sd}


def predict(model, X: np.ndarray) -> np.ndarray:
    Z = np.column_stack([np.ones(len(X)), (X - model["mu"]) / model["sd"]])
    return 1 / (1 + np.exp(-(Z @ model["b"])))


def auc(p: np.ndarray, y: np.ndarray) -> float:
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p))
    ps = p[order]
    # average ranks for ties
    i = 0
    r = np.arange(1, len(p) + 1, dtype=float)
    while i < len(ps):
        j = i
        while j + 1 < len(ps) and ps[j + 1] == ps[i]:
            j += 1
        r[i:j + 1] = (i + j + 2) / 2
        i = j + 1
    ranks[order] = r
    npos = y.sum()
    nneg = len(y) - npos
    return float((ranks[y == 1].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def scores(p: np.ndarray, y: np.ndarray, years: np.ndarray, floor: float) -> dict:
    q = np.clip(p, floor, 1 - floor)
    out = {
        "brier": float(np.mean((p - y) ** 2)),
        "log_loss": float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))),
        "auc": auc(p, y),
    }
    caps = {}
    for frac in (0.01, 0.05, 0.10):
        hit = 0
        for Y in np.unique(years):
            s = years == Y
            k = max(1, int(round(frac * s.sum())))
            top = np.argsort(-p[s], kind="mergesort")[:k]
            hit += y[s][top].sum()
        caps[f"top_{int(frac * 100)}pct"] = round(float(hit / max(1, y.sum())), 4)
    out["share_of_events_in_top_risk"] = caps
    out["expected_vs_observed_by_year"] = {
        int(Y): [round(float(p[years == Y].sum()), 1), int(y[years == Y].sum())] for Y in np.unique(years)
    }
    return out


def reliability(p: np.ndarray, y: np.ndarray) -> list:
    edges = [0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0001]
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        s = (p >= a) & (p < b)
        if s.sum():
            out.append({"pred_range": [a, round(min(b, 1), 3)], "n": int(s.sum()), "mean_pred": round(float(p[s].mean()), 5), "observed": round(float(y[s].mean()), 5)})
    return out


def hex_smoother(grid: Grid, rings: int = 2, sigma: float = 1.0) -> np.ndarray:
    W = np.zeros((grid.n, grid.n), dtype=np.float32)
    for k, (j, d) in enumerate(grid.neighbours(rings)):
        W[k, j] = np.exp(-(d**2) / (2 * sigma**2))
    return W / W.sum(1, keepdims=True)


def forecast(L: np.ndarray, H: np.ndarray, S: np.ndarray) -> dict:
    n = L.shape[0]
    feats = Features(L, H, S)
    Ly = L.reshape(n, NY, 12)
    cache: dict[int, np.ndarray] = {}

    def F(T):
        if T not in cache:
            cache[T] = feats.at(T)
        return cache[T]

    def rows(origins, h):
        X = np.concatenate([F(T).reshape(-1, F(T).shape[2]) for T in origins])
        y = np.concatenate([Ly[:, T + h - Y0].reshape(-1) for T in origins])
        return X, y.astype(float)

    def history(T):  # "history alone": share of years 2001..T with a large fire in this hex and calendar month
        return Ly[:, : T - Y0 + 1].mean(1)

    def climatology(T):
        return np.repeat(Ly[:, : T - Y0 + 1].mean((0, 1))[None, :], n, 0)

    first_origin = 2005  # the first features need a few years of record
    bt: dict = {}
    for h in (1, 2):
        P, B, C, Yt, yrs = [], [], [], [], []
        for Y in range(2018, Y1 + 1):
            T = Y - h  # the forecast is made with data through T
            train = list(range(first_origin, T - h + 1))  # targets T' + h <= T
            X, y = rows(train, h)
            mdl = fit_logistic(X, y)
            P.append(predict(mdl, F(T).reshape(-1, X.shape[1])))
            B.append(history(T).reshape(-1))
            C.append(climatology(T).reshape(-1))
            Yt.append(Ly[:, Y - Y0].reshape(-1).astype(float))
            yrs.append(np.full(n * 12, Y))
        P, B, C, Yt, yrs = map(np.concatenate, (P, B, C, Yt, yrs))
        floor = 0.5 / (2018 - h - Y0 + 2)  # half an event over the shortest training record, so history-alone zeros are scoreable
        sm, sb, sc = scores(P, Yt, yrs, floor), scores(B, Yt, yrs, floor), scores(C, Yt, yrs, floor)
        bt[f"horizon_{h}y"] = {
            "test_years": [2018, Y1],
            "unit_months": int(len(Yt)),
            "events": int(Yt.sum()),
            "model": sm,
            "history_alone": sb,
            "state_seasonal_average": sc,
            "brier_skill_vs_history_alone": round(1 - sm["brier"] / sb["brier"], 4),
            "brier_skill_vs_state_seasonal_average": round(1 - sm["brier"] / sc["brier"], 4),
            "log_loss_floor": floor,
            "reliability_model": reliability(P, Yt),
            "reliability_history_alone": reliability(B, Yt),
        }
    # final fits with every year through 2025: 2026 is one year ahead, 2027 two
    out = np.zeros((n, 24))
    coefs = {}
    for h in (1, 2):
        X, y = rows(list(range(first_origin, Y1 - h + 1)), h)
        mdl = fit_logistic(X, y)
        out[:, (h - 1) * 12:h * 12] = predict(mdl, F(Y1).reshape(-1, X.shape[1])).reshape(n, 12)
        coefs[f"horizon_{h}y"] = {"intercept": round(float(mdl["b"][0]), 4), **{nm: round(float(c), 4) for nm, c in zip(Features.NAMES, mdl["b"][1:])}}
    hist = history(Y1)
    return {"p": out, "history": np.concatenate([hist, hist], 1), "backtest": bt, "coefficients_standardized": coefs}


# ---------------------------------------------------------------- main
def load_state(path: Path) -> dict:
    """California's block of window.BURN_DATA, plus the shared meta and county outlines"""
    text = path.read_text()
    body = text[text.index("{"): text.rindex("}") + 1]
    d = json.loads(body)
    return {**d["states"]["CA"], "meta": d["meta"], "geo": d["geo"]["CA"]}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-js", type=Path, default=REPO / "data.js")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--cache", type=Path, default=None, help="where the downloaded perimeters are kept (default: OUT/cache)")
    ap.add_argument("--refresh", action="store_true", help="download the perimeters again")
    ap.add_argument("--skip-firms", action="store_true", help="skip the FIRMS hotspot check")
    a = ap.parse_args()
    st = load_state(a.data_js)
    a.out.mkdir(parents=True, exist_ok=True)
    attrs, geos, retrieved = load_source(a.cache or a.out / "cache", a.refresh)
    grid = Grid(st)

    # ---- fire list with geometry, deduplicated, CA hexagons attached
    seen = set()
    fires, dupes, no_date, empty = [], 0, 0, 0
    for f in geos:
        p = f["properties"]
        if dedupe_key(p) in seen:
            dupes += 1
            continue
        seen.add(dedupe_key(p))
        start, src = fire_start(p)
        if start is None:
            no_date += 1
            continue
        g = clean_geom(f["geometry"]) if f.get("geometry") else None
        if g is None:
            empty += 1
            continue
        gm = grid.to_map(g)
        hexes = overlap_hexes(grid, gm)
        fires.append({
            "id": p["OBJECTID"], "name": (p.get("FIRE_NAME") or "").strip(), "year": p["YEAR_"], "state": p.get("STATE"),
            "acres": float(p.get("GIS_ACRES") or 0), "start": start, "date_from": src, "cont": ms_to_date(p.get("CONT_DATE")),
            "geom": g, "gmap": gm, "hexes": hexes, "month": (start.year - Y0) * 12 + start.month - 1,
        })
    in_ca = [f for f in fires if f["hexes"]]
    large = [f for f in in_ca if f["acres"] >= LARGE_ACRES]

    # threshold counts: every perimeter (attributes), and the ones that overlap a CA hexagon
    seen_a, acres_all = set(), []
    for f in attrs:
        p = f["properties"]
        if dedupe_key(p) not in seen_a:
            seen_a.add(dedupe_key(p))
            acres_all.append(p.get("GIS_ACRES") or 0)
    acres_all = np.asarray(acres_all, float)
    thresholds = {
        str(t): {
            "perimeters_2001_2025": int((acres_all >= t).sum()),
            "overlapping_ca_hexagons_with_start_date": int(sum(f["acres"] >= t for f in in_ca)),
            "hex_months_flagged": len({(k, f["month"]) for f in in_ca if f["acres"] >= t for k, _ in f["hexes"]}),
        }
        for t in REPORT_ACRES
    }

    # ---- hex x month pairs
    pairs = sorted({(k, f["month"]) for f in large for k, _ in f["hexes"]})
    L = np.zeros((grid.n, NM), dtype=np.uint8)
    for k, i in pairs:
        L[k, i] = 1

    # ---- counties: a fire counts in a county when >= 1% of its area, or its largest share, is there
    cshapes = county_shapes(st, grid)
    ctree = shapely.STRtree([c if c is not None else Polygon() for c in cshapes])
    county_rows: dict[tuple[int, int], list] = {}
    for f in large:
        idx = ctree.query(f["gmap"], predicate="intersects")
        if len(idx) == 0:
            continue
        ar = shapely.area(shapely.intersection(np.array(cshapes, dtype=object)[idx], f["gmap"]))
        tot = max(shapely.area(f["gmap"]), 1e-12)
        share = ar / tot
        keep = share >= 0.01
        keep[np.argmax(share)] = True
        for ci, s, ok in zip(idx, share, keep):
            if ok:
                r = county_rows.setdefault((int(ci), f["month"]), [0, 0.0])
                r[0] += 1
                r[1] += f["acres"] * float(s)
    crow = [[ci, i, v[0], int(round(v[1]))] for (ci, i), v in sorted(county_rows.items())]

    # ---- FIRMS sanity check
    check = {}
    if not a.skip_firms:
        print("reading FIRMS hotspots", file=sys.stderr)
        pts = firms_points(grid)
        check = firms_check(grid, st, pts, large)

    by_year = {y: sum(1 for f in large if f["start"].year == y) for y in range(Y0, Y1 + 1)}
    meta = {
        "source": SOURCE_NAME,
        "source_url": SOURCE_LAYER,
        "source_page": SOURCE_PAGE,
        "credit": "Fire perimeters: CAL FIRE Fire and Resource Assessment Program (FRAP), with USDA Forest Service Region 5, BLM, NPS, USFWS and local agencies.",
        "retrieved": retrieved,
        "definition": f"A large fire is a CAL FIRE FRAP perimeter of at least {LARGE_ACRES:,} acres (GIS_ACRES, the mapped area, including any part outside California), years {Y0}-{Y1}, dated by the month of ALARM_DATE, or of CONT_DATE when the alarm date is missing.",
        "hex_rule": f"A hexagon is marked for a month when a large fire that started that month covers at least {MIN_HEX_SHARE:.0%} of it (about 1.6 km2) or the hexagon holds that fire's largest share.",
        "county_rule": "A fire counts in a county when at least 1% of its mapped area is in that county, or the county holds its largest share. A fire crossing counties counts once in each, so county totals add up to more than the state total. acres_in_county is GIS_ACRES times that share.",
        "limits": [
            "FRAP is incomplete: some perimeters are missing, duplicated or over-generalized (CAL FIRE's own caveat).",
            "A perimeter is the final outline; the month is when the fire started, though large fires can burn into the next month.",
            "Unburned islands inside a perimeter are counted as burned.",
            "The layer includes some fires mapped across the Oregon and Nevada lines; they count wherever they reach a California hexagon.",
            "Perimeters with no alarm or containment date in 2001-2025 cannot be placed in a month and are left out (see perimeters_dropped).",
        ],
        "thresholds_acres": thresholds,
        "large_fires": len(large),
        "large_fires_by_start_year": by_year,
        "large_fires_dated_by_containment": sum(1 for f in large if f["date_from"] == "containment"),
        "perimeters_dropped": {"duplicates": dupes, "no_usable_date": no_date, "no_geometry": empty},
        "hex_months": len(pairs),
        "hexagons_ever_marked": int((L.max(1) > 0).sum()),
        "hexagons": grid.n,
        "month_index": "i = (year-2001)*12 + (month-1)",
        "hex_index": "position in data.js states.CA.hexes (rows of q, r, county)",
        "firms_check": check,
    }
    top = sorted(large, key=lambda f: -f["acres"])[:25]
    payload = {
        "meta": meta,
        "pairs": [v for pr in pairs for v in pr],
        "county_rows": [v for r in crow for v in r],
        "county_rows_layout": "flat rows of four: county index (data.js states.CA.counties), month index, large fires, acres in county",
        "fires": [[f["name"], f["month"], int(round(f["acres"])), f["start"].isoformat()] for f in sorted(large, key=lambda f: (f["month"], -f["acres"]))],
        "fires_layout": "[name, month index, GIS acres, start date] for every large fire, by month then size",
    }
    (a.out / "large_hex_months.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote large_hex_months.json: {len(pairs)} hex-months, {len(large)} fires", file=sys.stderr)

    # ---- forecast
    print("forecasting", file=sys.stderr)
    nc = len(st["counties"])
    Lc = np.zeros((nc, NM))
    for ci, i in county_rows:
        Lc[ci, i] = 1
    fc_hex = forecast(L.astype(float), harmonized_counts(st, "hex_rows", grid.n), hex_smoother(grid))
    fc_cty = forecast(Lc, harmonized_counts(st, "county_rows", nc), np.eye(nc))

    def month_major(x: np.ndarray) -> list[int]:  # [unit, 24] -> arr[t * n + u], permille
        return np.rint(x * 1000).astype(int).T.reshape(-1).tolist()

    def summary(fc: dict) -> dict:
        return {"coefficients_standardized": fc["coefficients_standardized"], "backtest": fc["backtest"]}

    fmeta = {
        "what": "Chance of at least one large fire (>= 1,000 acres, CAL FIRE FRAP perimeter) that starts in the month and reaches the hexagon (p) or the county (county), California, January 2026 to December 2027.",
        "is_forecast": "A statistical outlook from fire history alone: no weather, fuel moisture or ignitions. It cannot know whether 2026 or 2027 will be a big fire year; its value is in ranking places and months. The backtest shows it barely beats the state's seasonal average on Brier score and ranks places far better than history alone.",
        "years": [2026, 2027],
        "months": [f"{y}-{m:02d}" for y in (2026, 2027) for m in range(1, 13)],
        "units": "permille integers (0-1000); 0 means below 0.5 per thousand (0.05%)",
        "layout": "Month-major. The value for unit u in month t is arr[t * n + u], t = (year - 2026) * 12 + (month - 1), t = 0..23. p and history: n = number of hexagons and u is the index in BURN_DATA.states.CA.hexes (rows of three). county and county_history: n = number of counties and u is the index in BURN_DATA.states.CA.counties. history arrays are the 'history alone' baseline: the share of 2001-2025 with a large fire in that unit and calendar month, the same for both years.",
        "n_hex": grid.n,
        "n_county": nc,
        "method": "Logistic regression on features computed only from years up to the forecast origin: the unit x calendar-month large-fire rate (+-1 month window; for hexagons also a Gaussian average over 2 rings of neighbours), the unit's any-month rate, a recency-weighted rate (half-life 5 years), the state seasonal rate, the unit's harmonized FIRMS hotspot history, and whether the unit had a large fire in the last 3 or 4-10 years. Separate fits for one year ahead (2026) and two years ahead (2027), trained on forecast origins 2005 onward. Hexagons and counties are fitted separately.",
        "features": Features.NAMES,
        "backtest_design": "Rolling origin. Each test year Y in 2018-2025 is forecast with data through Y-1 (horizon 1) or Y-2 (horizon 2), refitting the model each time on outcomes known by then. Baselines get the same data. 'history_alone': share of years 2001..origin with a large fire in that unit and calendar month. 'state_seasonal_average': the average over all units for that calendar month. Log loss clips every forecast to [floor, 1-floor] so history-alone zeros can be scored. top_N_pct: share of the test year's large-fire unit-months that fell in that year's N% highest forecasts. expected_vs_observed_by_year: [sum of forecasts, actual count].",
        "hex": summary(fc_hex),
        "county": summary(fc_cty),
        "source": SOURCE_NAME,
        "source_url": SOURCE_LAYER,
        "credit": meta["credit"],
    }
    body = {
        "meta": fmeta,
        "p": month_major(fc_hex["p"]),
        "history": month_major(fc_hex["history"]),
        "county": month_major(fc_cty["p"]),
        "county_history": month_major(fc_cty["history"]),
    }
    (a.out / "large_forecast.json").write_text(json.dumps(body, separators=(",", ":")))
    for name, fc in (("hex", fc_hex), ("county", fc_cty)):
        for h in ("horizon_1y", "horizon_2y"):
            b = fc["backtest"][h]
            print(
                f"{name} {h}: brier model {b['model']['brier']:.5f} history {b['history_alone']['brier']:.5f} "
                f"seasonal {b['state_seasonal_average']['brier']:.5f}; auc {b['model']['auc']:.3f} / "
                f"{b['history_alone']['auc']:.3f} / {b['state_seasonal_average']['auc']:.3f}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
