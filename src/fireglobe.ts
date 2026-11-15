import type { CountryIndexEntry, RGB, WorldCountry } from "./types";
import { WORLD } from "./world";

/* =====================================================================
   FIRE LAYER: every country on the globe tinted by how much it burns, from the dataset's index.json on Hugging Face.
   Painted once into an equirectangular canvas that wraps a sphere just above the earth.
   ===================================================================== */

/** years the index totals cover (2001–2025) */
export const FIRE_YEARS = 25;
const R_KM = 6371.0088;
/** low to high: pale yellow, orange, red, deep maroon; darker and more opaque means more fire */
const STOPS: { c: RGB; a: number }[] = [
  { c: [255, 232, 150], a: 0.18 },
  { c: [255, 180, 60], a: 0.34 },
  { c: [244, 110, 30], a: 0.5 },
  { c: [196, 42, 20], a: 0.66 },
  { c: [110, 10, 8], a: 0.82 },
];
export function fireColour(t: number): { c: RGB; a: number } {
  t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)),
    f = t - i,
    a = STOPS[i],
    b = STOPS[i + 1];
  return { c: a.c.map((v, k) => Math.round(v + (b.c[k] - v) * f)) as RGB, a: a.a + (b.a - a.a) * f };
}
const css = (x: { c: RGB; a: number }) => `rgba(${x.c[0]},${x.c[1]},${x.c[2]},${x.a.toFixed(3)})`;

/** area in km² of a country's outer rings: the shoelace sum in (longitude in radians, sine of latitude), which is
    exact on the equal-area cylindrical projection */
export function areaKm2(c: WorldCountry) {
  let sum = 0;
  for (const r of c.r) {
    let s = 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
      s += ((r[j] - r[i]) * Math.PI) / 180 * (Math.sin((r[j + 1] * Math.PI) / 180) + Math.sin((r[i + 1] * Math.PI) / 180));
    sum += Math.abs(s) / 2;
  }
  return sum * R_KM * R_KM;
}

export interface FireStat {
  /** hotspots a year, in VIIRS terms, averaged over 2001–2025 */
  perYear: number;
  /** hotspots a year per 1,000 km² */
  density: number;
  /** position on the colour scale, 0–1 */
  t: number;
}
export interface FireLayer {
  canvas: HTMLCanvasElement;
  stats: Map<string, FireStat>;
  /** the densities at the two ends of the colour scale */
  lo: number;
  hi: number;
}

/** a ring's west, south, east and north edges */
function ringBox(r: number[]): [number, number, number, number] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    w = Math.min(w, r[i]);
    e = Math.max(e, r[i]);
    s = Math.min(s, r[i + 1]);
    n = Math.max(n, r[i + 1]);
  }
  return [w, s, e, n];
}
const quantile = (s: number[], q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];

/** the per-country numbers and the painted canvas; countries missing from the index, or with no fires, stay clear */
export function buildFireLayer(index: CountryIndexEntry[], width = 2048): FireLayer {
  const total = new Map(index.map(e => [e.country, e.total])),
    raw: { c: WorldCountry; area: number; perYear: number; density: number }[] = [];
  for (const c of WORLD) {
    const tot = total.get(c.k),
      area = areaKm2(c);
    if (!tot || !(tot > 0) || !(area > 0)) continue;
    const perYear = tot / FIRE_YEARS;
    raw.push({ c, area, perYear, density: (perYear / area) * 1000 });
  }
  const logs = raw.map(x => Math.log10(x.density)).sort((a, b) => a - b),
    l0 = logs.length ? quantile(logs, 0.05) : 0,
    l1 = logs.length ? Math.max(l0 + 0.5, quantile(logs, 0.97)) : 1,
    stats = new Map<string, FireStat>();
  for (const x of raw) stats.set(x.c.k, { perYear: x.perYear, density: x.density, t: (Math.log10(x.density) - l0) / (l1 - l0) });

  const cv = paintCountries(
    raw.map(x => ({ c: x.c, area: x.area, fill: css(fireColour(stats.get(x.c.k)!.t)) })),
    width,
  );
  return { canvas: cv, stats, lo: Math.pow(10, l0), hi: Math.pow(10, l1) };
}

/** countries painted into an equirectangular canvas (width × width/2) that wraps a sphere */
export function paintCountries(items: { c: WorldCountry; area: number; fill: string }[], width = 2048): HTMLCanvasElement {
  const h = width / 2,
    cv = document.createElement("canvas");
  cv.width = width;
  cv.height = h;
  const g = cv.getContext("2d")!,
    X = (lon: number) => ((lon + 180) / 360) * width,
    Y = (lat: number) => ((90 - lat) / 180) * h;
  /* largest first, so a country inside another's outer ring (Lesotho in South Africa) is painted on top */
  for (const x of items.slice().sort((a, b) => b.area - a.area)) {
    g.fillStyle = x.fill;
    g.beginPath();
    for (const r of x.c.r) {
      g.moveTo(X(r[0]), Y(r[1]));
      for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1]));
      g.closePath();
    }
    g.fill();
    /* places made only of islands smaller than a couple of texels still show: a dot on each island, so a group
       spread over the ocean (Kiribati, the Maldives) is visible too, not just a single small country */
    const boxes = x.c.r.map(ringBox);
    if (boxes.every(([w, s, e, n]) => X(e) - X(w) < 3 && Y(s) - Y(n) < 3)) {
      g.beginPath();
      for (const [w, s, e, n] of boxes) {
        const cx = X((w + e) / 2),
          cy = Y((s + n) / 2);
        g.moveTo(cx + 2, cy);
        g.arc(cx, cy, 2, 0, 2 * Math.PI);
      }
      g.fill();
    }
  }
  return cv;
}
