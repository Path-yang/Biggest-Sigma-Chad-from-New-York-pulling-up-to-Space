#!/usr/bin/env python3
"""Build response.js: road drive times from every hexagon to its closest fire stations.

For New York and California this script reads the OpenStreetMap road network,
finds the three fire and EMS stations with the shortest drive to the centre of
every state hexagon (the 0.05 / 0.07 degree hexagons in data.js), the closest
station by road for every 2 km hexagon, and fits a simple rule for estimating
drive time between any two points from their straight-line distance. It writes
response.js (window.RESPONSE) beside data.js, with arrays in data.js order.

Method:

  * Roads: the Geofabrik extract of each state (OpenStreetMap, ODbL), one state
    at a time; the download is deleted after it is read unless --keep-pbf.
    Kept: ways whose highway= is in SPEED_KMH below. Dropped: anything tagged
    access=no, motor_vehicle=no or motorcar=no unless emergency=yes/designated;
    service=parking_aisle/driveway/drive-through; area=yes; tracks of grade 4
    or 5. Private roads are kept, since engines are let through gates.
  * Speeds: the class default in SPEED_KMH. Where maxspeed= is tagged (and the
    class is not service, track or living_street) it is used instead, times
    0.9 on motorway and trunk roads and 0.8 elsewhere for bends, junctions and
    signals. Every speed is capped at CAP_KMH, a common governor setting for
    fire apparatus. There is no traffic, no signal delay, no turn penalty and
    no turnout time, but the speeds sit below posted limits. On the same road
    distance these times came out a median 17% (NY) and 33% (CA) longer than
    the NFPA/RAND travel formula (0.65 + 1.7 x miles). They are estimates of
    driving time, not measured response times, and not a bound either way.
  * One-way: honoured on motorway and trunk roads and their ramps (implied on
    motorways), where carriageways are physically divided. Ignored on every
    other road, because an engine running with lights may go against a one-way
    street for a short way.
  * Graph: a vertex at every junction, every way end and at least every
    VERTEX_STEP_KM along a way, so that a point can snap to a road nearby.
    Pieces of network with fewer than MIN_COMPONENT vertices (car parks, broken
    fragments) are dropped. Points snap to the nearest vertex that touches a
    road other than a motorway or its ramps.
  * Off-road legs: the straight line from a hexagon centre to its snapped vertex
    and from a station to its snapped vertex are added at ACCESS_KMH. Snap
    distances are written out so the page can flag hexagons far from any road.
    A point more than SNAP_MAX_KM from any kept road (open water, islands with
    no joined road network, deep wilderness) gets no drive time at all.
  * Search: Dijkstra (scipy.sparse.csgraph) on the reversed graph from each
    hexagon's vertex, which gives the drive from every station to that hexagon.
    The search widens (20, 60, 180 minutes, then unlimited) until 3 stations
    are reached, so the 3 found are exact, not drawn from a shortlist.
    2 km hexagons use one search from all stations at once (a virtual source
    joined to every station's vertex by its off-road time).
  * Calibration: from a random sample of state hexagons, drive times to every
    station and every other state hexagon reached within 180 minutes. Per
    straight-line distance band: median effective speed (straight km per hour
    of drive, forced to rise with distance) and median detour factor (route km
    / straight km). Each hexagon also gets local extra minutes: how much longer
    (or shorter) the drives to its 3 closest stations took than the band speeds
    predict, averaged and shrunk toward 0. The estimate between two points is
    straight km / band speed + the extra minutes of each end that is a
    hexagon centre (0 for a station), never faster than FLOOR_KMH in a
    straight line. Fitted on half the sampled hexagons and scored on the other
    half against one speed for all distances and against bands alone; then
    refitted on all of them. Multiplicative local factors were tried and did
    worse on the held-out half.

Stations sit only inside each state, so hexagons near a state line may have a
closer station across it that is not counted. Roads are clipped at the
state extract's edge in the same way.

Usage:
    .venv/bin/python scripts/build_response.py [--states NY CA] [--work DIR]
        [--keep-pbf] [--calib-sources 300] [--out response.js] [--npz DIR]

Needs numpy, scipy and osmium (pyosmium). Writes response.js in the repo root.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sys
import tempfile
import time
import urllib.request
from array import array
from pathlib import Path

import numpy as np
import osmium
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
GEOFABRIK = "https://download.geofabrik.de/north-america/us/{}-latest.osm.pbf"
REGION = {"NY": "new-york", "CA": "california"}
USER_AGENT = "burn-calendar-build/1.0 (static site build script)"
VERSION = 1

# Free-flow speed in km/h by OSM highway class when maxspeed is not tagged.
SPEED_KMH = {
    "motorway": 95, "motorway_link": 55,
    "trunk": 80, "trunk_link": 50,
    "primary": 60, "primary_link": 45,
    "secondary": 50, "secondary_link": 40,
    "tertiary": 45, "tertiary_link": 35,
    "unclassified": 40, "residential": 30, "road": 25,
    "living_street": 10, "service": 15, "track": 15,
}
CLASSES = list(SPEED_KMH)
DIVIDED = {"motorway", "motorway_link", "trunk", "trunk_link"}
NO_SNAP = {"motorway", "motorway_link"}
NO_MAXSPEED = {"service", "track", "living_street"}
SKIP_SERVICE = {"parking_aisle", "driveway", "drive-through"}
CAP_KMH = 105.0
ACCESS_KMH = 20.0
VERTEX_STEP_KM = 0.5
MIN_COMPONENT = 200
SNAP_MAX_KM = 10.0
FLOOR_KMH = 110.0  # an estimate is never faster than this straight-line speed
NO_EXTRA = -9999  # e10 value of a hexagon with no station reachable
SEARCH_LIMITS_MIN = (20.0, 60.0, 180.0, np.inf)
CALIB_LIMIT_MIN = 180.0
CALIB_BANDS_KM = [0, 2, 5, 10, 20, 40, 80, 160]
EARTH_KM = 6371.0088
S3 = math.sqrt(3)


# ---------------------------------------------------------------- geometry
def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.minimum(1.0, a)))


def ecef_km(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]) * EARTH_KM


def chord_to_arc_km(c):
    return 2 * EARTH_KM * np.arcsin(np.minimum(1.0, np.asarray(c) / (2 * EARTH_KM)))


# ---------------------------------------------------------------- data.js
def load_burn_data():
    text = (ROOT / "data.js").read_text()
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def hex_centres(qr_flat, stride, R, K):
    """Hexagon centres as lon, lat, exactly as hexState() in src/model.ts."""
    a = np.asarray(qr_flat, dtype=np.float64).reshape(-1, stride)
    q, r = a[:, 0], a[:, 1]
    X = R * S3 * (q + r / 2)
    Y = R * 1.5 * r
    return X / K, Y


# ---------------------------------------------------------------- OSM
def download(st, work):
    path = work / f"{REGION[st]}-latest.osm.pbf"
    if path.exists():
        print(f"  using {path}")
        return path
    url = GEOFABRIK.format(REGION[st])
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 22):
            f.write(chunk)
    tmp.rename(path)
    return path


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 24):
            h.update(chunk)
    return h.hexdigest()


def parse_maxspeed(v):
    if not v:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", v)
    if not m:
        return None
    s = float(m.group(1)) * (1.609344 if "mph" in v else 1.0)
    return s if 5 <= s <= 160 else None


def way_speed(cls, tags):
    if cls not in NO_MAXSPEED:
        posted = parse_maxspeed(tags.get("maxspeed"))
        if posted:
            return min(CAP_KMH, posted * (0.9 if cls in DIVIDED else 0.8))
    return min(CAP_KMH, SPEED_KMH[cls])


def way_oneway(cls, tags):
    if cls not in DIVIDED:
        return 0
    ow = tags.get("oneway")
    if ow in ("yes", "true", "1"):
        return 1
    if ow == "-1":
        return -1
    if ow is None and (cls in ("motorway", "motorway_link") or tags.get("junction") == "roundabout"):
        return 1
    return 0


def drivable(cls, tags):
    if cls is None or tags.get("area") == "yes":
        return False
    if cls == "service" and tags.get("service") in SKIP_SERVICE:
        return False
    if cls == "track" and tags.get("tracktype") in ("grade4", "grade5"):
        return False
    emergency_ok = tags.get("emergency") in ("yes", "designated")
    if not emergency_ok:
        if tags.get("access") == "no" or tags.get("motor_vehicle") == "no" or tags.get("motorcar") == "no":
            return False
    return True


def read_ways(pbf):
    """Every drivable way: class, speed, one-way, and its nodes (id, lon, lat)."""
    cls_of = {c: i for i, c in enumerate(CLASSES)}
    w_cls, w_ow, w_start = array("b"), array("b"), array("q")
    w_speed = array("f")
    n_id, n_lon, n_lat = array("q"), array("d"), array("d")
    fp = (
        osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)
        .with_locations()
        .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
        .with_filter(osmium.filter.KeyFilter("highway"))
    )
    for w in fp:
        tags = w.tags
        cls = tags.get("highway")
        if cls not in cls_of or not drivable(cls, tags):
            continue
        ids, lons, lats = [], [], []
        for nd in w.nodes:
            loc = nd.location
            if loc.valid():
                ids.append(nd.ref)
                lons.append(loc.lon)
                lats.append(loc.lat)
        if len(ids) < 2:
            continue
        w_cls.append(cls_of[cls])
        w_ow.append(way_oneway(cls, tags))
        w_speed.append(way_speed(cls, tags))
        w_start.append(len(n_id))
        n_id.extend(ids)
        n_lon.extend(lons)
        n_lat.extend(lats)
    w_start.append(len(n_id))
    return (
        np.frombuffer(w_cls, np.int8).copy(), np.frombuffer(w_ow, np.int8).copy(),
        np.frombuffer(w_speed, np.float32).astype(np.float64), np.frombuffer(w_start, np.int64).copy(),
        np.frombuffer(n_id, np.int64).copy(), np.frombuffer(n_lon, np.float64).copy(),
        np.frombuffer(n_lat, np.float64).copy(),
    )


# ---------------------------------------------------------------- graph
class Graph:
    """Directed road graph: time in minutes and length in km on the same edges."""

    def __init__(self, ways):
        w_cls, w_ow, w_speed, w_start, n_id, n_lon, n_lat = ways
        nn, nw = len(n_id), len(w_cls)
        way_of = np.repeat(np.arange(nw), np.diff(w_start))
        seg = np.zeros(nn)
        seg[:-1] = haversine_km(n_lon[:-1], n_lat[:-1], n_lon[1:], n_lat[1:])
        seg[w_start[1:] - 1] = 0.0  # no segment across a way boundary
        cum = np.concatenate([[0.0], np.cumsum(seg)])[:nn]
        local = cum - cum[w_start[way_of]]
        _, inv, cnt = np.unique(n_id, return_inverse=True, return_counts=True)
        keep = cnt[inv] >= 2
        keep[w_start[:-1]] = True
        keep[w_start[1:] - 1] = True
        bucket = np.floor(local / VERTEX_STEP_KM).astype(np.int64)
        step = np.ones(nn, bool)
        step[1:] = bucket[1:] != bucket[:-1]
        keep |= step
        P = np.flatnonzero(keep)
        same_way = way_of[P[:-1]] == way_of[P[1:]]
        a, b = P[:-1][same_way], P[1:][same_way]
        wa = way_of[a]
        length = cum[b] - cum[a]
        minutes = length / w_speed[wa] * 60.0
        vid_of_node, vinv = np.unique(n_id[P], return_inverse=True)
        pos_of_v = np.zeros(len(vid_of_node), np.int64)
        pos_of_v[vinv] = P
        self.lon, self.lat = n_lon[pos_of_v], n_lat[pos_of_v]
        self.n = len(vid_of_node)
        vmap = np.full(nn, -1, np.int64)
        vmap[P] = vinv
        u, v = vmap[a], vmap[b]
        ow = w_ow[wa]
        fwd, bwd = ow >= 0, ow <= 0
        src = np.concatenate([u[fwd], v[bwd]])
        dst = np.concatenate([v[fwd], u[bwd]])
        t = np.concatenate([minutes[fwd], minutes[bwd]])
        L = np.concatenate([length[fwd], length[bwd]])
        cls = np.concatenate([w_cls[wa][fwd], w_cls[wa][bwd]])
        ok = src != dst
        src, dst, t, L, cls = src[ok], dst[ok], t[ok], L[ok], cls[ok]
        order = np.lexsort((t, dst, src))
        src, dst, t, L, cls = src[order], dst[order], t[order], L[order], cls[order]
        first = np.ones(len(src), bool)
        first[1:] = (src[1:] != src[:-1]) | (dst[1:] != dst[:-1])
        src, dst, t, L, cls = src[first], dst[first], t[first], L[first], cls[first]
        t = np.maximum(t, 1e-5)
        L = np.maximum(L, 1e-7)
        self.T = csr_matrix((t, (src, dst)), shape=(self.n, self.n))
        self.L = csr_matrix((L, (src, dst)), shape=(self.n, self.n))
        self.T.sort_indices()
        self.L.sort_indices()
        assert np.array_equal(self.T.indices, self.L.indices) and np.array_equal(self.T.indptr, self.L.indptr)
        self.TT = self.T.T.tocsr()
        minor = np.zeros(self.n, bool)
        no_snap = np.isin(cls, [CLASSES.index(c) for c in NO_SNAP])
        minor[src[~no_snap]] = True
        minor[dst[~no_snap]] = True
        _, label = connected_components(self.T, directed=True, connection="weak")
        size = np.bincount(label)
        self.big = size[label] >= MIN_COMPONENT
        self.snappable = np.flatnonzero(self.big & minor)
        self.tree = cKDTree(ecef_km(self.lon[self.snappable], self.lat[self.snappable]))
        self.n_edges = len(src)
        self.n_dropped_small = int((~self.big).sum())

    def snap(self, lon, lat):
        d, i = self.tree.query(ecef_km(lon, lat))
        return self.snappable[i], chord_to_arc_km(d)

    def edge_km(self, a, b):
        lo, hi = self.L.indptr[a], self.L.indptr[a + 1]
        j = lo + np.searchsorted(self.L.indices[lo:hi], b)
        return self.L.data[j]

    def path_km(self, start, pred, end):
        """Road km from start to end following pred (pred[x] = next vertex toward end)."""
        km, x = 0.0, start
        while x != end:
            y = pred[x]
            if y < 0:
                return np.nan
            km += self.edge_km(x, y)
            x = y
        return km


# ---------------------------------------------------------------- per state
def state_response(st, D, g, rng, calib_sources):
    s = D["states"][st]
    R, K = s["hex_r"], s["hex_k"]
    hlon, hlat = hex_centres(s["hexes"], 3, R, K)
    nh = len(hlon)
    pl = D["places"][st]
    sxy = np.asarray(pl["stn_xy"], np.float64).reshape(-1, 2)
    slon, slat = sxy[:, 0], sxy[:, 1]
    ns = len(slon)

    hv, hsnap = g.snap(hlon, hlat)
    sv, ssnap = g.snap(slon, slat)
    h_road = hsnap <= SNAP_MAX_KM
    s_road = ssnap <= SNAP_MAX_KM
    h_acc = hsnap / ACCESS_KMH * 60
    s_acc = ssnap / ACCESS_KMH * 60

    stree = cKDTree(ecef_km(slon, slat))
    cd, ci = stree.query(ecef_km(hlon, hlat))
    crow_km = haversine_km(hlon, hlat, slon[ci], slat[ci])

    top = np.full((nh, 3), -1, np.int64)
    tmin = np.full((nh, 3), np.nan)
    tkm = np.full((nh, 3), np.nan)
    calib_set = set(rng.choice(nh, size=min(calib_sources, nh), replace=False).tolist())
    calib_half = {k: (rng.random() < 0.5) for k in calib_set}
    pairs = []  # (source hex, half, straight km, minutes, route km or nan)
    t0 = time.time()
    for k in range(nh):
        if not h_road[k]:
            continue
        is_cal = k in calib_set
        limits = (CALIB_LIMIT_MIN, np.inf) if is_cal else SEARCH_LIMITS_MIN
        for lim in limits:
            dist, pred = dijkstra(g.TT, directed=True, indices=int(hv[k]), limit=lim, return_predecessors=True)
            ts = np.where(s_road, dist[sv] + s_acc + h_acc[k], np.inf)
            if np.isfinite(ts).sum() >= 3 or lim == np.inf:
                break
        order = np.argsort(ts, kind="stable")[:3]
        for j, i in enumerate(order):
            if not np.isfinite(ts[i]):
                continue
            top[k, j] = i
            tmin[k, j] = ts[i]
            tkm[k, j] = g.path_km(int(sv[i]), pred, int(hv[k]))
        if is_cal:
            pairs.extend(calib_pairs(k, calib_half[k], g, dist, pred, hv, hlon, hlat, h_acc, hsnap, h_road,
                                     sv, slon, slat, s_acc, ssnap, s_road, rng))
        if k % 250 == 0:
            print(f"    hex {k}/{nh}  {time.time() - t0:.0f}s", flush=True)

    fine = fine_response(st, D, g, sv, s_acc, s_road, K)
    stn_hex = point_hex(slon, slat, R, K, s["hexes"])
    pairs = np.asarray(pairs, np.float64)
    cal, extra = calibrate(pairs, top, tmin, hlon, hlat, slon, slat, stn_hex)
    return dict(
        hlon=hlon, hlat=hlat, slon=slon, slat=slat, hv=hv, hsnap=hsnap, sv=sv, ssnap=ssnap,
        top=top, tmin=tmin, tkm=tkm, crow_km=crow_km, crow_i=ci, fine=fine, cal=cal, h_acc=h_acc,
        extra=extra, h_road=h_road, stn_hex=stn_hex, pairs=pairs,
    )


def point_hex(lon, lat, R, K, hexes):
    """State hexagon index holding each point (-1 if none), as hexKey() in src/model.ts."""
    a = np.asarray(hexes, np.int64).reshape(-1, 3)
    key = {(int(q), int(r)): i for i, (q, r, _) in enumerate(a)}
    X, Y = np.asarray(lon) * K, np.asarray(lat)
    q = ((S3 / 3) * X - Y / 3) / R
    r = ((2 / 3) * Y) / R
    s_ = -q - r
    rq, rr, rs = np.round(q), np.round(r), np.round(s_)
    dq, dr, ds = np.abs(rq - q), np.abs(rr - r), np.abs(rs - s_)
    fix_q = (dq > dr) & (dq > ds)
    fix_r = ~fix_q & (dr > ds)
    rq = np.where(fix_q, -rr - rs, rq)
    rr = np.where(fix_r, -rq - rs, rr)
    return np.array([key.get((int(x), int(y)), -1) for x, y in zip(rq, rr)], np.int64)


def calib_pairs(k, half, g, dist, pred, hv, hlon, hlat, h_acc, hsnap, h_road, sv, slon, slat, s_acc, ssnap, s_road, rng):
    """Drive times from every station and hexagon reached to hexagon k."""
    out = []
    for kind, lon, lat, v, acc, snapkm, road, skip in (
        (0, slon, slat, sv, s_acc, ssnap, s_road, None),
        (1, hlon, hlat, hv, h_acc, hsnap, h_road, k),
    ):
        t = dist[v] + acc + h_acc[k]
        straight = haversine_km(hlon[k], hlat[k], lon, lat)
        ok = road & np.isfinite(t) & (straight > 0.05) & (dist[v] <= CALIB_LIMIT_MIN)
        if skip is not None:
            ok[skip] = False
        idx = np.flatnonzero(ok)
        with_km = set(rng.choice(idx, size=min(25, len(idx)), replace=False).tolist()) if len(idx) else set()
        for i in idx:
            rk = np.nan
            if i in with_km:
                rk = g.path_km(int(v[i]), pred, int(hv[k])) + snapkm[i] + hsnap[k]
            out.append((k, half, straight[i], t[i], rk, kind, i))
    return out


def fine_response(st, D, g, sv, s_acc, s_road, K):
    dt_ = D["detail"][st]
    flon, flat = hex_centres(dt_["fine"], 5, dt_["fine_r"], K)
    fv, fsnap = g.snap(flon, flat)
    f_acc = fsnap / ACCESS_KMH * 60
    # virtual source n joined to each station vertex by its off-road time
    n = g.n
    best_acc = {}
    best_stn = {}
    for i, (v, a) in enumerate(zip(sv.tolist(), s_acc.tolist())):
        if not s_road[i]:
            continue
        if v not in best_acc or a < best_acc[v]:
            best_acc[v], best_stn[v] = a, i
    vs = np.fromiter(best_acc, np.int64)
    va = np.array([best_acc[v] for v in vs]) + 1e-6
    T = g.T.tocoo()
    rows = np.concatenate([T.row, np.full(len(vs), n)])
    cols = np.concatenate([T.col, vs])
    data = np.concatenate([T.data, va])
    G = csr_matrix((data, (rows, cols)), shape=(n + 1, n + 1))
    dist, pred = dijkstra(G, directed=True, indices=n, return_predecessors=True)
    root = pred.astype(np.int64).copy()
    idx = np.arange(n + 1)
    root[(root == n) | (root < 0)] = idx[(root == n) | (root < 0)]
    for _ in range(64):
        nxt = root[root]
        if np.array_equal(nxt, root):
            break
        root = nxt
    stn_of_vertex = np.full(n + 1, -1, np.int64)
    stn_of_vertex[vs] = [best_stn[v] for v in vs]
    fs = stn_of_vertex[root[fv]]
    fmin = np.where(fsnap <= SNAP_MAX_KM, dist[fv] + f_acc, np.inf)
    fs[~np.isfinite(fmin)] = -1
    return dict(lon=flon, lat=flat, stn=fs, minutes=fmin, snap=fsnap, dist=dist, stn_of_vertex=stn_of_vertex, root=root)


def monotone(y, w):
    """Weighted pool-adjacent-violators: the closest non-decreasing sequence."""
    blocks = []  # [value, weight, count]
    for v, ww in zip(y, w):
        blocks.append([v, ww, 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            v2, w2, c2 = blocks.pop()
            v1, w1, c1 = blocks.pop()
            blocks.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2, c1 + c2])
    return np.concatenate([[v] * c for v, _, c in blocks])


def calibrate(P, top, tmin, hlon, hlat, slon, slat, stn_hex):
    """Drive time from straight-line km: speed per distance band, plus local extra minutes per hexagon.

    Scored on held-out source hexagons against one speed for every distance.
    """
    k, half, km, mins, route, kind, other = P.T
    k, kind, other = k.astype(np.int64), kind.astype(np.int64), other.astype(np.int64)
    nb = len(CALIB_BANDS_KM)
    band = np.digitize(km, CALIB_BANDS_KM) - 1
    nh = len(hlon)
    reach = top >= 0
    t_lon = np.where(reach, slon[np.maximum(top, 0)], np.nan)
    t_lat = np.where(reach, slat[np.maximum(top, 0)], np.nan)
    t_km = haversine_km(hlon[:, None], hlat[:, None], t_lon, t_lat)
    t_band = np.digitize(np.nan_to_num(t_km), CALIB_BANDS_KM) - 1

    def fit_speeds(mask):
        raw = np.full(nb, np.nan)
        n = np.zeros(nb)
        for b in range(nb):
            m = mask & (band == b)
            n[b] = m.sum()
            if n[b] >= 20:
                raw[b] = float(np.median(km[m] / (mins[m] / 60)))
        good = np.flatnonzero(np.isfinite(raw))
        filled = np.array([raw[b] if np.isfinite(raw[b]) else raw[good[np.argmin(np.abs(good - b))]] for b in range(nb)])
        return raw, monotone(filled, np.maximum(n, 1))

    def hex_extra(kmh):
        """Mean of actual minus band-predicted minutes to the hexagon's 3 closest stations,
        with one pseudo-observation of 0 so that few drives stay near 0."""
        use = reach & (t_km >= 1.0)
        pred = np.where(use, np.nan_to_num(t_km) / kmh[t_band] * 60, 0.0)
        ex = np.where(use, np.where(use, tmin, 0.0) - pred, 0.0)
        e = ex.sum(1) / (use.sum(1) + 1)
        e[~reach[:, 0]] = np.nan
        return e

    def predict(kmh, e):
        """Band speed alone, and band speed plus the local extra minutes of each hexagon end
        (a station end adds nothing: the extras were measured on drives from stations)."""
        base = km / kmh[band] * 60
        e_k = np.where(np.isfinite(e[k]), e[k], 0.0)
        e_o = np.where(kind == 1, e[np.clip(other, 0, nh - 1)], 0.0)
        e_o = np.where(np.isfinite(e_o), e_o, 0.0)
        return base, np.maximum(base + e_k + e_o, km / FLOOR_KMH * 60)

    def score(mask, pred_min):
        e = (pred_min[mask] - mins[mask]) / mins[mask]
        a = np.abs(e)
        return dict(
            n=int(mask.sum()),
            med_abs_pct=round(float(np.median(a)) * 100, 1),
            p90_abs_pct=round(float(np.quantile(a, 0.9)) * 100, 1),
            bias_pct=round(float(np.median(e)) * 100, 1),
            mae_min=round(float(np.mean(np.abs(pred_min[mask] - mins[mask]))), 2),
        )

    # held-out test: fit on half A of the source hexagons, score on half B
    A = half == 1
    in_top3 = (kind == 0) & np.array([o in top[kk] for kk, o in zip(k, other)])
    B = (half == 0) & ~in_top3
    _, kmh_a = fit_speeds(A)
    one_a = float(np.median(km[A] / (mins[A] / 60)))
    band_pred, local_pred = predict(kmh_a, hex_extra(kmh_a))
    base_pred = km / one_a * 60
    preds = {"one_speed": base_pred, "bands": band_pred, "bands_plus_local": local_pred}
    test = {name: score(B, pr) for name, pr in preds.items()}
    test["by_band"] = []
    for b in range(nb):
        m = B & (band == b)
        if m.sum() >= 20:
            test["by_band"].append(dict(band=b, **{name: score(m, pr)["med_abs_pct"] for name, pr in preds.items()}, n=int(m.sum())))

    raw, kmh = fit_speeds(np.ones(len(km), bool))
    f = hex_extra(kmh)
    detour, d_spread, n_pairs, n_km, spread = [], [], [], [], []
    for b in range(nb):
        m = band == b
        n_pairs.append(int(m.sum()))
        mk = m & np.isfinite(route)
        n_km.append(int(mk.sum()))
        if mk.sum() >= 10:
            d = route[mk] / km[mk]
            detour.append(round(float(np.median(d)), 3))
            d_spread.append([round(float(np.quantile(d, 0.1)), 2), round(float(np.quantile(d, 0.9)), 2)])
        else:
            detour.append(None)
            d_spread.append(None)
        if m.sum() >= 20:
            sp = km[m] / (mins[m] / 60)
            spread.append([round(float(np.quantile(sp, 0.1)), 1), round(float(np.quantile(sp, 0.9)), 1)])
        else:
            spread.append(None)
    fin = f[np.isfinite(f)]
    cal = dict(
        bands_km=CALIB_BANDS_KM,
        kmh=[round(float(x), 1) for x in kmh],
        kmh_raw=[None if not np.isfinite(x) else round(float(x), 1) for x in raw],
        kmh_p10_p90=spread,
        detour=detour,
        detour_p10_p90=d_spread,
        n_pairs=n_pairs,
        n_route_km=n_km,
        one_kmh=round(float(np.median(km / (mins / 60))), 1),
        local_extra_min_p10_p50_p90=[round(float(np.quantile(fin, q)), 1) for q in (0.1, 0.5, 0.9)],
        floor_kmh=FLOOR_KMH,
        n_source_hexes=int(len(np.unique(k))),
        test=test,
    )
    return cal, f


# ---------------------------------------------------------------- output
def i10(a):
    a = np.asarray(a, np.float64)
    out = np.where(np.isfinite(a), np.round(a * 10), -1).astype(np.int64)
    return out.ravel().tolist()


def state_json(r):
    f = r["fine"]
    return {
        "n": int(len(r["hlon"])),
        "ns": int(len(r["slon"])),
        "top": r["top"].ravel().tolist(),
        "min10": i10(r["tmin"]),
        "km10": i10(r["tkm"]),
        "crow10": i10(r["crow_km"]),
        "crow_s": r["crow_i"].astype(int).tolist(),
        "snap_m": np.round(r["hsnap"] * 1000).astype(int).tolist(),
        "s_snap_m": np.round(r["ssnap"] * 1000).astype(int).tolist(),
        "e10": np.where(np.isfinite(r["extra"]), np.round(r["extra"] * 10), NO_EXTRA).astype(int).tolist(),
        "fine": {"n": int(len(f["lon"])), "s": f["stn"].astype(int).tolist(), "min10": i10(f["minutes"])},
        "cal": r["cal"],
    }


FIELDS = {
    "top": "per state hexagon (data.js hexes order), 3 station indices (data.js places stn order), fastest first; -1 = none",
    "min10": "drive minutes x10 for the 3 stations in top, off-road legs included; -1 = none",
    "km10": "road km x10 along the route for the 3 stations in top, off-road legs excluded; -1 = none",
    "crow10": "straight-line km x10 from the hexagon centre to the nearest station",
    "crow_s": "index of that straight-line nearest station",
    "snap_m": "metres from the hexagon centre to the road vertex it snapped to; over 10000 = no road, no times",
    "s_snap_m": "per station, metres to its snapped road vertex",
    "e10": "per hexagon, local extra minutes x10 for the calibration estimate; -9999 = no station reachable",
    "fine": "per 2 km hexagon (data.js detail fine order): s = fastest station index, min10 = its minutes x10; -1 = none",
    "cal": "calibration: estimate minutes = max(km/floor_kmh*60, km/kmh[band]*60 + extra of each hexagon end)",
}

METHOD = (
    "Drive times from fire and EMS stations (data.js places) to the centre of every hexagon, on the "
    "OpenStreetMap road network. Free-flow speeds by road class (maxspeed used where tagged, x0.9 on "
    "motorway/trunk and x0.8 elsewhere, capped at 105 km/h); one-way honoured on motorway and trunk "
    "roads only; no traffic, signals, turn penalties or turnout time. Estimated driving times, not "
    "measured response times. "
    "Points snap to the nearest road vertex; that straight-line leg is added at 20 km/h, and "
    "points more than 10 km from a road get no time. Only stations inside the state are counted. "
    "Calibration: per straight-line distance band, the median effective speed and detour factor from sampled hexagon-to-station and hexagon-to-hexagon drives, plus "
    "per-hexagon local extra minutes, tested on held-out hexagons against one speed for all distances."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", nargs="+", default=["NY", "CA"], choices=["NY", "CA"])
    ap.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "burn-calendar-osm",
                    help="where the .osm.pbf downloads go (deleted after use unless --keep-pbf)")
    ap.add_argument("--keep-pbf", action="store_true")
    ap.add_argument("--calib-sources", type=int, default=300)
    ap.add_argument("--out", type=Path, default=ROOT / "response.js")
    ap.add_argument("--npz", type=Path, default=None, help="also save raw results per state here (for checks)")
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    D = load_burn_data()
    out = {
        "v": VERSION,
        "built": dt.date.today().isoformat(),
        "method": METHOD,
        "source": "Roads: OpenStreetMap via Geofabrik extracts. Stations: data.js places.",
        "credit": "Road data (c) OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright)",
        "speeds_kmh": SPEED_KMH,
        "cap_kmh": CAP_KMH,
        "access_kmh": ACCESS_KMH,
        "snap_max_km": SNAP_MAX_KM,
        "osm": {},
        "fields": FIELDS,
    }
    prev = {}
    if a.out.exists():
        t = a.out.read_text()
        prev = json.loads(t[t.index("{"): t.rindex("}") + 1])
    for st in ("NY", "CA"):
        if st not in a.states and st in prev:
            out[st], out["osm"][st] = prev[st], prev["osm"][st]
    for st in a.states:
        rng = np.random.default_rng(20251 if st == "NY" else 20252)
        print(f"== {st}", flush=True)
        pbf = download(st, a.work)
        hdr = osmium.io.Reader(str(pbf), osmium.osm.NOTHING).header()
        stamp = hdr.get("osmosis_replication_timestamp", "")
        out["osm"][st] = {"file": pbf.name, "md5": md5(pbf), "timestamp": stamp}
        t0 = time.time()
        ways = read_ways(pbf)
        print(f"  {len(ways[0])} ways, {len(ways[4])} node refs read in {time.time() - t0:.0f}s", flush=True)
        if not a.keep_pbf:
            pbf.unlink()
            print(f"  deleted {pbf}")
        g = Graph(ways)
        del ways
        print(f"  graph: {g.n} vertices, {g.n_edges} directed edges, {g.n_dropped_small} vertices in small pieces dropped", flush=True)
        r = state_response(st, D, g, rng, a.calib_sources)
        out[st] = state_json(r)
        out["osm"][st]["graph"] = {"vertices": int(g.n), "edges": int(g.n_edges)}
        if a.npz:
            a.npz.mkdir(parents=True, exist_ok=True)
            f = r["fine"]
            np.savez_compressed(
                a.npz / f"{st}.npz", hlon=r["hlon"], hlat=r["hlat"], slon=r["slon"], slat=r["slat"],
                top=r["top"], tmin=r["tmin"], tkm=r["tkm"], crow_km=r["crow_km"], hsnap=r["hsnap"],
                ssnap=r["ssnap"], h_acc=r["h_acc"], hv=r["hv"], sv=r["sv"], flon=f["lon"], flat=f["lat"],
                fstn=f["stn"], fmin=f["minutes"], fsnap=f["snap"],
                ms_hex=np.where(r["h_road"], f["dist"][r["hv"]] + r["h_acc"], np.inf), extra=r["extra"], stn_hex=r["stn_hex"], pairs=r["pairs"], ms_stn=f["stn_of_vertex"][f["root"][r["hv"]]],
            )
        print(f"  {st} done in {time.time() - t0:.0f}s; calibration {json.dumps(r['cal']['kmh'])}", flush=True)
        del g
    body = json.dumps(out, separators=(",", ":"))
    a.out.write_text(
        "/* Burn Calendar drive times, built by scripts/build_response.py. "
        "Road data (c) OpenStreetMap contributors, ODbL. */\nwindow.RESPONSE = " + body + ";\n"
    )
    print(f"wrote {a.out} ({a.out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    sys.exit(main())
