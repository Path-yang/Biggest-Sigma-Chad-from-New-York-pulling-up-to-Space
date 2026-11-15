import type { CountyOutlook, OutlookData, OutlookState, StateCode } from "./types";

/* =====================================================================
   THE 14-DAY OUTLOOK: outlook.js (scripts/build_outlook.py) holds each county's
   usual chance for every day of the year and a small weather model; the page
   fetches Open-Meteo's forecast for the county points and works out each county's
   chance of at least one hotspot from today through the next 13 days.
   The computation follows the contract in the build script exactly.
   ===================================================================== */
/** outlook.js loads after the page opens a state (src/extras.ts), so it is read when needed */
const O = () => window.OUTLOOK;
/** outlook.js loaded and holds this state */
export const olOn = (st: StateCode) => !!O()?.states?.[st]?.base;
export const olData = () => O();
/** below this usual chance a ratio is mostly noise */
export const RARE = 0.03;
const TIMEOUT_MS = 40000;
/** counties per request: a few requests in parallel come back sooner than one long one, at the same quota cost */
const CHUNK = 16;
/** after this long, the page says the service is slow */
const SLOW_MS = 6000;
/** a fetched outlook is reused for this long, in memory and in the browser's storage */
const KEEP_MS = 3 * 3600 * 1000;
/** the state's own time zone: Open-Meteo starts the 14 days on the county's local date */
const TZ: Record<StateCode, string> = { NY: "America/New_York", CA: "America/Los_Angeles" };
/** today's date in the state, "2026-11-15" */
function stateToday(st: StateCode): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ[st], year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
        new Date(),
      ),
      v = (t: string) => p.find(x => x.type === t)?.value || "";
    return `${v("year")}-${v("month")}-${v("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
/** a fetched outlook can be shown: under 3 hours old, and its 14 days still start today */
const fresh = (st: StateCode, at: number, today: string) => Date.now() - at < KEEP_MS && today >= stateToday(st);

/** day of year 0..364; in a leap year 29 February shares 1 March's index and every later day moves back one
 * (as in scripts/build_outlook.py) */
export function doy365(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const j = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return leap && m > 2 ? j - 1 : j;
}

/** one county's outlook; rain and et0 are its 46 daily values (index prior is today); null if any value is missing */
export function countyOutlook(
  D: OutlookData,
  S: OutlookState,
  ci: number,
  today: string,
  rain: (number | null)[],
  et0: (number | null)[],
): CountyOutlook | null {
  const T = D.prior,
    H = D.horizon;
  if (!/^\d{4}-\d\d-\d\d$/.test(today) || rain.length < T + H || et0.length < T + H) return null;
  let rain14 = 0,
    dry = 0,
    et14 = 0,
    rain30 = 0,
    et30 = 0;
  for (let i = 0; i < T + H; i++) {
    const rv = rain[i],
      ev = et0[i];
    if (typeof rv !== "number" || typeof ev !== "number" || !Number.isFinite(rv) || !Number.isFinite(ev)) return null;
    /* ECMWF can return small negative rain */
    const r = Math.max(0, rv),
      e = Math.max(0, ev);
    if (i < T) {
      rain30 += r;
      et30 += e;
    } else {
      rain14 += r;
      et14 += e;
      if (r < D.dry_mm) dry++;
    }
  }
  const base = S.base[ci * 365 + doy365(today)] / 10000;
  if (!(base > 0 && base < 1)) return null;
  const x = [Math.log(base / (1 - base)), Math.log1p(rain14), dry / H, et14 / H, Math.log1p(rain30), (et30 - rain30) / T];
  let z = S.coef[0];
  for (let j = 0; j < x.length; j++) z += S.coef[j + 1] * x[j];
  const p = 1 / (1 + Math.exp(-z)),
    norm = 1 / (1 + Math.exp(-(S.norm_coef[0] + S.norm_coef[1] * x[0])));
  return { p, base, ratio: p / base, norm, wx_ratio: p / norm, today };
}

/** one request for the given counties of a state; the answer is an array in the same order */
export function forecastUrl(st: StateCode, cis: number[], models: string): string {
  const S = O()!.states[st],
    q = new URLSearchParams();
  q.set("latitude", cis.map(ci => S.pts[ci][0].toFixed(3)).join(","));
  q.set("longitude", cis.map(ci => S.pts[ci][1].toFixed(3)).join(","));
  for (const [k, v] of Object.entries(O()!.api.params)) if (k !== "models") q.set(k, String(v));
  q.set("models", models);
  return O()!.api.url + "?" + q.toString();
}

/* ---------- fetching, with a timeout, a fallback model and a short-lived cache ---------- */
export type OlStatus = "idle" | "loading" | "ok" | "error";
export interface OlRun {
  status: OlStatus;
  /** one per county, null where no weather came back */
  rows: (CountyOutlook | null)[];
  /** first and last day of the 14 */
  today: string;
  end: string;
  /** counties filled from the fallback model, and counties with no outlook */
  fallback: number;
  missing: number;
  /** when the weather was fetched (ms) */
  at: number;
  /** what went wrong, in words */
  err: string;
  /** still loading after a few seconds */
  slow?: boolean;
}
const runs: Partial<Record<StateCode, OlRun>> = {};
const busy: Partial<Record<StateCode, Promise<void>>> = {};
export const olRun = (st: StateCode): OlRun | null => runs[st] || null;

interface Daily {
  time?: unknown;
  precipitation_sum?: unknown;
  et0_fao_evapotranspiration?: unknown;
}
const numArr = (a: unknown): (number | null)[] | null =>
  Array.isArray(a) ? a.map(v => (typeof v === "number" && Number.isFinite(v) ? v : null)) : null;
class WeatherError extends Error {}

async function getDaily(st: StateCode, cis: number[], models: string): Promise<Daily[]> {
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
      r = await fetch(forecastUrl(st, cis, models), { signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      throw new WeatherError(why());
    }
    if (!r.ok)
      throw new WeatherError(
        r.status === 429
          ? "The weather service's free daily limit has been reached. Try again later."
          : `The weather service answered with an error (${r.status}).`,
      );
    let j: unknown;
    try {
      j = await r.json();
    } catch {
      throw new WeatherError(ac.signal.aborted ? why() : "The weather service sent something that is not a forecast.");
    }
    const list = (Array.isArray(j) ? j : [j]) as { daily?: Daily }[];
    if (list.length !== cis.length) throw new WeatherError("The weather service sent a forecast for the wrong number of places.");
    return list.map(o => (o && typeof o === "object" && o.daily) || {});
  } finally {
    clearTimeout(t);
  }
}
function work(st: StateCode, ci: number, d: Daily): CountyOutlook | null {
  const time = Array.isArray(d.time) ? (d.time as unknown[]) : null,
    rain = numArr(d.precipitation_sum),
    et0 = numArr(d.et0_fao_evapotranspiration);
  if (!time || !rain || !et0 || typeof time[O()!.prior] !== "string") return null;
  return countyOutlook(O()!, O()!.states[st], ci, time[O()!.prior] as string, rain, et0);
}
/** the ISO date n days after an ISO date */
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/* ---------- the browser's storage: wrapped, since it can be missing or blocked ---------- */
const storeKey = (st: StateCode) => `burn-outlook-v${O()?.v ?? 0}-${st}`;
type Stored = { at: number; rows: ([number, number, number, string] | null)[]; fallback: number };
function fromStore(st: StateCode): OlRun | null {
  try {
    const raw = localStorage.getItem(storeKey(st));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s || typeof s.at !== "number" || !Array.isArray(s.rows) || s.rows.length !== O()!.states[st].pts.length) return null;
    const rows = s.rows.map(r => (r ? { p: r[0], base: r[1], ratio: r[0] / r[1], norm: r[2], wx_ratio: r[0] / r[2], today: r[3] } : null)),
      run = finish(rows, s.fallback, s.at);
    return run.status === "ok" && fresh(st, run.at, run.today) ? run : null;
  } catch {
    return null;
  }
}
function toStore(st: StateCode, run: OlRun) {
  try {
    const s: Stored = { at: run.at, fallback: run.fallback, rows: run.rows.map(r => (r ? [r.p, r.base, r.norm, r.today] : null)) };
    localStorage.setItem(storeKey(st), JSON.stringify(s));
  } catch {
    /* storage full or blocked: the outlook still works, it is just fetched again next time */
  }
}
function finish(rows: (CountyOutlook | null)[], fallback: number, at: number): OlRun {
  const first = rows.find(r => r) || null,
    /* the most common start date, in case a county's local date differs */
    tally = new Map<string, number>();
  rows.forEach(r => r && tally.set(r.today, (tally.get(r.today) || 0) + 1));
  const today = first ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
  return {
    status: first ? "ok" : "error",
    rows,
    today,
    end: today ? addDays(today, O()!.horizon - 1) : "",
    fallback,
    missing: rows.filter(r => !r).length,
    at,
    err: first ? "" : "The weather service sent no usable forecast.",
  };
}

/** start getting the outlook for a state, unless it is here and fresh, or on its way; done() runs when it changes.
 * force asks again for the counties a fresh outlook is missing (or for all of them, when there is no fresh outlook);
 * the counties already in are kept, whatever the answer. */
export function olLoad(st: StateCode, done: () => void, force = false) {
  if (!olOn(st) || busy[st]) return;
  const have = runs[st],
    keep = have && have.status === "ok" && fresh(st, have.at, have.today) ? have : null;
  if (keep && (!force || !keep.missing)) return;
  if (!keep) {
    const stored = fromStore(st);
    if (stored) {
      runs[st] = stored;
      done();
      return;
    }
    runs[st] = { status: "loading", rows: [], today: "", end: "", fallback: 0, missing: 0, at: 0, err: "" };
    done();
  }
  const n = O()!.states[st].pts.length,
    want = Array.from({ length: n }, (_, i) => i).filter(ci => !keep || !keep.rows[ci]);
  const slowT = setTimeout(() => {
    const cur = runs[st];
    if (cur && cur.status === "loading") {
      cur.slow = true;
      done();
    }
  }, SLOW_MS);
  busy[st] = (async () => {
    try {
      const chunks: number[][] = [];
      for (let i = 0; i < want.length; i += CHUNK) chunks.push(want.slice(i, i + CHUNK));
      const got = await Promise.allSettled(chunks.map(c => getDaily(st, c, String(O()!.api.params.models))));
      if (got.every(g => g.status === "rejected")) throw (got[0] as PromiseRejectedResult).reason;
      const rows: (CountyOutlook | null)[] = keep ? keep.rows.slice() : new Array(n).fill(null),
        answered = new Set<number>();
      got.forEach((g, j) => {
        if (g.status !== "fulfilled") return;
        chunks[j].forEach((ci, i) => {
          answered.add(ci);
          rows[ci] = work(st, ci, g.value[i]);
        });
      });
      /* counties the main model answered with gaps get one more try with Open-Meteo's best-match model */
      let fallback = keep ? keep.fallback : 0;
      const gaps = want.filter(ci => answered.has(ci) && !rows[ci]);
      if (gaps.length) {
        try {
          const fb = await getDaily(st, gaps, O()!.api.fallback_models);
          gaps.forEach((ci, j) => {
            const o = work(st, ci, fb[j]);
            if (o) {
              rows[ci] = o;
              fallback++;
            }
          });
        } catch {
          /* keep what the main model gave; the rest show "no outlook" */
        }
      }
      /* a merged outlook keeps the time of its first answer, so it is not kept longer than that */
      const run = finish(rows, fallback, keep ? keep.at : Date.now());
      const failed = got.find((g): g is PromiseRejectedResult => g.status === "rejected");
      if (failed && run.status === "ok") run.err = failed.reason instanceof WeatherError ? failed.reason.message : "";
      runs[st] = run;
      if (run.status === "ok" && !run.missing) toStore(st, run);
    } catch (e) {
      const err = e instanceof WeatherError ? e.message : "The outlook could not be worked out.";
      /* a failed retry leaves the counties already in on the map */
      runs[st] = keep ? { ...keep, err } : { status: "error", rows: [], today: "", end: "", fallback: 0, missing: n, at: 0, err };
    } finally {
      clearTimeout(slowT);
      delete busy[st];
      done();
    }
  })();
}
