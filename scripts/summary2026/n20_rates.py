"""NOAA-20 -> Suomi NPP exchange rates per FIRMS country and calendar month, learned on the
2018-2025 overlap from the daily v2-filtered history (hist_daily.parquet), the same shrinkage
scheme build_country_summaries.py uses for MODIS -> VIIRS:
  r_all[c] = (sum V + k_all * G) / (sum N + k_all)       (country's all-months rate, toward global G)
  r[c, m]  = (V_m + k_m * r_all[c]) / (N_m + k_m)         (monthly rate, toward the country's own)
Pseudo-counts are picked by leave-one-year-out monthly WAPE (lightest pair within 1% of the best).
Only days on which both satellites delivered normally count (world V/N20 within 0.75-1.35).

Backtest: each year 2018-2025 is held out in turn; its NOAA-20 counts are converted with rates
learned from the other years and compared with the S-NPP counts actually observed, for whole
months and for the exact 2026 windows that need conversion (same calendar days). The 5th-95th
percentile of observed / converted per size bin gives the range multipliers.
Usage: n20_rates.py WORK_DIR V2_INDEX_JSON. Writes <WORK>/n20_rates.json and <WORK>/backtest_n20.txt."""
import datetime as dt, json, sys
import duckdb, numpy as np

OUT = sys.argv[1]
WINDOWS = [(3, 10, 12), (4, 28, 30), (6, 1, 2), (7, 10, 16), (8, 3, 4), (8, 18, 18), (10, 12, 13), (11, 2, 14)]
Y0, Y1 = 2018, 2025
NY = Y1 - Y0 + 1
BINS = [10, 100, 1000]
PSEUDO_GRID = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000]
NEAR_BEST, MIN_EVAL, MIN_BIN, BOOT, SEED = 0.01, 50, 30, 1000, 20180401

con = duckdb.connect()
df = con.execute(f"SELECT country, sensor, d, n FROM '{OUT}/hist_daily.parquet' WHERE d >= DATE '{Y0}-01-01'").fetchnumpy()
countries = sorted(set(df["country"].tolist()) | {e["country"] for e in json.load(open(sys.argv[2]))["countries"]})  # all FIRMS countries (v2 index)
ci = {c: i for i, c in enumerate(countries)}
d0 = dt.date(Y0, 1, 1)
ND = (dt.date(Y1, 12, 31) - d0).days + 1
days = [d0 + dt.timedelta(k) for k in range(ND)]
yr = np.array([d.year - Y0 for d in days]); mo = np.array([d.month - 1 for d in days]); dom = np.array([d.day for d in days])
V = np.zeros((len(countries), ND)); N = np.zeros((len(countries), ND))
di = np.array([(x - np.datetime64(d0, "D")).astype(int) for x in df["d"].astype("datetime64[D]")])
c_idx = np.array([ci[c] for c in df["country"]])
isv = df["sensor"] == "V"
np.add.at(V, (c_idx[isv], di[isv]), df["n"][isv]); np.add.at(N, (c_idx[~isv], di[~isv]), df["n"][~isv])
wv, wn = V.sum(0), N.sum(0)
good = (wv > 0) & (wn > 0) & (wv / np.maximum(wn, 1) > 0.75) & (wv / np.maximum(wn, 1) < 1.35)
print(f"good overlap days: {good.sum()} of {ND} ({(~good).sum()} left out, incl. 2018 Jan-Mar before NOAA-20)")

def monthly(X):
    out = np.zeros((X.shape[0], NY, 12))
    for y in range(NY):
        for m in range(12):
            sel = good & (yr == y) & (mo == m)
            out[:, y, m] = X[:, sel].sum(1)
    return out
Vm, Nm = monthly(V), monthly(N)

def rates(Vs, Ns, G, ka, km):
    r_all = (Vs.sum(-1) + ka * G) / (Ns.sum(-1) + ka)
    return r_all, (Vs + km * r_all[..., None]) / (Ns + km)

def loyo(ka, km):
    Vs, Ns = Vm.sum(1), Nm.sum(1)
    pred, rs = np.zeros_like(Vm), np.zeros_like(Vm)
    for j in range(NY):
        Vt, Nt = Vs - Vm[:, j], Ns - Nm[:, j]
        _, r = rates(Vt, Nt, Vt.sum() / Nt.sum(), ka, km)
        rs[:, j] = r; pred[:, j] = Nm[:, j] * r
    return pred, rs

obs_tot = Vm.sum((1, 2)); keep = obs_tot >= MIN_EVAL
scores = {}
for ka in PSEUDO_GRID:
    for km in PSEUDO_GRID:
        p, _ = loyo(ka, km)
        scores[(ka, km)] = float((np.abs(p - Vm).sum((1, 2))[keep] / obs_tot[keep]).mean())
best = min(scores.values())
ka, km = min(k for k, s in scores.items() if s <= best * (1 + NEAR_BEST))
G = Vm.sum() / Nm.sum()
r_all, r = rates(Vm.sum(1), Nm.sum(1), G, ka, km)
pred, held = loyo(ka, km)

rng = np.random.default_rng(SEED)
W = rng.multinomial(NY, np.full(NY, 1 / NY), size=BOOT).astype(float)
_, rb = rates(np.einsum("by,cym->cbm", W, Vm), np.einsum("by,cym->cbm", W, Nm), G, ka, km)
r_lo, r_hi = np.percentile(rb, [5, 95], axis=1)

# held-out windows: same calendar days as the 2026 conversions, only years where every day is good
win = {}  # (country, window) -> list of (pred, obs, year)
wp, wo, wc, wk = [], [], [], []
for k, (m, a, b) in enumerate(WINDOWS):
    for y in range(NY):
        sel = (yr == y) & (mo == m - 1) & (dom >= a) & (dom <= b)
        if not good[sel].all():
            continue
        p = N[:, sel].sum(1) * held[:, y, m - 1]; o = V[:, sel].sum(1)
        wp.append(p); wo.append(o); wc.append(np.arange(len(countries))); wk.append(np.full(len(countries), k))
wp, wo, wc, wk = (np.concatenate(x) for x in (wp, wo, wc, wk))

def bin_of(p):
    b = np.searchsorted(np.array(BINS, float), p, side="left")
    return np.where(p == 0, -1, b)

def ranges(p, o):
    b = bin_of(p); out = []
    for k in range(len(BINS) + 1):
        s = b == k
        out.append((float(np.percentile(o[s] / p[s], 5)), float(np.percentile(o[s] / p[s], 95)), int(s.sum())) if s.sum() else (None, None, 0))
    z = o[b == -1]
    return out, ((float(np.percentile(z, 95, method="higher")), int(z.size)) if z.size else (None, 0))

ym = Nm > 0  # months with NOAA-20 data on good days
allp = np.concatenate([pred[ym], wp]); allo = np.concatenate([Vm[ym], wo])
allc = np.concatenate([np.broadcast_to(np.arange(len(countries))[:, None, None], Vm.shape)[ym], wc])
pooled, pooled_zero = ranges(allp, allo)

def sig(x, n=4):
    if x is None or not np.isfinite(x): return None
    if x == 0: return 0
    return float(round(x, n - 1 - int(np.floor(np.log10(abs(x))))))

res = {"k_all": ka, "k_m": km, "global": sig(G), "years": [Y0, Y1], "good_days": int(good.sum()), "windows": WINDOWS,
       "pooled_pi": [[sig(a), sig(b), n] for a, b, n in pooled], "pooled_zero_hi": pooled_zero[0], "countries": {}}
lines = [f"NOAA-20 -> S-NPP rates, overlap {Y0}-{Y1} ({good.sum()} good days); global rate {G:.4f}",
         f"pseudo-counts by held-out monthly WAPE: all-months {ka}, monthly {km} (score {scores[(ka, km)]:.4f}; best {best:.4f}; "
         f"1/1 {scores[(1, 1)]:.4f}; 100000/100000 {scores[(100000, 100000)]:.4f})",
         "pooled range multipliers (5th, 95th pct of observed/converted; n) per bin <=10, <=100, <=1000, >1000: "
         + str([(sig(a), sig(b), n) for a, b, n in pooled]) + f"; zero_hi {pooled_zero}"]

def wape(p, o):
    return float(np.abs(p - o).sum() / o.sum()) if o.sum() > 0 else None

# world-level and per-country backtest summary
lines.append("\nHeld-out backtest (each year converted with rates learned on the other years):")
for name, msk in [("whole months", None)] + [(f"window {m:02d}-{a:02d}..{m:02d}-{b:02d}", k) for k, (m, a, b) in enumerate(WINDOWS)]:
    if msk is None:
        p, o, c = pred[ym], Vm[ym], allc[:ym.sum()]
        p1 = Nm[ym]  # ratio 1 (adding nothing, N20 as is)
        pg = Nm[ym] * G
    else:
        s = wk == msk; p, o, c = wp[s], wo[s], wc[s]
        p1 = None; pg = None
    big = np.isin(c, np.flatnonzero(obs_tot >= 10000))
    lines.append(f"  {name}: all country-periods pooled WAPE {wape(p, o):.4f}; countries with >=10k overlap S-NPP detections: WAPE {wape(p[big], o[big]):.4f}"
                 + (f"; same with ratio 1: {wape(p1, o):.4f}, global ratio: {wape(pg, o):.4f}" if p1 is not None else ""))
# per-country annual
ann_lines = []
for c in countries:
    i = ci[c]
    own, own_zero = ranges(allp[allc == i], allo[allc == i])
    pi = []
    for (lo, hi, n), (plo, phi, _) in zip(own, pooled):
        lo, hi = (lo, hi) if n >= MIN_BIN else (plo, phi)
        pi.append([sig(min(lo, 1.0)), sig(max(hi, 1.0))])
    zero_hi = max(own_zero[0] if own_zero[1] >= MIN_BIN else pooled_zero[0], 1.0)
    py, oy = (pred[i] * ym[i]).sum(1), (Vm[i] * ym[i]).sum(1)
    errs = [float((p - o) / o) for p, o in zip(py, oy) if o > 0]
    s = (wc == i) & (wk == len(WINDOWS) - 1)
    res["countries"][c] = {
        "r": [sig(x) for x in r[i]], "r_lo": [sig(x) for x in r_lo[i]], "r_hi": [sig(x) for x in r_hi[i]],
        "r_all": sig(r_all[i]), "pi": pi, "zero_hi": sig(zero_hi),
        "overlap_V": int(Vm[i].sum()), "overlap_N20": int(Nm[i].sum()),
        "bt_monthly_wape": sig(wape(pred[i][ym[i]], Vm[i][ym[i]])),
        "bt_annual_med_abs_err": sig(float(np.median(np.abs(errs)))) if errs else None,
        "bt_nov2_14_wape": sig(wape(wp[s], wo[s])),
    }
    if obs_tot[i] >= 10000:
        ann_lines.append((obs_tot[i], c, res["countries"][c]))
lines.append("\nPer country (>=10k overlap S-NPP detections), held out by year: monthly WAPE, median |annual error|, Nov 2-14 window WAPE, r_all")
for _, c, x in sorted(ann_lines, reverse=True):
    lines.append(f"  {c:28s} {x['bt_monthly_wape']:<8} {x['bt_annual_med_abs_err']:<8} {x['bt_nov2_14_wape']!s:<8} {x['r_all']}")
cov = np.mean([(lo <= o / p <= hi) for p, o, cc in zip(allp, allo, allc) if p > 0
               for lo, hi in [res["countries"][countries[cc]]["pi"][int(bin_of(np.array([p]))[0])]]])
lines.append(f"\nshare of held-out samples (months and windows, p>0) inside their 90% range: {cov:.3f}")
json.dump(res, open(f"{OUT}/n20_rates.json", "w"), indent=None)
open(f"{OUT}/backtest_n20.txt", "w").write("\n".join(lines) + "\n")
print("\n".join(lines[:20]))
