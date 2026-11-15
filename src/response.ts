import type { ResponseCal, ResponseState, StateCode } from "./types";
import { NM, Y0 } from "./data";
import { hexAtLonLat, hexKey, hexState, notFire } from "./model";
import { fcHex } from "./forecast";

/* =====================================================================
   FIRE RESPONSE: drive times from fire and EMS stations (response.js),
   places far from a station, first-due areas and a crew placement planner.
   Fire risk is either the historical record (past odds) or, when the reader picks 2026 or 2027,
   the forecast in forecast.js, which is itself built from fire history alone.
   ===================================================================== */
/** response.js loads after the page opens a state (src/extras.ts), so it is read when needed */
const RESP = () => window.RESPONSE;
export const respOf = (st: StateCode): ResponseState | null => RESP()?.[st] || null;
export const respCredit = () => RESP()?.credit || "";
/** a place this far from every station, in a straight line, counts as far */
export const GAP_KM = 15;

/** great-circle distance in km */
export function gcKm(lon1: number, lat1: number, lon2: number, lat2: number) {
  const r = Math.PI / 180,
    a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** estimated drive minutes over a straight-line distance, plus the local extra minutes of each end (response.js cal) */
export function estMin(cal: ResponseCal, km: number, extraA: number, extraB: number) {
  let b = 0;
  while (b + 1 < cal.bands_km.length && cal.bands_km[b + 1] <= km) b++;
  return Math.max((km / cal.floor_kmh) * 60, (km / cal.kmh[b]) * 60 + extraA + extraB);
}
const hexLon = (st: StateCode, k: number) => hexState(st).X[k] / hexState(st).K;
const hexLat = (st: StateCode, k: number) => hexState(st).Y[k];
export const stnLon = (st: StateCode, i: number) => hexState(st).stn.X[i] / hexState(st).K;
export const stnLat = (st: StateCode, i: number) => hexState(st).stn.Y[i];

/* ---------- the three closest stations ---------- */
export interface NearStation {
  i: number;
  name: string;
  town: string;
  /** drive minutes to the point asked about: exact to the hexagon centre or 2 km patch, plus an estimate for the rest */
  min: number;
  /** drive minutes and road km to the hexagon centre, as the road search found them (NaN for a station found only
   * by the 2 km patch's own search) */
  minC: number;
  km: number;
  /** straight-line km from the point asked about */
  crow: number;
  /** how min was found: to the centre itself; via the centre plus an estimated last stretch; estimated straight from
   * the station (when that is shorter); or the 2 km patch's own road search */
  via: "centre" | "leg" | "line" | "patch";
}
export interface Closest {
  k: number;
  rows: NearStation[];
  /** straight-line km from the point asked about to its hexagon's centre */
  off: number;
  /** the 2 km hexagon under the point, if fire was seen there since 2012: its fastest station */
  fine: { i: number; name: string; min: number } | null;
  /** why there are no rows, when there are none */
  why: string;
}
/** the stations with the shortest drive to hexagon k, measured from point (lon, lat) for the straight line */
/** a point this far (km) from its hexagon's centre gets an estimated time: the centre's drive time plus the last
 * stretch, or the estimate straight from the station, whichever is shorter */
const LEG_KM = 1;
/** a hexagon's local extra minutes for the estimating rule, never below 0 here (a negative one, in a fast town grid,
 * would put a short hop at freeway speed); 0 where it has none */
const extraOf = (r: ResponseState, k: number) => (k >= 0 && r.e10[k] > 0 ? r.e10[k] / 10 : 0);
export function closestAt(st: StateCode, k: number, lon = hexLon(st, k), lat = hexLat(st, k)): Closest | null {
  const r = respOf(st);
  if (!r || k < 0) return null;
  const hx = hexState(st),
    off = gcKm(lon, lat, hexLon(st, k), hexLat(st, k)),
    far = off >= LEG_KM && r.e10[k] !== -9999,
    eK = extraOf(r, k),
    /* the drive from the centre to the point: the centre's own local minutes are already in its road time */
    leg = far ? estMin(r.cal, off, 0, eK) : 0,
    fj = hx.f.key.get(hexKey(lon * hx.K, lat, hx.f.R)),
    fs = fj === undefined || fj >= r.fine.n ? -1 : r.fine.s[fj],
    fine = fs >= 0 ? { i: fs, name: hx.stn.names[fs][0], min: r.fine.min10[fj!] / 10 } : null,
    rows: NearStation[] = [];
  for (let j = 0; j < 3; j++) {
    const i = r.top[3 * k + j];
    if (i < 0) break;
    const minC = r.min10[3 * k + j] / 10,
      crow = gcKm(lon, lat, stnLon(st, i), stnLat(st, i)),
      viaLeg = minC + leg,
      line = far ? estMin(r.cal, crow, eK, extraOf(r, hexAtLonLat(st, stnLon(st, i), stnLat(st, i)))) : Infinity,
      est = Math.min(viaLeg, line),
      patch = fine && fine.i === i && fine.min < est;
    rows.push({
      i,
      name: hx.stn.names[i][0],
      town: hx.stn.names[i][1],
      min: patch ? fine.min : est,
      minC,
      km: r.km10[3 * k + j] / 10,
      crow,
      via: patch ? "patch" : !far ? "centre" : line < viaLeg ? "line" : "leg",
    });
  }
  /* the 2 km patch's own road search can find a faster station than the three of the hexagon centre */
  if (fine && rows.length && !rows.some(s => s.i === fine.i) && fine.min < rows[rows.length - 1].min)
    rows.push({
      i: fine.i,
      name: fine.name,
      town: hx.stn.names[fine.i][1],
      min: fine.min,
      minC: NaN,
      km: NaN,
      crow: gcKm(lon, lat, stnLon(st, fine.i), stnLat(st, fine.i)),
      via: "patch",
    });
  rows.sort((x, y) => x.min - y.min);
  rows.length = Math.min(rows.length, 3);
  return {
    k,
    rows,
    off,
    fine,
    why: rows.length
      ? ""
      : r.snap_m[k] > (RESP()!.snap_max_km || 10) * 1000
        ? `There is no road within ${RESP()!.snap_max_km || 10} km of this hexagon's centre, so no drive time.`
        : "The roads here do not connect to any station in the data (for example a military base or an island).",
  };
}

/* ---------- how often each hexagon burns in one calendar month ---------- */
export interface MonthRisk {
  a: number;
  b: number;
  n: number;
  /** the forecast year when p is the forecast chance (a = b = that year, e is all zero); absent for past odds */
  fc?: number;
  /** share of the years a..b with at least one hotspot in the month, or the forecast chance */
  p: Float32Array;
  /** average hotspots in the month over those years */
  e: Float32Array;
  ptot: number;
  etot: number;
}
const riskCache = new Map<string, MonthRisk>();
export function monthRisk(st: StateCode, m: number, a: number, b: number): MonthRisk {
  const key = [st, m, a, b].join("|"),
    hit = riskCache.get(key);
  if (hit) return hit;
  const hx = hexState(st),
    nf = notFire(st),
    n = b - a + 1,
    p = new Float32Array(hx.n),
    e = new Float32Array(hx.n);
  let ptot = 0,
    etot = 0;
  for (let k = 0; k < hx.n; k++) {
    if (nf[k]) continue;
    let c = 0,
      s = 0;
    for (let y = a; y <= b; y++) {
      const v = hx.H[k * NM + (y - Y0) * 12 + m];
      if (v > 0) c++;
      s += v;
    }
    p[k] = c / n;
    e[k] = s / n;
    ptot += p[k];
    etot += e[k];
  }
  const o = { a, b, n, p, e, ptot, etot };
  riskCache.set(key, o);
  return o;
}

/** the forecast chance of any fire in month m of a forecast year, in the same shape as past odds */
const fcRiskCache = new Map<string, MonthRisk>();
export function forecastRisk(st: StateCode, year: number, m: number): MonthRisk | null {
  const key = [st, year, m].join("|"),
    hit = fcRiskCache.get(key);
  if (hit) return hit;
  const p = fcHex(st, "any", year, m);
  if (!p) return null;
  let ptot = 0;
  for (let k = 0; k < p.length; k++) ptot += p[k];
  const o: MonthRisk = { a: year, b: year, n: 1, fc: year, p, e: new Float32Array(p.length), ptot, etot: 0 };
  fcRiskCache.set(key, o);
  return o;
}

/* ---------- places where fire is likely and the nearest station is far ---------- */
export function gapList(st: StateCode, risk: MonthRisk, minP: number) {
  const r = respOf(st)!,
    list: number[] = [];
  let far = 0,
    maxCrow = 0;
  for (let k = 0; k < r.n; k++) {
    const crow = r.crow10[k] / 10;
    if (crow > maxCrow) maxCrow = crow;
    if (crow <= GAP_KM) continue;
    far++;
    if (risk.p[k] >= minP - 1e-9) list.push(k);
  }
  list.sort((x, y) => risk.p[y] - risk.p[x] || r.crow10[y] - r.crow10[x]);
  return { list, far, maxCrow };
}

/* ---------- first-due areas: which station reaches each burning place first ---------- */
/** per state hexagon, flat pairs [station, share]: the 2 km patches inside it that burned in month m since 2012, each
 * counted once (data.js has no month-by-month counts for them) and given to its fastest station; the hexagon's own
 * fastest station when it has none. A station of -1 means no station reaches that part by road. */
const splitCache = new Map<string, number[][]>();
function splitFor(st: StateCode, m: number) {
  const key = st + "|" + m,
    hit = splitCache.get(key);
  if (hit) return hit;
  const hx = hexState(st),
    f = hx.f,
    r = respOf(st)!,
    bit = 1 << m,
    acc: Map<number, number>[] = Array.from({ length: hx.n }, () => new Map());
  /* response.js has road times for the 2 km patches data.js had when it was built (to 2025); patches first seen in
     2026 come after them and have none, so they are left out here */
  for (let j = 0, nj = Math.min(f.n, r.fine.n); j < nj; j++) {
    if (!(f.mm[j] & bit)) continue;
    const k = hx.key.get(hexKey(f.X[j], f.Y[j], hx.R));
    if (k === undefined) continue;
    const s = r.fine.s[j];
    acc[k].set(s, (acc[k].get(s) || 0) + 1);
  }
  const out = acc.map((mp, k) => {
    let t = 0;
    mp.forEach(v => (t += v));
    if (!t) return [r.top[3 * k], 1];
    const o: number[] = [];
    mp.forEach((v, s) => o.push(s, v / t));
    return o;
  });
  splitCache.set(key, out);
  return out;
}
export interface StaffRow {
  i: number;
  /** the hexagons with fire this station is first to in an average year (past odds), or expected to be (forecast) */
  e: number;
  /** its part of the state's */
  share: number;
  /** the highest chance of fire among the hexagons it is first to */
  top: number;
  /** state hexagons that send some of their fire to this station */
  hexes: number;
  /** past odds only: average hotspots a year, in this month, in its first-due area, and the years with fire there */
  hot?: number;
  k?: number;
}
/** stations ranked by how often fire comes to the places they reach first by road in month m: each hexagon counts by its
 * chance of fire (past odds or a forecast), split among stations the way its fire fell in that month since 2012. So a
 * place that burns most years counts more than one huge fire in one year. With past odds, also each station's average
 * hotspots and years with fire. */
export function staffUp(st: StateCode, m: number, risk: MonthRisk) {
  const hx = hexState(st),
    ns = hx.stn.n,
    parts = splitFor(st, m),
    w = risk.p,
    E = new Float64Array(ns),
    top = new Float32Array(ns),
    hexes = new Uint16Array(ns);
  let none = 0,
    total = 0;
  for (let k = 0; k < hx.n; k++) {
    const p = parts[k],
      wk = w[k];
    if (!(wk > 0)) continue;
    total += wk;
    for (let q = 0; q < p.length; q += 2) {
      const s = p[q];
      if (s < 0) {
        none += wk * p[q + 1];
        continue;
      }
      hexes[s]++;
      E[s] += wk * p[q + 1];
      if (wk > top[s]) top[s] = wk;
    }
  }
  /* past odds: the hotspots behind it, and in how many years the area had fire */
  const past = !risk.fc,
    hot = new Float64Array(past ? ns : 0),
    K = new Uint16Array(past ? ns : 0),
    seen = new Int32Array(past ? ns : 0).fill(-1),
    nf = notFire(st);
  if (past)
    for (let y = risk.a; y <= risk.b; y++)
      for (let k = 0; k < hx.n; k++) {
        const h = hx.H[k * NM + (y - Y0) * 12 + m];
        if (!(h > 0) || nf[k]) continue;
        const p = parts[k];
        for (let q = 0; q < p.length; q += 2) {
          const s = p[q];
          if (s < 0) continue;
          hot[s] += h * p[q + 1];
          if (seen[s] !== y) {
            seen[s] = y;
            K[s]++;
          }
        }
      }
  const rows: StaffRow[] = [];
  for (let i = 0; i < ns; i++)
    if (E[i] > 0)
      rows.push({
        i,
        e: E[i],
        share: total ? E[i] / total : 0,
        top: top[i],
        hexes: hexes[i],
        ...(past ? { hot: hot[i] / risk.n, k: K[i] } : {}),
      });
  rows.sort((x, y) => y.e - x.e || y.top - x.top);
  return { rows, total, noneShare: total ? none / total : 0, stations: rows.length };
}
/** the state hexagons that send some of month m's fire to station i */
export function stationArea(st: StateCode, m: number, i: number) {
  const parts = splitFor(st, m),
    mask = new Uint8Array(parts.length);
  parts.forEach((p, k) => {
    for (let q = 0; q < p.length; q += 2) if (p[q] === i) mask[k] = 1;
  });
  return mask;
}

/* ---------- crew placement: greedy maximum coverage ---------- */
/** hexagons whose fastest existing station drives there within T minutes */
export function coveredNow(st: StateCode, T: number) {
  const r = respOf(st)!,
    c = new Uint8Array(r.n);
  for (let k = 0; k < r.n; k++) c[k] = r.min10[3 * k] >= 0 && r.min10[3 * k] <= T * 10 ? 1 : 0;
  return c;
}
/** for a crew at each hexagon centre, the hexagons it reaches within T minutes by the calibration estimate (null: no road link) */
const reachCache = new Map<string, (Int32Array | null)[]>();
export function reachFor(st: StateCode, T: number) {
  const key = st + "|" + T,
    hit = reachCache.get(key);
  if (hit) return hit;
  const r = respOf(st)!,
    hx = hexState(st),
    cal = r.cal,
    n = hx.n,
    lon = new Float64Array(n),
    lat = new Float64Array(n),
    maxKm = (T / 60) * cal.floor_kmh * 1.01,
    out: (Int32Array | null)[] = [],
    buf: number[] = [];
  for (let k = 0; k < n; k++) {
    lon[k] = hx.X[k] / hx.K;
    lat[k] = hx.Y[k];
  }
  for (let j = 0; j < n; j++) {
    if (r.e10[j] === -9999) {
      out.push(null);
      continue;
    }
    buf.length = 0;
    const cj = 111.32 * Math.cos((lat[j] * Math.PI) / 180),
      ej = r.e10[j] / 10;
    for (let k = 0; k < n; k++) {
      if (r.e10[k] === -9999) continue;
      const dy = (lat[k] - lat[j]) * 110.57;
      if (dy > maxKm || dy < -maxKm) continue;
      const dx = (lon[k] - lon[j]) * cj;
      if (dx * dx + dy * dy > maxKm * maxKm) continue;
      if (k === j || estMin(cal, gcKm(lon[j], lat[j], lon[k], lat[k]), ej, r.e10[k] / 10) <= T) buf.push(k);
    }
    out.push(Int32Array.from(buf));
  }
  reachCache.set(key, out);
  return out;
}
export interface Plan {
  /** share of the month's fire risk within T minutes of a station today, and after each added crew */
  before: number;
  after: number[];
  sites: { k: number; gain: number }[];
  /** for each hexagon, the index of the first added crew that reaches it; -1 if none does or a station already does */
  by: Int16Array;
  total: number;
}
/** add N crews one at a time, each at the hexagon centre that brings the most still-uncovered weight within T minutes */
export function greedyPlan(st: StateCode, w: Float32Array, T: number, N: number): Plan {
  const reach = reachFor(st, T),
    cov = coveredNow(st, T),
    n = w.length,
    by = new Int16Array(n).fill(-1);
  let total = 0,
    got = 0;
  for (let k = 0; k < n; k++) {
    total += w[k];
    if (cov[k]) got += w[k];
  }
  const before = total ? got / total : 0,
    sites: Plan["sites"] = [],
    after: number[] = [];
  for (let s = 0; s < N && total > 0; s++) {
    let best = -1,
      bg = 1e-9;
    for (let j = 0; j < n; j++) {
      const R = reach[j];
      if (!R) continue;
      let g = 0;
      for (let q = 0; q < R.length; q++) if (!cov[R[q]]) g += w[R[q]];
      if (g > bg) {
        bg = g;
        best = j;
      }
    }
    if (best < 0) break;
    for (const k of reach[best]!)
      if (!cov[k]) {
        cov[k] = 1;
        by[k] = s;
      }
    got += bg;
    sites.push({ k: best, gain: bg / total });
    after.push(got / total);
  }
  return { before, after, sites, by, total };
}
/** share of weight w within T minutes of a station or of one of the given crew sites */
function coverageWith(st: StateCode, w: Float32Array, T: number, sites: number[]) {
  const reach = reachFor(st, T),
    cov = coveredNow(st, T);
  for (const j of sites) for (const k of reach[j] || []) cov[k] = 1;
  let t = 0,
    g = 0;
  for (let k = 0; k < w.length; k++) {
    t += w[k];
    if (cov[k]) g += w[k];
  }
  return t ? g / t : 0;
}
const planCache = new Map<string, Plan>();
export function planFor(st: StateCode, risk: MonthRisk, m: number, T: number, N: number) {
  const key = [st, m, risk.fc ? "fc" : "past", risk.a, risk.b, T, N].join("|");
  let p = planCache.get(key);
  if (!p) {
    p = greedyPlan(st, risk.p, T, N);
    planCache.set(key, p);
  }
  return p;
}
/** the planner tested on later years: choose sites from the first half of the years, score them on the second half,
 * against the simple rule "put each crew in the busiest place no station reaches in time" */
export interface PlanTest {
  train: [number, number];
  test: [number, number];
  today: number;
  greedy: number;
  busiest: number;
}
const testCache = new Map<string, PlanTest | null>();
export function planTest(st: StateCode, m: number, a: number, b: number, T: number, N: number): PlanTest | null {
  const key = [st, m, a, b, T, N].join("|");
  if (testCache.has(key)) return testCache.get(key)!;
  let out: PlanTest | null = null;
  if (b - a + 1 >= 6) {
    const mid = a + Math.floor((b - a + 1) / 2) - 1,
      tr = monthRisk(st, m, a, mid),
      te = monthRisk(st, m, mid + 1, b);
    if (tr.ptot > 0 && te.ptot > 0) {
      const g = greedyPlan(st, tr.p, T, N).sites.map(s => s.k),
        cov = coveredNow(st, T),
        reach = reachFor(st, T),
        busy: number[] = [];
      for (let k = 0; k < tr.p.length; k++) if (!cov[k] && reach[k] && tr.p[k] > 0) busy.push(k);
      busy.sort((x, y) => tr.p[y] - tr.p[x] || x - y);
      out = {
        train: [a, mid],
        test: [mid + 1, b],
        today: coverageWith(st, te.p, T, []),
        greedy: coverageWith(st, te.p, T, g),
        busiest: coverageWith(st, te.p, T, busy.slice(0, N)),
      };
    }
  }
  testCache.set(key, out);
  return out;
}
/** how many hexagons a new site reaches within T minutes, on average over the sites with a road link (itself included) */
export function reachMean(st: StateCode, T: number) {
  let n = 0,
    t = 0;
  for (const R of reachFor(st, T))
    if (R) {
      n++;
      t += R.length;
    }
  return n ? t / n : 0;
}
/** the estimating rule's typical error (median absolute %, on held-out pairs) over the distance bands a drive of T minutes
 * covers, leaving out bands with too few test pairs to say (and keeping at least the shortest band that has enough);
 * the lowest and highest error and the distances they span, or null if no band qualifies */
export function calErrFor(cal: ResponseCal, T: number): { lo: number; hi: number; km0: number; km1: number } | null {
  /* by_band[].band is the band's index: it runs from bands_km[band] to bands_km[band + 1] */
  const ok = cal.test.by_band.filter(b => b.n >= 100 && cal.bands_km[b.band] !== undefined);
  if (!ok.length) return null;
  const hit = ok.filter(b => cal.bands_km[b.band] < (T / 60) * cal.kmh[b.band]),
    use = hit.length ? hit : [ok[0]],
    errs = use.map(b => b.bands_plus_local),
    last = use[use.length - 1].band;
  return {
    lo: Math.min(...errs),
    hi: Math.max(...errs),
    km0: cal.bands_km[use[0].band],
    km1: cal.bands_km[last + 1] ?? cal.bands_km[last],
  };
}
