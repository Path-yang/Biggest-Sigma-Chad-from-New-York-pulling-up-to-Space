import { fileUrl, isNums, isObj } from "./hf";
import { near } from "./world";

/* =====================================================================
   SQUARES OF ABOUT 5.5 KM (fine/v1 on Hugging Face): the same harmonized hotspots on a 0.05 degree grid, per year,
   in 5 by 5 degree tiles per country. Fetched only for the part of the map in view once it is zoomed in, a few at a
   time, and kept for the visit.
   ===================================================================== */
export const FINE_DIR = "fine/v1";
export const FINE_CELL = 0.05;
type Box = [number, number, number, number];
type FileRow = { file: string; bbox: Box; bytes: number; cells: number };
type FineIndex = { country: string; years: number[]; bbox: Box | null; files: FileRow[] };
/** one decoded file: per cell its global indexes, its total and its 26 yearly values (row-major) */
export type FineTile = { y0: number; ny: number; la: Int32Array; lo: Int32Array; total: Float32Array; years: Float32Array };

const isIndex =
  (k: string) =>
  (x: unknown): x is FineIndex =>
    isObj(x) &&
    x.country === k &&
    isNums(x.years) &&
    Array.isArray(x.files) &&
    x.files.every(f => isObj(f) && typeof f.file === "string" && isNums(f.bbox, 4));
function getJson(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController(),
    t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal })
    .then(r => {
      if (!r.ok) throw new Error(`Hugging Face answered ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(t));
}
const INDEX = new Map<string, Promise<FineIndex>>();
export function fineIndex(k: string) {
  let p = INDEX.get(k);
  if (!p) {
    p = getJson(fileUrl(`${FINE_DIR}/${encodeURIComponent(k)}/index.json`), 20000).then(x => {
      if (!isIndex(k)(x)) throw new Error("The fine grid index is not in the expected format");
      return x;
    });
    p.catch(() => INDEX.delete(k));
    INDEX.set(k, p);
  }
  return p;
}
function decode(t: unknown): FineTile {
  if (!isObj(t) || !isNums(t.rows) || !isNums(t.origin, 2) || !isNums(t.years)) throw new Error("bad tile");
  const R = t.rows,
    ny = t.years.length;
  let n = 0;
  for (let p = 0; p < R.length; n++) p += 4 + 2 * R[p + 3];
  const out: FineTile = {
    y0: t.years[0],
    ny,
    la: new Int32Array(n),
    lo: new Int32Array(n),
    total: new Float32Array(n),
    years: new Float32Array(n * ny),
  };
  for (let p = 0, i = 0; p < R.length; i++) {
    const k = R[p + 3];
    out.la[i] = t.origin[0] + R[p];
    out.lo[i] = t.origin[1] + R[p + 1];
    out.total[i] = R[p + 2];
    p += 4;
    for (let j = 0; j < k; j++, p += 2) out.years[i * ny + R[p]] = R[p + 1];
  }
  return out;
}

/* ---------- the cache and the queue ---------- */
const KEEP = 48,
  MAX_FLIGHT = 3;
const TILES = new Map<string, FineTile>();
const FLIGHT = new Set<string>();
const FAILED = new Set<string>();
let queue: { path: string; done: () => void }[] = [];
let gen = 0;
/** drop the files not asked for yet (leaving the view, or zooming out past the 5.5 km squares); files already in
    flight finish into the cache */
export function fineStop() {
  gen++;
  queue = [];
}
let requests = 0;
/** how many tile files this visit has asked Hugging Face for (for testing) */
export const fineRequests = () => requests;
function pump() {
  while (FLIGHT.size < MAX_FLIGHT && queue.length) {
    const { path, done } = queue.shift()!;
    if (TILES.has(path) || FLIGHT.has(path)) continue;
    FLIGHT.add(path);
    requests++;
    getJson(fileUrl(path), 30000)
      .then(decode)
      .then(
        t => {
          TILES.set(path, t);
          while (TILES.size > KEEP) TILES.delete(TILES.keys().next().value!);
          done();
        },
        () => FAILED.add(path),
      )
      .finally(() => {
        FLIGHT.delete(path);
        pump();
      });
  }
}
const shifted = (b: Box, lon0: number): Box => {
  const off = near((b[0] + b[2]) / 2, lon0) - (b[0] + b[2]) / 2;
  return [b[0] + off, b[1], b[2] + off, b[3]];
};
const meets = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
/** the files of country k that cross the view (in map longitudes near lon0), nearest the middle first */
function filesIn(ix: FineIndex, k: string, view: Box, lon0: number, max = 16) {
  const cx = (view[0] + view[2]) / 2,
    cy = (view[1] + view[3]) / 2;
  return ix.files
    .map(f => ({ f, b: shifted(f.bbox, lon0) }))
    .filter(x => meets(x.b, view))
    .sort(
      (a, b) =>
        Math.hypot((a.b[0] + a.b[2]) / 2 - cx, (a.b[1] + a.b[3]) / 2 - cy) -
        Math.hypot((b.b[0] + b.b[2]) / 2 - cx, (b.b[1] + b.b[3]) / 2 - cy),
    )
    .slice(0, max)
    .map(x => `${FINE_DIR}/${encodeURIComponent(k)}/${x.f.file}`);
}
/** ask for the files in view that are not here yet; `arrived` runs as each one comes in. Older requests that are
    not in flight yet are dropped, so panning fast does not leave a long queue behind. */
export function wantFine(k: string, view: Box, lon0: number, arrived: () => void) {
  const g = ++gen;
  return fineIndex(k).then(ix => {
    const paths = filesIn(ix, k, view, lon0);
    if (g !== gen) return { wanted: paths.length, have: paths.filter(p => TILES.has(p)).length, empty: !ix.files.length };
    queue = paths.filter(p => !TILES.has(p) && !FLIGHT.has(p) && !FAILED.has(p)).map(path => ({ path, done: arrived }));
    pump();
    return { wanted: paths.length, have: paths.filter(p => TILES.has(p)).length, empty: !ix.files.length };
  });
}
type Feature = { type: "Feature"; properties: Record<string, number>; geometry: { type: string; coordinates: unknown } };
/** the squares in view from the files already here: every year's sum, or one year's */
export function fineFeatures(k: string, view: Box, lon0: number, year: number | null) {
  const features: Feature[] = [],
    pre = `${FINE_DIR}/${encodeURIComponent(k)}/`,
    c = FINE_CELL,
    padX = (view[2] - view[0]) * 0.1,
    padY = (view[3] - view[1]) * 0.1;
  let max = 0;
  for (const [path, t] of TILES) {
    if (!path.startsWith(pre)) continue;
    const yi = year == null ? -1 : year - t.y0;
    if (year != null && (yi < 0 || yi >= t.ny)) continue;
    for (let i = 0; i < t.la.length; i++) {
      const v = yi < 0 ? t.total[i] : t.years[i * t.ny + yi];
      if (!(v > 0)) continue;
      const s = t.la[i] * c,
        w = near(t.lo[i] * c + c / 2, lon0) - c / 2;
      if (w + c < view[0] - padX || w > view[2] + padX || s + c < view[1] - padY || s > view[3] + padY) continue;
      const e = w + c,
        n = s + c,
        r = (x: number) => Math.round(x * 1e4) / 1e4;
      if (v > max) max = v;
      features.push({
        type: "Feature",
        properties: { n: Math.round(v * 10) / 10, la: t.la[i], lo: t.lo[i] },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [r(w), r(s)],
              [r(e), r(s)],
              [r(e), r(n)],
              [r(w), r(n)],
              [r(w), r(s)],
            ],
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features, max };
}
/** one square's yearly values, from the files here */
export function fineCell(k: string, la: number, lo: number) {
  const pre = `${FINE_DIR}/${encodeURIComponent(k)}/`;
  for (const [path, t] of TILES) {
    if (!path.startsWith(pre)) continue;
    for (let i = 0; i < t.la.length; i++)
      if (t.la[i] === la && t.lo[i] === lo)
        return { y0: t.y0, total: t.total[i], years: Array.from(t.years.subarray(i * t.ny, (i + 1) * t.ny)) };
  }
  return null;
}
/** the values of the files here, for colour classes: each square's total, or each of its nonzero years */
export function fineValues(k: string, perYear: boolean) {
  const pre = `${FINE_DIR}/${encodeURIComponent(k)}/`,
    out: number[] = [];
  for (const [path, t] of TILES) {
    if (!path.startsWith(pre)) continue;
    if (!perYear) out.push(...t.total);
    else for (const v of t.years) if (v > 0) out.push(v);
  }
  return out;
}
