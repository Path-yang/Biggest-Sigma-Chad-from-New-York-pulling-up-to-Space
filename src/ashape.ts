import { near } from "./world";

/* =====================================================================
   AREA SHAPES: a rectangle, a circle or a freehand outline drawn on the country map, as plain longitude/latitude.
   Longitudes stay as drawn (they may run past 180 for a country across the antimeridian); a square is tested
   after moving its centre by whole turns to lie near the shape.
   ===================================================================== */
export type Shape =
  | { t: "r"; s: number; w: number; n: number; e: number }
  | { t: "c"; lat: number; lon: number; km: number }
  /** [lon, lat] pairs, not closed */
  | { t: "p"; pts: [number, number][] };

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
/** great-circle distance in km */
export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** the longitude the shape is centred on, for unwrapping squares near it */
export function midLon(s: Shape) {
  if (s.t === "r") return (s.w + s.e) / 2;
  if (s.t === "c") return s.lon;
  let a = Infinity,
    z = -Infinity;
  for (const p of s.pts) {
    a = Math.min(a, p[0]);
    z = Math.max(z, p[0]);
  }
  return (a + z) / 2;
}
function inPoly(pts: [number, number][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** a tester for points: true when (lat, lon) lies inside the shape */
export function tester(s: Shape) {
  const m = midLon(s);
  if (s.t === "r") return (lat: number, lon: number) => lat >= s.s && lat <= s.n && near(lon, m) >= s.w && near(lon, m) <= s.e;
  if (s.t === "c") return (lat: number, lon: number) => km(s.lat, s.lon, lat, near(lon, m)) <= s.km;
  return (lat: number, lon: number) => inPoly(s.pts, near(lon, m), lat);
}
/** the point at a distance and bearing from a start, for drawing a circle */
function dest(lat: number, lon: number, dKm: number, brg: number): [number, number] {
  const d = dKm / R_KM,
    p1 = rad(lat),
    l1 = rad(lon),
    b = rad(brg),
    p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)),
    l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(l2 * 180) / Math.PI, (p2 * 180) / Math.PI];
}
/** the map's top and bottom edge */
const MERC_LAT = 85.05;
/** 1 or -1 when a circle takes in the north or south pole, else 0 */
export function poleIn(s: Shape) {
  if (s.t !== "c") return 0;
  return km(s.lat, s.lon, 90, 0) < s.km ? 1 : km(s.lat, s.lon, -90, 0) < s.km ? -1 : 0;
}
/** the outline as a closed ring of [lon, lat], moved by whole turns to lie near lon0 */
export function ring(s: Shape, lon0: number): [number, number][] {
  let pts: [number, number][];
  if (s.t === "r")
    pts = [
      [s.w, s.s],
      [s.e, s.s],
      [s.e, s.n],
      [s.w, s.n],
    ];
  else if (s.t === "c") {
    pts = [];
    for (let k = 0; k < 72; k++) {
      const [x, y] = dest(s.lat, s.lon, s.km, k * 5);
      pts.push([near(x, s.lon), y]);
    }
    /* a circle round a pole: its edge goes once round the world, so close it along the map's top or bottom edge */
    const pole = poleIn(s);
    if (pole) {
      pts.sort((p, q) => p[0] - q[0]);
      const a = pts[0],
        z = pts[pts.length - 1],
        f = (s.lon + 180 - z[0]) / (a[0] + 360 - z[0] || 1),
        yEdge = z[1] + f * (a[1] - z[1]);
      pts = [[s.lon - 180, yEdge], ...pts, [s.lon + 180, yEdge], [s.lon + 180, pole * MERC_LAT], [s.lon - 180, pole * MERC_LAT]];
    }
  } else pts = s.pts.slice();
  const off = near(midLon(s), lon0) - midLon(s);
  const out = pts.map(([x, y]) => [x + off, y] as [number, number]);
  out.push(out[0]);
  return out;
}
/** [west, south, east, north] */
export function bbox(s: Shape): [number, number, number, number] {
  const r = ring(s, midLon(s));
  let w = Infinity,
    so = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of r) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    so = Math.min(so, y);
    n = Math.max(n, y);
  }
  return [w, so, e, n];
}
/** surface area in km², on a sphere */
export function areaKm2(s: Shape) {
  /* a spherical cap */
  if (s.t === "c") return 2 * Math.PI * R_KM * R_KM * (1 - Math.cos(s.km / R_KM));
  const r = ring(s, midLon(s));
  let a = 0;
  for (let i = 0; i + 1 < r.length; i++) a += rad(r[i + 1][0] - r[i][0]) * (2 + Math.sin(rad(r[i][1])) + Math.sin(rad(r[i + 1][1])));
  return Math.abs((a * R_KM * R_KM) / 2);
}

/* ---------- words ---------- */
const deg = (v: number, p: string, n: string, dp = 2) => `${Math.abs(v).toFixed(dp)}°${v < 0 ? n : p}`;
const wrap = (lon: number) => near(lon, 0);
export const latW = (v: number, dp = 2) => deg(v, "N", "S", dp);
export const lonW = (v: number, dp = 2) => deg(wrap(v), "E", "W", dp);
export function describe(s: Shape) {
  if (s.t === "r") return `Box ${latW(s.s, 1)} to ${latW(s.n, 1)}, ${lonW(s.w, 1)} to ${lonW(s.e, 1)}`;
  if (s.t === "c") return `${Math.round(s.km).toLocaleString("en-US")} km around ${latW(s.lat, 1)}, ${lonW(s.lon, 1)}`;
  return `Drawn shape, about ${roundArea(areaKm2(s))} km²`;
}
export const roundArea = (a: number) => {
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, a))) - 1));
  return (Math.round(a / p) * p).toLocaleString("en-US");
};

/* ---------- in the address: r:s,w,n,e  c:lat,lon,km  p:lat,lon,lat,lon,... ---------- */
const num = (v: number, dp: number) => String(Number(v.toFixed(dp)));
export function encode(s: Shape) {
  if (s.t === "r") return `r:${[s.s, s.w, s.n, s.e].map(v => num(v, 3)).join(",")}`;
  if (s.t === "c") return `c:${num(s.lat, 3)},${num(s.lon, 3)},${num(s.km, 1)}`;
  return `p:${s.pts.map(([x, y]) => `${num(y, 2)},${num(x, 2)}`).join(",")}`;
}
export function decode(t: string): Shape | null {
  const m = /^([rcp]):(.+)$/.exec(t.trim());
  if (!m) return null;
  const v = m[2].split(",").map(Number);
  if (!v.length || v.some(x => !Number.isFinite(x))) return null;
  const okLat = (y: number) => y >= -90 && y <= 90,
    okLon = (x: number) => x >= -540 && x <= 540;
  if (m[1] === "r") {
    if (v.length !== 4) return null;
    const [s, w, n, e] = v;
    if (!okLat(s) || !okLat(n) || !okLon(w) || !okLon(e) || !(n > s) || !(e > w) || e - w > 360) return null;
    return { t: "r", s, w, n, e };
  }
  if (m[1] === "c") {
    if (v.length !== 3) return null;
    const [lat, lon, r] = v;
    if (!okLat(lat) || !okLon(lon) || !(r > 0) || r > 5000) return null;
    return { t: "c", lat, lon, km: r };
  }
  if (v.length < 6 || v.length % 2 || v.length > 400) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i < v.length; i += 2) {
    if (!okLat(v[i]) || !okLon(v[i + 1])) return null;
    pts.push([v[i + 1], v[i]]);
  }
  return { t: "p", pts };
}

/** fewer points for a freehand line: Douglas-Peucker in degrees, then at most max points */
export function simplify(pts: [number, number][], tol: number, max = 120): [number, number][] {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1,
      bd = 0;
    const [x1, y1] = pts[a],
      [x2, y2] = pts[b],
      dx = x2 - x1,
      dy = y2 - y1,
      L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      /* a closed loop starts and ends at one point: measure from that point instead of from a line */
      const d = L < 1e-9 ? Math.hypot(pts[i][0] - x1, pts[i][1] - y1) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0 && bd > tol) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  let out = pts.filter((_, i) => keep[i]);
  if (out.length > max) {
    const step = out.length / max;
    out = Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
  }
  return out;
}
