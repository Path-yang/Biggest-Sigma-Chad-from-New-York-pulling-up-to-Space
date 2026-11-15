import type { CountrySummary } from "./types";
import { cellIndexes, centreLon, mapData } from "./cmap";
import { cutEdge, near, shapeOf } from "./world";

/* =====================================================================
   SMALL COUNTRY MAPS for the forecast and fire-station sections: the country's outline and its grid squares,
   drawn flat in SVG like the 14-day outlook's map. No basemap and no WebGL, so they cost almost nothing next to the
   main MapLibre map. Squares of one colour are drawn as one path, so Canada's 13,000 squares stay light; the
   square under the pointer is found from the pointer's position.
   ===================================================================== */
export interface MiniLayer {
  fill: string;
  /** cell indices into summary/v2 `cells` */
  cells: number[];
  /** a stroke in the fill colour, so a 0.1° square on a big country is still a visible dot */
  edge?: boolean;
}
export interface MiniMark {
  c: number;
  label: string;
  title: string;
}
export interface MiniOptions {
  layers: MiniLayer[];
  /** [lon, lat] dots drawn over the squares (fire stations) */
  points?: number[][];
  /** numbered markers on cells */
  marks?: MiniMark[];
  label: string;
  /** caption for the square under the pointer; null when nothing worth saying is there */
  pick: (c: number) => string | null;
  caption: HTMLElement;
  idle: string;
}

const S = 10;
const r1 = (v: number) => Math.round(v * 100) / 100;
const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const coarse = () => matchMedia("(pointer: coarse)").matches;

/** the geometry every mini map of one country shares */
interface Frame {
  la: Int32Array;
  lo: Int32Array;
  lon0: number;
  kx: number;
  bounds: [number, number, number, number];
  key: Map<number, number>;
}
const FRAMES = new WeakMap<CountrySummary, Frame>();
const keyOf = (la: number, lo: number) => (la + 4000) * 20000 + (lo + 8000);
function frameOf(d: CountrySummary): Frame {
  const had = FRAMES.get(d);
  if (had) return had;
  const { la, lo } = cellIndexes(d),
    lon0 = centreLon(d, lo),
    md = mapData(d, d.y0, d.y1),
    area = (b: number[]) => Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1])),
    /* the whole country, unless far-off islands (the Aleutians, overseas departments) would shrink it to a corner */
    bounds = area(md.all) > 4 * area(md.bounds) ? md.bounds : md.all,
    kx = Math.max(0.2, Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180)),
    key = new Map<number, number>();
  for (let c = 0; c < la.length; c++) key.set(keyOf(la[c], lo[c]), c);
  const f = { la, lo, lon0, kx, bounds, key };
  FRAMES.set(d, f);
  return f;
}
/** the centre of a cell, (lat, lon) with lon in -180..180 */
export function cellCentre(d: CountrySummary, c: number): [number, number] {
  const f = frameOf(d);
  return [(f.la[c] + 0.5) * d.cell, near((f.lo[c] + 0.5) * d.cell, 0)];
}

/** draw the map into host; returns its width over its height */
export function drawMini(host: HTMLElement, d: CountrySummary, o: MiniOptions): number {
  const F = frameOf(d),
    cell = d.cell,
    X = (lonU: number) => (lonU - F.lon0) * F.kx * S,
    Y = (lat: number) => -lat * S,
    west = (c: number) => near(F.lo[c] * cell + cell / 2, F.lon0) - cell / 2;
  /* the frame: where the fire is (as the main map opens), widened to hold every marked square */
  let [x0, y0, x1, y1] = [X(F.bounds[0]), Y(F.bounds[3]), X(F.bounds[2]), Y(F.bounds[1])];
  for (const m of o.marks || []) {
    const w = west(m.c),
      s = F.la[m.c] * cell;
    x0 = Math.min(x0, X(w));
    x1 = Math.max(x1, X(w + cell));
    y0 = Math.min(y0, Y(s + cell));
    y1 = Math.max(y1, Y(s));
  }
  const pad = 0.04 * Math.max(x1 - x0, y1 - y0) + 2;
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  const vw = x1 - x0,
    vh = y1 - y0;
  /* the outline: land as one filled path, borders as lines without the antimeridian cuts */
  const shape = shapeOf(d.country);
  let land = "",
    lines = "";
  if (shape)
    for (const r of shape.r) {
      const off = near(r[0], F.lon0) - r[0];
      land += "M";
      for (let i = 0; i < r.length; i += 2) land += `${r1(X(r[i] + off))},${r1(Y(r[i + 1]))} `;
      land += "Z";
      for (let i = 0; i + 3 < r.length; i += 2) {
        if (cutEdge(d.country, r[i], r[i + 1], r[i + 2], r[i + 3])) continue;
        lines += `M${r1(X(r[i] + off))},${r1(Y(r[i + 1]))}L${r1(X(r[i + 2] + off))},${r1(Y(r[i + 3]))}`;
      }
    }
  const cw = r1(cell * F.kx * S),
    ch = r1(cell * S),
    layers = o.layers
      .filter(l => l.cells.length)
      .map(l => {
        let p = "";
        for (const c of l.cells) p += `M${r1(X(west(c)))},${r1(Y(F.la[c] * cell + cell))}h${cw}v${ch}h${-cw}z`;
        return `<path d="${p}" fill="${l.fill}"${l.edge ? ` stroke="${l.fill}" stroke-width="1.6" vector-effect="non-scaling-stroke"` : ""}/>`;
      })
      .join("");
  let dots = "";
  for (const [lon, lat] of o.points || []) dots += `M${r1(X(near(lon, F.lon0)))},${r1(Y(lat))}h0`;
  host.innerHTML =
    `<div class="cpMiniBox" style="max-width:min(100%,${Math.max(160, Math.round((520 * vw) / vh))}px)">` +
    `<svg viewBox="${r1(x0)} ${r1(y0)} ${r1(vw)} ${r1(vh)}" role="img" aria-label="${esc(o.label)}">` +
    `<path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/>` +
    layers +
    `<path d="${lines}" fill="none" stroke="#1b1b1b" stroke-opacity=".7" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    (dots
      ? `<path d="${dots}" fill="none" stroke="#fffefa" stroke-width="4.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `<path d="${dots}" fill="none" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
      : "") +
    `<rect class="cpMiniOn" width="${cw}" height="${ch}" fill="none" stroke="#1b1b1b" stroke-width="2" vector-effect="non-scaling-stroke" visibility="hidden"/>` +
    `</svg>` +
    (o.marks || [])
      .map(m => {
        const x = X(west(m.c) + cell / 2),
          y = Y(F.la[m.c] * cell + cell / 2);
        return `<span class="cpMiniMark" style="left:${(((x - x0) / vw) * 100).toFixed(2)}%;top:${(((y - y0) / vh) * 100).toFixed(2)}%" title="${esc(m.title)}">${esc(m.label)}</span>`;
      })
      .join("") +
    `</div>`;
  const svg = host.querySelector("svg")!,
    on = svg.querySelector<SVGRectElement>(".cpMiniOn")!;
  o.caption.innerHTML = o.idle;
  const at = (e: PointerEvent | MouseEvent) => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()),
      lon = near(p.x / (F.kx * S) + F.lon0, 0),
      lat = -p.y / S;
    return F.key.get(keyOf(Math.floor(lat / cell), Math.floor(lon / cell))) ?? null;
  };
  let shown: number | null = null;
  const show = (e: PointerEvent | MouseEvent) => {
    const c = at(e),
      text = c == null ? null : o.pick(c);
    if (c === shown) return;
    if (c == null || text == null) {
      if (e.type === "click" || !coarse()) {
        shown = null;
        on.setAttribute("visibility", "hidden");
        o.caption.innerHTML = o.idle;
      }
      return;
    }
    shown = c;
    on.setAttribute("x", String(r1(X(west(c)))));
    on.setAttribute("y", String(r1(Y(F.la[c] * cell + cell))));
    on.setAttribute("visibility", "visible");
    o.caption.innerHTML = text;
  };
  svg.onpointermove = show;
  svg.onclick = show;
  svg.onpointerleave = () => {
    if (coarse()) return;
    shown = null;
    on.setAttribute("visibility", "hidden");
    o.caption.innerHTML = o.idle;
  };
  return vw / vh;
}
