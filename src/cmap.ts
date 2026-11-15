import type { CountrySummary } from "./types";
import { fmt } from "./util";
import { cutEdge, near, shapeOf } from "./world";

/* =====================================================================
   COUNTRY MAP: the grid squares on a MapLibre map over the OpenFreeMap "positron" basemap.
   Longitudes are unwrapped around the country's label point, so a country across the antimeridian (Fiji, Russia,
   the Aleutians) is drawn and framed in one piece.
   ===================================================================== */
const STYLE = "https://tiles.openfreemap.org/styles/positron";
/** ColorBrewer YlOrRd without its two palest steps, which vanish on the grey basemap */
export const FIRE = ["#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
/** the colours for however many classes there are, spread over the ramp with the darkest always at the top */
export function classColours(breaks: number[], ramp = FIRE) {
  if (!breaks.length) return [ramp[3]];
  const cols = breaks.length + 1;
  return Array.from({ length: cols }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (cols - 1))]);
}
const INK = "#1b1b1b";

type Feature = { type: "Feature"; properties: Record<string, number>; geometry: { type: string; coordinates: unknown } };
type Collection = { type: "FeatureCollection"; features: Feature[] };
export interface MapData {
  cells: Collection;
  outline: Collection;
  /** [west, south, east, north], unwrapped: where the fire is, which the map opens on */
  bounds: [number, number, number, number];
  /** the whole country with every burning square, for "show all" */
  all: [number, number, number, number];
  /** true when the opening frame leaves out part of the country */
  cropped: boolean;
  /** lower edges of classes 2 to 7 */
  breaks: number[];
  max: number;
  min: number;
  n: number;
}

/** the [lat_index, lon_index] of every cell. Files built before the fix of 14 November 2026 wrote a cell west of
    Greenwich as lat - 1, lon + 100000; undo that if it ever arrives. Correct files pass unchanged. */
function cellIndexes(d: CountrySummary) {
  const n = d.cells.length / 2,
    la = new Int32Array(n),
    lo = new Int32Array(n),
    lim = 180 / d.cell + 1;
  for (let c = 0; c < n; c++) {
    la[c] = d.cells[2 * c];
    lo[c] = d.cells[2 * c + 1];
    if (lo[c] > lim) {
      lo[c] -= 100000;
      la[c] += 1;
    }
  }
  return { la, lo };
}
/** a round number near v: 1, 2, 3, 5, 10, 20, 30, 50 ... */
export function nice(v: number) {
  if (v < 1) return Math.round(v * 10) / 10 || 0.1;
  const p = Math.pow(10, Math.floor(Math.log10(v))),
    f = v / p;
  return (f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7.5 ? 5 : 10) * p;
}
/** where the class edges sit, as shares of the values: wide at the bottom, narrow at the top, so the dark classes
    pick out the few places (or months) that hold most of the fire */
const PROBS = [0.25, 0.45, 0.62, 0.76, 0.87, 0.95];
/** up to seven classes from quantiles of the values, at round numbers */
export function classBreaks(vals: number[]) {
  const pos = vals.filter(v => v > 0).sort((a, b) => a - b);
  if (!pos.length) return { breaks: [] as number[], max: 0, min: 0 };
  const max = pos[pos.length - 1],
    min = pos[0],
    out: number[] = [];
  for (const q of PROBS) {
    const b = nice(pos[Math.floor(q * (pos.length - 1))]);
    if (b > (out.length ? out[out.length - 1] : min) && b < max) out.push(b);
  }
  return { breaks: out, max, min };
}

/** at least half a degree each way, so a tiny country keeps some surroundings */
function pad(b: number[]): [number, number, number, number] {
  const px = Math.max(0, 0.5 - (b[2] - b[0])) / 2,
    py = Math.max(0, 0.5 - (b[3] - b[1])) / 2;
  return [b[0] - px, Math.max(-85, b[1] - py), b[2] + px, Math.min(85, b[3] + py)];
}

export function mapData(d: CountrySummary, yFrom: number, yTo: number): MapData {
  const shape = shapeOf(d.country),
    cell = d.cell,
    nc = d.cells.length / 2,
    { la, lo } = cellIndexes(d),
    tot = new Float64Array(nc),
    modis = new Float64Array(nc),
    viirs = new Float64Array(nc);
  for (let p = 0; p < d.cell_rows.length; p += 5) {
    const y = d.y0 + d.cell_rows[p + 1];
    if (y < yFrom || y > yTo) continue;
    const c = d.cell_rows[p];
    tot[c] += d.cell_rows[p + 2];
    modis[c] += d.cell_rows[p + 3];
    viirs[c] += d.cell_rows[p + 4];
  }
  /* the centre longitude everything is unwrapped around: the label point, else the median square */
  let lon0 = shape ? shape.c[0] : (d.bbox[0] + d.bbox[2]) / 2;
  if (!shape && nc) {
    const ls = Array.from(lo, v => v * cell).sort((a, b) => a - b);
    lon0 = ls[Math.floor(ls.length / 2)];
  }
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  const cells: Feature[] = [];
  for (let c = 0; c < nc; c++) {
    if (tot[c] + modis[c] + viirs[c] <= 0) continue;
    const s = la[c] * cell,
      w = near(lo[c] * cell + cell / 2, lon0) - cell / 2,
      e = w + cell,
      n = s + cell;
    grow(w, s);
    grow(e, n);
    cells.push({
      type: "Feature",
      properties: { n: tot[c], mo: modis[c], vi: viirs[c], s, w: lo[c] * cell },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    });
  }
  /* the outline, without the edges that only exist because a shape was cut at the antimeridian */
  const lines: number[][][] = [];
  if (shape)
    for (const r of shape.r) {
      const off = near(r[0], lon0) - r[0];
      let run: number[][] = [];
      const flush = () => {
        if (run.length > 1) lines.push(run);
        run = [];
      };
      for (let i = 0; i + 3 < r.length; i += 2) {
        if (cutEdge(d.country, r[i], r[i + 1], r[i + 2], r[i + 3])) {
          flush();
          continue;
        }
        if (!run.length) run.push([r[i] + off, r[i + 1]]);
        run.push([r[i + 2] + off, r[i + 3]]);
        grow(r[i] + off, r[i + 1]);
      }
      flush();
    }
  if (!isFinite(x0)) {
    grow(near(d.bbox[0], lon0), d.bbox[1]);
    grow(near(d.bbox[2], lon0), d.bbox[3]);
  }
  const all = pad([x0, y0, x1, y1]);
  /* open on the fire, not the outline: the hotspot-weighted 1st to 99th percentile of the squares' edges, so
     Hawaii and the Aleutians do not shrink the lower 48 to a corner. Zooming out still shows every square. */
  let bounds = all;
  if (cells.length) {
    const wt = cells.map(f => Math.max(f.properties.n, 0.01)),
      sum = wt.reduce((a, b) => a + b, 0),
      at = (key: (i: number) => number, q: number) => {
        const idx = cells.map((_, i) => i).sort((a, b) => key(a) - key(b));
        let acc = 0;
        for (const i of idx) {
          acc += wt[i];
          if (acc >= q * sum) return key(i);
        }
        return key(idx[idx.length - 1]);
      },
      edge = (i: number, k: 0 | 1) => (cells[i].geometry.coordinates as number[][][])[0][k * 2],
      w = at(i => edge(i, 0)[0], 0.01),
      s0 = at(i => edge(i, 0)[1], 0.01),
      e = at(i => edge(i, 1)[0], 0.99),
      n = at(i => edge(i, 1)[1], 0.99),
      dx = (e - w) * 0.06,
      dy = (n - s0) * 0.06;
    bounds = pad([w - dx, s0 - dy, e + dx, n + dy]);
  }
  /* crop a side only when that gains real room (the Aleutians); otherwise keep the country's own edge there, so
     squares on a quiet border are not cut off */
  const dw = all[2] - all[0],
    dh = all[3] - all[1],
    keep = (i: number, d: number) => (Math.abs(all[i] - bounds[i]) < 0.15 * d ? all[i] : bounds[i]);
  bounds = [keep(0, dw), keep(1, dh), keep(2, dw), keep(3, dh)];
  const cropped = bounds.some((b, i) => b !== all[i]);
  const { breaks, max, min } = classBreaks(cells.map(f => f.properties.n));
  return {
    cells: { type: "FeatureCollection", features: cells },
    outline: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }],
    },
    bounds,
    all,
    cropped,
    min,
    breaks,
    max,
    n: cells.length,
  };
}

/** the MapLibre step expression for the classes */
function fillExpr(breaks: number[]) {
  const c = classColours(breaks);
  if (!breaks.length) return c[0];
  const e: unknown[] = ["step", ["get", "n"], c[0]];
  breaks.forEach((b, i) => e.push(b, c[i + 1]));
  return e;
}

/* ---------- the one live map ---------- */
interface Live {
  // MapLibre's Map and Popup; typed loosely because the library's types are not installed
  map: any;
  popup: any;
  k: string;
  ready: boolean;
  next: MapData | null;
  hover: number | null;
  yFrom: number;
  yTo: number;
  all: [number, number, number, number];
}
let L: Live | null = null;
/** called with the map each time a country's map has its squares on: the area tools add their layers then */
const readyFns: ((map: any) => void)[] = [];
export const onMapReady = (f: (map: any) => void) => readyFns.push(f);
/** close the square popup, e.g. when a drawing on the map starts or ends */
export const hideCellPopup = () => L?.popup?.remove();

export function destroyMap() {
  if (!L) return;
  try {
    L.map?.remove();
  } catch {
    /* already gone */
  }
  L = null;
}
const deg = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v < 0 ? n : p}`;
function popupHtml(p: Record<string, number>, cell: number, yFrom: number, yTo: number) {
  const n = p.n;
  return (
    `<b>${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}</b> <span>in ${yFrom === yTo ? yFrom : `${yFrom}–${yTo}`}, adjusted</span>` +
    `<span>Raw: ${fmt(p.mo)} MODIS, ${fmt(p.vi)} Suomi NPP</span>` +
    `<span class="pos">${deg(p.s, "N", "S")}–${deg(p.s + cell, "N", "S")}, ${deg(p.w, "E", "W")}–${deg(p.w + cell, "E", "W")}</span>`
  );
}

/* ---------- the basemap style ---------- */
const PAPER = "#f5f4f0",
  WATER = "#dde5ea";
/** a plain style for when OpenFreeMap does not answer: the squares and outline still draw on paper */
const FALLBACK = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eeebe4" } }] };
/** labels we do not need at country scale; dropping them also saves their glyph downloads */
const DROP = /^(highway-name|highway-shield|road_shield|airport|waterway_line_label)/;
/** Latin names only. Positron writes every label as "latin nonlatin", which pulls Cyrillic, Arabic, Ethiopic and
    more glyph ranges in three weights: about 1 MB per country, for labels that are only there for orientation. */
const LATIN = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
// the style JSON is loosely typed because MapLibre's types are not installed
function tidyStyle(st: any) {
  st.layers = st.layers
    .filter((l: any) => !DROP.test(l.id))
    .map((l: any) => {
      if (l.id === "background") l.paint = { ...l.paint, "background-color": PAPER };
      if (l.id === "water") l.paint = { ...l.paint, "fill-color": WATER };
      if (l.id === "waterway") l.paint = { ...l.paint, "line-color": WATER };
      if (l.layout && l.layout["text-field"] && /name/.test(JSON.stringify(l.layout["text-field"])))
        l.layout = { ...l.layout, "text-field": LATIN };
      return l;
    });
  return st;
}
let styleP: Promise<unknown> | null = null;
/** OpenFreeMap's positron, tidied; the plain style if it does not arrive within 8 seconds */
function getStyle(): Promise<unknown> {
  if (!styleP)
    styleP = Promise.race([
      fetch(STYLE).then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000)),
    ]).then(tidyStyle, () => {
      styleP = null;
      return FALLBACK;
    });
  return styleP;
}

/** draw (or redraw) the map for this country and these years; onFail says why there is no map, onBasemap that the
    basemap is missing but the squares are there */
export function showMap(
  host: HTMLElement,
  d: CountrySummary,
  data: MapData,
  yFrom: number,
  yTo: number,
  onFail: (why: string) => void,
  onBasemap: () => void,
) {
  const ml = window.maplibregl;
  if (!ml) return onFail("The map library did not load.");
  const fresh = !L || L.k !== d.country;
  if (fresh) {
    destroyMap();
    const k = d.country;
    const live: Live = (L = {
      map: null,
      popup: null,
      k,
      ready: false,
      next: data,
      hover: null,
      yFrom,
      yTo,
      all: data.all,
    });
    getStyle().then(style => {
      if (L !== live) return;
      if (style === FALLBACK) onBasemap();
      start(host, d, live, style, onFail, onBasemap);
    });
    return;
  }
  const live = L!;
  live.yFrom = yFrom;
  live.yTo = yTo;
  live.all = data.all;
  if (!live.ready) {
    live.next = data;
    return;
  }
  live.popup.remove();
  live.hover = null;
  live.map.getSource("cells").setData(data.cells);
  for (const id of ["cells", "cells-edge"])
    if (live.map.getLayer(id)) live.map.setPaintProperty(id, id === "cells" ? "fill-color" : "line-color", fillExpr(data.breaks));
}
/** zoom out to the whole country */
export function fitAll() {
  if (!L || !L.map) return;
  const b = L.all;
  L.map.fitBounds([b.slice(0, 2), b.slice(2)], { padding: 24, duration: 600 });
}

function start(host: HTMLElement, d: CountrySummary, live: Live, style: unknown, onFail: (why: string) => void, onBasemap: () => void) {
  const ml = window.maplibregl,
    data = live.next!;
  host.innerHTML = "";
  let map: any;
  try {
    map = new ml.Map({
      container: host,
      style,
      bounds: [data.bounds.slice(0, 2), data.bounds.slice(2)],
      fitBoundsOptions: { padding: host.clientWidth < 560 ? 12 : 28 },
      maxZoom: 11,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: true,
      attributionControl: { compact: true },
      renderWorldCopies: true,
      fadeDuration: 0,
    });
  } catch (e) {
    L = null;
    return onFail("This browser could not start the map (WebGL is off or unavailable).");
  }
  live.map = map;
  /* for tests and debugging in the console */
  (host as HTMLElement & { _map?: unknown })._map = map;
  live.popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 });
  map.touchZoomRotate.disableRotation();
  map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new ml.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
  /* a basemap file that fails (sprite, tiles, glyphs) costs only the basemap; the squares do not need it. If the
     style itself never finishes loading, swap in the plain one once. */
  let swapped = style === FALLBACK;
  const swap = () => {
    if (swapped || live.ready || L !== live) return;
    swapped = true;
    onBasemap();
    map.setStyle(FALLBACK);
  };
  map.on("error", (e: { sourceId?: string; tile?: unknown }) => {
    /* the vector source's own description (TileJSON) failed: the land and sea will not draw */
    if (e.sourceId && e.sourceId !== "cells" && e.sourceId !== "outline" && !e.tile) onBasemap();
    setTimeout(swap, 4000);
  });
  map.on("style.load", () => {
    if (L !== live || live.ready) return;
    addLayers(map, d, live);
  });
}

function addLayers(map: any, d: CountrySummary, live: Live) {
  const data = live.next!;
  /* our layers go under the borders and place names, so the map reads as a map and not as a heatmap */
  const under = map.getLayer("boundary_3") ? "boundary_3" : undefined,
    labels = map.getLayer("water_name_point_label") ? "water_name_point_label" : undefined;
  map.addSource("cells", { type: "geojson", data: data.cells, tolerance: 0, buffer: 2, generateId: true });
  map.addSource("outline", { type: "geojson", data: data.outline });
  map.addLayer(
    {
      id: "cells",
      type: "fill",
      source: "cells",
      paint: { "fill-color": fillExpr(data.breaks), "fill-opacity": 0.9, "fill-antialias": false },
    },
    under,
  );
  /* a few squares scattered over a lot of sea (atolls, island chains) would be specks at the opening zoom; a
     stroke in the same colour gives each a minimum size, and fades once the squares are big enough to see */
  if (data.n < 400)
    map.addLayer(
      {
        id: "cells-edge",
        type: "line",
        source: "cells",
        paint: {
          "line-color": fillExpr(data.breaks),
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 7, 1.5, 9, 0],
        },
      },
      under,
    );
  map.addLayer(
    {
      id: "cells-hover",
      type: "line",
      source: "cells",
      paint: { "line-color": INK, "line-width": 1.5, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] },
    },
    labels,
  );
  map.addLayer(
    { id: "outline", type: "line", source: "outline", paint: { "line-color": INK, "line-width": 1.1, "line-opacity": 0.75 } },
    labels,
  );
  live.ready = true;
  live.next = null;
  for (const f of readyFns) f(map);
  const host = map.getContainer() as HTMLElement;
  /* start with the attribution folded to its (i) button; it opens on a tap */
  const fold = () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  fold();
  map.once("idle", fold);
  const clear = () => {
    if (live.hover != null) map.setFeatureState({ source: "cells", id: live.hover }, { hover: false });
    live.hover = null;
  };
  const show = (e: { features?: { id: number; properties: Record<string, number> }[]; lngLat: unknown }) => {
    const f = e.features && e.features[0];
    if (!f) return;
    if (live.hover !== f.id) {
      clear();
      live.hover = f.id;
      map.setFeatureState({ source: "cells", id: f.id }, { hover: true });
    }
    map.getCanvas().style.cursor = "default";
    live.popup
      .setLngLat(e.lngLat)
      .setHTML(popupHtml(f.properties, d.cell, live.yFrom, live.yTo))
      .addTo(map);
  };
  map.on("mousemove", "cells", show);
  map.on("click", "cells", show);
  map.on("mouseleave", "cells", () => {
    clear();
    live.popup.remove();
    map.getCanvas().style.cursor = "";
  });
  map.on("click", (e: { point: unknown }) => {
    if (!map.queryRenderedFeatures(e.point, { layers: ["cells"] }).length) {
      clear();
      live.popup.remove();
    }
  });
}
/** the map needs telling when its box changes size while it was hidden */
export const resizeMap = () => L?.map?.resize();
