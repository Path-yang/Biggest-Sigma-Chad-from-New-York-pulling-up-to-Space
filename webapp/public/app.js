/* HotSpotters: harmonized MODIS + VIIRS hotspot explorer.
   All numbers come from static files under data/ (see pipeline/build_tiles.py). */
"use strict";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Inferno-like ramp: dark to bright, reads in greyscale and for colour-blind viewers
const RAMP = ["#0b0724", "#2c0b57", "#5c126e", "#8b2268", "#bb3654", "#e0562f", "#f6850f", "#fbb91e", "#f8f39a"];
const DIVERGE = ["#2f7fc1", "#5aa9e6", "#a9cfee", "#3a4050", "#f3c08e", "#f08a3c", "#c9471f"];

const S = {
  meta: null, bbox: null, name: "Whole world",
  mode: "h", cal: "count", fromY: 2000, toY: 2026, cmpYear: 2026, cmpYear2: 0, pin: null,
  layer: { year: 2025, month: -1 },
  agg: null, cells: null, tiles: new Map(), token: 0, playing: null,
};
const $ = id => document.getElementById(id);
const fmt = n => (n == null || isNaN(n)) ? "n/a" : Math.round(n).toLocaleString("en-US");
const short = n => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
const miOf = (y, m) => (y - 2000) * 12 + m;
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function rampAt(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}
const css = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
const lum = rgb => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}

/* ---------------- data loading ---------------- */
async function fetchBin(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes.buffer;
}
function parseTile(buf) {
  const n = new DataView(buf).getUint32(4, true);
  let o = 8;
  const cell = new Uint16Array(buf, o, n); o += 2 * n;
  const mi = new Uint16Array(buf, o, n); o += 2 * n;
  const m = new Uint32Array(buf, o, n); o += 4 * n;
  const v = new Uint32Array(buf, o, n); o += 4 * n;
  const s = new Uint32Array(buf, o, n);
  return { n, cell, mi, m, v, s };
}
function parseLayer(buf) {
  const n = new DataView(buf).getUint32(4, true);
  return { n, idx: new Uint32Array(buf, 8, n), h: new Float32Array(buf, 8 + 4 * n, n) };
}
function getTile(key) {
  if (!S.tiles.has(key)) S.tiles.set(key, fetchBin(`data/t/${key}.bin.gz`).then(parseTile));
  return S.tiles.get(key);
}
function tilesFor(b) {
  const keys = [], T = S.meta.tile * S.meta.res;
  const ty0 = Math.max(0, Math.floor((b.s + 90) / T)), ty1 = Math.min(17, Math.floor((b.n + 90 - 1e-9) / T));
  const spans = b.w <= b.e ? [[b.w, b.e]] : [[b.w, 180], [-180, b.e]];
  for (const [w, e] of spans) {
    const tx0 = Math.max(0, Math.floor((w + 180) / T)), tx1 = Math.min(35, Math.floor((e + 180 - 1e-9) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = `${tx}_${ty}`;
      if (S.tileSet.has(k) && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}
const inBox = (b, lon, lat) => lat >= b.s && lat <= b.n && (b.w <= b.e ? lon >= b.w && lon <= b.e : lon >= b.w || lon <= b.e);

/** Sum every cell whose centre falls in the box, month by month. */
async function aggregate(b, token) {
  const meta = S.meta, N = meta.mi1 + 1, T = meta.tile, R = meta.region, res = meta.res;
  const M = new Float64Array(N), V = new Float64Array(N), Sr = new Float64Array(N), H = new Float64Array(N), K = new Float64Array(N);
  const keys = tilesFor(b), cells = [];
  let done = 0, nCells = 0;
  const work = keys.map(key => getTile(key).then(t => {
    if (token !== S.token) return;
    const [tx, ty] = key.split("_").map(Number);
    let last = -1, inside = false, k = 1, a = 1, rec = null;
    for (let i = 0; i < t.n; i++) {
      const c = t.cell[i];
      if (c !== last) {
        last = c;
        const lc = c % T, lr = (c - lc) / T, col = tx * T + lc, row = ty * T + lr;
        const lon = -180 + (col + 0.5) * res, lat = -90 + (row + 0.5) * res;
        inside = inArea(b, lon, lat);
        if (inside) {
          const f = meta.regions[`${Math.floor(col / R)}_${Math.floor(row / R)}`] || [meta.kWorld, meta.aWorld];
          k = f[0]; a = f[1]; nCells++;
          rec = { lon, lat, k, a, i0: i, i1: i, t };
          cells.push(rec);
        }
      }
      if (!inside) continue;
      rec.i1 = i + 1;
      const mi = t.mi[i], m = t.m[i], s = t.s[i];
      M[mi] += m; V[mi] += t.v[i]; Sr[mi] += s; K[mi] += m * k;
      H[mi] += mi <= meta.miSplit ? m * k * (mi < meta.miAqua ? a : 1) : s;
    }
    done++;
    $("loadState").textContent = `Loading ${done}/${keys.length} tiles`;
  }));
  await Promise.all(work);
  return { M, V, S: Sr, H, K, nCells, cells };
}
function worldAgg() {
  const w = S.meta.world, f = a => Float64Array.from(a);
  return { M: f(w.m), V: f(w.v), S: f(w.s), H: f(w.h), K: f(w.k), nCells: null, cells: null };
}

/** The series for the chosen mode; null where that mode has no data. */
function seriesFor(agg, mode) {
  const { mi0, mi1, miSplit } = S.meta, out = new Array(mi1 + 1).fill(null);
  for (let mi = mi0; mi <= mi1; mi++) {
    if (mode === "h") out[mi] = agg.H[mi];
    else if (mode === "m") out[mi] = agg.M[mi];
    else if (mode === "v") out[mi] = mi > miSplit ? agg.V[mi] : null;
    else out[mi] = mi <= miSplit ? agg.M[mi] : agg.V[mi];
  }
  return out;
}
const isPartial = mi => mi === S.meta.mi1;
const sourceOf = (mi, mode) => mi <= S.meta.miSplit
  ? (mode === "h" ? "Older sensor (MODIS), corrected to match" : "Older sensor (MODIS), uncorrected")
  : (mode === "h" ? "Newer sensor (VIIRS)" : "Newer sensor (VIIRS), all satellites");

/* ---------------- statistics ---------------- */
function stats(series) {
  const { mi0, mi1 } = S.meta, lo = Math.max(mi0, miOf(S.fromY, 0)), hi = Math.min(mi1, miOf(S.toY, 11));
  const byMonth = Array.from({ length: 12 }, () => []), years = [];
  let total = 0;
  for (let y = S.fromY; y <= S.toY; y++) {
    let sum = 0, n = 0;
    for (let m = 0; m < 12; m++) {
      const mi = miOf(y, m), v = mi >= lo && mi <= hi ? series[mi] : null;
      if (v == null) continue;
      total += v;
      if (!isPartial(mi)) { byMonth[m].push(v); sum += v; n++; }
    }
    years.push({ y, sum, n, complete: n === 12 });
  }
  const clim = byMonth.map(a => {
    const s = a.slice().sort((x, y) => x - y);
    return { n: s.length, med: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75), max: s.length ? s[s.length - 1] : null };
  });
  return { lo, hi, total, clim, years };
}

/* ---------------- map ---------------- */
let map, layerCanvas;
function initMap() {
  map = new maplibregl.Map({
    container: "map", style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: [15, 12], zoom: 1.6, minZoom: 1, maxZoom: 10.5, attributionControl: { compact: true }, renderWorldCopies: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
  layerCanvas = document.createElement("canvas");
  layerCanvas.width = layerCanvas.height = 1440;
  return new Promise(resolve => map.on("load", () => {
    const firstSymbol = (map.getStyle().layers.find(l => l.type === "symbol") || {}).id;
    FINE.before = firstSymbol;
    map.on("moveend", updateFine);
    map.addSource("fires", { type: "image", url: layerCanvas.toDataURL(), coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]] });
    map.addLayer({ id: "fires", type: "raster", source: "fires", paint: { "raster-opacity": 0.88, "raster-resampling": "nearest", "raster-fade-duration": 0 } }, firstSymbol);
    map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "sel-fill", type: "fill", source: "sel", paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } });
    map.addLayer({ id: "sel-line", type: "line", source: "sel", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5] } });
    resolve();
  }));
}
function boxFeature(b) {
  const e = b.w <= b.e ? b.e : b.e + 360;
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[b.w, b.s], [e, b.s], [e, b.n], [b.w, b.n], [b.w, b.s]]] } };
}
const polyFeature = b => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...b.pts, b.pts[0]]] } });
const regionFeature = b => ({ type: "Feature", properties: {}, geometry: b.g });
const showBox = b => map.getSource("sel").setData({ type: "FeatureCollection", features: b ? [b.kind === "region" ? regionFeature(b) : b.kind === "circle" ? circleFeature(b) : b.kind === "poly" ? polyFeature(b) : boxFeature(b)] : [] });
const LEVEL_LABEL = ["Country", "State or province", "District or county", "Place"];
/** A named place measured by the copilot: only the harmonized series is known. */
function regionAgg(series) {
  const z = () => new Float64Array(S.meta.mi1 + 1), H = z();
  for (let i = 0; i < H.length; i++) H[i] = series[i] || 0;
  return { M: z(), V: z(), S: z(), H, K: z(), nCells: null, cells: null, simple: true };
}

/* ---- circles on the globe ---- */
const R_EARTH = 6371.0088, toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
const wrapLon = x => ((x + 180) % 360 + 360) % 360 - 180;
function distKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** A circle of radius r km, with its bounding box (w, s, e, n) for loading tiles. */
function circleShape(lon, lat, r) {
  lon = wrapLon(lon); lat = Math.max(-89.9, Math.min(89.9, lat));
  const ang = r / R_EARTH, s = Math.max(-90, lat - toDeg(ang)), n = Math.min(90, lat + toDeg(ang)), cl = Math.cos(toRad(lat));
  let w = -180, e = 180;
  if (s > -90 && n < 90 && Math.sin(ang) < cl) { const d = toDeg(Math.asin(Math.sin(ang) / cl)); w = wrapLon(lon - d); e = wrapLon(lon + d); }
  return { kind: "circle", lon, lat, r, w, s, e, n };
}
function circleFeature(c, steps = 120) {
  const ang = c.r / R_EARTH, la = toRad(c.lat), lo = toRad(c.lon), ring = [];
  for (let i = 0; i <= steps; i++) {
    const b = 2 * Math.PI * i / steps;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(ang) + Math.cos(la) * Math.sin(ang) * Math.cos(b));
    const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(la), Math.cos(ang) - Math.sin(la) * Math.sin(lat2));
    ring.push([toDeg(lon2), Math.max(-85, Math.min(85, toDeg(lat2)))]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
const inArea = (b, lon, lat) => inBox(b, lon, lat) && (b.kind === "circle" ? distKm(lat, lon, b.lat, b.lon) <= b.r : b.kind === "poly" ? inPoly(b, lon, lat) : true);
/* ---- freehand shapes ---- */
function pointInRing(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(b, lon, lat) {
  for (const x of [lon, lon - 360, lon + 360]) if (x >= b.minLng && x <= b.maxLng) return pointInRing(b.pts, x, lat);
  return false;
}
/** A freehand shape: its points (first one inside -180..180, the rest continuous) and bounding box. */
function polyShape(raw) {
  let pts = raw;
  if (pts.length > 240) { const k = Math.ceil(pts.length / 240); pts = pts.filter((_, i) => i % k === 0); }
  const shift = wrapLon(pts[0][0]) - pts[0][0];
  pts = pts.map(([x, y]) => [+(x + shift).toFixed(4), +Math.max(-85, Math.min(85, y)).toFixed(4)]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minLng = Math.min(...xs), maxLng = Math.max(...xs), full = maxLng - minLng >= 360;
  return { kind: "poly", pts, minLng, maxLng, w: full ? -180 : wrapLon(minLng), e: full ? 180 : maxLng === 180 ? 180 : wrapLon(maxLng), s: Math.min(...ys), n: Math.max(...ys) };
}
function areaSize(b) {
  if (b.kind === "circle") return { r: b.r, km2: Math.PI * b.r * b.r };
  if (b.kind === "poly") {
    const mid = (b.s + b.n) / 2, c = Math.cos(toRad(mid)), p = b.pts;
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * c * 111.32) * (p[i][1] * 110.57) - (p[i][0] * c * 111.32) * (p[j][1] * 110.57);
    return { km2: Math.abs(a) / 2, midLat: mid, midLon: wrapLon((b.minLng + b.maxLng) / 2) };
  }
  const dLon = b.w <= b.e ? b.e - b.w : b.e + 360 - b.w, mid = (b.s + b.n) / 2;
  const wk = dLon * 111.32 * Math.cos(toRad(mid)), hk = (b.n - b.s) * 110.57;
  return { wk, hk, km2: wk * hk, midLat: mid, midLon: wrapLon(b.w + dLon / 2) };
}
const roundKm = x => x >= 1000 ? fmt(Math.round(x / 10) * 10) : fmt(x);
const km2Txt = a => (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + " million" : fmt(Math.round(a / (a >= 1e4 ? 100 : 1)) * (a >= 1e4 ? 100 : 1))) + " km²";
function areaText(b) {
  if (b.kind === "region") return `${LEVEL_LABEL[b.level] || "Place"}${b.label && b.label !== b.name ? " · " + b.label.split(", ").slice(1).join(", ") : ""}`;
  const z = areaSize(b);
  if (b.kind === "circle") return `Centre ${coord(b.lat, "N", "S")}, ${coord(b.lon, "E", "W")} · ${roundKm(b.r)} km radius · ${km2Txt(z.km2)}`;
  if (b.kind === "poly") return `Centre ${coord(z.midLat, "N", "S")}, ${coord(z.midLon, "E", "W")} · drawn shape · ${km2Txt(z.km2)}`;
  return `Centre ${coord(z.midLat, "N", "S")}, ${coord(z.midLon, "E", "W")} · ${roundKm(z.wk)} × ${roundKm(z.hk)} km · ${km2Txt(z.km2)}`;
}
const areaSpec = b => b.kind === "region" ? `${b.label || b.name}, boundary id ${b.id}` : b.kind === "poly"
  ? `drawn shape, lon lat points: ${b.pts.map(p => `${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join("; ")}`
  : b.kind === "circle"
  ? `centre ${b.lat.toFixed(3)}, ${b.lon.toFixed(3)}, radius ${b.r.toFixed(1)} km`
  : `W ${b.w.toFixed(3)}, S ${b.s.toFixed(3)}, E ${b.e.toFixed(3)}, N ${b.n.toFixed(3)}`;

const layerCache = new Map();
async function drawLayer() {
  const { year, month } = S.layer, isMonth = month >= 0;
  const mi = miOf(year, month), key = isMonth ? `m/${mi}` : year ? `y/${year}` : "y/all";
  const ok = isMonth ? mi >= S.meta.mi0 && mi <= S.meta.mi1 : true;
  const top = topFor(0);
  const ctx = layerCanvas.getContext("2d"), img = ctx.createImageData(1440, 1440), px = img.data;
  if (ok) {
    if (!layerCache.has(key)) layerCache.set(key, fetchBin(`data/g/${key}.bin.gz`).then(parseLayer).catch(() => ({ n: 0, idx: [], h: [] })));
    const L = await layerCache.get(key);
    if (S.layer.year !== year || S.layer.month !== month) return;
    const grid = new Float32Array(1440 * 720);
    for (let i = 0; i < L.n; i++) grid[L.idx[i]] = L.h[i];
    S.coarse = grid;
    const lut = LUT;
    const logTop = Math.log(1 + top);
    for (let y = 0; y < 1440; y++) {
      // each canvas row is a Web Mercator row; find the latitude it shows
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 1440))) * 180 / Math.PI;
      const row = Math.floor((lat + 90) / 0.25);
      if (row < 0 || row > 719) continue;
      for (let x = 0; x < 1440; x++) {
        const h = grid[row * 1440 + x];
        if (h <= 0) continue;
        const t = Math.min(255, Math.round(255 * Math.log(1 + h) / logTop)), o = (y * 1440 + x) * 4;
        px[o] = lut[t * 3]; px[o + 1] = lut[t * 3 + 1]; px[o + 2] = lut[t * 3 + 2]; px[o + 3] = 235;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  map.getSource("fires").updateImage({ url: layerCanvas.toDataURL() });
  updateFine();
  document.querySelectorAll("#calendar .c.sel").forEach(c => c.classList.remove("sel"));
  if (isMonth) { const c = document.querySelector(`#calendar .c[data-mi="${mi}"]`); if (c) c.classList.add("sel"); }
}
function setLayer(year, month) {
  if (!year) month = -1;
  $("layerMonth").disabled = !year;
  S.layer = { year, month };
  $("layerYear").value = year; $("layerMonth").value = month;
  drawLayer();
}


/* ---------------- finer map levels, loaded as the reader zooms in ---------------- */
const LEVELS = [
  { label: "28 km", topAll: 300000, topYear: 20000, topMonth: 3000 },
  { deg: 0.05, tile: 10, n: 200, minZoom: 4.2, label: "5.5 km", topAll: 40000, topYear: 2500, topMonth: 500 },
  { deg: 0.01, tile: 2, n: 200, minZoom: 7.2, label: "1 km", topAll: 2500, topYear: 200, topMonth: 60 },
];
const topFor = lvl => !S.layer.year ? LEVELS[lvl].topAll : S.layer.month < 0 ? LEVELS[lvl].topYear : LEVELS[lvl].topMonth;
const FINE = { index: null, cache: new Map(), shown: new Set(), grids: new Map(), gen: 0, before: undefined };
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) LUT.set(rampAt(RAMP, 0.12 + 0.88 * i / 255), i * 3);

function levelFor(zoom) {
  if (!FINE.index) return 0;
  return zoom >= LEVELS[2].minZoom ? 2 : zoom >= LEVELS[1].minZoom ? 1 : 0;
}
function setLegend(lvl) {
  const { year, month } = S.layer, L = LEVELS[lvl];
  $("legendHi").textContent = short(topFor(lvl)) + "+";
  $("layerHint").textContent = `Fire hotspots per ${L.label} square, ${!year ? "2000 to 2026" : (month < 0 ? "" : MONTHS[month] + " ") + year}`
    + (lvl < 2 && FINE.index ? " · zoom in for finer cells" : "");
}
function parseFine(buf) {
  const n = new DataView(buf).getUint32(4, true), kind = new Uint8Array(buf, 0, 4)[3];
  if (kind === 51) return { n, cell: new Uint16Array(buf, 8, n), mi: new Uint16Array(buf, 8 + 2 * n, n), val: new Uint8Array(buf, 8 + 4 * n, n) };
  return { n, cell: new Uint16Array(buf, 8, n), val: new Uint16Array(buf, 8 + 2 * n, n), tag: new Uint8Array(buf, 8 + 4 * n, n) };
}
function fineFile(url) {
  if (!FINE.cache.has(url)) {
    if (FINE.cache.size > 300) FINE.cache.delete(FINE.cache.keys().next().value);
    FINE.cache.set(url, fetchBin(url).then(parseFine).catch(() => null));
  }
  return FINE.cache.get(url);
}
/** Paint one tile of fine cells onto a Web Mercator canvas. */
function fineImage(lvl, tx, ty, d, year, month) {
  const L = LEVELS[lvl], N = L.n, lon0 = -180 + tx * L.tile, latS = -90 + ty * L.tile;
  const s = Math.max(latS, -85.0511), n = Math.min(latS + L.tile, 85.0511);
  if (n <= s) return null;
  const grid = new Float32Array(N * N);
  if (lvl === 1) { for (let i = 0; i < d.n; i++) if (month < 0 || d.tag[i] === month) grid[d.cell[i]] += d.val[i]; }
  else {
    const lo = !year ? 0 : miOf(year, month < 0 ? 0 : month), hi = !year ? 65535 : month < 0 ? miOf(year, 11) : lo;
    for (let i = 0; i < d.n; i++) { const mi = d.mi[i]; if (mi >= lo && mi <= hi) grid[d.cell[i]] += d.val[i]; }
  }
  const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), yN = my(n), yS = my(s);
  const H = Math.max(8, Math.min(1024, Math.round(N * (yN - yS) / (L.tile * Math.PI / 180))));
  const cv = document.createElement("canvas"); cv.width = N; cv.height = H;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(N, H), px = img.data;
  const logTop = Math.log(1 + topFor(lvl));
  let any = false;
  for (let py = 0; py < H; py++) {
    const lat = (2 * Math.atan(Math.exp(yN - (py + 0.5) / H * (yN - yS))) - Math.PI / 2) * 180 / Math.PI;
    const row = Math.floor((lat - latS) / L.deg);
    if (row < 0 || row >= N) continue;
    for (let x = 0; x < N; x++) {
      const h = grid[row * N + x];
      if (h <= 0) continue;
      const t = Math.min(255, Math.round(255 * Math.log(1 + h) / logTop)), o = (py * N + x) * 4;
      px[o] = LUT[t * 3]; px[o + 1] = LUT[t * 3 + 1]; px[o + 2] = LUT[t * 3 + 2]; px[o + 3] = 235; any = true;
    }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL(), grid, coordinates: [[lon0, n], [lon0 + L.tile, n], [lon0 + L.tile, s], [lon0, s]] };
}
function removeFine(id) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  FINE.shown.delete(id); FINE.grids.delete(id);
}
async function updateFine() {
  if (!map || !map.getSource("fires")) return;
  const gen = ++FINE.gen, lvl = levelFor(map.getZoom()), { year, month } = S.layer;
  setLegend(lvl);
  if (lvl === 0) {
    [...FINE.shown].forEach(removeFine);
    map.setPaintProperty("fires", "raster-opacity", 0.88);
    return;
  }
  const L = LEVELS[lvl], b = map.getBounds(), nx = 360 / L.tile;
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  const have = lvl === 1 ? FINE.index.f1[year || "all"] : FINE.index.f3, want = new Map();
  for (let ty = Math.floor((s + 90) / L.tile); ty <= Math.floor((n + 90) / L.tile); ty++) {
    for (let ix = Math.floor((b.getWest() + 180) / L.tile); ix <= Math.floor((b.getEast() + 180) / L.tile); ix++) {
      const tx = ((ix % nx) + nx) % nx, key = `${tx}_${ty}`;
      if (have && have.has(key)) want.set(`fine-${lvl}-${key}-${year}-${month}`, { tx, ty, key });
    }
  }
  await Promise.all([...want].map(async ([id, t]) => {
    if (FINE.shown.has(id)) return;
    const d = await fineFile(lvl === 1 ? `data/f1/${year || "all"}/${t.key}.bin.gz` : `data/f3/${t.key}.bin.gz`);
    if (!d || gen !== FINE.gen || FINE.shown.has(id)) return;
    const img = fineImage(lvl, t.tx, t.ty, d, year, month);
    if (!img) return;
    map.addSource(id, { type: "image", url: img.url, coordinates: img.coordinates });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.9, "raster-resampling": "nearest", "raster-fade-duration": 0 } }, FINE.before);
    FINE.shown.add(id); FINE.grids.set(id, img.grid);
  }));
  if (gen !== FINE.gen) return;
  [...FINE.shown].forEach(id => { if (!want.has(id)) removeFine(id); });
  map.setPaintProperty("fires", "raster-opacity", 0);
  updateCellBox();
}

/* ---------------- how big is one square: marker and hover readout ---------------- */
function cellInfo(lat) {
  const z = map.getZoom(), lvl = levelFor(z), deg = lvl === 0 ? 0.25 : LEVELS[lvl].deg;
  const cos = Math.max(0.05, Math.cos(lat * Math.PI / 180)), w = deg * 512 * Math.pow(2, z) / 360;
  return { lvl, deg, px: [w, w / cos], km: [deg * 111.32 * cos, deg * 110.57] };
}
const kmTxt = v => v >= 10 ? Math.round(v) : v.toFixed(1);
function updateCellBox() {
  const c = cellInfo(map.getCenter().lat), sq = $("cellSq");
  sq.style.width = Math.max(2, Math.min(40, c.px[0])) + "px";
  sq.style.height = Math.max(2, Math.min(40, c.px[1])) + "px";
  $("cellTxt").innerHTML = `<b>One square = ${kmTxt(c.km[0])} × ${kmTxt(c.km[1])} km</b><br>${c.lvl < 2 ? "Zoom in and the squares get smaller, down to 1 km" : "Finest level"}`;
}
function initHover() {
  const empty = { type: "FeatureCollection", features: [] }, tip = $("tip");
  map.addSource("hover", { type: "geojson", data: empty });
  map.addLayer({ id: "hover-line", type: "line", source: "hover", paint: { "line-color": "#ffffff", "line-width": 1.5 } });
  const hide = () => { map.getSource("hover").setData(empty); tip.hidden = true; };
  map.on("mousemove", e => {
    if (S.drawing || Math.abs(e.lngLat.lat) > 85) return hide();
    const lon = ((e.lngLat.lng + 180) % 360 + 360) % 360 - 180, off = e.lngLat.lng - lon, lat = e.lngLat.lat;
    const c = cellInfo(lat), col = Math.floor((lon + 180) / c.deg + 1e-9), row = Math.floor((lat + 90) / c.deg + 1e-9);
    const w = -180 + col * c.deg + off, s = -90 + row * c.deg, x = w + c.deg, n = s + c.deg;
    map.getSource("hover").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [x, s], [x, n], [w, n], [w, s]]] } });
    const { year, month } = S.layer;
    let v = null;
    if (c.lvl === 0) v = S.coarse ? S.coarse[row * 1440 + col] : null;
    else {
      const g = FINE.grids.get(`fine-${c.lvl}-${Math.floor(col / 200)}_${Math.floor(row / 200)}-${year}-${month}`);
      v = g ? g[(row % 200) * 200 + col % 200] : FINE.shown.size ? 0 : null;
    }
    const when = !year ? "2000 to 2026" : (month < 0 ? "" : MONTHS[month] + " ") + year;
    const k = cellInfo(s + c.deg / 2).km;
    tip.innerHTML = `<b>${v == null ? "Loading" : v > 0 ? fmt(v) + (v === 1 ? " hotspot" : " hotspots") : "No hotspots"}</b><div class="m">${when} · this square: ${kmTxt(k[0])} × ${kmTxt(k[1])} km</div>`;
    tip.hidden = false;
    const r = tip.getBoundingClientRect(), p = e.originalEvent;
    tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, p.clientX + 14)) + "px";
    tip.style.top = Math.max(8, p.clientY - r.height - 12) + "px";
  });
  map.on("mouseout", hide);
  map.on("move", updateCellBox);
  updateCellBox();
}

/* ---------------- drawing a box ---------------- */
const MIN_R = 15;   // km; smaller circles would hold no 28 km cell centre
const TOOL_HINT = {
  rect: "Drag a rectangle on the map · Esc to cancel",
  circle: "Press on the centre, drag out the radius · Esc to cancel",
  poly: "Press and draw your shape, release to close it · Esc to cancel",
};
function flashHint(text) {
  const h = $("drawHint"); h.textContent = text; h.hidden = false; h.classList.add("warn");
  clearTimeout(flashHint.t); flashHint.t = setTimeout(() => { if (!S.drawing) h.hidden = true; h.classList.remove("warn"); }, 2200);
}
const ICONS = {
  rect: '<svg viewBox="0 0 20 20"><rect x="3" y="5" width="14" height="10" rx="1.5"/></svg>',
  circle: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><circle class="dot" cx="10" cy="10" r="1.2"/></svg>',
  poly: '<svg viewBox="0 0 20 20"><path d="M4 16.5l.9-3.6 8.6-8.6 2.7 2.7-8.6 8.6z"/><path d="M12.3 5.5l2.7 2.7"/></svg>',
};
const TOOL_NAME = { rect: "Rectangle", circle: "Circle", poly: "Pencil" };
const TOOL_TITLE = { rect: "Drag a rectangle on the map", circle: "Press on the centre, then drag out the radius", poly: "Draw any shape freehand" };
function initDraw() {
  let tool = null, kind = "rect", start = null, pts = null, lastPx = null;
  const hint = $("drawHint"), menu = $("toolMenu");
  document.querySelectorAll("#toolMenu [data-tool]").forEach(b => b.querySelector(".ico").innerHTML = ICONS[b.dataset.tool]);
  const showKind = k => {
    kind = k; $("toolIcon").innerHTML = ICONS[k]; $("toolName").textContent = TOOL_NAME[k]; $("toolMain").title = TOOL_TITLE[k];
    document.querySelectorAll("#toolMenu [data-tool]").forEach(b => b.setAttribute("aria-checked", b.dataset.tool === k));
  };
  const setTool = t => {
    tool = t; start = null; pts = null; S.drawing = !!t;
    t ? map.dragPan.disable() : map.dragPan.enable();
    map.getCanvas().style.cursor = t ? "crosshair" : "";
    $("toolMain").classList.toggle("on", !!t); $("toolMain").setAttribute("aria-pressed", !!t);
    hint.classList.remove("warn"); hint.hidden = !t;
    if (t) hint.textContent = TOOL_HINT[t];
    $("toolHint").textContent = t ? "Now draw on the map" : "Choose a shape, then draw on the map";
    $("clearChip").hidden = !!t || !S.bbox;
  };
  const openMenu = open => { menu.hidden = !open; $("toolMore").setAttribute("aria-expanded", open); };
  S.setTool = setTool;
  showKind("rect");
  $("toolMain").onclick = () => setTool(tool ? null : kind);
  $("toolMore").onclick = e => { e.stopPropagation(); openMenu(menu.hidden); };
  menu.onclick = e => { const b = e.target.closest("[data-tool]"); if (!b) return; showKind(b.dataset.tool); openMenu(false); setTool(b.dataset.tool); };
  document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest("#toolSplit")) openMenu(false); });

  const rectOf = (a, b) => ({ kind: "rect", w: Math.min(a.lng, b.lng), e: Math.max(a.lng, b.lng), s: Math.max(-90, Math.min(a.lat, b.lat)), n: Math.min(90, Math.max(a.lat, b.lat)) });
  const down = e => {
    if (!tool) return;
    start = e.lngLat; e.preventDefault();
    if (tool === "poly") { pts = [[e.lngLat.lng, e.lngLat.lat]]; lastPx = e.point; }
  };
  const move = e => {
    if (!tool || !start) return;
    if (tool === "poly") {
      if (Math.hypot(e.point.x - lastPx.x, e.point.y - lastPx.y) < 4) return;
      pts.push([e.lngLat.lng, e.lngLat.lat]); lastPx = e.point;
      showBox({ kind: "poly", pts });
      hint.textContent = "Keep drawing · release to close the shape";
      return;
    }
    const sh = tool === "rect" ? rectOf(start, e.lngLat) : circleShape(start.lng, start.lat, distKm(start.lat, start.lng, e.lngLat.lat, e.lngLat.lng)), z = areaSize(sh);
    showBox(sh);
    hint.textContent = sh.kind === "rect" ? `${roundKm(z.wk)} × ${roundKm(z.hk)} km · release to select` : `Radius ${roundKm(sh.r)} km · release to select`;
  };
  const up = e => {
    if (!tool || !start) return;
    const t = tool;
    if (t === "poly") {
      const drawn = pts; setTool(null);
      const sh = drawn && drawn.length >= 3 ? polyShape(drawn) : null;
      if (!sh || (sh.maxLng - sh.minLng < 0.25 && sh.n - sh.s < 0.25)) { showBox(S.bbox); return flashHint("Too small: draw a bigger shape"); }
      return setArea(sh, "Your shape");
    }
    const sh = t === "rect" ? rectOf(start, e.lngLat) : circleShape(start.lng, start.lat, distKm(start.lat, start.lng, e.lngLat.lat, e.lngLat.lng));
    setTool(null);
    const small = sh.kind === "rect" ? sh.e - sh.w < 0.25 || sh.n - sh.s < 0.25 : sh.r < MIN_R;
    if (small) { showBox(S.bbox); return flashHint(sh.kind === "rect" ? "Too small: drag a bigger rectangle (at least 28 km)" : `Too small: drag a radius of at least ${MIN_R} km`); }
    setArea(sh.kind === "rect" ? normBox(sh) : sh, sh.kind === "rect" ? "Your rectangle" : "Your circle");
  };
  map.on("mousedown", down); map.on("mousemove", move); map.on("mouseup", up);
  map.on("touchstart", down); map.on("touchmove", move); map.on("touchend", up);
  window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!menu.hidden) return openMenu(false);
    if (tool) { setTool(null); showBox(S.bbox); return; }
    const typing = e.target instanceof Element && e.target.matches("input, select, textarea");
    if (S.bbox && !typing && !document.querySelector("dialog[open]")) clearArea();
  });
}
function normBox(b) {
  if (b.e - b.w >= 360) return { kind: "rect", w: -180, e: 180, s: b.s, n: b.n };
  return { kind: "rect", w: wrapLon(b.w), e: b.e === 180 ? 180 : wrapLon(b.e), s: b.s, n: b.n };
}
/** Drop the current selection and go back to the whole world, keeping the map where it is. */
function clearArea() {
  if (S.setTool) S.setTool(null);
  if (window.Copilot) Copilot.clearMap();
  setArea(null);
}
function fillCoords(b) {
  if (b && (b.kind === "poly" || b.kind === "region")) return;
  const kind = b ? b.kind : $("coordShape").value;
  $("coordShape").value = kind;
  $("rectFields").hidden = kind !== "rect"; $("circFields").hidden = kind !== "circle";
  if (!b) return;
  const f = (id, v) => $(id).value = +v.toFixed(3);
  if (b.kind === "circle") { f("clat", b.lat); f("clon", b.lon); f("cr", b.r); }
  else { f("cw", b.w); f("cs", b.s); f("ce", b.e); f("cn", b.n); }
}

/* ---------------- selecting an area ---------------- */
async function setArea(b, name, fly) {
  const token = ++S.token;
  const m = b && /^Your (rectangle|circle|shape)$/.exec(name);
  if (m) name = `${m[1][0].toUpperCase() + m[1].slice(1)} ${S.areaN = (S.areaN || 0) + 1}`;
  S.bbox = b; S.name = b ? name : "Whole world";
  $("clearChip").hidden = !b || !!S.drawing; $("clearBtn").hidden = !b;
  showBox(b); fillCoords(b);
  $("coordMsg").textContent = "";
  if (b && fly) { const e = b.w <= b.e ? b.e : b.e + 360; map.fitBounds([[b.w, b.s], [e, b.n]], { padding: 60, duration: 900, maxZoom: 8 }); }
  const r3 = x => +x.toFixed(3);
  history.replaceState(null, "", b ? (b.kind === "region" ? `#place=${encodeURIComponent(b.id)}` : b.kind === "poly" ? `#poly=${b.pts.map(p => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join(";")}` : b.kind === "circle" ? `#circle=${r3(b.lon)},${r3(b.lat)},${r3(b.r)}` : `#bbox=${[b.w, b.s, b.e, b.n].map(r3).join(",")}`) : location.pathname + location.search);
  let agg;
  try {
    $("loadState").textContent = b ? "Loading..." : "";
    agg = !b ? worldAgg() : b.kind === "region" ? regionAgg(b.series) : await aggregate(b, token);
  } catch (err) { if (token === S.token) $("loadState").textContent = "Could not load data: " + err.message; return; }
  if (token !== S.token) return;
  S.agg = agg; $("loadState").textContent = "";
  render();
}

/* ---------------- rendering ---------------- */
function render() {
  if (!S.agg) return;
  const series = seriesFor(S.agg, S.mode), st = stats(series);
  S.series = series; S.stats = st;
  $("areaName").textContent = S.name;
  const b = S.bbox;
  $("areaSub").textContent = b ? areaText(b) : "All land on Earth";
  renderKpis(series, st); renderCalendar(series, st); renderSeasonal(series, st); renderAnnual(st);
  const rows = S.agg.cells ? S.agg.cells.reduce((n, c) => n + (c.i1 - c.i0), 0) : 0;
  $("dlCells").disabled = !S.agg.cells;
  $("dlHint").textContent = S.agg.cells ? `Cell file: one row per 0.25 degree cell and month, up to ${fmt(rows)} rows.` : "Draw an area to download counts by cell.";
}
const unit = () => "hotspots";
const coord = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;

const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pctTxt = p => `${Math.abs(p).toFixed(0)}% ${p >= 0 ? "above" : "below"}`;
/** Plain-language reading of how far a count is from the usual one. */
function levelOf(p) {
  if (p == null) return { label: "No usual level to compare", cls: "lvl-flat" };
  if (p >= 100) return { label: "Far above usual", cls: "lvl-high" };
  if (p >= 25) return { label: "Above usual", cls: "lvl-up" };
  if (p > -25) return { label: "About usual", cls: "lvl-flat" };
  return { label: "Below usual", cls: "lvl-down" };
}
/** The handful of numbers a responder needs for one area. */
function summarize(series, st) {
  const peakM = st.clim.reduce((best, c, m) => c.med != null && (best < 0 || c.med > st.clim[best].med) ? m : best, -1);
  const full = st.years.filter(y => y.complete), worst = full.reduce((a, y) => !a || y.sum > a.sum ? y : a, null);
  let latest = null;
  for (let mi = st.hi; mi >= st.lo; mi--) if (series[mi] != null && !isPartial(mi)) { latest = mi; break; }
  const out = { peakM, worst, latest, pct: null, ytd: null, ytdUsual: null, ytdPct: null, avgYear: null, trend: null, share: null };
  if (latest != null) {
    const med = st.clim[latest % 12].med;
    out.value = series[latest];
    if (med > 0) out.pct = (series[latest] - med) / med * 100;
    let a = 0, u = 0;
    for (let m = 0; m <= latest % 12; m++) { const v = series[latest - latest % 12 + m]; if (v != null) { a += v; u += st.clim[m].med || 0; } }
    out.ytd = a; out.ytdUsual = u; if (u > 0) out.ytdPct = (a - u) / u * 100;
  }
  if (full.length) out.avgYear = full.reduce((t, y) => t + y.sum, 0) / full.length;
  if (full.length >= 8 && out.avgYear > 0) {
    const mx = full.reduce((t, r) => t + r.y, 0) / full.length;
    out.trend = full.reduce((t, r) => t + (r.y - mx) * (r.sum - out.avgYear), 0) / full.reduce((t, r) => t + (r.y - mx) ** 2, 0) * 10 / out.avgYear * 100;
  }
  const tot = st.clim.reduce((t, c) => t + (c.med || 0), 0);
  if (tot > 0) out.share = st.clim.map(c => (c.med || 0) / tot * 100);
  return out;
}
const trendTxt = t => t == null ? "n/a" : Math.abs(t) < 3 ? "Steady" : `${t > 0 ? "Up" : "Down"} ${Math.abs(t).toFixed(0)}%`;
function renderKpis(series, st) {
  const z = S.summary = summarize(series, st), L = z.latest;
  const when = L == null ? "" : `${MONTH_FULL[L % 12]} ${2000 + Math.floor(L / 12)}`, lv = levelOf(z.pct);
  $("status").className = "status " + (L == null ? "lvl-flat" : lv.cls);
  $("status").innerHTML = L == null ? `<div><b>No data in this period</b></div>` :
    `<span class="badge">${lv.label}</span><div><b>${when}: ${fmt(z.value)} hotspots${z.pct == null ? "" : `, ${pctTxt(z.pct)} the usual for ${MONTH_FULL[L % 12]}`}</b>`
    + `<div class="m">${z.peakM < 0 ? "" : `Fires here usually peak in ${MONTH_FULL[z.peakM]}. `}"Usual" is the middle value for that month across ${S.fromY} to ${S.toY}.</div></div>`;
  const k = (label, value, detail, c = "") => `<div class="kpi"><div class="k">${label}</div><div class="v">${value}</div><div class="d ${c}">${detail}</div></div>`;
  const yr = L == null ? "" : 2000 + Math.floor(L / 12);
  $("kpis").innerHTML =
    k(L == null ? "This year so far" : `${yr} so far (Jan to ${MONTHS[L % 12]})`, z.ytd == null ? "n/a" : short(z.ytd), z.ytdPct == null ? "" : `${pctTxt(z.ytdPct)} the usual ${short(z.ytdUsual)}`, z.ytdPct == null ? "" : z.ytdPct >= 0 ? "up" : "down") +
    k("Usual peak month", z.peakM < 0 ? "n/a" : MONTH_FULL[z.peakM], z.peakM < 0 ? "" : `usually ${fmt(st.clim[z.peakM].med)} hotspots`) +
    k("Most active year", z.worst ? z.worst.y : "n/a", z.worst ? fmt(z.worst.sum) + " hotspots" : "no complete year") +
    k("Long-term trend", trendTxt(z.trend), z.trend == null ? "needs 8 full years" : `per decade · ${short(z.avgYear)} a year on average`, z.trend == null || Math.abs(z.trend) < 3 ? "" : z.trend > 0 ? "up" : "down");
  renderCompare();
}

/* ---- comparing two areas ---- */
function renderCompare() {
  const blk = $("cmpBlock"), p = S.pin;
  blk.hidden = !p;
  $("pinBtn").textContent = p && p.bbox === S.bbox ? "Pinned" : "Pin to compare";
  if (!p) return;
  if (p.bbox === S.bbox) { $("cmpBody").innerHTML = `<p class="hint"><b>${p.name}</b> is pinned. Now select another area on the map to compare it with.</p>`; return; }
  const a = S.summary, b = p.z, mon = z => z.latest == null ? "n/a" : `${fmt(z.value)}${z.pct == null ? "" : ` <span class="${z.pct >= 0 ? "up" : "down"}">(${pctTxt(z.pct)} usual)</span>`}`;
  const row = (label, x, y) => `<tr><th>${label}</th><td>${x}</td><td>${y}</td></tr>`;
  const ytd = z => z.ytd == null ? "n/a" : `${short(z.ytd)}${z.ytdPct == null ? "" : ` <span class="${z.ytdPct >= 0 ? "up" : "down"}">(${pctTxt(z.ytdPct)} usual)</span>`}`;
  let html = `<table class="cmp"><thead><tr><th></th><th><i class="sw a"></i>${S.name}</th><th><i class="sw b"></i>${p.name}</th></tr></thead><tbody>`
    + row(a.latest == null ? "Latest month" : `${MONTHS[a.latest % 12]} ${2000 + Math.floor(a.latest / 12)}`, mon(a), mon(b))
    + row("This year so far", ytd(a), ytd(b))
    + row("Usual peak month", a.peakM < 0 ? "n/a" : MONTH_FULL[a.peakM], b.peakM < 0 ? "n/a" : MONTH_FULL[b.peakM])
    + row("Average per year", a.avgYear == null ? "n/a" : short(a.avgYear), b.avgYear == null ? "n/a" : short(b.avgYear))
    + row("Trend per decade", trendTxt(a.trend), trendTxt(b.trend)) + `</tbody></table>`;
  if (a.share && b.share) {
    const W = 468, H = 150, x0 = 44, x1 = W - 10, y0 = 10, y1 = H - 24, max = niceMax(Math.max(...a.share, ...b.share));
    const X = m => x0 + (m + 0.5) * (x1 - x0) / 12, Y = v => y1 - (v / max) * (y1 - y0);
    let g = "";
    const step = niceStep(max / 4);
    for (let v = 0; v <= max * 1.001; v += step) g += `<line class="grid" x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${x0 - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}%</text>`;
    MONTHS.forEach((m, i) => g += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">${m}</text>`);
    g += `<polyline points="${b.share.map((v, m) => `${X(m)},${Y(v)}`).join(" ")}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="5 4"/>`;
    g += `<polyline points="${a.share.map((v, m) => `${X(m)},${Y(v)}`).join(" ")}" fill="none" stroke="#ff8a3d" stroke-width="2.5"/>`;
    a.share.forEach((v, m) => g += `<circle cx="${X(m)}" cy="${Y(v)}" r="6" fill="transparent" data-tip="<b>${MONTH_FULL[m]}</b><div class='m'>${S.name}: ${v.toFixed(0)}% of its yearly fire<br>${p.name}: ${b.share[m].toFixed(0)}%</div>"/>`);
    html += `<div class="chart">${svgEl(W, H, g)}</div><p class="hint">When each area burns: the share of a usual year's hotspots that falls in each month. Orange: ${S.name}. White dashes: ${p.name}.</p>`;
  }
  $("cmpBody").innerHTML = html;
}

function renderCalendar(series, st) {
  const el = $("calendar"), anomMode = S.cal === "anom";
  let max = 0;
  for (let mi = st.lo; mi <= st.hi; mi++) if (series[mi] != null && !isPartial(mi)) max = Math.max(max, series[mi]);
  const colour = mi => {
    const v = series[mi];
    if (anomMode) {
      const med = st.clim[mi % 12].med;
      if (!med) return v > 0 ? rampAt(DIVERGE, 1) : rampAt(DIVERGE, 0.5);
      return rampAt(DIVERGE, 0.5 + Math.max(-1, Math.min(1, (v - med) / med)) / 2);
    }
    return v > 0 ? rampAt(RAMP, 0.1 + 0.9 * Math.sqrt(v / (max || 1))) : hexRgb("#141821");
  };
  let html = `<div class="h"></div>` + MONTHS.map(m => `<div class="h">${m}</div>`).join("") + `<div class="h">Year</div>`;
  for (let y = S.toY; y >= S.fromY; y--) {
    html += `<div class="y">${y}</div>`;
    for (let m = 0; m < 12; m++) {
      const mi = miOf(y, m), v = mi >= st.lo && mi <= st.hi ? series[mi] : null;
      if (v == null) { html += `<div class="c na"></div>`; continue; }
      const rgb = colour(mi), med = st.clim[m].med;
      const txt = anomMode ? (med > 0 ? ((v - med) / med * 100 >= 0 ? "+" : "") + Math.max(-99, Math.min(999, (v - med) / med * 100)).toFixed(0) : "") : (v > 0 ? short(v) : "");
      html += `<button class="c${isPartial(mi) ? " part" : ""}" data-mi="${mi}" style="background-color:${css(rgb)};color:${lum(rgb) > 0.55 ? "#141414" : "#f3f4f8"}" aria-label="${MONTHS[m]} ${y}: ${fmt(v)}">${txt}</button>`;
    }
    const yr = st.years.find(r => r.y === y);
    html += `<div class="t">${yr && yr.n ? short(yr.sum) + (yr.complete ? "" : "*") : ""}</div>`;
  }
  html += `<div class="y norm">Usual</div>`;
  for (let m = 0; m < 12; m++) {
    const med = st.clim[m].med;
    if (med == null) { html += `<div class="c na"></div>`; continue; }
    const rgb = anomMode ? rampAt(DIVERGE, 0.5) : med > 0 ? rampAt(RAMP, 0.1 + 0.9 * Math.sqrt(Math.min(1, med / (max || 1)))) : hexRgb("#141821");
    html += `<div class="c norm" style="background-color:${css(rgb)};color:${lum(rgb) > 0.55 ? "#141414" : "#f3f4f8"}" data-tip="<b>Usual ${MONTHS[m]}: ${fmt(med)}</b><div class='m'>The middle value of ${st.clim[m].n} years</div>">${short(med)}</div>`;
  }
  html += `<div class="t"></div>`;
  el.innerHTML = html;
  $("calBar").style.background = `linear-gradient(90deg, ${(anomMode ? DIVERGE : RAMP).join(",")})`;
  $("calLo").textContent = anomMode ? "Far fewer than usual" : "0";
  $("calHi").textContent = anomMode ? "Far more than usual" : fmt(max) + " a month";
  $("calNote").textContent = anomMode
    ? "Each month against what is usual for that time of year. Orange: more fire than usual. Blue: less. The number is the % difference."
    : "Number of hotspots each month. Brighter means more fire.";
  if (S.layer.month >= 0) { const c = el.querySelector(`.c[data-mi="${miOf(S.layer.year, S.layer.month)}"]`); if (c) c.classList.add("sel"); }
}
function calTip(mi) {
  const v = S.series[mi], c = S.stats.clim[mi % 12], y = 2000 + Math.floor(mi / 12);
  let line = "";
  if (c.med > 0 && !isPartial(mi)) { const p = (v - c.med) / c.med * 100; line = `<div class="m">${levelOf(p).label}: ${pctTxt(p)} the usual ${fmt(c.med)}</div>`; }
  return `<b>${MONTHS[mi % 12]} ${y}: ${fmt(v)}</b> ${unit()}${line}${isPartial(mi) ? `<div class="m">First 7 days only</div>` : ""}`;
}

/* ---- small SVG helpers ---- */
const svgEl = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" role="img">${inner}</svg>`;
function yAxis(max, x0, x1, y0, y1) {
  let out = "";
  const step = niceStep(max / 4);
  for (let v = 0; v <= max * 1.001; v += step) {
    const y = y1 - (v / max) * (y1 - y0);
    out += `<line class="grid" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/><text x="${x0 - 6}" y="${y + 3.5}" text-anchor="end">${short(v)}</text>`;
  }
  return out;
}
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
const niceMax = v => { const s = niceStep(v / 4); return Math.max(s, Math.ceil(v / s) * s); };

function renderSeasonal(series, st) {
  const W = 468, H = 190, x0 = 44, x1 = W - 10, y0 = 10, y1 = H - 24;
  const yearVals = y => { const out = []; for (let m = 0; m < 12; m++) { const mi = miOf(y, m); out.push(mi >= S.meta.mi0 && mi <= S.meta.mi1 && !isPartial(mi) ? series[mi] : null); } return out; };
  const sets = [{ y: S.cmpYear, col: "#ff8a3d", dash: "", w: 2.5 }];
  if (S.cmpYear2 && S.cmpYear2 !== S.cmpYear) sets.push({ y: S.cmpYear2, col: "#ffffff", dash: "5 4", w: 2 });
  sets.forEach(q => q.v = yearVals(q.y));
  const max = niceMax(Math.max(1, ...st.clim.map(c => c.q3 || 0), ...sets.flatMap(q => q.v.map(v => v || 0))));
  const X = m => x0 + (m + 0.5) * (x1 - x0) / 12, Y = v => y1 - (v / max) * (y1 - y0);
  let g = yAxis(max, x0, x1, y0, y1);
  MONTHS.forEach((m, i) => g += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">${m}</text>`);
  if (st.clim.every(c => c.n > 0)) {
    const top = st.clim.map((c, m) => `${X(m)},${Y(c.q3)}`), bot = st.clim.map((c, m) => `${X(m)},${Y(c.q1)}`).reverse();
    g += `<polygon points="${top.concat(bot).join(" ")}" fill="#5aa9e6" opacity="0.22"/>`;
    g += `<polyline points="${st.clim.map((c, m) => `${X(m)},${Y(c.med)}`).join(" ")}" fill="none" stroke="#5aa9e6" stroke-width="2"/>`;
  }
  for (const q of sets.slice().reverse()) {
    let seg = [];
    const flush = () => { if (seg.length > 1) g += `<polyline points="${seg.join(" ")}" fill="none" stroke="${q.col}" stroke-width="${q.w}"${q.dash ? ` stroke-dasharray="${q.dash}"` : ""}/>`; seg = []; };
    q.v.forEach((v, m) => { if (v == null) flush(); else seg.push(`${X(m)},${Y(v)}`); }); flush();
    q.v.forEach((v, m) => {
      if (v == null) return;
      const c = st.clim[m], p = c.med > 0 ? ` · ${pctTxt((v - c.med) / c.med * 100)} usual` : "";
      g += `<circle cx="${X(m)}" cy="${Y(v)}" r="3.5" fill="${q.col}" data-tip="<b>${MONTHS[m]} ${q.y}: ${fmt(v)}</b><div class='m'>Usual ${MONTHS[m]}: ${fmt(c.med)}${p}</div>"/>`;
    });
  }
  $("seasonal").innerHTML = svgEl(W, H, g);
  $("seasonHint").innerHTML = `<i class="sw u"></i>Blue line: a usual year. Blue band: the range most years fall in. <i class="sw a"></i>${S.cmpYear}`
    + (sets[1] ? ` <i class="sw b"></i>${S.cmpYear2}` : "") + ".";
}

function renderAnnual(st) {
  const W = 468, H = 180, x0 = 44, x1 = W - 8, y0 = 10, y1 = H - 22, yrs = st.years.filter(y => y.n > 0);
  if (!yrs.length) { $("annual").innerHTML = ""; return; }
  const max = niceMax(Math.max(1, ...yrs.map(y => y.sum))), bw = (x1 - x0) / yrs.length;
  let g = yAxis(max, x0, x1, y0, y1);
  yrs.forEach((r, i) => {
    const h = (r.sum / max) * (y1 - y0), x = x0 + i * bw + 1;
    g += `<rect x="${x}" y="${y1 - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="#ff8a3d" opacity="${r.complete ? 1 : 0.45}" data-tip="<b>${r.y}: ${fmt(r.sum)}</b><div class='m'>${r.complete ? "Full year" : "Incomplete year, " + r.n + " months"}</div>"/>`;
    if (r.y % 5 === 0 || yrs.length <= 12) g += `<text x="${x + bw / 2 - 1}" y="${H - 6}" text-anchor="middle">${r.y}</text>`;
  });
  const full = yrs.filter(y => y.complete);
  let note = "";
  if (full.length >= 8) {
    const n = full.length, mx = full.reduce((a, r) => a + r.y, 0) / n, my = full.reduce((a, r) => a + r.sum, 0) / n;
    const slope = full.reduce((a, r) => a + (r.y - mx) * (r.sum - my), 0) / full.reduce((a, r) => a + (r.y - mx) ** 2, 0);
    const Xc = y => x0 + (yrs.findIndex(r => r.y === y) + 0.5) * bw, Yc = v => y1 - (Math.max(0, Math.min(max, v)) / max) * (y1 - y0);
    const a = full[0].y, b = full[n - 1].y;
    g += `<line x1="${Xc(a)}" y1="${Yc(my + slope * (a - mx))}" x2="${Xc(b)}" y2="${Yc(my + slope * (b - mx))}" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.8"/>`;
    if (my > 0) note = `Trend: ${slope >= 0 ? "+" : ""}${(slope * 10 / my * 100).toFixed(0)}% per decade`;
  }
  $("trendNote").textContent = note;
  $("annual").innerHTML = svgEl(W, H, g);
}

function renderValidation() {
  const { K, S: Sr } = S.agg, a = S.meta.miSplit + 1, b = miOf(2025, 11), W = 468, H = 150, x0 = 44, x1 = W - 8, y0 = 10, y1 = H - 22;
  let max = 1, sx = 0, sy = 0, n = 0;
  for (let mi = a; mi <= b; mi++) { max = Math.max(max, K[mi], Sr[mi]); sx += K[mi]; sy += Sr[mi]; n++; }
  if (sy < 200) { $("validation").innerHTML = ""; $("valNote").textContent = "Too few hotspots here to test"; return; }
  const mx = sx / n, my = sy / n;
  let cxy = 0, cxx = 0, cyy = 0;
  for (let mi = a; mi <= b; mi++) { cxy += (K[mi] - mx) * (Sr[mi] - my); cxx += (K[mi] - mx) ** 2; cyy += (Sr[mi] - my) ** 2; }
  const r = cxy / Math.sqrt(cxx * cyy || 1);
  max = niceMax(max);
  const X = mi => x0 + (mi - a) / (b - a) * (x1 - x0), Y = v => y1 - (v / max) * (y1 - y0);
  let g = yAxis(max, x0, x1, y0, y1);
  for (let y = 2013; y <= 2025; y += 2) g += `<text x="${X(miOf(y, 0))}" y="${H - 6}" text-anchor="middle">${y}</text>`;
  const line = (arr, col, w) => { let p = ""; for (let mi = a; mi <= b; mi++) p += `${X(mi)},${Y(arr[mi])} `; return `<polyline points="${p}" fill="none" stroke="${col}" stroke-width="${w}"/>`; };
  g += line(K, "#8791a6", 2) + line(Sr, "#ff8a3d", 1.5);
  $("validation").innerHTML = svgEl(W, H, g);
  $("valNote").textContent = `Match r = ${r.toFixed(2)} · totals differ ${((sx - sy) / sy * 100).toFixed(0)}%`;
}

/* ---------------- downloads ---------------- */
function save(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = () => (S.bbox ? S.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "world");
const header = () => `# HotSpotters (NASA FIRMS MODIS + VIIRS). Area: ${S.name}${S.bbox ? ` [${areaSpec(S.bbox)}]` : ""}. Not a NASA product.\n`;
function dlMonthly() {
  const A = S.agg, st = S.stats;
  if (A.simple) {
    let out = header() + "year,month,hotspots,complete_month\n";
    for (let mi = st.lo; mi <= st.hi; mi++) out += [2000 + Math.floor(mi / 12), mi % 12 + 1, A.H[mi].toFixed(1), isPartial(mi) ? 0 : 1].join(",") + "\n";
    return save(`hotspotters_${slug()}_monthly.csv`, out);
  }
  let out = header() + "# harmonized = MODIS scaled to VIIRS up to Jan 2012, hotspots seen by one VIIRS satellite after\nyear,month,harmonized,source,modis,viirs_merged,viirs_one_satellite,modis_scaled_to_viirs,complete_month\n";
  for (let mi = st.lo; mi <= st.hi; mi++) {
    const post = mi > S.meta.miSplit;
    out += [2000 + Math.floor(mi / 12), mi % 12 + 1, A.H[mi].toFixed(1), post ? "VIIRS" : "MODIS", A.M[mi], post ? A.V[mi] : "", post ? A.S[mi] : "", A.K[mi].toFixed(1), isPartial(mi) ? 0 : 1].join(",") + "\n";
  }
  save(`hotspotters_${slug()}_monthly.csv`, out);
}
function dlCells() {
  if (!S.agg.cells) return;
  const st = S.stats, meta = S.meta, parts = [header() + "# one row per 0.25 degree cell (centre given) and month with at least one hotspot\nlatitude,longitude,year,month,harmonized,modis,viirs_merged,viirs_one_satellite\n"];
  for (const c of S.agg.cells) {
    let chunk = "";
    for (let i = c.i0; i < c.i1; i++) {
      const mi = c.t.mi[i];
      if (mi < st.lo || mi > st.hi) continue;
      const m = c.t.m[i], post = mi > meta.miSplit, h = post ? c.t.s[i] : m * c.k * (mi < meta.miAqua ? c.a : 1);
      chunk += `${c.lat},${c.lon},${2000 + Math.floor(mi / 12)},${mi % 12 + 1},${post ? h : h.toFixed(1)},${m},${post ? c.t.v[i] : ""},${post ? c.t.s[i] : ""}\n`;
    }
    parts.push(chunk);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(parts, { type: "text/csv" })); a.download = `hotspotters_${slug()}_cells.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function dlPng() {
  const st = S.stats, series = S.series, years = [];
  for (let y = S.toY; y >= S.fromY; y--) years.push(y);
  const cw = 54, ch = 26, left = 70, top = 96, W = left + 12 * cw + 110, H = top + years.length * ch + 60;
  const cv = document.createElement("canvas"); cv.width = W * 2; cv.height = H * 2;
  const c = cv.getContext("2d"); c.scale(2, 2);
  c.fillStyle = "#0a0c11"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#e9ebf1"; c.font = "600 20px system-ui, sans-serif"; c.fillText(`Burning activity calendar: ${S.name}`, 20, 34);
  c.fillStyle = "#98a0b3"; c.font = "13px system-ui, sans-serif";
  c.fillText("Fire hotspots per month · satellite detections from NASA FIRMS", 20, 56);
  if (S.bbox) c.fillText(areaText(S.bbox), 20, 74);
  let max = 0;
  for (let mi = st.lo; mi <= st.hi; mi++) if (series[mi] != null && !isPartial(mi)) max = Math.max(max, series[mi]);
  c.textAlign = "center"; MONTHS.forEach((m, i) => c.fillText(m, left + i * cw + cw / 2, top - 8));
  c.fillText("Year", left + 12 * cw + 52, top - 8);
  years.forEach((y, r) => {
    const yy = top + r * ch;
    c.textAlign = "right"; c.fillStyle = "#98a0b3"; c.font = "13px system-ui, sans-serif"; c.fillText(y, left - 10, yy + ch / 2 + 4);
    for (let m = 0; m < 12; m++) {
      const mi = miOf(y, m), v = mi >= st.lo && mi <= st.hi ? series[mi] : null;
      const rgb = v == null ? [22, 26, 34] : v > 0 ? rampAt(RAMP, 0.1 + 0.9 * Math.sqrt(v / (max || 1))) : [20, 24, 33];
      c.fillStyle = css(rgb); c.fillRect(left + m * cw + 1, yy + 1, cw - 2, ch - 2);
      if (v != null) { c.fillStyle = lum(rgb) > 0.55 ? "#111" : "#f2f3f7"; c.textAlign = "center"; c.font = "11px system-ui, sans-serif"; c.fillText(short(v) + (isPartial(mi) ? "*" : ""), left + m * cw + cw / 2, yy + ch / 2 + 4); }
    }
    const yr = st.years.find(q => q.y === y);
    c.fillStyle = "#e9ebf1"; c.textAlign = "right"; c.font = "13px system-ui, sans-serif";
    if (yr && yr.n) c.fillText(fmt(yr.sum) + (yr.complete ? "" : "*"), W - 20, yy + ch / 2 + 4);
  });
  c.textAlign = "left"; c.fillStyle = "#98a0b3"; c.font = "12px system-ui, sans-serif";
  c.fillText("* incomplete month or year. A hotspot is a satellite pixel flagged as burning, not a count of fires. hotspotters.compare", 20, H - 20);
  cv.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `hotspotters_${slug()}.png`; a.click(); });
}

/* ---------------- wiring ---------------- */
function tipFor(target) {
  if (target.dataset && target.dataset.mi) return calTip(+target.dataset.mi);
  return target.dataset ? target.dataset.tip : null;
}
function initUi() {
  const { mi0, mi1 } = S.meta, y0 = 2000 + Math.floor(mi0 / 12), y1 = 2000 + Math.floor(mi1 / 12);
  const opts = (a, b, sel) => { let s = ""; for (let y = a; y <= b; y++) s += `<option${y === sel ? " selected" : ""}>${y}</option>`; return s; };
  S.fromY = y0; S.toY = y1; S.cmpYear = y1;
  $("cmpYear").innerHTML = opts(y0, y1, y1);
  $("layerYear").innerHTML = `<option value="0">All years</option>` + opts(y0, y1, S.layer.year);
  $("layerMonth").innerHTML = `<option value="-1">Whole year</option>` + MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("legendBar").style.background = `linear-gradient(90deg, ${RAMP.slice(1).join(",")})`;

  $("cmpYear").onchange = e => { S.cmpYear = +e.target.value; render(); };
  $("cmpYear2").innerHTML = `<option value="0">Add a year</option>` + opts(y0, y1, -1);
  $("cmpYear2").onchange = e => { S.cmpYear2 = +e.target.value; render(); };
  $("pinBtn").onclick = () => { S.pin = { name: S.name, bbox: S.bbox, z: S.summary }; renderCompare(); };
  $("unpinBtn").onclick = () => { S.pin = null; renderCompare(); };
  $("calSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.cal = b.dataset.cal; [...$("calSeg").children].forEach(x => x.classList.toggle("on", x === b)); render(); };
  $("layerYear").onchange = e => setLayer(+e.target.value, S.layer.month);
  $("layerMonth").onchange = e => setLayer(S.layer.year, +e.target.value);
  $("playBtn").onclick = () => {
    if (S.playing) { clearInterval(S.playing); S.playing = null; $("playBtn").textContent = "Play"; return; }
    $("playBtn").textContent = "Pause";
    if (S.layer.month < 0) setLayer(S.layer.year || y0 + 1, 0);
    S.playing = setInterval(() => {
      let { year, month } = S.layer; month++;
      if (month > 11) { month = 0; year++; }
      if (miOf(year, month) > S.meta.mi1) { year = y0 + 1; month = 0; }
      setLayer(year, month);
    }, 650);
  };
  $("clearChip").onclick = clearArea;
  $("clearBtn").onclick = clearArea;
  $("worldBtn").onclick = () => { S.setTool && S.setTool(null); setArea(null); map.flyTo({ center: [15, 12], zoom: 1.6 }); };
  $("coordShape").onchange = () => { fillCoords(null); $("coordMsg").textContent = ""; };
  $("coords").onsubmit = e => {
    e.preventDefault();
    const num = id => parseFloat($(id).value), msg = t => $("coordMsg").textContent = t;
    if ($("coordShape").value === "circle") {
      const lat = num("clat"), lon = num("clon"), r = num("cr");
      if ([lat, lon, r].some(isNaN)) return msg("Enter a latitude, a longitude and a radius");
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return msg("Latitude is -90 to 90, longitude -180 to 180");
      if (r < MIN_R || r > 5000) return msg(`Radius must be ${MIN_R} to 5,000 km`);
      setArea(circleShape(lon, lat, r), "Your circle", true);
    } else {
      const w = num("cw"), s = num("cs"), ee = num("ce"), n = num("cn");
      if ([w, s, ee, n].some(isNaN)) return msg("Enter all four edges in degrees");
      if (s >= n) return msg("South must be below north");
      if (Math.abs(w) > 180 || Math.abs(ee) > 180) return msg("Longitude is -180 to 180");
      setArea({ kind: "rect", w, s: Math.max(-90, s), e: ee, n: Math.min(90, n) }, "Your rectangle", true);
    }
  };
  $("calendar").onclick = e => { const c = e.target.closest(".c[data-mi]"); if (c) { const mi = +c.dataset.mi; setLayer(2000 + Math.floor(mi / 12), mi % 12); } };
  $("dlMonthly").onclick = dlMonthly; $("dlCells").onclick = dlCells; $("dlPng").onclick = dlPng;
  $("aboutBtn").onclick = () => $("about").showModal();
  // the side panel can be tucked away to give the map the whole width
  const setPanel = open => {
    document.body.classList.toggle("panel-hidden", !open);
    $("panelTab").setAttribute("aria-expanded", open);
    $("panelTab").title = $("panelTab").ariaLabel = open ? "Hide the side panel" : "Show the side panel";
    try { localStorage.setItem("hs-panel", open ? "1" : "0"); } catch { /* private window */ }
    setTimeout(() => map && map.resize(), 30);
  };
  $("panelTab").onclick = () => setPanel(document.body.classList.contains("panel-hidden"));
  try { if (localStorage.getItem("hs-panel") === "0") setPanel(false); } catch { /* fine */ }
  $("shareBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); $("shareBtn").textContent = "Link copied"; }
    catch { $("shareBtn").textContent = "Copy from address bar"; }
    setTimeout(() => $("shareBtn").textContent = "Copy link", 1800);
  };

  const tip = $("tip");
  document.addEventListener("mousemove", e => {
    if (e.target instanceof Element && e.target.closest("#map")) return;   // the map draws its own readout
    const html = e.target instanceof Element ? tipFor(e.target) : null;
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, e.clientX + 14)) + "px";
    tip.style.top = Math.max(8, e.clientY - r.height - 12) + "px";
  });

  const v = S.meta.validation, t = S.meta.totals;
  $("aboutTotals").textContent = `${fmt(t.modis)} MODIS and ${fmt(t.viirs)} VIIRS hotspot detections`;
  $("aboutK").textContent = `${S.meta.kWorld.toFixed(2)} VIIRS hotspots per MODIS hotspot`;
  $("aboutA").textContent = S.meta.aWorld.toFixed(2);
  $("aboutVal").textContent = `Over ${v.overlap}, scaled MODIS and VIIRS agree with r = ${v.worldMonthR.toFixed(3)} month by month for the world and r = ${v.regionYearR.toFixed(3)} across all regions and years; yearly world totals differ by ${(v.worldYearMape * 100).toFixed(1)}% on average (worst year ${(v.worldYearWorst * 100).toFixed(1)}%).`;
}

async function main() {
  S.meta = await (await fetch("data/meta.json")).json();
  S.tileSet = new Set(S.meta.tiles);
  fetch("data/fine2.json").then(r => r.ok ? r.json() : null).then(ix => {
    if (!ix) return;
    const f1 = {};
    for (const y in ix.f1) f1[y] = new Set(ix.f1[y]);
    FINE.index = { f1, f3: new Set(ix.f3) };
    updateFine();
  }).catch(() => {});
  initUi();
  S.agg = worldAgg(); render();
  await initMap();
  initDraw();
  initHover();
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  drawLayer();
  const m = /bbox=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/.exec(location.hash), c = /circle=([-\d.]+),([-\d.]+),([-\d.]+)/.exec(location.hash);
  if (m) setArea({ kind: "rect", w: +m[1], s: +m[2], e: +m[3], n: +m[4] }, "Your rectangle", true);
  else if (c) setArea(circleShape(+c[1], +c[2], Math.max(MIN_R, +c[3])), "Your circle", true);
  else if (/place=/.test(location.hash) && window.Copilot) Copilot.openPlace(decodeURIComponent(/place=([^&]+)/.exec(location.hash)[1]));
  else {
    const p = /poly=([-\d.,;]+)/.exec(location.hash);
    const pts = p ? p[1].split(";").map(q => q.split(",").map(Number)).filter(q => q.length === 2 && q.every(isFinite)) : [];
    if (pts.length >= 3) setArea(polyShape(pts), "Your shape", true);
  }
}
main().catch(err => { document.getElementById("loadState").textContent = "Could not start: " + err.message; console.error(err); });
