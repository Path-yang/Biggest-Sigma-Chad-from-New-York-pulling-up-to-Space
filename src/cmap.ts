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
const INK = "#1b1b1b";

type Feature = { type: "Feature"; properties: Record<string, number>; geometry: { type: string; coordinates: unknown } };
type Collection = { type: "FeatureCollection"; features: Feature[] };
export interface MapData {
  cells: Collection;
  outline: Collection;
  /** [west, south, east, north], unwrapped */
  bounds: [number, number, number, number];
  /** lower edges of classes 2 to 7 */
  breaks: number[];
  max: number;
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
/** a round number near v: 1, 2, 5, 10, 20, 50 ... */
function nice(v: number) {
  if (v < 1) return Math.round(v * 10) / 10 || 0.1;
  const p = Math.pow(10, Math.floor(Math.log10(v))),
    f = v / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
/** seven classes on a log scale between the smallest and largest square, at round numbers */
function classBreaks(vals: number[]) {
  const pos = vals.filter(v => v > 0);
  if (!pos.length) return { breaks: [], max: 0 };
  const max = Math.max(...pos),
    lo = Math.max(1, Math.min(...pos)),
    out: number[] = [];
  if (max <= lo) return { breaks: [], max };
  for (let i = 1; i < 7; i++) {
    const b = nice(Math.exp(Math.log(lo) + ((Math.log(max) - Math.log(lo)) * i) / 7));
    if (b > (out[out.length - 1] ?? 0) && b < max) out.push(b);
  }
  return { breaks: out, max };
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
  /* at least half a degree each way, so a tiny country keeps some surroundings */
  const padX = Math.max(0, 0.5 - (x1 - x0)) / 2,
    padY = Math.max(0, 0.5 - (y1 - y0)) / 2;
  const { breaks, max } = classBreaks(cells.map(f => f.properties.n));
  return {
    cells: { type: "FeatureCollection", features: cells },
    outline: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }],
    },
    bounds: [x0 - padX, Math.max(-85, y0 - padY), x1 + padX, Math.min(85, y1 + padY)],
    breaks,
    max,
    n: cells.length,
  };
}

/** the MapLibre step expression for the classes; with no breaks every square gets the middle colour */
function fillExpr(breaks: number[]) {
  if (!breaks.length) return FIRE[3];
  /* spread the colours over however many classes there are, darkest always at the top */
  const cols = breaks.length + 1,
    pick = (i: number) => FIRE[Math.round((i * (FIRE.length - 1)) / Math.max(1, cols - 1))],
    e: unknown[] = ["step", ["get", "n"], pick(0)];
  breaks.forEach((b, i) => e.push(b, pick(i + 1)));
  return e;
}
export const classColours = (breaks: number[]) => {
  const cols = breaks.length + 1;
  return Array.from({ length: cols }, (_, i) => FIRE[Math.round((i * (FIRE.length - 1)) / Math.max(1, cols - 1))]);
};

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
}
let L: Live | null = null;

export function destroyMap() {
  if (!L) return;
  try {
    L.map.remove();
  } catch {
    /* already gone */
  }
  L = null;
}
const deg = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v < 0 ? n : p}`;
function popupHtml(p: Record<string, number>, cell: number, yFrom: number, yTo: number) {
  const n = p.n;
  return (
    `<b>${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}</b> <span>in ${yFrom}–${yTo}, in VIIRS terms</span>` +
    `<span>Raw: ${fmt(p.mo)} MODIS, ${fmt(p.vi)} Suomi NPP</span>` +
    `<span class="pos">${deg(p.s, "N", "S")}–${deg(p.s + cell, "N", "S")}, ${deg(p.w, "E", "W")}–${deg(p.w + cell, "E", "W")}</span>`
  );
}

/** draw (or redraw) the map for this country and these years; onFail says why there is no map */
export function showMap(host: HTMLElement, d: CountrySummary, data: MapData, yFrom: number, yTo: number, onFail: (why: string) => void) {
  const ml = window.maplibregl;
  if (!ml) return onFail("The map library did not load.");
  const fresh = !L || L.k !== d.country;
  if (fresh) {
    destroyMap();
    host.innerHTML = "";
    let map: any;
    try {
      map = new ml.Map({
        container: host,
        style: STYLE,
        bounds: [data.bounds.slice(0, 2), data.bounds.slice(2)],
        fitBoundsOptions: { padding: 28 },
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
      return onFail("This browser could not start the map (WebGL is off or unavailable).");
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ml.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    const live: Live = (L = {
      map,
      popup: new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 }),
      k: d.country,
      ready: false,
      next: data,
      hover: null,
      yFrom,
      yTo,
    });
    map.on("error", (e: { error?: Error }) => {
      if (!live.ready && L === live) onFail(`The basemap could not load${e.error?.message ? ` (${e.error.message})` : ""}.`);
    });
    map.on("load", () => {
      if (L !== live) return;
      /* our layers go under the borders and place names, so the map reads as a map and not as a heatmap */
      const under = map.getLayer("boundary_3") ? "boundary_3" : undefined,
        labels = map.getLayer("waterway_line_label") ? "waterway_line_label" : undefined;
      map.addSource("cells", { type: "geojson", data: live.next!.cells, tolerance: 0, buffer: 2, generateId: true });
      map.addSource("outline", { type: "geojson", data: live.next!.outline });
      map.addLayer(
        {
          id: "cells",
          type: "fill",
          source: "cells",
          paint: { "fill-color": fillExpr(live.next!.breaks), "fill-opacity": 0.88, "fill-antialias": false },
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
      /* start with the attribution folded to its (i) button; it opens on a tap */
      host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
    });
    return;
  }
  const live = L!;
  live.yFrom = yFrom;
  live.yTo = yTo;
  if (!live.ready) {
    live.next = data;
    return;
  }
  live.popup.remove();
  live.hover = null;
  live.map.getSource("cells").setData(data.cells);
  live.map.setPaintProperty("cells", "fill-color", fillExpr(data.breaks));
}
/** the map needs telling when its box changes size while it was hidden */
export const resizeMap = () => L?.map.resize();
