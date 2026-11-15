"""Assemble summary/v3: summary v2 (2001-2025, copied unchanged) plus 2026 to the last complete day.

Inputs (all read-only):
  V2      build/hf/summary/v2/<Country>.json and index.json
  RAW     the fetch task's folder: viirs-snpp_2026.parquet, viirs-noaa20_2026.parquet, coverage_days.csv,
          daily_counts_2026.parquet, validation/validation_2025_by_country.csv
  WORK    hist_daily.parquet (hist stage), n20_rates.json (rates stage), modis_2026_cells_daily.parquet and
          modis_2026_days.csv (modis stage)
Output: OUT/<Country>.json and OUT/index.json.

2026 in S-NPP terms (monthly.V), day by day for each country (rule in daycls.py): S-NPP detections on the days
S-NPP delivered; NOAA-20 detections times the country's NOAA-20-to-S-NPP rate for that calendar month on the days
S-NPP missed, and on partial S-NPP days whose missing UTC hours hold the country's overpasses; on 12 October, when
both satellites missed many countries' overpasses, the mean of the days either side. The two satellites are never
added on the same day. monthly.N20 is NOAA-20 as observed. Monthly arrays end with the last (partial) month:
December 2026 is absent, not zero. y2026.hist_gaps gives past S-NPP outage months (2018-2025) filled the same way;
monthly.V keeps v2's values for them. y2026.ytd counts January 2012 as the converted MODIS month.
"""
import calendar, csv, datetime as dt, json, math, sys
from collections import defaultdict
from pathlib import Path

import duckdb
import numpy as np

V2, RAW, WORK, OUT = (Path(p) for p in sys.argv[1:5])
Y0, YEAR = 2001, 2026
LAST = dt.date(2026, 11, 14)  # last complete UTC day (NOAA-20); S-NPP's last complete day is 2026-11-01
NMON = LAST.month  # 2026 months present, Jan..Nov
YI = YEAR - Y0  # year index 25
I0 = YI * 12  # monthly index of Jan 2026
N_MONTHS = I0 + NMON  # 311
BINS = [10, 100, 1000]
HIST_Y0 = 2012
SAME_Y0 = 2012  # first year of same-days history (VIIRS from Feb 2012)


def sig(x, n=4):
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0
    v = round(x, n - 1 - int(math.floor(math.log10(abs(x)))))
    return int(v) if v == int(v) and abs(v) < 1e15 else v


def num1(x):
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False, default=lambda x: x.item())


def quant(a):
    a = np.asarray(a, float)
    if a.size == 0:
        return None
    q = np.percentile(a, [0, 25, 50, 75, 100])
    return {"min": num1(q[0]), "q25": num1(q[1]), "median": num1(q[2]), "q75": num1(q[3]), "max": num1(q[4])}


def rank_desc(cur, hist):
    """1 = higher than every past year; ties count in the reader's favour of 'not unusual' (rank among >=)."""
    return 1 + int(sum(1 for h in hist if h >= cur))


# ------------------------------------------------------------------ day classes, per country
# Each country-day takes one source, never two added together: S-NPP as observed (obs), NOAA-20 times the country's
# rate (conv), or, where both satellites missed the country's overpasses (12 Oct 2026), the mean of the days either
# side (interp). The rule is in daycls.py, shared with the New York and California data.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daycls  # noqa: E402

con = duckdb.connect()
DY = daycls.Days(RAW, dt.date(YEAR, 1, 1), LAST, con)
days, status, snpp_short, both_short = DY.days, DY.status, DY.snpp_short, DY.both_short
rates = json.load(open(WORK / "n20_rates.json"))
dc = con.execute(f"SELECT country, sensor, acq_date, n FROM read_parquet('{RAW}/daily_counts_2026.parquet') WHERE acq_date <= DATE '{LAST}'").fetchall()
cnt = defaultdict(dict)  # country -> day -> (S-NPP, NOAA-20)
for c, s_, d, n in dc:
    v = list(cnt[c].get(d, (0, 0)))
    v[0 if s_ == "viirs-snpp" else 1] += int(n)
    cnt[c][d] = tuple(v)
hourly = defaultdict(dict)  # country -> (sensor, day, hour) -> n
for s_, f in daycls.SENSOR_FILES:
    for c, d, h, n in con.execute(f"""SELECT country, acq_date, CAST(substr(acq_time, 1, 2) AS INTEGER) h, count(*) n
            FROM read_parquet('{RAW}/{f}_2026.parquet') WHERE acq_date IN ({DY.window_sql()}) GROUP BY ALL""").fetchall():
        hourly[c][(s_, d, h)] = n
countries_all = sorted(set(cnt) | set(rates["countries"]))
cls, why, interp_src, interp_rng = {}, {}, {}, {}  # keyed by (country, day)
for c in countries_all:
    r = rates["countries"].get(c, {"r": [1.0] * 12})["r"]
    k, w, sr, rg = DY.classify(cnt.get(c, {}), hourly.get(c, {}), r)
    for d in days:
        cls[(c, d)] = k[d]
        if d in w:
            why[(c, d)] = w[d]
    for d in sr:
        interp_src[(c, d)], interp_rng[(c, d)] = sr[d], rg[d]

con.execute("CREATE TEMP TABLE dayclass (country VARCHAR, d DATE, cls VARCHAR)")
con.executemany("INSERT INTO dayclass VALUES (?, ?, ?)", [(c, d, k) for (c, d), k in cls.items()])
con.execute("CREATE TEMP TABLE interp (country VARCHAR, d DATE, src DATE, w DOUBLE)")
con.executemany("INSERT INTO interp VALUES (?, ?, ?, ?)", [(c, d, x, w) for (c, d), v in interp_src.items() for x, w in v])
LA = "CAST(floor(round(latitude * 100000) / 5000) AS INTEGER)"
LO = "CAST(floor(round(longitude * 100000) / 5000) AS INTEGER)"
# S-NPP on the country-days it is used; NOAA-20 on every day to LAST, tagged with the country-day's class
snpp = con.execute(f"""SELECT p.country, {LA} la, {LO} lo, month(acq_date) m, count(*) n FROM read_parquet('{RAW}/viirs-snpp_2026.parquet') p
    JOIN dayclass c ON c.country = p.country AND c.d = p.acq_date AND c.cls = 'obs' GROUP BY ALL ORDER BY ALL""").fetchnumpy()
n20 = con.execute(f"""SELECT p.country, {LA} la, {LO} lo, month(acq_date) m, c.cls, count(*) n FROM read_parquet('{RAW}/viirs-noaa20_2026.parquet') p
    JOIN dayclass c ON c.country = p.country AND c.d = p.acq_date WHERE acq_date <= DATE '{LAST}' GROUP BY ALL ORDER BY ALL""").fetchnumpy()
# interpolated country-days: the source days' cells in S-NPP terms (S-NPP if that day is 'obs', else NOAA-20 x rate later)
interp = con.execute(f"""
    SELECT i.country, {LA} la, {LO} lo, month(i.d) m, month(i.src) ms, 'V' sensor, sum(i.w) n
      FROM read_parquet('{RAW}/viirs-snpp_2026.parquet') p JOIN interp i ON i.country = p.country AND i.src = p.acq_date
      JOIN dayclass c ON c.country = i.country AND c.d = i.src AND c.cls = 'obs' GROUP BY ALL
    UNION ALL
    SELECT i.country, {LA} la, {LO} lo, month(i.d) m, month(i.src) ms, 'N20' sensor, sum(i.w) n
      FROM read_parquet('{RAW}/viirs-noaa20_2026.parquet') p JOIN interp i ON i.country = p.country AND i.src = p.acq_date
      JOIN dayclass c ON c.country = i.country AND c.d = i.src AND c.cls = 'conv' GROUP BY ALL ORDER BY ALL""").fetchnumpy()
modis = con.execute(f"""SELECT country, la, lo, month(acq_date) m, sat, sum(n) n FROM read_parquet('{WORK}/modis_2026_cells_daily.parquet')
    WHERE acq_date <= DATE '{LAST}' GROUP BY ALL ORDER BY ALL""").fetchnumpy()
# cross-check against the fetch task's daily counts
chk = con.execute(f"""SELECT sensor, sum(n) FROM read_parquet('{RAW}/daily_counts_2026.parquet') p JOIN dayclass c ON c.country = p.country AND c.d = p.acq_date
    WHERE sensor = 'viirs-noaa20' OR c.cls = 'obs' GROUP BY 1 ORDER BY 1""").fetchall()
assert dict(chk) == {"viirs-noaa20": int(n20["n"].sum()), "viirs-snpp": int(snpp["n"].sum())}, (chk, n20["n"].sum(), snpp["n"].sum())
print("both-satellite partial days:", [d.isoformat() for d in both_short],
      "| S-NPP short days checked per country:", [d.isoformat() for d in sorted(snpp_short)])
print("country-days: conv because S-NPP missed the country's overpasses", sum(1 for v in why.values() if v.startswith("S-NPP missed this")),
      "| conv because S-NPP under 40% of NOAA-20", sum(1 for v in why.values() if v.startswith("S-NPP saw under")),
      "| S-NPP on a both-partial day", sum(1 for v in why.values() if v.startswith("NOAA-20 partial; S-NPP")),
      "| interpolated", len(interp_src))
for d in DY.check:
    print(" ", d, "missing UTC hours S-NPP", sorted(DY.miss[("V", d)][0]), "NOAA-20", sorted(DY.miss[("N", d)][0]))

modis_days = defaultdict(set)
modis_last = {}
for r in csv.DictReader(open(WORK / "modis_2026_days.csv")):
    d = dt.date.fromisoformat(r["acq_date"])
    if d <= LAST:
        modis_days[r["sat"]].add(d)
modis_missing = {s: [d.isoformat() for d in days if d not in modis_days[s]] for s in ("T", "A")}
for s in ("T", "A"):
    modis_last[s] = max(modis_days[s]).isoformat() if modis_days[s] else None


def by_country(t):
    out = defaultdict(list)
    for i, c in enumerate(t["country"]):
        out[c].append(i)
    return {c: np.array(v) for c, v in out.items()}


ix_s, ix_n, ix_m, ix_i = by_country(snpp), by_country(n20), by_country(modis), by_country(interp)

# ------------------------------------------------------------------ history for like-for-like comparisons
h = con.execute(f"SELECT country, sensor, year(d) y, month(d) m, day(d) dd, n FROM read_parquet('{WORK}/hist_daily.parquet')").fetchnumpy()
# historical S-NPP outage days (world S-NPP count missing or under half of NOAA-20's) from NOAA-20's start: on these
# days v2 (and so v3 before 2026) holds little or no S-NPP data. For like-for-like comparisons with 2026, whose gaps are
# filled from NOAA-20, the same-days and year-to-date history is given both as in v2 and gap-filled the same way.
wv, wn = defaultdict(float), defaultdict(float)
for s_, dd_, n_ in zip(h["sensor"], zip(h["y"], h["m"], h["dd"]), h["n"]):
    (wv if s_ == "V" else wn)[dd_] += n_
GAP = {k for k in wn if k[0] >= 2018 and wn[k] > 0 and wv.get(k, 0) < 0.5 * wn[k]}
same = defaultdict(lambda: defaultdict(float))  # (country, sensor) -> year -> count on days 1..LAST.day of LAST.month
ytd = defaultdict(lambda: defaultdict(float))  # (country, sensor) -> year -> Jan 1 .. LAST month/day
fill = defaultdict(float)  # (country, kind, year) -> change from gap filling (kind 'same' or 'ytd')
gapm = defaultdict(lambda: defaultdict(float))  # country -> month index -> change from gap filling
gapp = defaultdict(lambda: defaultdict(float))  # country -> month index -> converted NOAA-20 added (for the range)
gapdays = defaultdict(list)  # month index -> days
for k in sorted(GAP):
    gapdays[(k[0] - Y0) * 12 + k[1] - 1].append(k[2])
for c, s_, y, m, dd, n in zip(h["country"], h["sensor"], h["y"], h["m"], h["dd"], h["n"]):
    y, m, dd = int(y), int(m), int(dd)
    in_same = m == LAST.month and dd <= LAST.day
    in_ytd = m < LAST.month or in_same
    if in_same:
        same[(c, s_)][y] += n
    if in_ytd:
        ytd[(c, s_)][y] += n
    if (y, m, dd) in GAP:
        delta = n * rates["countries"][c]["r"][m - 1] if s_ == "N20" else -n
        gapm[c][(y - Y0) * 12 + m - 1] += delta
        if s_ == "N20":
            gapp[c][(y - Y0) * 12 + m - 1] += delta
        if in_same:
            fill[(c, "same", y)] += delta
        if in_ytd:
            fill[(c, "ytd", y)] += delta

join25 = {}
for r in csv.DictReader(open(RAW / "validation" / "validation_2025_by_country.csv")):
    join25[(r["country"], r["series"])] = r
WARN_JOIN = 0.05  # |2025 pipeline vs v2| above this (and at least 1,000 detections) gets a warning

MASK_NOTE = (
    "2026 uses a same-year mask like v2's, from VIIRS flags only: a 0.05 degree cell is dropped for all of 2026 when any 2026 VIIRS "
    "detection in it, at any confidence, is a volcano, static land source or offshore (type 1, 2 or 3). v2 also drops cells that MODIS "
    "flags; that was left out for 2026 because adding MODIS flags made the rerun on 2025 worse (median country 1.7% off v2 instead of "
    "0.85%), and it is the main reason gas-flaring countries such as Libya and Iraq differ (see join_check_2025). January-July use "
    "FIRMS's own types (standard processing). From 1 August the data are near real time, which has no type column, so a detection counts "
    "as non-vegetation when an archive VIIRS type 1-3 detection (2021-2025) or a 2026 standard-processing one lies within 0.01 degree. "
    "The task first asked for a mask from the 2023-2025 archive; tested on 2025 it did not reproduce v2 (Canada +92%), because "
    "lakeside fire pixels flagged 'offshore' move with each year's fires, so the same-year rule was kept. MODIS 2026 counts (shown, "
    "not used) drop the VIIRS mask cells plus the cells of 2026 MODIS type 1-3 detections.")
FILTER_2026 = (" 2026: the same confidence and type rules, and a same-year static-source mask from VIIRS flags only (v2 also uses "
               "MODIS flags; see y2026.mask_note); NOAA-20 near-real-time types are inferred; countries are assigned by "
               "point-in-polygon because FIRMS's country files for 2026 are not published.")


def same_days_block(c, cur_v, cur_lo, cur_hi, cur_n20):
    ys = list(range(SAME_Y0, YEAR))
    hv2 = [int(same[(c, "V")].get(y, 0)) for y in ys]
    hv = [int(round(a + fill.get((c, "same", y), 0.0))) for a, y in zip(hv2, ys)]
    yn = list(range(2018, YEAR))
    hn = [same[(c, "N20")].get(y, 0) for y in yn]
    return {
        "m": LAST.month, "day0": 1, "day1": LAST.day,
        "years": [ys[0], ys[-1]], "V": hv, "V_stats": quant(hv), "V_v2": hv2,
        "filled_years": sorted({k[0] for k in GAP if k[1] == LAST.month and k[2] <= LAST.day}),
        "cur": cur_v, "cur_lo": cur_lo, "cur_hi": cur_hi, "rank": rank_desc(cur_v, hv),
        "n20_years": [yn[0], yn[-1]], "N20": [int(x) for x in hn], "N20_stats": quant(hn), "cur_n20": cur_n20,
        "n20_rank": rank_desc(cur_n20, hn),
    }


def ytd_block(c, d, cur_v, cur_lo, cur_hi):
    ys = list(range(SAME_Y0, YEAR))
    hv2 = [int(ytd[(c, "V")].get(y, 0)) for y in ys]
    hv = [int(round(a + fill.get((c, "ytd", y), 0.0))) for a, y in zip(hv2, ys)]
    # S-NPP starts on 20 January 2012, and the record uses VIIRS from February 2012. January 2012 is therefore the
    # MODIS month converted with the country's January rate, as in the monthly record, so 2012 is a whole year to date.
    i = (2012 - Y0) * 12
    jan12 = (d["monthly"]["T"][i] + d["monthly"]["A"][i]) * d["r_ta"][0]
    hv[0] = int(round(hv[0] - d["monthly"]["V"][i] + jan12))
    return {"to": LAST.isoformat()[5:], "years": [ys[0], ys[-1]], "V": hv, "V_stats": quant(hv), "V_v2": hv2,
            "cur": cur_v, "cur_lo": cur_lo, "cur_hi": cur_hi, "rank": rank_desc(cur_v, hv),
            "note": ("V: 2012 counts January 2012 as the MODIS month converted with the country's January rate (S-NPP starts on "
                     "20 January 2012; the record uses VIIRS from February 2012); past Suomi NPP outage days filled from NOAA-20 "
                     "like 2026. V_v2: S-NPP as in v2, with only 20-31 January 2012.")}


def harm_cells(d, ccode, r_n20):
    """2026 cell rows on the country's own v2 grid, appending any new cells."""
    cell = d["cell"]
    step = round(cell * 100000) // 5000
    cells = d["cells"]
    key = {(cells[2 * k], cells[2 * k + 1]): k for k in range(len(cells) // 2)}
    H, M, S = defaultdict(float), defaultdict(int), defaultdict(int)

    def kid(la, lo):
        k = (int(la) // step, int(lo) // step)  # python // floors, as np.floor_divide in v2
        if k not in key:
            key[k] = len(cells) // 2
            cells.extend(k)
        return key[k]

    if ccode in ix_s:
        i = ix_s[ccode]
        for la, lo, n in zip(snpp["la"][i], snpp["lo"][i], snpp["n"][i]):
            k = kid(la, lo); H[k] += n; S[k] += n
    if ccode in ix_n:
        i = ix_n[ccode]
        for la, lo, m, cls, n in zip(n20["la"][i], n20["lo"][i], n20["m"][i], n20["cls"][i], n20["n"][i]):
            if cls == "conv":
                H[kid(la, lo)] += n * r_n20[m - 1]
    if ccode in ix_i:
        i = ix_i[ccode]
        for la, lo, ms, sen, n in zip(interp["la"][i], interp["lo"][i], interp["ms"][i], interp["sensor"][i], interp["n"][i]):
            H[kid(la, lo)] += n if sen == "V" else n * r_n20[ms - 1]
    if ccode in ix_m:
        i = ix_m[ccode]
        for la, lo, n in zip(modis["la"][i], modis["lo"][i], modis["n"][i]):
            M[kid(la, lo)] += int(n)
    las = [int(x) for t, ix in ((snpp, ix_s), (n20, ix_n), (modis, ix_m)) if ccode in ix for x in t["la"][ix[ccode]]]
    los = [int(x) for t, ix in ((snpp, ix_s), (n20, ix_n), (modis, ix_m)) if ccode in ix for x in t["lo"][ix[ccode]]]
    ext = [min(los) * 0.05, min(las) * 0.05, (max(los) + 1) * 0.05, (max(las) + 1) * 0.05] if las else None
    rows = []
    for k in sorted(set(H) | set(M) | set(S)):
        hv = num1(H.get(k, 0.0))
        if hv == 0 and M.get(k, 0) == 0 and S.get(k, 0) == 0:
            continue
        rows += [k, YI, hv, M.get(k, 0), S.get(k, 0)]
    return rows, cells, ext


def hist_gap(d, rt, c, i):
    """a past month with S-NPP outage days, filled from NOAA-20 as 2026 is: value and a 90% range for the converted part"""
    v2 = d["monthly"]["V"][i]
    filled = v2 + gapm[c].get(i, 0.0)
    p = gapp[c].get(i, 0.0)
    if p == 0:
        lo, hi = 0.0, float(rt["zero_hi"])
    else:
        b = 0
        while b < len(BINS) and p > BINS[b]:
            b += 1
        lo, hi = p * rt["pi"][b][0], p * rt["pi"][b][1]
    f = int(round(filled))
    return {"i": i, "days": gapdays[i], "v2": v2, "filled": f, "n20_conv": round(p, 1),
            "lo": min(f, int(math.floor(filled - p + lo))), "hi": max(f, int(math.ceil(filled - p + hi)))}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    idx2 = json.load(open(V2 / "index.json"))
    index = []
    report = []
    for e in idx2["countries"]:
        c = e["country"]
        d = json.load(open(V2 / f"{c}.json"))
        assert d["v"] == 2 and d["y1"] == 2025 and all(len(d["monthly"][s]) == 300 for s in "T A V N20".split())
        rt = rates["countries"][c]
        r_n20 = rt["r"]
        mon = {s: [0] * NMON for s in ("T", "A", "Vobs", "N20", "N20conv")}
        if c in ix_s:
            i = ix_s[c]
            for m, n in zip(snpp["m"][i], snpp["n"][i]):
                mon["Vobs"][m - 1] += int(n)
        if c in ix_n:
            i = ix_n[c]
            for m, kc, n in zip(n20["m"][i], n20["cls"][i], n20["n"][i]):
                mon["N20"][m - 1] += int(n)
                if kc == "conv":
                    mon["N20conv"][m - 1] += int(n)
        if c in ix_m:
            i = ix_m[c]
            for m, s, n in zip(modis["m"][i], modis["sat"][i], modis["n"][i]):
                mon[s][m - 1] += int(n)
        mon["Vint"] = [0.0] * NMON
        if c in ix_i:
            i = ix_i[c]
            for m, ms, sen, n in zip(interp["m"][i], interp["ms"][i], interp["sensor"][i], interp["n"][i]):
                mon["Vint"][m - 1] += n if sen == "V" else n * r_n20[ms - 1]
        days_of = defaultdict(lambda: defaultdict(list))  # kind -> month -> days
        for dd in days:
            k = cls[(c, dd)]
            if k != "obs":
                days_of[k][dd.month].append(dd.day)
            elif (c, dd) in why:
                days_of["obs_partial"][dd.month].append(dd.day)
        v26, vconv, vint, vlo, vhi, conv_months = [], [], [], [], [], []
        for m in range(NMON):
            nc = mon["N20conv"][m]
            p = nc * r_n20[m]
            if days_of["conv"].get(m + 1):
                if p == 0:
                    lo, hi = 0.0, float(rt["zero_hi"])
                else:
                    b = 0
                    while b < len(BINS) and p > BINS[b]:
                        b += 1
                    lo, hi = p * rt["pi"][b][0], p * rt["pi"][b][1]
            else:
                lo = hi = 0.0
            ids = [dt.date(YEAR, m + 1, x) for x in days_of["interp"].get(m + 1, [])]
            q = mon["Vint"][m]
            q_lo = sum(interp_rng[(c, x)][0] for x in ids)
            q_hi = sum(interp_rng[(c, x)][2] for x in ids)
            pc, qc = int(round(p)), int(round(q))
            v26.append(mon["Vobs"][m] + pc + qc)
            vconv.append(pc)
            vint.append(qc)
            vlo.append(mon["Vobs"][m] + int(math.floor(lo)) + int(math.floor(q_lo)))
            vhi.append(mon["Vobs"][m] + int(math.ceil(hi)) + int(math.ceil(q_hi)))
            if days_of["conv"].get(m + 1) or ids:
                ds = days_of["conv"].get(m + 1, [])
                cm = {"i": I0 + m, "m": m + 1, "days": ds, "n_days": len(ds),
                     "why": sorted({why[(c, dt.date(YEAR, m + 1, x))] for x in ds}),
                     "n20": nc, "rate": r_n20[m], "v_conv": pc, "v_obs": mon["Vobs"][m], "v": v26[-1], "v_lo": vlo[-1], "v_hi": vhi[-1]}
                if ids:
                    cm.update({"interp_days": [x.day for x in ids], "v_interp": qc,
                              "interp_note": "both satellites partial over this country: the mean of the usable day before and after"})
                if days_of["obs_partial"].get(m + 1):
                    cm["obs_partial_days"] = days_of["obs_partial"][m + 1]
                conv_months.append(cm)
        monthly = {
            "T": d["monthly"]["T"] + mon["T"], "A": d["monthly"]["A"] + mon["A"],
            "V": d["monthly"]["V"] + v26, "N20": d["monthly"]["N20"] + mon["N20"],
        }
        rows26, cells, ext = harm_cells(d, c, r_n20)
        cur_v, cur_lo, cur_hi = v26[-1], vlo[-1], vhi[-1]
        jb = {}
        for s in ("V", "N20"):
            r = join25.get((c, s))
            if r and r["annual_diff_pct"] not in ("", None):
                jb[s] = float(r["annual_diff_pct"])
        big = (c, "V") in join25 and int(join25[(c, "V")]["v2_2025"] or 0) >= 1000
        warn = bool(big and abs(jb.get("V", 0)) > WARN_JOIN * 100)
        o = dict(d)
        o.update({
            "v": 3, "y1": YEAR, "last_date": LAST.isoformat(), "n_months": N_MONTHS,
            "partial": {"y": YEAR, "m": LAST.month, "i": N_MONTHS - 1, "day0": 1, "day1": LAST.day,
                        "days_in_month": calendar.monthrange(YEAR, LAST.month)[1], "next_month_absent": True},
            "sensor_last": {"T": modis_last["T"], "A": modis_last["A"], "V": "2026-11-01", "N20": LAST.isoformat()},
            "filter": d["filter"] + FILTER_2026,
            "monthly": monthly,
            "cells": cells,
            "cell_rows": d["cell_rows"] + rows26,
            "totals": {s: int(sum(monthly[s])) for s in ("T", "A", "V", "N20")},
            "y2026": {
                "v_obs": mon["Vobs"], "v_conv": vconv, "v_interp": vint, "v_lo": vlo, "v_hi": vhi,
                "conv_months": conv_months,
                "n20_rate": {"r": r_n20, "r_lo": rt["r_lo"], "r_hi": rt["r_hi"], "r_all": rt["r_all"], "pi": rt["pi"],
                             "zero_hi": rt["zero_hi"], "bins": BINS,
                             "backtest": {"monthly_wape": rt["bt_monthly_wape"], "annual_med_abs_err": rt["bt_annual_med_abs_err"],
                                          "nov2_14_wape": rt["bt_nov2_14_wape"]},
                             "overlap": {"years": rates["years"], "V": rt["overlap_V"], "N20": rt["overlap_N20"]}},
                "same_days": same_days_block(c, cur_v, cur_lo, cur_hi, mon["N20"][-1]),
                "ytd": ytd_block(c, d, int(sum(v26)), int(sum(vlo)), int(sum(vhi))),
                "join_check_2025": {"V_pct": jb.get("V"), "N20_pct": jb.get("N20"), "warn": warn},
                "modis_missing_days": modis_missing,
                "hist_gaps": [hist_gap(d, rt, c, i) for i in sorted(gapdays)],
                "mask_note": MASK_NOTE,
            },
        })
        o["source"] = dict(d["source"], y2026=(
            "FIRMS API area endpoint (world, one request per sensor-day), fetched 2026-11-15: VIIRS S-NPP and NOAA-20 SP to "
            "2026-07-31 and NRT after; MODIS SP to 2026-08-31 and NRT after."))
        if ext:  # widen the bbox to the 2026 detections when they fall outside it
            b = d["bbox"]
            o["bbox"] = [round(min(b[0], ext[0]), 2), round(min(b[1], ext[1]), 2), round(max(b[2], ext[2]), 2), round(max(b[3], ext[3]), 2)]
        text = dumps(o)
        nbytes = len(text.encode())
        if nbytes > 2_600_000:
            raise SystemExit(f"{c}: {nbytes} bytes")
        (OUT / f"{c}.json").write_text(text, encoding="utf-8")
        # harmonized total: v2's (2001-2025) plus 2026 V
        tot26 = int(sum(v26))
        index.append(dict(e, file=f"summary/v3/{c}.json", bytes=nbytes, total=e["total"] + tot26,
                          total_2001_2025=e["total"], total_2026=tot26))
        report.append((c, tot26, cur_v))
    (OUT / "index.json").write_text(dumps({"v": 3, "y0": Y0, "y1": YEAR, "last_date": LAST.isoformat(),
                                           "n_months": N_MONTHS, "countries": index}), encoding="utf-8")
    print(f"{len(index)} countries written to {OUT}")
    print("converted days (world rule):", {m: sorted({dd.day for (cc, dd), k in cls.items() if k == "conv" and dd.month == m
                                                       and status["viirs-snpp"].get(dd) != "ok"}) for m in range(1, NMON + 1)})
    print("MODIS missing days to", LAST, {s: v for s, v in modis_missing.items()})


if __name__ == "__main__":
    main()
