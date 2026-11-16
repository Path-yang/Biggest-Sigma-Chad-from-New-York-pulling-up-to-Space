import { isNums, isObj, loadChecked } from "./hf";
import { near } from "./world";

/* =====================================================================
   STATES AND PROVINCES (provinces/v1 on Hugging Face): one file per country with every first-level division from
   Natural Earth (public domain; geoBoundaries for 7 countries), its monthly harmonized hotspots 2001 to 14 November 2026, and a simplified outline.
   A 0.05 degree square counts wholly for the province that holds its middle. Used by the country map view's card
   and by the copilot, which names provinces and districts.
   ===================================================================== */
export const PROV_DIR = "provinces/v1";
export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
export interface Province {
  id: string;
  iso: string | null;
  name: string;
  aliases: string[];
  type: string | null;
  region: string | null;
  bbox: [number, number, number, number];
  label: [number, number];
  area_km2: number;
  cells: number;
  total: number;
  per_year: number[];
  usual: number[];
  watch: number[];
  monthly: number[];
  geometry: Geometry;
}
export interface ProvinceFile {
  v: number;
  country: string;
  name: string;
  y0: number;
  n_months: number;
  partial: { y: number; m: number; i: number; day0: number; day1: number; days_in_month: number } | null;
  last_date: string;
  watch_years: [number, number][];
  provinces: Province[];
  /** where the outlines come from and whether the units are out of date (not checked: older files lack it) */
  boundaries?: { source: string; units: string | null; outdated: boolean; note: string | null };
  licence?: string;
}
const isProvince = (x: unknown): x is Province =>
  isObj(x) &&
  typeof x.id === "string" &&
  typeof x.name === "string" &&
  Array.isArray(x.aliases) &&
  isNums(x.bbox, 4) &&
  isNums(x.monthly) &&
  isNums(x.per_year) &&
  isNums(x.usual, 12) &&
  isNums(x.watch, 12) &&
  typeof x.total === "number" &&
  isObj(x.geometry) &&
  (x.geometry.type === "Polygon" || x.geometry.type === "MultiPolygon");
const isFile =
  (k: string) =>
  (x: unknown): x is ProvinceFile =>
    isObj(x) &&
    x.v === 1 &&
    x.country === k &&
    typeof x.y0 === "number" &&
    typeof x.n_months === "number" &&
    Array.isArray(x.watch_years) &&
    typeof x.last_date === "string" &&
    (x.partial === null ||
      (isObj(x.partial) &&
        (["y", "m", "i", "day0", "day1"] as const).every(f => typeof (x.partial as Record<string, unknown>)[f] === "number"))) &&
    Array.isArray(x.provinces) &&
    x.provinces.every(isProvince);
/** who drew the outlines, short ("Natural Earth" or "geoBoundaries") */
export const outlineName = (f: ProvinceFile) => (f.boundaries?.source === "geoBoundaries" ? "geoBoundaries" : "Natural Earth");
/** the outline credit in full: geoBoundaries asks for attribution, Natural Earth is public domain */
export const outlineCredit = (f: ProvinceFile) =>
  outlineName(f) === "geoBoundaries"
    ? (f.licence ?? "").split(" Fire values")[0].trim() || "Province boundaries: geoBoundaries (Runfola et al. 2020, geoboundaries.org)."
    : "Outlines: Natural Earth (public domain).";
export const loadProvinces = (k: string) => loadChecked(`${PROV_DIR}/${encodeURIComponent(k)}.json`, isFile(k), 25000);

/* ---------- the numbers ---------- */
export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y),
    h = s.length >> 1;
  return !s.length ? 0 : s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
/** the frame of the file: the partial month (November 2026, to the 14th), the last complete month and year */
export function frameOf(f: ProvinceFile) {
  const pi = f.partial ? f.partial.i : f.n_months,
    lastFull = pi - 1,
    cy = f.y0 + Math.floor(lastFull / 12),
    /* months of the current year that are complete (January to October: 10) */
    cm = (lastFull % 12) + 1,
    yb = cm === 12 ? cy : cy - 1;
  return { pi, lastFull, cy, cm, yb, next: f.partial ? f.partial.m % 12 : lastFull % 12 === 11 ? 0 : (lastFull % 12) + 1 };
}
const idx = (f: ProvinceFile, y: number, m: number) => (y - f.y0) * 12 + m;
/** the current year's complete months, and the median of the same months over the complete years */
export function soFar(f: ProvinceFile, p: Province) {
  const fr = frameOf(f),
    sumYear = (y: number) => {
      let s = 0;
      for (let m = 0; m < fr.cm; m++) s += p.monthly[idx(f, y, m)] ?? 0;
      return s;
    };
  const past: number[] = [];
  for (let y = f.y0; y <= fr.yb && y < fr.cy; y++) past.push(sumYear(y));
  return { cur: fr.cy > fr.yb ? sumYear(fr.cy) : 0, usual: median(past), months: fr.cm, y: fr.cy };
}
/** the calendar month with the most hotspots over the complete years */
export function busiestMonth(f: ProvinceFile, p: Province) {
  const fr = frameOf(f),
    sums = new Array(12).fill(0);
  for (let y = f.y0; y <= fr.yb; y++) for (let m = 0; m < 12; m++) sums[m] += p.monthly[idx(f, y, m)] ?? 0;
  let best = 0;
  for (let m = 1; m < 12; m++) if (sums[m] > sums[best]) best = m;
  return { m: best, sum: sums[best] };
}
export function worstYear(f: ProvinceFile, p: Province) {
  const fr = frameOf(f);
  let y = -1,
    v = 0;
  p.per_year.forEach((n, i) => {
    if (f.y0 + i <= fr.yb && n > v) {
      v = n;
      y = f.y0 + i;
    }
  });
  return { y, v };
}
export type Level = "high" | "elevated" | "low";
/** "where to watch" levels for one calendar month, as the site's area outlook */
export function levels(ps: Province[], m: number) {
  const r = [...ps].sort((a, b) => b.watch[m] - a.watch[m]),
    total = r.reduce((s, x) => s + x.watch[m], 0),
    out = new Map<Province, Level>();
  let cum = 0;
  for (const x of r) {
    const e = x.watch[m];
    out.set(x, total > 0 && e >= 1 && cum < 0.5 * total ? "high" : total > 0 && e >= 1 && cum < 0.8 * total ? "elevated" : "low");
    cum += e;
  }
  return out;
}

/* ---------- names, as the copilot gives them ---------- */
export const nameKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
/** words that name the kind of division rather than the place ("Mato Grosso State", "Province of Nairobi") */
const KIND =
  /\b(state|province|provincia|provincie|region|regione|department|departement|departamento|district|county|oblast|krai|kray|governorate|prefecture|territory|municipality|canton|voivodeship|division|emirate|parish|autonomous|republic|federal|capital|area|of|the|de|del|do|da)\b/giu;
const stripKind = (s: string) => s.replace(KIND, " ");
/** the province of the file a place name means, or null: by ISO code or id, then name, then alias; first as given,
    then without words like "State" or "Province" */
export function provinceNamed(f: ProvinceFile, name: string): Province | null {
  const first = name.split(",")[0];
  for (const raw of [name, first, stripKind(first)]) {
    const k = nameKey(raw);
    if (!k) continue;
    const hit =
      f.provinces.find(p => (p.iso && nameKey(p.iso) === k) || nameKey(p.id) === k) ??
      f.provinces.find(p => nameKey(p.name) === k) ??
      f.provinces.find(p => p.aliases.some(a => nameKey(a) === k)) ??
      f.provinces.find(p => nameKey(stripKind(p.name)) === k) ??
      f.provinces.find(p => p.aliases.some(a => nameKey(stripKind(a)) === k));
    if (hit) return hit;
  }
  return null;
}
/** provinces whose name or an alias contains the typed text, those that start with it first */
export function searchProvinces(f: ProvinceFile, q: string, max = 8) {
  const k = nameKey(q);
  if (!k) return [];
  const score = (p: Province) => {
    const n = nameKey(p.name);
    if (n.startsWith(k)) return 0;
    if (n.includes(k)) return 1;
    if (p.aliases.some(a => nameKey(a).startsWith(k))) return 2;
    if (p.aliases.some(a => nameKey(a).includes(k))) return 3;
    return 9;
  };
  return f.provinces
    .map(p => ({ p, s: score(p) }))
    .filter(x => x.s < 9)
    .sort((a, b) => a.s - b.s || b.p.total - a.p.total)
    .slice(0, max)
    .map(x => x.p);
}

/* ---------- outlines near the map's centre longitude ---------- */
/** the province's polygons, each moved by whole turns to lie near `lon0` (Natural Earth cuts shapes at 180 degrees,
    so Chukotka's or Alaska's parts may sit either side), and the box around them */
export function shapeNear(p: Province, lon0: number) {
  const polys = (p.geometry.type === "Polygon" ? [p.geometry.coordinates] : p.geometry.coordinates) as number[][][][];
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  const out = polys.map(poly => {
    const first = poly[0]?.[0];
    const off = first ? near(first[0], lon0) - first[0] : 0;
    return poly.map(ring =>
      ring.map(([x, y]) => {
        const X = x + off;
        if (X < w) w = X;
        if (X > e) e = X;
        if (y < s) s = y;
        if (y > n) n = y;
        return [X, y];
      }),
    );
  });
  return { geometry: { type: "MultiPolygon", coordinates: out }, box: [w, s, e, n] as [number, number, number, number] };
}
/** the province a copilot place names (by its name, and lying near its box), with its outline near lon0; or null */
export function provinceOfMark(f: ProvinceFile, name: string, box: [number, number, number, number], lon0: number) {
  const p = provinceNamed(f, name);
  if (!p) return null;
  const sh = shapeNear(p, lon0),
    off = near((box[0] + box[2]) / 2, lon0) - (box[0] + box[2]) / 2,
    nb = [box[0] + off, box[1], box[2] + off, box[3]];
  /* the same name somewhere else in the country (a town named after another province) is not this one */
  if (!(sh.box[0] <= nb[2] + 0.5 && sh.box[2] >= nb[0] - 0.5 && sh.box[1] <= nb[3] + 0.5 && sh.box[3] >= nb[1] - 0.5)) return null;
  /* nor is a city inside it that shares its name (Buenos Aires, Sao Paulo, New York): its box is far smaller */
  const area = (b: ArrayLike<number>) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  if (area(nb) < 0.1 * area(sh.box)) return null;
  return { p, ...sh };
}
