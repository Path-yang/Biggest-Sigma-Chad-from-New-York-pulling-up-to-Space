import { fileUrl } from "./hf";

/* =====================================================================
   AREA DATA: every grid square's harmonized hotspots month by month (Hugging Face cells/v1), fetched the first time
   a reader opens the area tools on a country, and the sums and comparisons for any set of squares.
   ===================================================================== */
export const CELLS_DIR = "cells/v1";
export const cellsPath = (k: string) => `${CELLS_DIR}/${encodeURIComponent(k)}.json`;
/** a whole file has this long to arrive */
const TIMEOUT_MS = 60000;

export interface PartMonth {
  y: number;
  /** 1-based month */
  m: number;
  i: number;
  day1: number;
}
export interface Grid {
  country: string;
  cell: number;
  y0: number;
  nm: number;
  partial: PartMonth | null;
  n: number;
  /** centre of each square */
  lat: Float64Array;
  lon: Float64Array;
  /** south-west corner, for the map */
  s: Float64Array;
  w: Float64Array;
  /** hotspots, square c and month i at c * nm + i */
  v: Float32Array;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNums = (x: unknown): x is number[] => Array.isArray(x) && x.every(v => typeof v === "number");

function parse(x: unknown, k: string): Grid {
  if (!isObj(x) || x.v !== 1 || x.country !== k) throw new Error("the file is not in the expected format");
  const cell = x.cell,
    y0 = x.y0,
    nm = x.n_months,
    cells = x.cells,
    rows = x.rows;
  if (typeof cell !== "number" || !(cell > 0) || typeof y0 !== "number" || typeof nm !== "number" || !(nm > 0))
    throw new Error("the file is not in the expected format");
  if (!isNums(cells) || cells.length % 2 || !isNums(rows) || rows.length % 3) throw new Error("the file is not in the expected format");
  const n = cells.length / 2,
    lat = new Float64Array(n),
    lon = new Float64Array(n),
    s = new Float64Array(n),
    w = new Float64Array(n),
    v = new Float32Array(n * nm),
    lim = 180 / cell + 1;
  for (let c = 0; c < n; c++) {
    let la = cells[2 * c],
      lo = cells[2 * c + 1];
    /* files built before 14 November 2026 wrote a square west of Greenwich as lat - 1, lon + 100000 */
    if (lo > lim) {
      lo -= 100000;
      la += 1;
    }
    s[c] = la * cell;
    w[c] = lo * cell;
    lat[c] = s[c] + cell / 2;
    lon[c] = w[c] + cell / 2;
  }
  for (let p = 0; p < rows.length; p += 3) {
    const c = rows[p],
      i = rows[p + 1];
    if (c >= 0 && c < n && i >= 0 && i < nm) v[c * nm + i] = rows[p + 2];
  }
  const pt = x.partial;
  const partial =
    isObj(pt) && typeof pt.y === "number" && typeof pt.m === "number" && typeof pt.i === "number" && typeof pt.day1 === "number"
      ? { y: pt.y, m: pt.m, i: pt.i, day1: pt.day1 }
      : null;
  return { country: k, cell, y0, nm, partial, n, lat, lon, s, w, v };
}

/** the dataset has no file for this country: nothing to retry */
export class NoCells extends Error {}
const NO_FILE = "Hugging Face has no month-by-month squares for this country yet";
let index: Promise<Set<string> | null> | null = null;
/** the countries with a file, from cells/v1/index.json; null when the index itself does not arrive */
function listed(): Promise<Set<string> | null> {
  if (!index)
    index = fetch(fileUrl(`${CELLS_DIR}/index.json`))
      .then(r => (r.ok ? r.json() : null))
      .then((x: unknown) =>
        isObj(x) && Array.isArray(x.countries) ? new Set(x.countries.filter(isObj).map(c => String(c.country))) : null,
      )
      .catch(() => null)
      .then(s => {
        if (!s) index = null;
        return s;
      });
  return index;
}
const GRIDS = new Map<string, Promise<Grid>>();
/** one country's squares; a failed fetch is forgotten so Try again asks again, unless the country has no file */
export function loadGrid(k: string): Promise<Grid> {
  const had = GRIDS.get(k);
  if (had) return had;
  const p = (async () => {
    /* ask the index first, so a country without a file costs no failed request */
    const has = await listed();
    if (has && !has.has(k)) throw new NoCells(NO_FILE);
    const ctl = new AbortController(),
      timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(fileUrl(cellsPath(k)), { signal: ctl.signal });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        res = await fetch(fileUrl(cellsPath(k)), { signal: ctl.signal });
      }
      if (res.status === 404) throw new NoCells(NO_FILE);
      if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
      return parse(await res.json(), k);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw new Error("it took longer than a minute");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  })();
  p.catch(e => {
    if (!(e instanceof NoCells)) GRIDS.delete(k);
  });
  GRIDS.set(k, p);
  return p;
}

/* ---------- sums ---------- */
/** the monthly series of a set of squares */
export function seriesOf(g: Grid, idx: ArrayLike<number>) {
  const S = new Float64Array(g.nm);
  for (let k = 0; k < idx.length; k++) {
    const o = idx[k] * g.nm;
    for (let i = 0; i < g.nm; i++) S[i] += g.v[o + i];
  }
  return S;
}

export function median(a: ArrayLike<number>) {
  const s = Array.from(a).sort((x, y) => x - y),
    h = s.length >> 1;
  if (!s.length) return 0;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** the parts of the record every comparison needs */
export interface Frame {
  y0: number;
  nm: number;
  /** last year with all twelve months: the "usual" runs from y0 to here */
  yb: number;
  /** the year of the last data, and its last complete month (0-based, -1 if none) */
  cy: number;
  cyLast: number;
  partial: PartMonth | null;
}
export function frameOf(g: Grid): Frame {
  const lastFull = g.partial ? g.partial.i - 1 : g.nm - 1,
    cy = g.y0 + Math.floor((g.nm - 1) / 12),
    yb = g.y0 + Math.floor((lastFull + 1) / 12) - 1,
    cyLast = lastFull - (cy - g.y0) * 12;
  return { y0: g.y0, nm: g.nm, yb, cy, cyLast, partial: g.partial };
}
export const idxOf = (F: Frame, y: number, m: number) => (y - F.y0) * 12 + m;

/** a long-term trend: Sen's slope on log(1 + yearly total), tested with Mann-Kendall */
export interface Trend {
  /** % per decade, compounded, so never below -100 */
  pct: number;
  /** the rise or fall is clear of year-to-year noise (Mann-Kendall, p < 0.05) */
  clear: boolean;
  /** the fitted curve: log(1 + hotspots) = a + b * (year - y0) */
  a: number;
  b: number;
}
/** a trend needs this many hotspots in an average complete year, and this many years with fire */
export const TREND_MIN_MEAN = 10;
export const TREND_MIN_YEARS = 5;

export interface AreaStats {
  /** usual (median of y0..yb) for each calendar month */
  usual: number[];
  /** median over complete years with fire of each month's % of that year's total */
  share: number[];
  /** complete-year totals, y0..yb */
  years: { y: number; v: number }[];
  /** median of the complete-year totals */
  usualYear: number;
  /** the last year so far, over its complete months, against the same months of past years */
  ytd: { y: number; last: number; cur: number; usual: number; rank: number; ties: number; n: number } | null;
  /** the partial month so far, never compared */
  part: number | null;
  peak: number;
  top: { y: number; v: number } | null;
  /** null when there is too little fire to read one */
  trend: Trend | null;
  mean: number;
  total: number;
}
export function stats(F: Frame, S: ArrayLike<number>): AreaStats {
  const usual: number[] = [];
  for (let m = 0; m < 12; m++) {
    const v: number[] = [];
    for (let y = F.y0; y <= F.yb; y++) v.push(S[idxOf(F, y, m)]);
    usual.push(median(v));
  }
  const years: { y: number; v: number }[] = [];
  for (let y = F.y0; y <= F.yb; y++) {
    let t = 0;
    for (let m = 0; m < 12; m++) t += S[idxOf(F, y, m)];
    years.push({ y, v: t });
  }
  let total = 0;
  for (let i = 0; i < F.nm; i++) total += S[i];
  const mean = years.length ? years.reduce((a, r) => a + r.v, 0) / years.length : 0;
  /* the latest year: its complete months against the same months of every complete year */
  let ytd: AreaStats["ytd"] = null;
  if (F.cy > F.yb && F.cyLast >= 0) {
    const sum = (y: number) => {
      let t = 0;
      for (let m = 0; m <= F.cyLast; m++) t += S[idxOf(F, y, m)];
      return t;
    };
    const cur = sum(F.cy),
      past = years.map(r => sum(r.y));
    ytd = {
      y: F.cy,
      last: F.cyLast,
      cur,
      usual: median(past),
      /* sums of rounded values: equal within a tenth */
      rank: 1 + past.filter(v => v > cur + 0.05).length,
      ties: past.filter(v => Math.abs(v - cur) <= 0.05).length,
      n: past.length + 1,
    };
  }
  const part = F.partial ? S[F.partial.i] : null;
  let peak = 0;
  for (let m = 1; m < 12; m++) if (usual[m] > usual[peak]) peak = m;
  /* every median zero (fire in only a few years): the month with the most fire in total */
  if (usual[peak] === 0) {
    const tot = new Array(12).fill(0);
    for (let y = F.y0; y <= F.yb; y++) for (let m = 0; m < 12; m++) tot[m] += S[idxOf(F, y, m)];
    peak = tot.indexOf(Math.max(...tot));
  }
  const top = years.length ? years.reduce((a, r) => (r.v > a.v ? r : a), years[0]) : null;
  const share: number[] = [];
  for (let m = 0; m < 12; m++)
    share.push(median(years.filter(r => r.v > 0).map(r => (S[idxOf(F, r.y, m)] / r.v) * 100)));
  const trend =
    mean >= TREND_MIN_MEAN && years.filter(r => r.v >= 1).length >= TREND_MIN_YEARS ? trendOf(years, F.y0) : null;
  return {
    usual,
    share,
    years,
    usualYear: median(years.map(r => r.v)),
    ytd,
    part,
    peak,
    top: top && top.v > 0 ? top : null,
    trend,
    mean,
    total,
  };
}

/** Sen's slope through log(1 + total), as a compounded % per decade, and whether a Mann-Kendall test finds it clear */
export function trendOf(years: { y: number; v: number }[], y0: number): Trend {
  const n = years.length,
    x = years.map(r => r.y - y0),
    l = years.map(r => Math.log1p(Math.max(0, r.v))),
    slopes: number[] = [];
  let S = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      slopes.push((l[j] - l[i]) / (x[j] - x[i]));
      S += Math.sign(years[j].v - years[i].v);
    }
  const b = median(slopes),
    a = median(l.map((v, i) => v - b * x[i]));
  /* the variance of S, less for tied values (years with no fire tie with each other) */
  const groups = new Map<number, number>();
  for (const r of years) groups.set(r.v, (groups.get(r.v) ?? 0) + 1);
  let tie = 0;
  for (const t of groups.values()) tie += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18,
    z = varS > 0 ? (S - Math.sign(S)) / Math.sqrt(varS) : 0;
  return { pct: (Math.exp(10 * b) - 1) * 100, clear: Math.abs(z) >= 1.96, a, b };
}

/* ---------- where to watch: a history-based estimate for one calendar month ---------- */
export interface Estimate {
  vals: number[];
  med: number;
  recent: number;
  expected: number;
  lo: number;
  hi: number;
  active: number;
}
/** the ten latest years with that month complete */
export function watchYears(F: Frame, m: number) {
  const lastY = m <= F.cyLast && F.cy > F.yb ? F.cy : F.yb;
  return Array.from({ length: 10 }, (_, k) => lastY - 9 + k).filter(y => y >= F.y0);
}
/** 60% the median of the last ten, 40% the mean of the last three, as in the HotSpotters outlook */
export function estimate(F: Frame, S: ArrayLike<number>, m: number, years: number[]): Estimate {
  const vals = years.map(y => S[idxOf(F, y, m)]),
    med = median(vals),
    last3 = vals.slice(-3),
    recent = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length),
    sorted = vals.slice().sort((a, b) => a - b),
    q = (f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))] ?? 0;
  return { vals, med, recent, expected: 0.6 * med + 0.4 * recent, lo: q(0.2), hi: q(0.8), active: vals.filter(v => v >= 1).length };
}
