import type { CountryIndexEntry, CountrySummary } from "./types";

/* =====================================================================
   HUGGING FACE: the per-country summaries, fetched when a reader opens a country
   ===================================================================== */
export const HF_DATASET = "rogeryzd/firms-active-fire-by-country";
export const HF_PAGE = `https://huggingface.co/datasets/${HF_DATASET}`;
/** v3 is v2 (which drops cell-years any sensor flags as a static source; see the dataset card) with 2026 to date
 * added; v2 is the fallback when v3 does not arrive or does not check out */
export const SUMMARY_DIR = "summary/v3";
const FALLBACK_DIR = "summary/v2";
export const summaryPath = (k: string, dir = SUMMARY_DIR) => `${dir}/${encodeURIComponent(k)}.json`;
/** the file a summary came from: its version picks the folder */
export const pathOf = (d: CountrySummary) => summaryPath(d.country, `summary/v${d.v}`);
export const fileUrl = (path: string) => `${HF_PAGE}/resolve/main/${path}`;

/** bytes received so far, and the expected total when the server says */
export type Progress = (got: number, total: number | null) => void;

const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
/** Hugging Face limits anonymous requests; on 429 wait as asked (at most 8 s) and try once more */
async function fetchOnce(url: string) {
  const res = await fetch(url);
  if (res.status !== 429) return res;
  const after = Number(res.headers.get("retry-after"));
  await wait(after > 0 ? Math.min(8, after) * 1000 : 2500);
  return fetch(url);
}
async function fetchText(url: string, onProgress: () => Progress | null) {
  const res = await fetchOnce(url);
  if (!res.ok) throw new Error(res.status === 429 ? "Hugging Face is busy (too many requests)" : `Hugging Face answered ${res.status}`);
  const total = Number(res.headers.get("content-length")) || null;
  if (!res.body) return res.text();
  const reader = res.body.getReader(),
    parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress()?.(got, total);
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all);
}

/* ---------- checking what arrived ---------- */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNums = (x: unknown, n?: number): x is number[] =>
  Array.isArray(x) && (n === undefined || x.length === n) && x.every(v => typeof v === "number");
const isNumOrNull = (x: unknown) => x === null || typeof x === "number";
function isSummary(x: unknown, k: string): x is CountrySummary {
  if (!isObj(x) || (x.v !== 2 && x.v !== 3) || x.country !== k || typeof x.name !== "string") return false;
  if (typeof x.y0 !== "number" || typeof x.y1 !== "number" || x.y1 < x.y0) return false;
  /* v3's last year is partial: its arrays stop at n_months, and 2026 comes with its comparisons */
  if (x.v === 3 && !isV3(x)) return false;
  const nm = x.v === 3 ? (x.n_months as number) : (x.y1 - x.y0 + 1) * 12,
    mo = x.monthly,
    val = x.val,
    src = x.source,
    tot = x.totals;
  return (
    isNums(x.viirs_from, 2) &&
    isNums(x.aqua_from, 2) &&
    isNums(x.bins) &&
    typeof x.filter === "string" &&
    isObj(mo) &&
    ["T", "A", "V", "N20"].every(s => isNums(mo[s], nm)) &&
    ["r_ta", "r_t", "r_ta_lo", "r_ta_hi"].every(s => isNums(x[s], 12)) &&
    typeof x.r_all === "number" &&
    Array.isArray(x.pi) &&
    x.pi.length === x.bins.length + 1 &&
    x.pi.every(p => isNums(p, 2)) &&
    typeof x.zero_hi === "number" &&
    typeof x.rate_note === "string" &&
    isObj(val) &&
    ["raw_factor", "annual_med_err", "annual_max_err", "monthly_wape"].every(s => isNumOrNull(val[s])) &&
    Array.isArray(val.loyo) &&
    val.loyo.every(r => isObj(r) && ["y", "obs", "pred", "modis"].every(s => typeof r[s] === "number")) &&
    isNums(x.bbox, 4) &&
    typeof x.cell === "number" &&
    x.cell > 0 &&
    isNums(x.cells) &&
    isNums(x.cell_rows) &&
    x.cell_rows.length % 5 === 0 &&
    isObj(tot) &&
    isObj(src) &&
    typeof src.firms_updated === "string" &&
    typeof src.files === "number"
  );
}
function isV3(x: Record<string, unknown>) {
  const p = x.partial,
    y = x.y2026,
    nm = x.n_months;
  if (typeof nm !== "number" || typeof x.last_date !== "string" || !isObj(p) || !isObj(y)) return false;
  if (typeof x.y0 !== "number" || nm > ((x.y1 as number) - x.y0 + 1) * 12 || p.i !== nm - 1) return false;
  const sd = y.same_days,
    ytd = y.ytd,
    jc = y.join_check_2025;
  const cmp = (c: unknown) =>
    isObj(c) &&
    isNums(c.V) &&
    isObj(c.V_stats) &&
    ["cur", "cur_lo", "cur_hi", "rank"].every(s => typeof c[s] === "number") &&
    isNums(c.years, 2);
  return (
    ["v_obs", "v_conv", "v_lo", "v_hi"].every(s => isNums(y[s])) &&
    Array.isArray(y.conv_months) &&
    y.conv_months.every(c => isObj(c) && typeof c.i === "number" && isNums(c.days)) &&
    cmp(sd) &&
    cmp(ytd) &&
    isObj(jc) &&
    typeof jc.warn === "boolean" &&
    (y.hist_gaps === undefined ||
      (Array.isArray(y.hist_gaps) &&
        y.hist_gaps.every(g => isObj(g) && ["i", "filled", "lo", "hi"].every(k => typeof g[k] === "number") && isNums(g.days))))
  );
}
const isIndexEntry = (x: unknown): x is CountryIndexEntry =>
  isObj(x) && typeof x.country === "string" && typeof x.name === "string" && typeof x.file === "string";

/* ---------- one fetch per country per page load ---------- */
interface Pending {
  p: Promise<CountrySummary>;
  /** who hears about progress: the view that asked last */
  tell: { listen: Progress | null };
}
const SUMMARIES = new Map<string, Pending>();
/** the summary of one country; a failed fetch is forgotten so that Retry asks again */
export function loadSummary(k: string, onProgress: Progress | null): Promise<CountrySummary> {
  const had = SUMMARIES.get(k);
  if (had) {
    had.tell.listen = onProgress;
    return had.p;
  }
  const tell = { listen: onProgress },
    get = (dir: string) =>
      fetchText(fileUrl(summaryPath(k, dir)), () => tell.listen).then(text => {
        const data: unknown = JSON.parse(text);
        if (!isSummary(data, k)) throw new Error("The file from Hugging Face is not in the expected format");
        return data;
      }),
    /* the record with 2026 to date; if it fails, the 2001-2025 record */
    p = get(SUMMARY_DIR).catch(() => get(FALLBACK_DIR));
  p.catch(() => SUMMARIES.delete(k));
  SUMMARIES.set(k, { p, tell });
  return p;
}
let index: Promise<CountryIndexEntry[]> | null = null;
/** the list of every country in the dataset, including any without an outline in world.js */
export function loadIndex(): Promise<CountryIndexEntry[]> {
  if (!index) {
    const get = (dir: string) =>
      fetchText(fileUrl(`${dir}/index.json`), () => null).then(text => {
        const data: unknown = JSON.parse(text);
        if (!isObj(data) || !Array.isArray(data.countries)) throw new Error("The country index is not in the expected format");
        return data.countries.filter(isIndexEntry);
      });
    index = get(SUMMARY_DIR).catch(() => get(FALLBACK_DIR));
    index.catch(() => (index = null));
  }
  return index;
}

/* =====================================================================
   SMALL EXTRA FILES FOR THE COUNTRY PAGE: the 2026-2027 forecast (forecast/v1) and the fire stations
   (stations/v3: OpenStreetMap and Overture Maps; stations/v2, OpenStreetMap alone, when v3 does not arrive).
   Fetched only after the country's summary has arrived, so they never hold up the page, and given up on after a
   timeout so a slow answer ends in a quiet message instead of a spinner.
   ===================================================================== */
export const FORECAST_DIR = "forecast/v1";
export const STATIONS_DIR = "stations/v3";
export const STATIONS_FALLBACK_DIR = "stations/v2";
export const forecastPath = (k: string) => `${FORECAST_DIR}/${encodeURIComponent(k)}.json`;
export const stationsPath = (k: string, dir = STATIONS_DIR) => `${dir}/${encodeURIComponent(k)}.json`;
export { isObj, isNums };

/** the answer must start within `ms`; the body then gets three times as long, so a large file on a slow link
    still arrives, and the message says which of the two ran out */
async function jsonWithin(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController();
  let phase: "answer" | "download" = "answer",
    timer = setTimeout(() => ctl.abort(), ms);
  try {
    let res = await fetch(url, { signal: ctl.signal });
    if (res.status === 429) {
      await wait(2500);
      res = await fetch(url, { signal: ctl.signal });
    }
    if (!res.ok) throw new Error(res.status === 429 ? "Hugging Face is busy (too many requests)" : `Hugging Face answered ${res.status}`);
    clearTimeout(timer);
    phase = "download";
    timer = setTimeout(() => ctl.abort(), 3 * ms);
    return await res.json();
  } catch (e) {
    if (ctl.signal.aborted)
      throw new Error(
        phase === "answer"
          ? `Hugging Face did not answer within ${Math.round(ms / 1000)} seconds`
          : `the file did not finish downloading within ${Math.round((3 * ms) / 1000)} seconds`,
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
/** the last few files fetched; older ones are dropped so that a long visit does not keep every country in memory */
const EXTRAS = new Map<string, Promise<unknown>>();
const KEEP = 8;
/** one dataset file, checked by `ok`; a failed or late fetch is forgotten so that Retry asks again */
export function loadChecked<T>(path: string, ok: (x: unknown) => x is T, ms = 20000): Promise<T> {
  const had = EXTRAS.get(path);
  if (had) {
    EXTRAS.delete(path);
    EXTRAS.set(path, had);
    return had as Promise<T>;
  }
  const p = jsonWithin(fileUrl(path), ms).then(data => {
    if (!ok(data)) throw new Error("The file from Hugging Face is not in the expected format");
    return data;
  });
  p.catch(() => {
    if (EXTRAS.get(path) === p) EXTRAS.delete(path);
  });
  EXTRAS.set(path, p);
  while (EXTRAS.size > KEEP) EXTRAS.delete(EXTRAS.keys().next().value!);
  return p;
}
