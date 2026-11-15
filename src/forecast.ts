import type { FcLayer, FireKind, LargeLayer, Odds, StateCode } from "./types";
import { D, MONL, NM, Y0 } from "./data";
import { S } from "./state";
import { hexState, notFire, riskYears } from "./model";

/* =====================================================================
   FORECAST AND LARGE FIRES: forecast.js (scripts/build_forecast.py, with the
   California large-fire layer from CAL FIRE's fire perimeter maps merged in).
   Past odds are history; a forecast year is the model's chance from history alone.
   Neither knows anything about weather.
   ===================================================================== */
/** forecast.js loads after the page opens a state (src/extras.ts), so it is read when needed */
const F = () => window.FORECAST;
export const FC_YEARS: (2026 | 2027)[] = [2026, 2027];
/** forecast.js loaded and holds this state */
export const fcOn = (st: StateCode) => !!F()?.[st]?.any?.p;
/** the California large-fire layer, if it was merged into forecast.js */
export const largeOf = (st: StateCode): LargeLayer | null => {
  const L = st === "CA" ? F()?.CA.large : null;
  return L && L.past ? L : null;
};
export const fcData = () => F();
const layerOf = (st: StateCode, fire: FireKind): FcLayer | null => (fire === "large" ? largeOf(st) : fcOn(st) ? F()![st].any : null);
/** true when a layer's 2027 chances are the same as its 2026 ones (no trend term was chosen for it) */
const sameCache = new Map<string, boolean>();
export function fcSame(st: StateCode, fire: FireKind, county = false): boolean {
  const L = layerOf(st, fire),
    arr = L && (county ? L.county : L.p);
  if (!arr) return false;
  const key = [st, fire, county].join("|");
  let v = sameCache.get(key);
  if (v === undefined) {
    const h = arr.length / 2;
    v = true;
    for (let i = 0; i < h && v; i++) if (arr[i] !== arr[h + i]) v = false;
    sameCache.set(key, v);
  }
  return v;
}
/** the reader's choice made valid for this state: no forecast without forecast.js, no large fires outside California */
export function oddsFix() {
  if (!S.st) return;
  if (S.fire === "large" && !largeOf(S.st)) S.fire = "any";
  if (S.odds !== "past" && !fcOn(S.st)) S.odds = "past";
}
export const isFc = (o: Odds = S.odds): o is 2026 | 2027 => o !== "past";
const tIdx = (year: number, m: number) => (year - 2026) * 12 + m;

/** chances 0..1 for every hexagon (or county) in month m of a forecast year */
const fcCache = new Map<string, Float32Array>();
export function fcHex(st: StateCode, fire: FireKind, year: number, m: number, county = false): Float32Array | null {
  const L = layerOf(st, fire),
    arr = L && (county ? L.county : L.p);
  if (!arr) return null;
  const key = [st, fire, year, m, county].join("|"),
    hit = fcCache.get(key);
  if (hit) return hit;
  const n = county ? D.states[st].counties.length : hexState(st).n,
    o = new Float32Array(n),
    b = tIdx(year, m) * n;
  for (let u = 0; u < n; u++) o[u] = arr[b + u] / 1000;
  fcCache.set(key, o);
  return o;
}

/* ---------- large fires in the past, from the fire perimeter maps ---------- */
let largeMarks: Uint8Array | null = null;
/** 1 where a large fire that started in month i reached hexagon k: [k * NM + i] */
export function largeMarked(st: StateCode) {
  const L = largeOf(st);
  if (!L) return null;
  if (!largeMarks) {
    const n = hexState(st).n,
      m = new Uint8Array(n * NM),
      pr = L.past.pairs;
    for (let q = 0; q < pr.length; q += 2) if (pr[q] < n && pr[q + 1] < NM) m[pr[q] * NM + pr[q + 1]] = 1;
    largeMarks = m;
  }
  return largeMarks;
}
/** the years large-fire history covers within the chosen years */
export function largeYears(): [number, number] {
  const L = largeOf("CA"),
    a = Math.max(S.yFrom, L ? L.past.years[0] : Y0),
    b = Math.min(S.yTo, L ? L.past.years[1] : S.yTo);
  return a <= b ? [a, b] : [S.yFrom, S.yTo];
}
/** share of years a..b in which a large fire that started in month m reached each hexagon */
const pastLargeCache = new Map<string, Float32Array>();
export function pastLarge(st: StateCode, m: number, a: number, b: number) {
  const L = largeMarked(st);
  if (!L) return null;
  const key = [m, a, b].join("|"),
    hit = pastLargeCache.get(key);
  if (hit) return hit;
  const n = hexState(st).n,
    o = new Float32Array(n),
    ny = b - a + 1;
  for (let k = 0; k < n; k++) {
    let c = 0;
    for (let y = a; y <= b; y++) c += L[k * NM + (y - Y0) * 12 + m];
    o[k] = c / ny;
  }
  pastLargeCache.set(key, o);
  return o;
}
/** in how many of the years a..b a large fire that started in month m reached any hexagon of the mask */
export function pastLargeIn(st: StateCode, mask: Uint8Array, m: number, a: number, b: number) {
  const L = largeMarked(st)!,
    n = hexState(st).n;
  let k = 0;
  for (let y = a; y <= b; y++) {
    const i = (y - Y0) * 12 + m;
    for (let h = 0; h < n; h++)
      if (mask[h] && L[h * NM + i]) {
        k++;
        break;
      }
  }
  return { k, n: b - a + 1 };
}

/* ---------- the chance-of-fire layer the map and the tools use ---------- */
export interface Chance {
  /** chance 0..1 for every hexagon */
  v: Float32Array;
  /** the colour scale: v / max, raised to pow, gives 0..1 */
  max: number;
  pow: number;
  /** the years behind past odds; null for a forecast */
  years: [number, number] | null;
}
/** the colour scale of a kind of fire, square-root so small chances still show; large fires are rare, so theirs tops out at 12% */
export const scaleOf = (fire: FireKind) => (fire === "large" ? { max: 0.12, pow: 0.5 } : { max: 1, pow: 0.5 });
const pastAnyCache = new Map<string, Float32Array>();
export function chanceNow(st: StateCode, m = S.rm, odds: Odds = S.odds, fire: FireKind = S.fire): Chance {
  const sc = scaleOf(fire);
  if (isFc(odds)) {
    const v = fcHex(st, fire, odds, m);
    if (v) return { v, ...sc, years: null };
  }
  if (fire === "large") {
    const [a, b] = largeYears(),
      v = pastLarge(st, m, a, b);
    if (v) return { v, ...sc, years: [a, b] };
  }
  const [a, b] = riskYears(),
    key = [st, m, a, b].join("|");
  let v = pastAnyCache.get(key);
  if (!v) {
    const hx = hexState(st),
      nf = notFire(st);
    v = new Float32Array(hx.n);
    for (let k = 0; k < hx.n; k++) {
      if (nf[k]) continue;
      let c = 0;
      for (let y = a; y <= b; y++) if (hx.H[k * NM + (y - Y0) * 12 + m] > 0) c++;
      v[k] = c / (b - a + 1);
    }
    pastAnyCache.set(key, v);
  }
  return { v, ...scaleOf("any"), years: [a, b] };
}

/* ---------- words ---------- */
export const oddsName = (o: Odds = S.odds) => (isFc(o) ? `Forecast ${o}` : "Past odds");
/** "a hotspot" or "a large fire", for sentences */
export const fireWords = (fire: FireKind = S.fire) => (fire === "large" ? "a large fire (1,000+ acres)" : "fire");
/** "August 2026" for a forecast, "August" for past odds */
export const monthWhen = (m = S.rm, o: Odds = S.odds) => (isFc(o) ? `${MONL[m]} ${o}` : MONL[m]);
/** a chance written for people: whole percent above 10%, one decimal below; a forecast's 0 means under 0.05%, so "<0.1%" */
export const pctP = (x: number, past = false) =>
  past && x === 0 ? "0%" : x >= 0.095 ? Math.round(x * 100) + "%" : x >= 0.0005 ? (x * 100).toFixed(1) + "%" : "<0.1%";
/** a relative change as "5.9%", with a true minus sign when it went the other way, and "0%" when it rounds to nothing */
export const pctGain = (x: number) => (Math.abs(x) < 0.0005 ? "0%" : (x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(1) + "%");
