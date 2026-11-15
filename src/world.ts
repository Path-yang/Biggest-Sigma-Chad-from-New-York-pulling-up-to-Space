import type { Ring, WorldCountry } from "./types";

/* =====================================================================
   WORLD: country outlines from world.js, keyed by FIRMS country name
   ===================================================================== */
export const WORLD: WorldCountry[] = window.WORLD ? window.WORLD.countries : [];
const BY_KEY = new Map(WORLD.map(c => [c.k, c]));

/** the part of a country's address after "#c/": the FIRMS name in lower case, runs of other characters as one dash */
export const slugOf = (k: string) =>
  k
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
export const shapeOf = (k: string) => BY_KEY.get(k);
export const nameOf = (k: string) => BY_KEY.get(k)?.n ?? k.replace(/_/g, " ");
/** "the United States", "France": the names that read with an article in a sentence */
export function theName(name: string) {
  return /^(United|Republic|Democratic|Dominican|Central African|Czech|Federated|Russian|Holy)|Islands$|^(Netherlands|Philippines|Bahamas|Gambia|Maldives|Comoros|Seychelles|Gaza Strip|West Bank)$/.test(
    name,
  )
    ? "the " + name
    : name;
}

function inRing(r: Ring, lon: number, lat: number) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i],
      yi = r[i + 1],
      xj = r[j],
      yj = r[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const boxArea = (b: WorldCountry["b"]) => (b[2] - b[0]) * (b[3] - b[1]);
/** the country under a point; where outlines overlap (only outer rings are kept, so Lesotho lies inside South Africa's) the smaller one wins */
export function countryAt(lon: number, lat: number): WorldCountry | null {
  let best: WorldCountry | null = null;
  for (const c of WORLD) {
    const b = c.b;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (best && boxArea(b) >= boxArea(best.b)) continue;
    if (c.r.some(r => inRing(r, lon, lat))) best = c;
  }
  return best;
}
/** an outline edge that only exists because a shape was cut at the antimeridian, or into slices (Antarctica),
    or runs along the pole: filled, but never drawn as a border */
export const cutEdge = (k: string, a0: number, b0: number, a1: number, b1: number) =>
  (a0 === a1 && (Math.abs(a0) === 180 || (k === "Antarctica" && a0 % 60 === 0))) || (b0 < -89.9 && b1 < -89.9);
/** shift a longitude by whole turns so it lies within 180 degrees of lon0 */
export const near = (lon: number, lon0: number) => lon - 360 * Math.round((lon - lon0) / 360);
/** east-west extent in degrees of a country's rings, each moved by whole turns to lie near the label point, so a
    country cut at the antimeridian (Fiji, Kiribati, New Zealand) measures its real width, not about 360 */
export function lonSpan(c: WorldCountry) {
  let a = Infinity,
    z = -Infinity;
  for (const r of c.r) {
    const off = near(r[0], c.c[0]) - r[0];
    for (let i = 0; i < r.length; i += 2) {
      const lon = r[i] + off;
      if (lon < a) a = lon;
      if (lon > z) z = lon;
    }
  }
  return Math.min(360, z - a);
}
