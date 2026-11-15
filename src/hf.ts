import type { CountryIndexEntry, CountrySummary } from "./types";

/* =====================================================================
   HUGGING FACE: the per-country summaries, fetched when a reader opens a country
   ===================================================================== */
export const HF_DATASET = "rogeryzd/firms-active-fire-by-country";
export const HF_PAGE = `https://huggingface.co/datasets/${HF_DATASET}`;
/** v2 drops cell-years any sensor flags as a static source; see the dataset card */
export const SUMMARY_DIR = "summary/v2";
export const summaryPath = (k: string) => `${SUMMARY_DIR}/${encodeURIComponent(k)}.json`;
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
  if (!isObj(x) || x.v !== 2 || x.country !== k || typeof x.name !== "string") return false;
  if (typeof x.y0 !== "number" || typeof x.y1 !== "number" || x.y1 < x.y0) return false;
  const nm = (x.y1 - x.y0 + 1) * 12,
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
    p = fetchText(fileUrl(summaryPath(k)), () => tell.listen).then(text => {
      const data: unknown = JSON.parse(text);
      if (!isSummary(data, k)) throw new Error("The file from Hugging Face is not in the expected format");
      return data;
    });
  p.catch(() => SUMMARIES.delete(k));
  SUMMARIES.set(k, { p, tell });
  return p;
}
let index: Promise<CountryIndexEntry[]> | null = null;
/** the list of every country in the dataset, including any without an outline in world.js */
export function loadIndex(): Promise<CountryIndexEntry[]> {
  if (!index) {
    index = fetchText(fileUrl(`${SUMMARY_DIR}/index.json`), () => null).then(text => {
      const data: unknown = JSON.parse(text);
      if (!isObj(data) || !Array.isArray(data.countries)) throw new Error("The country index is not in the expected format");
      return data.countries.filter(isIndexEntry);
    });
    index.catch(() => (index = null));
  }
  return index;
}
