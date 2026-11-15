/* =====================================================================
   THE GLOBAL 14-DAY OUTLOOK: world_outlook.js (scripts/build_world_outlook.py) holds, for about 2,100 grid regions
   of 2.5° (about 280 km), the usual chance that a fortnight is busier than the region's median for that half of the
   month, the region's weather climate and a small weather model. A country page fetches Open-Meteo's forecast for
   that country's regions and works out each region's chance. The computation follows the build's CONTRACT.md and
   its reference (regionOutlook) exactly.
   ===================================================================== */
export type FeatureId = "tmax14" | "rhmin14" | "prec14" | "prec30";
/** Brier skill, AUC with weather, AUC of the usual odds, rows, events */
export type CountryMetric = [bss: number, aucModel: number, aucUsual: number, rows: number, events: number];
interface Scores {
  brier: number;
  bss: number;
  auc: number;
  n: number;
  event_rate: number;
}
export interface WorldOutlook {
  v: 1;
  built: string;
  horizon: number;
  prior: number;
  nharm: number;
  z_clip: number;
  regions: { band: number[]; col: number[]; lat: number[]; lon: number[]; zone: number[]; cont: number[]; bss: (number | null)[] };
  zones: string[];
  continents: string[];
  /** the regions where a FIRMS country has hotspots, with its share (‰) of the country's 2012-2025 hotspots */
  countries: Record<string, [ri: number, shareMille: number][]>;
  no_region: Record<string, number>;
  base: number[];
  thr: number[];
  features: { id: FeatureId }[];
  clim: Record<FeatureId, { mu: number[]; var: number[]; floor: number[] }>;
  coef: number[];
  norm_coef: [number, number];
  adjust: { tmax: number[]; tdew: number[]; prec: number[] };
  api: { url: string; params: Record<string, string | number>; max_points_per_get: number };
  metrics: {
    variants: Record<string, Scores>;
    by_zone: Record<string, { model: Scores; climatology_auc: number }>;
    by_continent: Record<string, { model: Scores; climatology_auc: number }>;
    by_country: Record<string, CountryMetric>;
    regions_beating_climatology: number;
  };
  examples: {
    region: number;
    today: string;
    temperature_2m_max: number[];
    dew_point_2m_mean: number[];
    precipitation_sum: number[];
    expect: { p: number; logit: number; ratio: number; norm: number; wx_ratio: number };
  }[];
}

/* ---------- loading the data file, only when a country opens ---------- */
const SRC = "world_outlook.js?v=1";
let fileP: Promise<WorldOutlook> | null = null;
/** world_outlook.js (0.34 MB compressed); a failed load is forgotten so the next country tries again */
export function loadWorldOutlook(): Promise<WorldOutlook> {
  if (window.WORLD_OUTLOOK) return Promise.resolve(window.WORLD_OUTLOOK);
  if (!fileP) {
    fileP = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = () => (window.WORLD_OUTLOOK ? ok(window.WORLD_OUTLOOK) : fail(new Error("the outlook file was empty")));
      s.onerror = () => {
        s.remove();
        fail(new Error("the outlook file did not load"));
      };
      document.head.appendChild(s);
    });
    fileP.catch(() => (fileP = null));
  }
  return fileP;
}

/* ---------- the computation (CONTRACT.md, "The computation") ---------- */
/** day of year 0..364; 29 February shares 28 February's index (58) */
export function doy365(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const j = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return leap && m > 2 ? j - 1 : j;
}
/** half-month 0..23 */
export function halfMonth(iso: string): number {
  const [, m, d] = iso.split("-").map(Number);
  return 2 * (m - 1) + (d > 15 ? 1 : 0);
}
/** a region's square [west, south, east, north] */
export function cellBounds(band: number, col: number): [number, number, number, number] {
  const n = Math.max(1, Math.round(144 * Math.cos(((-90 + 2.5 * (band + 0.5)) * Math.PI) / 180)));
  const w = 360 / n;
  return [-180 + col * w, -90 + band * 2.5, -180 + (col + 1) * w, -90 + (band + 1) * 2.5];
}
/** Magnus saturation vapour pressure, unscaled */
const es = (t: number) => Math.exp((17.62 * t) / (243.12 + t));

export interface RegionOutlook {
  /** chance that the 14 days from today are busier than the region's median fortnight for this half-month */
  p: number;
  /** the share of past fortnights at this time of year that were busier than the median */
  base: number;
  ratio: number;
  /** the model's chance with average weather */
  norm: number;
  wxRatio: number;
  /** the usual (median) 14-day hotspot count; the event is "more than this" */
  thr: number;
  hm: number;
  /** the region's local date that starts the 14 days */
  today: string;
  /** the largest standardised weather anomaly before clipping: how far the forecast is from the region's usual weather */
  zMax: number;
}
/** one region's outlook from 44 Open-Meteo daily values (0..29 the 30 days before today, 30 today); null if any is missing */
export function regionOutlook(
  O: WorldOutlook,
  ri: number,
  today: string,
  tmax: (number | null)[],
  tdew: (number | null)[],
  prec: (number | null)[],
): RegionOutlook | null {
  const T = O.prior,
    H = O.horizon,
    K = 2 * O.nharm + 1;
  if (!/^\d{4}-\d\d-\d\d$/.test(today)) return null;
  for (let i = 0; i < T + H; i++)
    for (const a of [tmax, tdew, prec]) {
      const v = a[i];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
    }
  const at = O.adjust.tmax[ri],
    ad = O.adjust.tdew[ri],
    ps = O.adjust.prec[ri];
  let t14 = 0,
    rh14 = 0,
    p14 = 0,
    p30 = 0;
  for (let i = 0; i < T + H; i++) {
    /* Open-Meteo put on POWER's footing: the region's offsets, and its rain scale */
    const tx = (tmax[i] as number) - at,
      td = (tdew[i] as number) - ad,
      pr = Math.max(0, prec[i] as number) * ps;
    if (i < T) p30 += pr;
    else {
      t14 += tx;
      rh14 += Math.min(100, (100 * es(td)) / es(tx));
      p14 += pr;
    }
  }
  const x: Record<FeatureId, number> = { tmax14: t14 / H, rhmin14: rh14 / H, prec14: Math.log1p(p14), prec30: Math.log1p(p30) };
  const doy = doy365(today),
    hm = halfMonth(today),
    a = (2 * Math.PI * doy) / 365,
    h = [1];
  for (let k = 1; k <= O.nharm; k++) h.push(Math.cos(k * a), Math.sin(k * a));
  const base = O.base[ri * 24 + hm] / 1000;
  if (!(base > 0 && base < 1)) return null;
  const lb = Math.log(base / (1 - base));
  let z = O.coef[0] + O.coef[1] * lb,
    zMax = 0;
  O.features.forEach((f, j) => {
    const C = O.clim[f.id];
    let mu = 0,
      v = 0;
    for (let k = 0; k < K; k++) {
      mu += h[k] * C.mu[ri * K + k];
      v += h[k] * C.var[ri * K + k];
    }
    const sd = Math.max(Math.sqrt(Math.max(v, 0)), C.floor[ri]),
      raw = (x[f.id] - mu) / sd,
      za = Math.max(-O.z_clip, Math.min(O.z_clip, raw));
    zMax = Math.max(zMax, Math.abs(raw));
    z += O.coef[j + 2] * za;
  });
  const p = 1 / (1 + Math.exp(-z)),
    norm = 1 / (1 + Math.exp(-(O.norm_coef[0] + O.norm_coef[1] * lb)));
  return { p, base, ratio: p / base, norm, wxRatio: p / norm, thr: O.thr[ri * 24 + hm], hm, today, zMax };
}
/** the two worked examples in the file, recomputed; the largest difference in p (for tests) */
export function checkExamples(O: WorldOutlook): number {
  let worst = 0;
  for (const e of O.examples) {
    const r = regionOutlook(O, e.region, e.today, e.temperature_2m_max, e.dew_point_2m_mean, e.precipitation_sum);
    worst = Math.max(worst, r ? Math.abs(r.p - e.expect.p) + Math.abs(r.norm - e.expect.norm) : Infinity);
  }
  return worst;
}

/* ---------- which regions a country page asks for ---------- */
export type CountryRegion = { ri: number; share: number };
/** a country's regions holding at least 0.1% of its hotspots (all of them if none does); the rest are drawn but not
    fetched, to spare the free weather quota */
export function countryRegions(O: WorldOutlook, k: string): { used: CountryRegion[]; minor: CountryRegion[] } {
  const all = (O.countries[k] || []).map(([ri, m]) => ({ ri, share: m / 1000 }));
  const used = all.filter(r => r.share >= 0.001);
  return used.length ? { used, minor: all.filter(r => r.share < 0.001) } : { used: all, minor: [] };
}

/* ---------- fetching, with a timeout and a short-lived cache ---------- */
const TIMEOUT_MS = 45000;
/** points per request: a few requests in parallel come back sooner than one long one, at the same quota cost */
const CHUNK = 50;
/** a fetched outlook is reused for this long, in memory and in the browser's storage */
const KEEP_MS = 3 * 3600 * 1000;

export interface WolRun {
  status: "loading" | "ok" | "error";
  /** by region index; null where no usable weather came back */
  rows: Map<number, RegionOutlook | null>;
  /** the most common first and last day of the 14 */
  today: string;
  end: string;
  missing: number;
  at: number;
  err: string;
}
class WeatherError extends Error {}
interface Daily {
  time?: unknown;
  temperature_2m_max?: unknown;
  dew_point_2m_mean?: unknown;
  precipitation_sum?: unknown;
}
const numArr = (a: unknown): (number | null)[] | null =>
  Array.isArray(a) ? a.map(v => (typeof v === "number" && Number.isFinite(v) ? v : null)) : null;

function forecastUrl(O: WorldOutlook, ris: number[]): string {
  const q = new URLSearchParams({
    latitude: ris.map(r => O.regions.lat[r].toFixed(2)).join(","),
    longitude: ris.map(r => O.regions.lon[r].toFixed(2)).join(","),
  });
  for (const [k, v] of Object.entries(O.api.params)) q.set(k, String(v));
  return `${O.api.url}?${q}`;
}
async function getDaily(O: WorldOutlook, ris: number[]): Promise<Daily[]> {
  /* the timeout covers the whole answer: the service can send its headers quickly and then trickle the body */
  const ac = new AbortController(),
    t = setTimeout(() => ac.abort(), TIMEOUT_MS),
    why = () =>
      ac.signal.aborted
        ? `The weather service did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : navigator.onLine === false
          ? "You seem to be offline, so there is no weather forecast."
          : "The weather service could not be reached.";
  try {
    let r: Response;
    try {
      r = await fetch(forecastUrl(O, ris), { signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      throw new WeatherError(why());
    }
    if (!r.ok)
      throw new WeatherError(
        r.status === 429
          ? "The weather service's free limit for this connection has been reached. Try again in a few minutes."
          : `The weather service answered with an error (${r.status}).`,
      );
    let j: unknown;
    try {
      j = await r.json();
    } catch {
      throw new WeatherError(ac.signal.aborted ? why() : "The weather service sent something that is not a forecast.");
    }
    const list = (Array.isArray(j) ? j : [j]) as { daily?: Daily }[];
    if (list.length !== ris.length) throw new WeatherError("The weather service sent a forecast for the wrong number of places.");
    return list.map(o => (o && typeof o === "object" && o.daily) || {});
  } finally {
    clearTimeout(t);
  }
}
function work(O: WorldOutlook, ri: number, d: Daily): RegionOutlook | null {
  const time = Array.isArray(d.time) ? (d.time as unknown[]) : null,
    tmax = numArr(d.temperature_2m_max),
    tdew = numArr(d.dew_point_2m_mean),
    prec = numArr(d.precipitation_sum),
    today = time ? time[O.prior] : null;
  if (!tmax || !tdew || !prec || typeof today !== "string") return null;
  return regionOutlook(O, ri, today, tmax, tdew, prec);
}
/** the ISO date n days after an ISO date */
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function finish(O: WorldOutlook, rows: Map<number, RegionOutlook | null>, at: number): WolRun {
  const tally = new Map<string, number>();
  rows.forEach(r => r && tally.set(r.today, (tally.get(r.today) || 0) + 1));
  const today = tally.size ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
  let missing = 0;
  rows.forEach(r => (missing += r ? 0 : 1));
  return {
    status: today ? "ok" : "error",
    rows,
    today,
    end: today ? addDays(today, O.horizon - 1) : "",
    missing,
    at,
    err: today ? "" : "The weather service sent no usable forecast.",
  };
}

/* the browser's storage: wrapped, since it can be missing or blocked */
const storeKey = (O: WorldOutlook, k: string) => `burn-world-outlook-v${O.v}.2-${O.built}-${k}`;
/** gaps: regions the service answered with missing values, kept as "no outlook" */
type Stored = { at: number; rows: [number, number, number, number, number, number, string, number][]; gaps: number[] };
function fromStore(O: WorldOutlook, k: string, want: number[]): WolRun | null {
  try {
    const raw = localStorage.getItem(storeKey(O, k));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s || typeof s.at !== "number" || Date.now() - s.at > KEEP_MS || !Array.isArray(s.rows)) return null;
    const rows = new Map<number, RegionOutlook | null>();
    for (const [ri, p, base, norm, thr, hm, today, zMax] of s.rows)
      rows.set(ri, { p, base, ratio: p / base, norm, wxRatio: p / norm, thr, hm, today, zMax });
    for (const ri of Array.isArray(s.gaps) ? s.gaps : []) rows.set(ri, null);
    if (want.some(ri => !rows.has(ri))) return null;
    const run = finish(O, rows, s.at);
    return run.status === "ok" ? run : null;
  } catch {
    return null;
  }
}
function toStore(O: WorldOutlook, k: string, run: WolRun) {
  try {
    const rows: Stored["rows"] = [],
      gaps: number[] = [];
    run.rows.forEach((r, ri) => (r ? rows.push([ri, r.p, r.base, r.norm, r.thr, r.hm, r.today, r.zMax]) : gaps.push(ri)));
    localStorage.setItem(storeKey(O, k), JSON.stringify({ at: run.at, rows, gaps } satisfies Stored));
  } catch {
    /* storage full or blocked: the outlook still works, it is just fetched again next time */
  }
}

const runs = new Map<string, WolRun>();
const busy = new Set<string>();
export const wolRun = (k: string) => runs.get(k) || null;
/** a chunk that fails for a reason other than the quota is asked once more before giving up */
async function getDailyTwice(O: WorldOutlook, ris: number[]): Promise<Daily[]> {
  try {
    return await getDaily(O, ris);
  } catch (e) {
    if (e instanceof WeatherError && /limit|offline/.test(e.message)) throw e;
    return getDaily(O, ris);
  }
}
/** below this share of the country's fire answered, the outlook is not shown: a headline from a few regions would mislead */
const MIN_SHARE = 0.75;
/** get the outlook for a country's regions, unless it is here and fresh or already on its way; done() runs on each change.
    A fresh outlook with gaps asks again only for the regions it is missing, and keeps the rest. */
export function wolLoad(O: WorldOutlook, k: string, done: () => void) {
  if (busy.has(k)) return;
  const regs = countryRegions(O, k).used,
    shareOf = new Map(regs.map(r => [r.ri, r.share])),
    total = regs.reduce((a, r) => a + r.share, 0) || 1,
    have = runs.get(k),
    keep = have && have.status === "ok" && Date.now() - have.at < KEEP_MS ? have : null;
  /* regions the service answered with gaps are not asked again until the outlook expires */
  if (keep && !keep.err) return done();
  if (!keep) {
    const stored = fromStore(
      O,
      k,
      regs.map(r => r.ri),
    );
    if (stored) {
      runs.set(k, stored);
      return done();
    }
    runs.set(k, { status: "loading", rows: new Map(), today: "", end: "", missing: 0, at: 0, err: "" });
  }
  done();
  const want = regs.map(r => r.ri).filter(ri => !keep || !keep.rows.get(ri));
  busy.add(k);
  (async () => {
    try {
      const chunks: number[][] = [];
      const size = Math.min(CHUNK, O.api.max_points_per_get);
      for (let i = 0; i < want.length; i += size) chunks.push(want.slice(i, i + size));
      const got = await Promise.allSettled(chunks.map(c => getDailyTwice(O, c)));
      const failed = got.find((g): g is PromiseRejectedResult => g.status === "rejected");
      const rows = new Map<number, RegionOutlook | null>(keep ? keep.rows : regs.map(r => [r.ri, null]));
      got.forEach((g, j) => {
        if (g.status === "fulfilled") chunks[j].forEach((ri, i) => rows.set(ri, work(O, ri, g.value[i])));
      });
      let answered = 0;
      rows.forEach((r, ri) => (answered += r ? shareOf.get(ri) || 0 : 0));
      if (answered / total < MIN_SHARE) throw failed ? failed.reason : new WeatherError("The weather service sent no usable forecast.");
      const run = finish(O, rows, keep ? keep.at : Date.now());
      if (failed) run.err = failed.reason instanceof WeatherError ? failed.reason.message : "Part of the forecast did not arrive.";
      runs.set(k, run);
      if (run.status === "ok" && !failed) toStore(O, k, run);
    } catch (e) {
      const err = e instanceof WeatherError ? e.message : "The outlook could not be worked out.";
      /* a failed retry leaves the regions already in on the map */
      runs.set(k, keep ? { ...keep, err } : { status: "error", rows: new Map(), today: "", end: "", missing: want.length, at: 0, err });
    } finally {
      busy.delete(k);
      done();
    }
  })();
}
