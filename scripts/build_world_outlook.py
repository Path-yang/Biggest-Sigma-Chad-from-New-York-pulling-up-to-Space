#!/usr/bin/env python3
"""Build world_outlook.js: a global 14-day fire outlook on a grid of about 2,100 land regions.

Stages (each caches its result in --work, so a re-run skips finished work):

  extract  VIIRS Suomi NPP hotspots 2012-2025 from build/hf (all countries), filtered
           as in the README: type 0, confidence n or h, and industrial spots removed
           (0.005 degree cells seen in 5 or more calendar years, more than half at
           night). Counted per grid region, FIRMS country and day.
  regions  The grid: 2.5 degree latitude bands, each cut into round(144 cos(lat))
           equal longitude steps, so cells are about 278 km on a side at every
           latitude (an equal-area-ish 2.5 degree grid). A cell becomes a region if
           VIIRS saw a hotspot there on at least 28 distinct days in 2012-2025
           (about two a year). Its weather point is the hotspot-weighted centre of
           its busiest 0.5 degree sub-cell, so it sits on burning land.
  fetch    NASA POWER daily point API (community AG, MERRA-2), 2011-12-01..2025-12-31,
           one request per region, 3 at a time, cached (about 22 minutes for 2,104 regions).
  overlap  Open-Meteo forecast API (its stored recent past) and POWER for the same 48 days,
           2026-08-14..2026-09-30, at every region point. Gives per-region offsets that put
           Open-Meteo's max temperature, dew point and rain on POWER's footing. Open-Meteo only
           keeps about 92 past days, so this window cannot be re-fetched after 2026-11-15;
           keep the cache (--work/overlap).
  model    Event, climatology, standardised weather anomalies, pooled logistic regression,
           leave-one-year-out backtest, source check, world_outlook.js.
  output   Same as model but reuses the saved backtests (backtest_*.json).

Event (shipped): more VIIRS hotspots in the region in the 14 days from the issue day than the
region's median 14-day count for that half-month (with a median of 0: at least one hotspot).
The plain "at least one hotspot" event is backtested too and reported as metrics_other_event.

Usage:
    .venv/bin/python scripts/build_world_outlook.py --hf build/hf --work DIR [--out world_outlook.js]
        [--stage extract|regions|fetch|overlap|model|output|all]

Needs duckdb, numpy and scipy. Network: power.larc.nasa.gov and api.open-meteo.com.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "burn-calendar-build/1.0"

Y0, Y1 = 2012, 2025
BAND_DEG = 2.5
NBANDS = 72
MIN_FIRE_DAYS = 28  # distinct days with a hotspot in 2012-2025 for a cell to become a region

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMS = ("T2M_MAX", "T2M_MIN", "T2MDEW", "RH2M", "WS10M", "WS10M_MAX", "PRECTOTCORR")
WX_START = dt.date(2011, 12, 1)
WX_END = dt.date(2025, 12, 31)
POWER_WORKERS = 3


# ---------------------------------------------------------------- grid
def band_cols(band):
    lat_c = -90 + BAND_DEG * (band + 0.5)
    return max(1, round(144 * math.cos(math.radians(lat_c))))


def cell_of(lat, lon):
    band = min(NBANDS - 1, int(math.floor((lat + 90) / BAND_DEG)))
    n = band_cols(band)
    return band, int(math.floor((lon + 180) / 360 * n)) % n


def cell_bounds(band, col):
    """[west, south, east, north] in degrees."""
    n = band_cols(band)
    w = 360 / n
    return [-180 + col * w, -90 + band * BAND_DEG, -180 + (col + 1) * w, -90 + (band + 1) * BAND_DEG]


# ---------------------------------------------------------------- extract
def stage_extract(hf, work):
    work.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    con = duckdb.connect()
    con.execute(f"SET temp_directory='{work / 'duck_tmp'}'")
    con.execute("SET memory_limit='8GB'")
    con.execute("SET max_temp_directory_size='2GB'")
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"""
    CREATE TEMP VIEW raw AS
    SELECT latitude AS lat, longitude AS lon, acq_date AS d, daynight
    FROM read_parquet('{hf / "viirs-snpp" / "*" / "viirs-snpp_*.parquet"}')
    WHERE year(acq_date) BETWEEN {Y0} AND {Y1}""")
    static_pq = work / "static.parquet"
    if not static_pq.exists():
        slices = []
        for k in range(24):  # 15 degree longitude slices keep each group-by in memory
            lo0, lo1 = -180 + 15 * k, (-165 + 15 * k) if k < 23 else 181
            sp = work / f"static_{k}.parquet"
            con.execute(f"""
            COPY (SELECT a, b FROM (
              SELECT round(lat / 0.005)::BIGINT AS a, round(lon / 0.005)::BIGINT AS b,
                     count(DISTINCT year(d)) AS yrs, avg((daynight = 'N')::INT) AS night
              FROM raw WHERE lon >= {lo0} AND lon < {lo1} GROUP BY 1, 2)
            WHERE yrs >= 5 AND night > 0.5) TO '{sp}' (FORMAT parquet)""")
            slices.append(str(sp))
        con.execute(f"COPY (SELECT * FROM read_parquet({slices})) TO '{static_pq}' (FORMAT parquet)")
        for sp in slices:
            Path(sp).unlink()
    con.execute(f"CREATE TEMP TABLE static AS SELECT * FROM '{static_pq}'")
    print("static 500 m cells:", con.execute("SELECT count(*) FROM static").fetchone()[0], flush=True)
    sub_parts = []
    for Y in range(Y0, Y1 + 1):
        pf, sf = work / f"cell_day_{Y}.parquet", work / f"sub_{Y}.parquet"
        sub_parts.append(str(sf))
        if pf.exists() and sf.exists():
            continue
        con.execute(f"""
        CREATE OR REPLACE TEMP TABLE f AS
        SELECT r.* FROM (
          SELECT latitude AS lat, longitude AS lon, acq_date AS d,
                 regexp_extract(filename, 'viirs-snpp_[0-9]{{4}}_(.*)\\.parquet$', 1) AS country
          FROM read_parquet('{hf / "viirs-snpp" / str(Y) / "*.parquet"}', filename=true)
          WHERE year(acq_date) = {Y} AND type = 0 AND confidence IN ('n', 'h')) r
        ANTI JOIN static s ON s.a = round(r.lat / 0.005)::BIGINT AND s.b = round(r.lon / 0.005)::BIGINT""")
        con.execute(f"""
        COPY (
          WITH g AS (SELECT *, least({NBANDS - 1}, floor((lat + 90) / {BAND_DEG}))::INT AS band FROM f),
               h AS (SELECT *, greatest(1, round(144 * cos(radians(-90 + {BAND_DEG} * (band + 0.5)))))::INT AS nb FROM g)
          SELECT band, (floor((lon + 180) / 360 * nb)::INT % nb) AS col, country, d,
                 count(*)::INT AS n, sum(lat) AS slat, sum(lon) AS slon
          FROM h GROUP BY ALL) TO '{pf}' (FORMAT parquet, COMPRESSION zstd)""")
        con.execute(f"""
        COPY (SELECT floor(lat * 2)::INT AS a, floor(lon * 2)::INT AS b, count(*)::INT AS n,
                     sum(lat) AS slat, sum(lon) AS slon FROM f GROUP BY 1, 2) TO '{sf}' (FORMAT parquet)""")
        print(f"extract {Y} ({time.time() - t0:.0f}s)", flush=True)
    con.execute(f"""COPY (SELECT a, b, sum(n)::BIGINT AS n, sum(slat) AS slat, sum(slon) AS slon
                FROM read_parquet({sub_parts}) GROUP BY 1, 2) TO '{work / "sub05.parquet"}' (FORMAT parquet)""")
    n = con.execute(f"SELECT count(*), sum(n) FROM read_parquet('{work / 'cell_day_*.parquet'}')").fetchone()
    print(f"cell-country-days {n[0]:,}, hotspots {n[1]:,}", flush=True)


# ---------------------------------------------------------------- regions
def stage_regions(work):
    con = duckdb.connect()
    cells = con.execute(f"""
        SELECT band, col, sum(n)::BIGINT AS n, count(DISTINCT d) AS nd, sum(slat) / sum(n), sum(slon) / sum(n)
        FROM read_parquet('{work / 'cell_day_*.parquet'}') GROUP BY 1, 2 ORDER BY 1, 2""").fetchall()
    kept = [(b, c, n, nd) for b, c, n, nd, _, _ in cells if nd >= MIN_FIRE_DAYS]
    centre = {(b, c): (la, lo) for b, c, _, _, la, lo in cells}
    index = {(b, c): i for i, (b, c, _, _) in enumerate(kept)}

    # weather point: hotspot-weighted centre of the busiest 0.5 degree sub-cell whose centre lies in the
    # region; a region narrower than that (no sub-cell centre inside) uses its own hotspot-weighted centre
    best = {}
    for a, b, n, slat, slon in con.execute(f"SELECT * FROM '{work / 'sub05.parquet'}'").fetchall():
        key = cell_of((a + 0.5) / 2, (b + 0.5) / 2)
        if key in index and (key not in best or n > best[key][0]):
            best[key] = (n, slat / n, slon / n)

    # countries: hotspots per (region, country), all cells (kept or not)
    cc = con.execute(f"""
        SELECT band, col, country, sum(n)::BIGINT FROM read_parquet('{work / 'cell_day_*.parquet'}')
        GROUP BY 1, 2, 3""").fetchall()
    tot = {}
    for b, c, k, n in cc:
        tot[k] = tot.get(k, 0) + n
    country_regions, region_countries, fallback = {}, [[] for _ in kept], {}
    for b, c, k, n in sorted(cc, key=lambda r: -r[3]):
        i = index.get((b, c))
        if i is None:
            continue
        share = n / tot[k]
        country_regions.setdefault(k, []).append([i, round(share, 4), int(n)])
        region_countries[i].append([k, int(n)])
    for k in tot:
        if k not in country_regions:
            fallback[k] = int(tot[k])
    regions = []
    for i, (b, c, n, nd) in enumerate(kept):
        _, la, lo = best.get((b, c), (0, *centre[(b, c)]))
        regions.append({"i": i, "band": b, "col": c, "lat": round(la, 2), "lon": round(lo, 2),
                        "hotspots": int(n), "fire_days": int(nd), "countries": region_countries[i]})
    out = {"min_fire_days": MIN_FIRE_DAYS, "cells_with_any_hotspot": len(cells), "regions": regions,
           "country_regions": country_regions, "countries_without_region": fallback}
    (work / "regions.json").write_text(json.dumps(out))
    print(f"regions: {len(regions)} of {len(cells)} cells with any hotspot; "
          f"{len(country_regions)} countries covered, {len(fallback)} not: {fallback}", flush=True)
    return out


def load_regions(work):
    return json.loads((work / "regions.json").read_text())


# ---------------------------------------------------------------- fetch (NASA POWER)
def power_file(work, la, lo):
    return work / "power" / f"p_{la:.2f}_{lo:.2f}.csv.gz"


def fetch_one(work, la, lo):
    f = power_file(work, la, lo)
    if f.exists():
        return "cached"
    qs = {"parameters": ",".join(POWER_PARAMS), "community": "AG", "longitude": f"{lo:.2f}",
          "latitude": f"{la:.2f}", "start": WX_START.strftime("%Y%m%d"), "end": WX_END.strftime("%Y%m%d"),
          "format": "CSV", "time-standard": "LST"}
    url = POWER_URL + "?" + "&".join(f"{k}={v}" for k, v in qs.items())
    wait = 5
    for attempt in range(12):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            if b"-END HEADER-" not in body:
                raise ValueError("no CSV header in response")
            tmp = f.with_suffix(".tmp")
            tmp.write_bytes(gzip.compress(body))
            tmp.rename(f)
            time.sleep(0.5)
            return "fetched"
        except urllib.error.HTTPError as e:
            ra = e.headers.get("Retry-After")
            print(f"POWER {la},{lo}: HTTP {e.code}; retry in {ra or wait}s", flush=True)
            time.sleep(int(ra) if ra and ra.isdigit() else wait)
        except Exception as e:  # network errors, timeouts, truncated bodies
            print(f"POWER {la},{lo}: {e!r}; retry in {wait}s", flush=True)
            time.sleep(wait)
        wait = min(wait * 2, 300)
    return "failed"


def stage_fetch(work):
    (work / "power").mkdir(parents=True, exist_ok=True)
    R = load_regions(work)["regions"]
    t0 = time.time()
    done = {"cached": 0, "fetched": 0, "failed": 0}
    with cf.ThreadPoolExecutor(POWER_WORKERS) as ex:
        futs = [ex.submit(fetch_one, work, r["lat"], r["lon"]) for r in R]
        for k, fu in enumerate(cf.as_completed(futs)):
            done[fu.result()] += 1
            if k % 100 == 0:
                print(f"fetch {k + 1}/{len(R)} {done} ({time.time() - t0:.0f}s)", flush=True)
    print(f"fetch finished {done} ({time.time() - t0:.0f}s)", flush=True)
    if done["failed"]:
        sys.exit("some POWER requests failed; run the fetch stage again")


def read_power(work, la, lo):
    """[day, param] array over WX_START..WX_END, NaN for missing (-999)."""
    txt = gzip.decompress(power_file(work, la, lo).read_bytes()).decode()
    body = txt[txt.index("-END HEADER-") + len("-END HEADER-"):].strip()
    hdr, *rows = body.splitlines()
    cols = hdr.split(",")
    a = np.loadtxt(io.StringIO("\n".join(rows)), delimiter=",")
    if len(a) != (WX_END - WX_START).days + 1:
        raise ValueError(f"unexpected length {len(a)} at {la},{lo}")
    out = np.stack([a[:, cols.index(p)] for p in POWER_PARAMS], 1)
    out[out <= -998] = np.nan
    return out


# ---------------------------------------------------------------- overlap (Open-Meteo vs POWER, recent days)
# The page's weather (Open-Meteo) and the training weather (POWER, MERRA-2) disagree at a given point by
# a roughly constant amount (grid, elevation and model differences). Both are fetched for the same
# recent days, and per-region offsets for daily max temperature and dew point are learned from them.
# POWER's latest weeks are not MERRA-2 (they come from a near-real-time stand-in with a different bias:
# the Open-Meteo minus POWER max temperature gap jumps by about 1 deg C on 2026-10-01), so only days
# up to 2026-09-30 are used. Open-Meteo's forecast API only keeps about 92 past days, so this window
# can no longer be fetched after 2026-11-15; the cache in --work/overlap keeps it.
OVERLAP = (dt.date(2026, 8, 14), dt.date(2026, 9, 30))
OM_URL = "https://api.open-meteo.com/v1/forecast"
OM_OVERLAP_VARS = "temperature_2m_max,dew_point_2m_mean,precipitation_sum"
OM_BATCH = 200  # points per request; about 2 weighted calls each (3 variables x 91 days), under 600 a minute
OM_SLEEP = 70


def stage_overlap(work):
    overlap_openmeteo(work)
    overlap_power(work)


def overlap_openmeteo(work):
    regs = load_regions(work)["regions"]
    od = work / "overlap"
    od.mkdir(parents=True, exist_ok=True)
    for b in range(0, len(regs), OM_BATCH):
        chunk = regs[b: b + OM_BATCH]
        f = od / f"om_{OVERLAP[0]}_{OVERLAP[1]}_{b:05d}_{len(chunk)}.json"
        if list(od.glob(f"om_*_{b:05d}_{len(chunk)}.json")):  # any cached range that covers OVERLAP
            continue
        q = {"latitude": ",".join(f"{r['lat']:.2f}" for r in chunk),
             "longitude": ",".join(f"{r['lon']:.2f}" for r in chunk),
             "daily": OM_OVERLAP_VARS, "wind_speed_unit": "ms", "timezone": "auto",
             "start_date": OVERLAP[0].isoformat(), "end_date": OVERLAP[1].isoformat()}
        url = OM_URL + "?" + "&".join(f"{k}={v}" for k, v in q.items())
        for attempt in range(10):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=300) as r:
                    body, cost = r.read(), r.headers.get("X-RateLimit-Cost")
                js = json.loads(body)
                if not isinstance(js, list) or len(js) != len(chunk):
                    raise ValueError("unexpected response shape")
                f.write_bytes(body)
                print(f"overlap open-meteo batch {b // OM_BATCH}: {len(chunk)} points, cost {cost}", flush=True)
                break
            except urllib.error.HTTPError as e:
                print(f"overlap batch {b}: HTTP {e.code} {e.read()[:200]!r}", flush=True)
                time.sleep(OM_SLEEP)
            except Exception as e:
                print(f"overlap batch {b}: {e!r}", flush=True)
                time.sleep(OM_SLEEP)
        else:
            sys.exit("open-meteo overlap fetch failed")
        time.sleep(OM_SLEEP)


def overlap_power(work):
    regs = load_regions(work)["regions"]
    od = work / "overlap"
    t0 = time.time()

    def one(r):
        f = od / f"pw_{r['lat']:.2f}_{r['lon']:.2f}.csv"
        if f.exists():
            return
        url = (f"{POWER_URL}?parameters=T2M_MAX,T2MDEW,PRECTOTCORR,WS10M&community=AG&longitude={r['lon']:.2f}"
               f"&latitude={r['lat']:.2f}&start={OVERLAP[0]:%Y%m%d}&end={OVERLAP[1]:%Y%m%d}&format=CSV&time-standard=LST")
        wait = 5
        for attempt in range(10):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=120) as x:
                    body = x.read()
                if b"-END HEADER-" not in body:
                    raise ValueError("no CSV header")
                f.write_bytes(body)
                time.sleep(0.5)
                return
            except Exception as e:
                print(f"overlap POWER {r['lat']},{r['lon']}: {e!r}", flush=True)
                time.sleep(wait)
                wait = min(wait * 2, 300)
        raise RuntimeError("POWER overlap fetch failed")

    with cf.ThreadPoolExecutor(POWER_WORKERS) as ex:
        list(ex.map(one, regs))
    print(f"overlap POWER done ({time.time() - t0:.0f}s)", flush=True)


def load_overlap(work, regs, partial=False):
    """Daily arrays [r, day] over OVERLAP from both sources: dict source -> var -> array.
    partial=True (development only) leaves regions without files as NaN."""
    od = work / "overlap"
    nd = (OVERLAP[1] - OVERLAP[0]).days + 1
    dates = [(OVERLAP[0] + dt.timedelta(i)).isoformat() for i in range(nd)]
    om = {k: np.full((len(regs), nd), np.nan) for k in ("tmax", "tdew", "prec")}
    pw = {k: np.full((len(regs), nd), np.nan) for k in ("tmax", "tdew", "prec")}
    names = {"temperature_2m_max": "tmax", "dew_point_2m_mean": "tdew", "precipitation_sum": "prec"}
    for b in range(0, len(regs), OM_BATCH):
        n = len(regs[b: b + OM_BATCH])
        fs = sorted(od.glob(f"om_*_{b:05d}_{n}.json"))
        if partial and not fs:
            continue
        js = json.loads(fs[0].read_text())
        for j, loc in enumerate(js):
            d = loc["daily"]
            i0 = d["time"].index(dates[0])
            if d["time"][i0: i0 + nd] != dates:
                raise ValueError("overlap file does not cover OVERLAP")
            for k, v in names.items():
                om[v][b + j] = [np.nan if x is None else x for x in d[k][i0: i0 + nd]]
    pnames = {"T2M_MAX": "tmax", "T2MDEW": "tdew", "PRECTOTCORR": "prec"}
    for i, r in enumerate(regs):
        f = od / f"pw_{r['lat']:.2f}_{r['lon']:.2f}.csv"
        if partial and not f.exists():
            continue
        txt = f.read_text()
        body = txt[txt.index("-END HEADER-") + len("-END HEADER-"):].strip()
        hdr, *rows = body.splitlines()
        a = np.loadtxt(io.StringIO("\n".join(rows)), delimiter=",", ndmin=2)
        cols = hdr.split(",")
        day0 = [dt.date(int(y), 1, 1) + dt.timedelta(int(dd) - 1) for y, dd in a[:, :2]]
        i0 = day0.index(OVERLAP[0])
        if len(day0) < i0 + nd or day0[i0 + nd - 1] != OVERLAP[1]:
            raise ValueError("POWER overlap file does not cover OVERLAP")
        for k, v in pnames.items():
            col = a[i0: i0 + nd, cols.index(k)].copy()
            col[col <= -998] = np.nan
            pw[v][i] = col
    return om, pw


# ---------------------------------------------------------------- model: shared definitions
HORIZON = 14
PRIOR = 30
NHM = 24  # half-months: index 2 * (month - 1) + (day > 15)
FIRE_FIRST = dt.date(2012, 1, 20)  # first VIIRS S-NPP day in the archive
ISSUE_EVERY = 7  # backtest issue days: every 7th day from FIRE_FIRST
CLIM_W = 15  # base rates pool issue days within this many days of the half-month
CLIM_A = 10  # ... and are shrunk toward the region's all-year rate with this many pseudo-samples
P_CLIP = (0.002, 0.998)
Z_CLIP = 4.0  # standardised anomalies are clipped to +/- this
NHARM = 2  # harmonics in the per-region seasonal mean and sd of each weather feature
OUTAGE_FRAC = 0.15  # a day whose global hotspot total is under this share of its +/-30-day median is an outage
RIDGE = 1.0

# Weather features: name -> (window, kind). Windows: "next" = issue day and the 13 after it,
# "prior" = the 30 days before the issue day. All are computed the same way from POWER (training)
# and from Open-Meteo (live), then standardised against the region's POWER climatology.
WX_FEATURES = {
    "tmax14": ("next", "mean daily maximum temperature, deg C"),
    "rhmin14": ("next", "mean daily minimum relative humidity, % (from dew point and max temperature)"),
    "prec14": ("next", "log(1 + total precipitation, mm)"),
    "wind14": ("next", "mean daily mean 10 m wind speed, m/s"),
    "prec30": ("prior", "log(1 + total precipitation over the 30 days before, mm)"),
}
ZONES = ("tropics", "subtropics", "temperate", "boreal")  # |lat| <23.5, <35, <55, >=55
CONTINENTS = ("North and Central America", "South America", "Europe", "Africa", "Asia", "Oceania")


def doy365(d):
    """Day of year 0..364 ignoring 29 February (which shares 28 February's index)."""
    j = d.timetuple().tm_yday - 1
    if d.month > 2 and d.year % 4 == 0 and (d.year % 100 != 0 or d.year % 400 == 0):
        j -= 1
    return j


def half_month(d):
    return 2 * (d.month - 1) + (1 if d.day > 15 else 0)


def harmonics(doy):
    a = 2 * np.pi * np.asarray(doy, float) / 365.0
    cols = [np.ones_like(a)]
    for k in range(1, NHARM + 1):
        cols += [np.cos(k * a), np.sin(k * a)]
    return np.stack(cols, -1)


def rh_min(tmax, tdew):
    """Daily minimum relative humidity (%) from the day's mean dew point and maximum temperature (Magnus)."""
    es = lambda t: np.exp(17.62 * t / (243.12 + t))
    return np.minimum(100.0, 100.0 * es(tdew) / es(tmax))


def zone_of(lat):
    a = abs(lat)
    return 0 if a < 23.5 else 1 if a < 35 else 2 if a < 55 else 3


def continent_of(lat, lon):
    if lon < -30:
        return 0 if lat >= 13 or (lat >= 7 and lon < -77.3) else 1
    if lon < 60 and lat >= 36:
        return 2
    if -20 <= lon < 52 and lat < 36 and not (lon > 34.5 and lat > 12.5):
        return 3
    if (lon >= 112 and lat < -10) or (lon >= 130 and lat < 0) or lon >= 160 or lon < -150:
        return 5
    return 4


def logit(p):
    return np.log(p / (1 - p))


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def fit_logistic(X, y, ridge=RIDGE):
    """Ridge-penalised logistic regression by Newton's method on standardised columns.
    Returns coefficients on the raw scale: [intercept, b1, b2, ...]."""
    mu, sd = X.mean(0), X.std(0)
    sd[sd == 0] = 1
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    P = np.eye(Z.shape[1]) * ridge
    P[0, 0] = 0
    for _ in range(60):
        p = sigmoid(Z @ w)
        g = Z.T @ (p - y) + P @ w
        H = (Z * (p * (1 - p))[:, None]).T @ Z + P
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    b = w[1:] / sd
    return np.concatenate([[w[0] - (b * mu).sum()], b])


def auc(p, y):
    from scipy.stats import rankdata
    r = rankdata(p)
    n1 = y.sum()
    n0 = len(y) - n1
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def scores(p, y, ref):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    b = float(np.mean((p - y) ** 2))
    br = float(np.mean((ref - y) ** 2))
    return {"brier": b, "bss": 1 - b / br if br > 0 else float("nan"), "auc": auc(p, y),
            "logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), "n": int(len(y)),
            "event_rate": float(y.mean())}


def reliability(p, y, bins=10):
    k = np.minimum((p * bins).astype(int), bins - 1)
    return [[round(float(p[k == b].mean()), 4), round(float(y[k == b].mean()), 4), int((k == b).sum())]
            for b in range(bins) if (k == b).any()]


# ---------------------------------------------------------------- model: data
class Data:
    """Everything on one daily axis: day 0 = WX_START. Fire data covers FIRE_FIRST..WX_END."""

    def __init__(self, work, dev=False):
        RG = load_regions(work)
        if dev:  # development: only regions already downloaded, renumbered
            keep = [r for r in RG["regions"] if power_file(work, r["lat"], r["lon"]).exists()][:400]
            new = {r["i"]: j for j, r in enumerate(keep)}
            RG["regions"] = [dict(r, i=new[r["i"]]) for r in keep]
            RG["country_regions"] = {k: [[new[i], s, n] for i, s, n in v if i in new]
                                     for k, v in RG["country_regions"].items()}
            RG["country_regions"] = {k: v for k, v in RG["country_regions"].items() if v}
        self.R = RG
        reg = RG["regions"]
        self.nr = len(reg)
        self.lat = np.array([r["lat"] for r in reg])
        self.lon = np.array([r["lon"] for r in reg])
        self.zone = np.array([zone_of(a) for a in self.lat])
        self.cont = np.array([continent_of(a, o) for a, o in zip(self.lat, self.lon)])
        self.days = [WX_START + dt.timedelta(i) for i in range((WX_END - WX_START).days + 1)]
        nd = len(self.days)
        self.doy = np.array([doy365(d) for d in self.days])
        self.hm = np.array([half_month(d) for d in self.days])
        self.year = np.array([d.year for d in self.days])
        self.feb29 = np.array([d.month == 2 and d.day == 29 for d in self.days])

        # truth: hotspots per region and day
        con = duckdb.connect()
        idx = {(r["band"], r["col"]): r["i"] for r in reg}
        rows = con.execute(f"""SELECT band, col, d, sum(n)::INT FROM read_parquet('{work / 'cell_day_*.parquet'}')
                               GROUP BY 1, 2, 3""").fetchall()
        hot = np.zeros((self.nr, nd), np.int32)
        tot = np.zeros(nd)
        for b, c, d, n in rows:
            t = (d - WX_START).days
            tot[t] += n
            i = idx.get((b, c))
            if i is not None:
                hot[i, t] += n
        # outages: days with no data or a global total far below the surrounding month
        first = (FIRE_FIRST - WX_START).days
        bad = np.zeros(nd, bool)
        bad[:first] = True
        for t in range(first, nd):
            ref = np.median(tot[max(first, t - 30): t + 31])
            bad[t] = tot[t] < OUTAGE_FRAC * ref
        self.outage_days = [self.days[t].isoformat() for t in np.where(bad)[0] if t >= first]
        self.hot = hot
        c = np.cumsum(np.pad(hot, ((0, 0), (1, 0))), axis=1)
        cb = np.cumsum(np.pad(bad.astype(int), (1, 0)))
        self.count14 = np.full((self.nr, nd), np.nan)
        self.count14[:, : nd - HORIZON + 1] = c[:, HORIZON:] - c[:, : nd - HORIZON + 1]
        ok = np.zeros(nd, bool)
        ok[: nd - HORIZON + 1] = (cb[HORIZON:] - cb[: nd - HORIZON + 1]) == 0
        ok &= ~self.feb29
        ok[:PRIOR] = False
        self.valid = ok  # issue days whose 14-day window is fully observed
        print(f"truth: {hot.sum():,} hotspots in regions ({hot.sum() / tot.sum():.2%} of all), "
              f"{len(self.outage_days)} outage days, {ok.sum()} valid issue days", flush=True)

        # weather
        t0 = time.time()
        wx = np.stack([read_power(work, r["lat"], r["lon"]) for r in reg])  # [r, day, param]
        nmiss = int(np.isnan(wx).sum())
        if nmiss:  # fill rare gaps along time
            for i, j in zip(*np.where(np.isnan(wx).any(1))):
                s = wx[i, :, j]
                m = np.isnan(s)
                s[m] = np.interp(np.where(m)[0], np.where(~m)[0], s[~m])
        print(f"weather: {wx.shape}, {nmiss} missing values filled ({time.time() - t0:.0f}s)", flush=True)
        P = {p: wx[..., k] for k, p in enumerate(POWER_PARAMS)}
        self.daily = {
            "tmax": P["T2M_MAX"], "rhmin": rh_min(P["T2M_MAX"], P["T2MDEW"]),
            "prec": np.maximum(P["PRECTOTCORR"], 0), "wind": P["WS10M"],
        }
        self.feat = self.weather_features()

    def weather_features(self):
        cs = {k: np.cumsum(np.pad(v.astype(float), ((0, 0), (1, 0))), axis=1) for k, v in self.daily.items()}
        cs["dry"] = np.cumsum(np.pad((self.daily["prec"] < 1.0).astype(float), ((0, 0), (1, 0))), axis=1)
        nd = len(self.days)
        t = np.arange(PRIOR, nd - HORIZON + 1)

        def nxt(k, h):
            return (cs[k][:, t + h] - cs[k][:, t]) / h

        F = {
            "tmax14": nxt("tmax", 14), "rhmin14": nxt("rhmin", 14), "prec14": np.log1p(nxt("prec", 14) * 14),
            "wind14": nxt("wind", 14), "prec30": np.log1p(cs["prec"][:, t] - cs["prec"][:, t - PRIOR]),
            "tmax7": nxt("tmax", 7), "rhmin7": nxt("rhmin", 7), "prec7": np.log1p(nxt("prec", 7) * 7),
            "wind7": nxt("wind", 7), "dry14": nxt("dry", 14),
        }
        out = {}
        for k, v in F.items():
            a = np.full((self.nr, nd), np.nan, np.float32)
            a[:, t] = v
            out[k] = a
        return out


# ---------------------------------------------------------------- model: climatologies
def hm_window_mask(W):
    """M[hm, doy] = 1 if day-of-year doy is within W days (circular) of half-month hm."""
    ref = dt.date(2001, 1, 1)
    hm_of = np.array([half_month(ref + dt.timedelta(d)) for d in range(365)])
    M = np.zeros((NHM, 365))
    for k in range(NHM):
        ds = np.where(hm_of == k)[0]
        for o in range(-W, W + 1):
            M[k, (ds + o) % 365] = 1
    return M


class FireClim:
    """Per-year event counts by region and half-month window, so any years can be left out cheaply."""

    def __init__(self, D, event, thr):
        """event: 'any' or 'above'. thr[r, hm]: count threshold for 'above' (event = count14 > thr)."""
        ys = list(range(Y0, Y1 + 1))
        self.ys = ys
        M = hm_window_mask(CLIM_W)
        self.K = np.zeros((D.nr, len(ys), NHM))
        self.N = np.zeros((D.nr, len(ys), NHM))
        for yi, Y in enumerate(ys):
            sel = np.where((D.year == Y) & D.valid)[0]
            e = event_of(D, sel, event, thr)
            Md = M[:, D.doy[sel]]  # [hm, days]
            self.K[:, yi] = e @ Md.T
            self.N[:, yi] = np.ones_like(e) @ Md.T

    def rate(self, exclude=()):
        ex = [y - Y0 for y in exclude]
        K = self.K.sum(1) - (self.K[:, ex].sum(1) if ex else 0)
        N = self.N.sum(1) - (self.N[:, ex].sum(1) if ex else 0)
        p0 = K.sum(1, keepdims=True) / np.maximum(N.sum(1, keepdims=True), 1)
        p = np.clip((K + CLIM_A * p0) / (N + CLIM_A), *P_CLIP)
        return np.round(p * 1000) / 1000  # [r, hm], as shipped (thousandths)


def event_of(D, sel, event, thr):
    c = D.count14[:, sel]
    if event == "any":
        return (c > 0).astype(float)
    return (c > thr[:, D.hm[sel]]).astype(float)


def above_threshold(D, exclude=()):
    """thr[r, hm]: median 14-day hotspot count over valid issue days within CLIM_W days of the half-month,
    in the years not excluded. The 'above' event is count14 > thr (so with a median of 0 it is 'any')."""
    M = hm_window_mask(CLIM_W)
    keep = D.valid & ~np.isin(D.year, list(exclude))
    thr = np.zeros((D.nr, NHM))
    for k in range(NHM):
        sel = np.where(keep & (M[k, D.doy] > 0))[0]
        thr[:, k] = np.median(D.count14[:, sel], axis=1)
    return np.floor(thr)  # medians of an even count can be x.5; floor keeps "more than" an integer rule


def wx_clim(D, name, years):
    """Per-region harmonic fit of a feature's seasonal mean and sd over the given years.
    Returns (mu_coef [r, 2*NHARM+1], sd_coef [r, 2*NHARM+1])."""
    F = D.feat[name]
    sel = np.where(np.isin(D.year, list(years)) & ~np.isnan(F[0]) & ~D.feb29)[0]
    H = harmonics(D.doy[sel])
    Y = F[:, sel].astype(float).T  # [days, r]
    G = np.linalg.solve(H.T @ H, H.T)
    mu = (G @ Y).T
    res2 = (Y - H @ mu.T) ** 2
    v = (G @ res2).T
    floor = 0.25 * np.sqrt(res2.mean(0))  # never let the sd fall below a quarter of the year-round sd
    return mu, v, floor


def wx_sd(H, v, floor):
    return np.maximum(np.sqrt(np.maximum(H @ v.T, 0)), floor[None, :]).T  # [r, days]


def anomalies(D, names, years, sel):
    """Standardised anomalies [len(sel), len(names)] at issue days sel (all regions, flattened r-major),
    using climatology fitted on `years`. Also returns the fitted climatology."""
    H = harmonics(D.doy[sel])
    out, clim = [], {}
    for nm in names:
        mu, v, floor = wx_clim(D, nm, years)
        sd = wx_sd(H, v, floor)
        z = (D.feat[nm][:, sel] - (H @ mu.T).T) / sd
        out.append(np.clip(z, -Z_CLIP, Z_CLIP).ravel())
        clim[nm] = (mu, v, floor)
    return np.column_stack(out), clim


# ---------------------------------------------------------------- model: backtest
SHIP = ["tmax14", "rhmin14", "prec14", "prec30"]
VARIANTS = {
    "climatology": None,
    "recalibrated climatology": [],
    "past 30 days of rain only (no forecast needed)": ["prec30"],
    "observed next 7 days + past 30": ["tmax7", "rhmin7", "prec7", "prec30"],
    "shipped: observed next 14 days + past 30": SHIP,
    "shipped + wind": SHIP + ["wind14"],
    "shipped + share of dry days": SHIP + ["dry14"],
    "shipped, weather effects per climate zone": "zone",
    "shipped, test inputs blurred by the Aug-Sep source gap (simulation)": ("noise", "fit", None),
    "shipped, test inputs blurred by the full source gap (simulation)": ("noise", "full", None),
    "trained for the full source gap, tested on observed weather": ("noise", None, "full"),
    "trained for the full source gap, tested with it (simulation)": ("noise", "full", "full"),
}
# sd of the Open-Meteo minus POWER gap in the standardised inputs (Gaussian sd = 1.25 x mean absolute gap).
# "fit": after the per-region adjustment, on days inside the 14 Aug - 30 Sep window it was learned on
#        (source check A). "full": the gap with no adjustment, which is what the adjustment is worth outside
#        that window: re-checked on 13-30 October and 1-12 November, the predicted chances from the two sources
#        agreed no better than unadjusted, and live mid-November forecasts showed a standardised humidity spread
#        of about 2 (expected 1). Source check B (no adjustment, full overlap) gives 1.25 x mean |gap| of about
#        1.57 (tmax14), 1.71 (rhmin14), 0.99 (prec14) and 1.17 (prec30); the values below are rounded up from an
#        earlier partial check, so they err on the side of more noise.
NOISE_SD = {
    "fit": {"tmax14": 0.75, "rhmin14": 0.9, "prec14": 1.0, "prec30": 1.0},
    "full": {"tmax14": 2.0, "rhmin14": 1.85, "prec14": 1.1, "prec30": 1.35},
}
# The shipped model is fitted on inputs blurred by the full source gap, so its weather effects are shrunk to
# what survives live inputs that are that far off (regression calibration for noisy inputs).
TRAIN_NOISE = "full"
TRAIN_SEED = 20261115
SHIPPED = "trained for the full source gap, tested on observed weather"  # the shipped model, observed weather
SHIPPED_LIVE = "trained for the full source gap, tested with it (simulation)"  # the same, with live-sized input error
OBSERVED_ONLY = "shipped: observed next 14 days + past 30"  # trained on clean inputs (the first model)


def design(Xz, names, base_logit, zone_rows, ids):
    if ids == "zone":
        cols = [base_logit] + [(zone_rows == z).astype(float) for z in range(1, len(ZONES))]
        for z in range(len(ZONES)):
            m = (zone_rows == z).astype(float)
            cols += [Xz[:, names.index(n)] * m for n in SHIP]
        return np.column_stack(cols)
    return np.column_stack([base_logit] + [Xz[:, names.index(n)] for n in ids])


def blur(X, sd, rng):
    """X with columns [base logit, *SHIP]: the weather columns plus Gaussian error of the given sd, clipped."""
    X = X.copy()
    for j, n in enumerate(SHIP):
        X[:, j + 1] = np.clip(X[:, j + 1] + rng.normal(0, sd[n], len(X)), -Z_CLIP, Z_CLIP)
    return X


def issue_rows(D):
    first = (FIRE_FIRST - WX_START).days
    t = np.arange(len(D.days))
    return np.where(D.valid & ((t - first) % ISSUE_EVERY == 0))[0]


def backtest(D, event):
    sel = issue_rows(D)
    names = SHIP + ["wind14", "tmax7", "rhmin7", "prec7", "dry14"]
    nr, ns = D.nr, len(sel)
    yr = np.tile(D.year[sel], nr)
    hm = np.tile(D.hm[sel], nr)
    reg = np.repeat(np.arange(nr), ns)
    zone_rows = D.zone[reg]
    preds = {k: np.zeros(nr * ns) for k in VARIANTS}
    y_all = np.zeros(nr * ns)
    t0 = time.time()
    for Y in range(Y0, Y1 + 1):
        others = [y for y in range(Y0, Y1 + 1) if y != Y]
        thr = above_threshold(D, (Y,)) if event == "above" else None
        y_all_fold = event_of(D, sel, event, thr).ravel()
        fc = FireClim(D, event, thr)
        Xz, _ = anomalies(D, names, others, sel)
        te = yr == Y
        tr = ~te
        base = np.zeros(nr * ns)
        base[te] = fc.rate((Y,))[reg[te], hm[te]]
        for yy in others:
            m = yr == yy
            base[m] = fc.rate((yy, Y))[reg[m], hm[m]]
        bl = logit(base)
        y_all[te] = y_all_fold[te]
        for vi, (k, ids) in enumerate(VARIANTS.items()):
            if ids is None:
                preds[k][te] = base[te]
                continue
            noisy = isinstance(ids, tuple)
            X = design(Xz, names, bl, zone_rows, SHIP if noisy else ids)
            Xtr = X[tr]
            if noisy and ids[2]:
                Xtr = blur(Xtr, NOISE_SD[ids[2]], np.random.default_rng([Y, vi, 1]))
            beta = fit_logistic(Xtr, y_all_fold[tr])
            Xt = X[te]
            if noisy and ids[1]:
                Xt = blur(Xt, NOISE_SD[ids[1]], np.random.default_rng([Y, vi, 2]))
            preds[k][te] = sigmoid(beta[0] + Xt @ beta[1:])
        print(f"  [{event}] fold {Y} done ({time.time() - t0:.0f}s): "
              + ", ".join(f"{k[:12]} {scores(preds[k][te], y_all[te], preds['climatology'][te])['bss']:+.4f}"
                          for k in VARIANTS if VARIANTS[k] is not None), flush=True)
    return {"pred": preds, "y": y_all, "year": yr, "region": reg, "hm": hm}


def wauc(p, y, w):
    """AUC with row weights (ties count half)."""
    u, inv = np.unique(p, return_inverse=True)
    wp = np.bincount(inv, weights=w * (y == 1), minlength=len(u))
    wn = np.bincount(inv, weights=w * (y == 0), minlength=len(u))
    below = np.cumsum(wn) - wn
    W1, W0 = wp.sum(), wn.sum()
    return float((wp * (below + 0.5 * wn)).sum() / (W1 * W0)) if W1 > 0 and W0 > 0 else float("nan")


def used_regions(lst):
    """The regions a country page forecasts, with their shares (as wol.ts countryRegions): those holding at
    least 0.1% of the country's hotspots (shares as shipped, in thousandths), or all of them if none does."""
    used = [(i, s) for i, s, _ in lst if round(s * 1000) >= 1]
    return used or [(i, s) for i, s, _ in lst]


def region_bss(D, bt, p, ref, y):
    out = np.full(D.nr, np.nan)
    ns = len(y) // D.nr  # rows are region-major: region i is rows [i * ns, (i + 1) * ns)
    for i in range(D.nr):
        sl = slice(i * ns, (i + 1) * ns)
        b0 = np.mean((ref[sl] - y[sl]) ** 2)
        if b0 > 0:
            out[i] = 1 - np.mean((p[sl] - y[sl]) ** 2) / b0
    return out


def summarise(D, bt):
    y, P = bt["y"], bt["pred"]
    ref = P["climatology"]
    out = {"variants": {k: rnd(scores(P[k], y, ref)) for k in VARIANTS}}
    p, pl = P[SHIPPED], P[SHIPPED_LIVE]
    sh = lambda m: {"model": rnd(scores(p[m], y[m], ref[m])), "climatology_auc": round(auc(ref[m], y[m]), 4),
                    "live_bss": round(scores(pl[m], y[m], ref[m])["bss"], 4)}
    out["by_year"] = {str(Y): rnd(scores(p[bt["year"] == Y], y[bt["year"] == Y], ref[bt["year"] == Y]))
                      for Y in range(Y0, Y1 + 1)}
    zr, cr = D.zone[bt["region"]], D.cont[bt["region"]]
    out["by_zone"] = {ZONES[z]: sh(zr == z) for z in range(len(ZONES)) if (zr == z).any()}
    out["by_continent"] = {CONTINENTS[c]: sh(cr == c) for c in range(len(CONTINENTS)) if (cr == c).any()}
    out["reliability"] = reliability(p, y)
    out["reliability_live"] = reliability(pl, y)
    out["reliability_climatology"] = reliability(ref, y)
    # per country: the rows of the regions its page forecasts, each region weighted by its share of the
    # country's hotspots, so a neighbour's fire in a shared cell counts only as much as the country's own.
    # [bss observed weather, auc, auc of the usual odds, rows, events, bss with live-sized input error]
    ns = len(y) // D.nr
    byc = {}
    for k, lst in D.R["country_regions"].items():
        used = used_regions(lst)
        idx = np.concatenate([np.arange(i * ns, (i + 1) * ns) for i, _ in used])
        w = np.repeat([max(s, 1e-6) for _, s in used], ns)
        yy, rr = y[idx], ref[idx]
        if yy.sum() == 0 or yy.sum() == len(yy):
            byc[k] = None
            continue
        b0 = np.average((rr - yy) ** 2, weights=w)
        wb = lambda q: round(float(1 - np.average((q[idx] - yy) ** 2, weights=w) / b0), 4)
        byc[k] = [wb(p), round(wauc(p[idx], yy, w), 3), round(wauc(rr, yy, w), 3), int(len(idx)), int(yy.sum()), wb(pl)]
    out["by_country"] = byc
    # per region skill, to flag where the model does not beat climatology
    reg_bss = region_bss(D, bt, p, ref, y)
    reg_live = region_bss(D, bt, pl, ref, y)
    out["regions_beating_climatology"] = round(float(np.mean(reg_bss[~np.isnan(reg_bss)] > 0)), 4)
    out["regions_beating_climatology_live"] = round(float(np.mean(reg_live[~np.isnan(reg_live)] > 0)), 4)
    out["region_bss_live"] = [None if np.isnan(v) else round(float(v), 3) for v in reg_live]
    return out, reg_bss


def rnd(d):
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()}


# ---------------------------------------------------------------- model: final fit and output
FEATURE_DECIMALS = {"tmax14": 2, "rhmin14": 2, "prec14": 3, "prec30": 3}
OM_DAILY = "temperature_2m_max,dew_point_2m_mean,precipitation_sum"


def final_fit(D, event):
    """Fit the shipped model on all years. Training rows use a base rate that leaves their own year
    out, as the page always forecasts a year the climatology has not seen."""
    sel = issue_rows(D)
    nr, ns = D.nr, len(sel)
    yr = np.tile(D.year[sel], nr)
    hm = np.tile(D.hm[sel], nr)
    reg = np.repeat(np.arange(nr), ns)
    thr = above_threshold(D) if event == "above" else np.zeros((nr, NHM))
    y = event_of(D, sel, event, thr).ravel()
    fc = FireClim(D, event, thr)
    base = np.zeros(nr * ns)
    for yy in range(Y0, Y1 + 1):
        m = yr == yy
        base[m] = fc.rate((yy,))[reg[m], hm[m]]
    years = list(range(Y0, Y1 + 1))
    Xz, clim = anomalies(D, SHIP, years, sel)
    X = np.column_stack([logit(base), Xz])
    if TRAIN_NOISE:
        X = blur(X, NOISE_SD[TRAIN_NOISE], np.random.default_rng(TRAIN_SEED))
    beta = fit_logistic(X, y)
    # "normal" is the same model with every weather anomaly at 0 (average weather), so p - normal is the
    # weather's effect alone. It is stored as norm_coef = [intercept, clim] of the model.
    norm = beta[:2]
    return {"beta": beta, "norm": norm, "base": fc.rate(), "thr": thr, "clim": clim}


def pack_clim(clim):
    out = {}
    for nm in SHIP:
        mu, v, floor = clim[nm]
        dcm = FEATURE_DECIMALS[nm]
        q = lambda a: [round(float(x), dcm) for x in np.asarray(a).ravel()]
        out[nm] = {"mu": q(mu), "var": q(v), "floor": q(floor)}
    return out


def outlook_from_daily(O, ri, today_iso, tmax, tdew, prec, adjust=True):
    """The page's computation, step for step as in CONTRACT.md. Arrays hold 44 days of Open-Meteo values:
    the 30 days before today (index 0..29), today (30) and the 13 days after (31..43)."""
    T, Hh = O["prior"], O["horizon"]
    at = O["adjust"]["tmax"][ri] if adjust else 0.0
    ad = O["adjust"]["tdew"][ri] if adjust else 0.0
    ps = O["adjust"]["prec"][ri] if adjust and "prec" in O["adjust"] else 1.0
    tmax = [v - at for v in tmax]  # Open-Meteo minus the region's offset = POWER-like value
    tdew = [v - ad for v in tdew]
    prec = [max(0.0, v) * ps for v in prec]
    K = 2 * O["nharm"] + 1
    d = dt.date.fromisoformat(today_iso)
    doy, hm = doy365(d), half_month(d)
    a = 2 * math.pi * doy / 365
    h = [1.0]
    for k in range(1, O["nharm"] + 1):
        h += [math.cos(k * a), math.sin(k * a)]
    es = lambda t: math.exp(17.62 * t / (243.12 + t))
    nxt = range(T, T + Hh)
    x = {
        "tmax14": sum(tmax[i] for i in nxt) / Hh,
        "rhmin14": sum(min(100.0, 100.0 * es(tdew[i]) / es(tmax[i])) for i in nxt) / Hh,
        "prec14": math.log1p(sum(max(0.0, prec[i]) for i in nxt)),
        "prec30": math.log1p(sum(max(0.0, prec[i]) for i in range(0, T))),
    }
    base = O["base"][ri * 24 + hm] / 1000
    z = O["coef"][0] + O["coef"][1] * math.log(base / (1 - base))
    if not (O["p_clip"][0] <= base <= O["p_clip"][1]):
        raise ValueError("base out of range")
    zs = []
    for j, f in enumerate(O["features"]):
        C = O["clim"][f["id"]]
        mu = sum(h[k] * C["mu"][ri * K + k] for k in range(K))
        var = sum(h[k] * C["var"][ri * K + k] for k in range(K))
        sd = max(math.sqrt(max(var, 0.0)), C["floor"][ri])
        zz = max(-O["z_clip"], min(O["z_clip"], (x[f["id"]] - mu) / sd))
        zs.append(zz)
        z += O["coef"][j + 2] * zz
    p = 1 / (1 + math.exp(-z))
    nz = O["norm_coef"][0] + O["norm_coef"][1] * math.log(base / (1 - base))
    norm = 1 / (1 + math.exp(-nz))
    return {"doy": doy, "hm": hm, "base": base, "x": x, "z_anom": zs, "logit": z, "p": p,
            "ratio": p / base, "norm": norm, "wx_ratio": p / norm}


def worked_examples(O, om, cases):
    """Examples built from real Open-Meteo days (the overlap fetch), laid out exactly like a forecast
    response with past_days=30: index 30 is 'today'."""
    out = []
    for ri, today in cases:
        t = (dt.date.fromisoformat(today) - OVERLAP[0]).days
        sl = slice(t - PRIOR, t + HORIZON)
        arr = lambda a: [round(float(v), 2) for v in a[ri, sl]]
        tmax, tdew, prec = arr(om["tmax"]), arr(om["tdew"]), arr(om["prec"])
        o = outlook_from_daily(O, ri, today, tmax, tdew, prec)
        out.append({
            "region": ri, "lat": O["regions"]["lat"][ri], "lon": O["regions"]["lon"][ri], "today": today,
            "countries": [k for k, lst in O["countries"].items() if any(i == ri for i, _ in lst)],
            "time0": (dt.date.fromisoformat(today) - dt.timedelta(days=PRIOR)).isoformat(),
            "temperature_2m_max": tmax, "dew_point_2m_mean": tdew, "precipitation_sum": prec,
            "expect": {"doy": o["doy"], "hm": o["hm"], "base": o["base"],
                       "x": {k: round(v, 6) for k, v in o["x"].items()},
                       "z_anom": [round(v, 6) for v in o["z_anom"]], "logit": round(o["logit"], 6),
                       "p": round(o["p"], 6), "ratio": round(o["ratio"], 6), "norm": round(o["norm"], 6),
                       "wx_ratio": round(o["wx_ratio"], 6)},
            "threshold": O["thr"][ri * 24 + o["hm"]],
        })
    return out


PREC_K = 10.0  # mm added to both totals when scaling rain, so short or dry overlaps stay near 1


def source_adjust(om, pw, days, rain=True):
    """Per-region offsets (Open-Meteo minus POWER) of daily max temperature and dew point over `days`,
    and a rain scale factor (POWER total + K) / (Open-Meteo total + K), clipped to [0.25, 4]."""
    out = {k: np.nanmean(om[k][:, days] - pw[k][:, days], axis=1) for k in ("tmax", "tdew")}
    if rain:
        so = np.nansum(np.maximum(om["prec"][:, days], 0), axis=1)
        sp = np.nansum(np.maximum(pw["prec"][:, days], 0), axis=1)
        out["prec"] = np.clip((sp + PREC_K) / (so + PREC_K), 0.25, 4.0)
    return out


def source_check(O, om, pw):
    """How far apart are the model's inputs and outputs when the same days come from Open-Meteo instead of
    POWER (both are observations/analyses here, no forecast)?
    Test A (out of sample): offsets fitted on the first 24 days of the overlap; compared on the 14-day
    windows that lie in the last 24 days. The 30 prior days are set equal for both sources (POWER where
    available, else 0 mm), so only the next-14-day inputs differ.
    Test B (in sample): offsets from all overlap days; full 44-day windows."""
    nd = om["tmax"].shape[1]
    nreg = len(O["regions"]["lat"])
    fit_half = nd // 2
    out = {}
    tests = (
        ("A: no adjustment", None, range(fit_half, nd - HORIZON + 1), True),
        ("A: offsets from the first half, tested on the second half", np.arange(fit_half), range(fit_half, nd - HORIZON + 1), True),
        ("A: offsets and rain scale from the first half, tested on the second half", "rain", range(fit_half, nd - HORIZON + 1), True),
        ("B: no adjustment", None, range(PRIOR, nd - HORIZON + 1), False),
        ("B: offsets from all days, in sample", np.arange(nd), range(PRIOR, nd - HORIZON + 1), False),
    )
    for label, fit_days, issue, next_only in tests:
        O2 = dict(O)
        if fit_days is None:
            O2["adjust"] = {k: [0.0] * nreg for k in ("tmax", "tdew")}
        else:
            adj = (source_adjust(om, pw, np.arange(fit_half)) if isinstance(fit_days, str)
                   else source_adjust(om, pw, fit_days, rain=False))
            O2["adjust"] = {k: [float(v) for v in adj[k]] for k in adj}
        zo, zp, po, pp = [], [], [], []
        for ri in range(nreg):
            for t in issue:
                def window(src, k):
                    v = np.full(PRIOR + HORIZON, 0.0)
                    lo = t - PRIOR
                    for i in range(PRIOR + HORIZON):
                        d = lo + i
                        if next_only and i < PRIOR:
                            v[i] = pw[k][ri, d] if 0 <= d < nd else 0.0
                        else:
                            v[i] = src[k][ri, d]
                    return list(v)
                a = [window(om, k) for k in ("tmax", "tdew", "prec")]
                b2 = [window(pw, k) for k in ("tmax", "tdew", "prec")]
                if any(np.isnan(x).any() for x in a + b2):
                    continue
                today = (OVERLAP[0] + dt.timedelta(days=t)).isoformat()
                A = outlook_from_daily(O2, ri, today, *a)
                B = outlook_from_daily(O2, ri, today, *b2, adjust=False)
                zo.append(A["z_anom"]), zp.append(B["z_anom"]), po.append(A["p"]), pp.append(B["p"])
        zo, zp, po, pp = map(np.array, (zo, zp, po, pp))
        feats = [f["id"] for f in O["features"]]
        out[label] = {
            "n": int(len(po)),
            "features": {f: {"mean_z_diff": round(float((zo[:, j] - zp[:, j]).mean()), 3),
                             "mean_abs_z_diff": round(float(np.abs(zo[:, j] - zp[:, j]).mean()), 3),
                             "corr_z": round(float(np.corrcoef(zo[:, j], zp[:, j])[0, 1]), 3)}
                         for j, f in enumerate(feats) if not (next_only and f == "prec30")},
            "p_mean_diff": round(float((po - pp).mean()), 4), "p_mean_abs_diff": round(float(np.abs(po - pp).mean()), 4),
            "p_corr": round(float(np.corrcoef(po, pp)[0, 1]), 4),
        }
        print(f"source check [{label}]: {out[label]}", flush=True)
    return out


EVENTS = {
    "any": "at least one VIIRS (Suomi NPP) hotspot in the region in the 14 days starting on the issue day",
    "above": ("more VIIRS (Suomi NPP) hotspots in the region in the 14 days starting on the issue day than "
              "the region's usual (median) 14-day count for that half-month, 2012-2025; where the usual "
              "count is 0 this is simply 'at least one hotspot'"),
}
SHIPPED_EVENT = "above"


def stage_model(work, out_path, events=("any", "above"), dev=False):
    D = Data(work, dev=dev)
    D.work = work
    summaries = {}
    for ev in events:
        f = work / f"backtest_{ev}{'_dev' if dev else ''}.json"
        bt = backtest(D, ev)
        s, reg_bss = summarise(D, bt)
        s["region_bss"] = [None if np.isnan(v) else round(float(v), 3) for v in reg_bss]
        f.write_text(json.dumps(s))
        summaries[ev] = s
        print(f"== event '{ev}'", flush=True)
        for k, m in s["variants"].items():
            print(f"   {k:52s} brier {m['brier']:.4f} bss {m['bss']:+.4f} auc {m['auc']:.4f} "
                  f"logloss {m['logloss']:.4f} rate {m['event_rate']:.3f} n {m['n']}", flush=True)
        for grp in ("by_zone", "by_continent"):
            for k, m in s[grp].items():
                print(f"   {k:30s} bss {m['model']['bss']:+.4f} auc {m['model']['auc']:.3f} "
                      f"(clim auc {m['climatology_auc']:.3f}) n {m['model']['n']}", flush=True)
        print("   by year: " + ", ".join(f"{Y} {m['bss']:+.3f}" for Y, m in s["by_year"].items()), flush=True)
        print(f"   regions beating climatology: {s['regions_beating_climatology']:.1%}", flush=True)
    for ev in EVENTS:  # reuse saved backtests (the "output" stage)
        f = work / f"backtest_{ev}{'_dev' if dev else ''}.json"
        if ev not in summaries and f.exists():
            summaries[ev] = json.loads(f.read_text())
    write_output(D, summaries, out_path)


def write_output(D, summaries, out_path):
    ev = SHIPPED_EVENT
    S = summaries[ev]
    fit = final_fit(D, ev)
    beta, norm = fit["beta"], fit["norm"]
    print(f"final coefficients [intercept, clim, {', '.join(SHIP)}] = {np.round(beta, 4).tolist()}", flush=True)
    regs = D.R["regions"]
    O = {
        "v": 1,
        "built": dt.date.today().isoformat(),
        "event": {"id": ev, "text": EVENTS[ev]},
        "horizon": HORIZON, "prior": PRIOR, "nharm": NHARM, "z_clip": Z_CLIP, "p_clip": list(P_CLIP),
        "grid": {"band_deg": BAND_DEG, "nbands": NBANDS, "cols": "max(1, round(144 * cos(radians(-90 + 2.5 * (band + 0.5)))))",
                 "min_fire_days": MIN_FIRE_DAYS, "cells_with_any_hotspot": D.R["cells_with_any_hotspot"]},
        "regions": {
            "band": [r["band"] for r in regs], "col": [r["col"] for r in regs],
            "lat": [r["lat"] for r in regs], "lon": [r["lon"] for r in regs],
            "zone": D.zone.tolist(), "cont": D.cont.tolist(),
            "bss": [None if v is None else round(v, 3) for v in S["region_bss"]],
            "bss_live": S["region_bss_live"],
        },
        "zones": list(ZONES), "continents": list(CONTINENTS),
        "countries": {k: [[i, round(s * 1000)] for i, s, _ in lst] for k, lst in D.R["country_regions"].items()},
        "no_region": D.R["countries_without_region"],
        "base": np.round(fit["base"] * 1000).astype(int).ravel().tolist(),
        "thr": fit["thr"].astype(int).ravel().tolist(),
        "features": [{"id": n, "window": WX_FEATURES[n][0], "label": WX_FEATURES[n][1]} for n in SHIP],
        "clim": pack_clim(fit["clim"]),
        "coef": [round(float(b), 5) for b in beta],
        "norm_coef": [round(float(b), 5) for b in norm],
        "api": {"url": OM_URL,
                "params": {"daily": OM_DAILY, "past_days": PRIOR, "forecast_days": 16, "timezone": "auto"},
                "max_points_per_get": 250},
        "adjust": None,
        "metrics": {k: v for k, v in S.items() if k not in ("region_bss", "region_bss_live")},
        "noise_sd": NOISE_SD, "train_noise": TRAIN_NOISE,
        "metrics_other_event": {k: summaries[k]["variants"] for k in summaries if k != ev},
        "outage_days": D.outage_days,
        "method": METHOD,
    }
    partial = os.environ.get("WORLD_OUTLOOK_PARTIAL") == "1"
    om, pw = load_overlap(D.work, regs, partial)
    adj = source_adjust(om, pw, np.arange(om["tmax"].shape[1]))
    if partial:
        print("WARNING: partial overlap, development output only", flush=True)
        adj = {k: np.nan_to_num(v) for k, v in adj.items()}
    O["adjust"] = {"from": [OVERLAP[0].isoformat(), OVERLAP[1].isoformat()],
                   **{k: [round(float(v), 2) for v in adj[k]] for k in adj}}
    O["source_check"] = source_check(O, om, pw)
    O["examples"] = worked_examples(O, om, pick_examples(D))
    txt = "window.WORLD_OUTLOOK = " + json.dumps(O, separators=(",", ":")) + ";\n"
    out_path.write_text(txt)
    print(f"wrote {out_path} ({len(txt):,} bytes)", flush=True)
    for e in O["examples"]:
        print(f"example region {e['region']} {e['countries']} {e['today']}: {e['expect']}", flush=True)


def pick_examples(D):
    """Two regions and dates inside the Open-Meteo overlap (so the inputs are real Open-Meteo values)."""
    out = []
    for la, lo, day in ((-15.6, -56.1, "2026-09-14"), (-12.5, 18.5, "2026-09-16")):
        b, c = cell_of(la, lo)
        i = next((r["i"] for r in D.R["regions"] if r["band"] == b and r["col"] == c), 0)
        out.append((i, day))
    return out


METHOD = (
    "A pooled logistic regression for about 2,100 regions on a 2.5 degree grid (cells about 280 km across). "
    "Inputs: the region's usual chance of the event for this half-month (VIIRS Suomi NPP, 2012-2025), and "
    "four weather anomalies, each standardised against the region's own NASA POWER (MERRA-2) climate for the "
    "day of the year: mean maximum temperature, mean daily minimum humidity and total rain over the next "
    "14 days, and total rain over the past 30 days. Live weather comes from Open-Meteo's forecast, shifted "
    "per region by the average gap between Open-Meteo and POWER in temperature and dew point, and scaled "
    "for rain, using 48 days both sources cover (14 August - 30 September 2026). That correction does not "
    "hold in other months, so the model is fitted on weather inputs blurred by the full uncorrected gap "
    "between the sources (noise_sd.full), which shrinks its weather effects to what survives such inputs. "
    "'Normal' is the same model with every weather anomaly at 0 (norm_coef = its first two coefficients). "
    "Tested by leaving out one year at a time (2012-2025) against the usual chance alone. The test used "
    "observed weather (POWER) for the next 14 days, with and without simulated errors the size of the source "
    "gap; it never used a real forecast, so live skill is lower, especially in the second week, and may be "
    "no better than the usual odds."
)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--hf", type=Path, default=ROOT / "build" / "hf")
    ap.add_argument("--work", type=Path, default=ROOT / "build" / "world_outlook")
    ap.add_argument("--out", type=Path, default=ROOT / "world_outlook.js")
    ap.add_argument("--stage", default="all", choices=["extract", "regions", "fetch", "overlap", "model", "output", "all"])
    ap.add_argument("--dev", action="store_true", help="model on the first 400 downloaded regions only")
    a = ap.parse_args()
    if a.stage in ("extract", "all"):
        stage_extract(a.hf, a.work)
    if a.stage in ("regions", "all"):
        stage_regions(a.work)
    if a.stage in ("fetch", "all"):
        stage_fetch(a.work)
    if a.stage in ("overlap", "all"):
        stage_overlap(a.work)
    if a.stage in ("model", "all"):
        stage_model(a.work, a.out, dev=a.dev)
    if a.stage == "output":  # rewrite world_outlook.js from the saved backtests
        stage_model(a.work, a.out, events=(), dev=a.dev)


if __name__ == "__main__":
    main()
