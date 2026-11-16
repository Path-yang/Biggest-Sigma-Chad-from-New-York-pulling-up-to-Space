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
  /** drawn over the station dots where they are dense, so what matters most stays visible */
  over?: boolean;
}
export interface MiniMark {
  c: number;
  label: string;
  title: string;
  muted?: boolean;
  /** never left off for want of room on a narrow screen (a mark that carries a warning) */
  keep?: boolean;
}
export interface MiniOptions {
  layers: MiniLayer[];
  /** [lon, lat] dots drawn over the squares (fire stations) */
  points?: number[][];
  /** [lon, lat] dots of a second, less sure kind, drawn as rings in their own colour under `points` */
  others?: { points: number[][]; color: string };
  /** numbered markers on cells */
  marks?: MiniMark[];
  label: string;
  /** caption for the square under the pointer; null when nothing worth saying is there */
  pick: (c: number) => string | null;
  caption: HTMLElement;
  idle: string;
}
export interface MiniResult {
  aspect: number;
  /** marks folded into a nearby mark's "+n", because they sat on it */
  folded: string[];
  /** marks left off on a narrow screen */
  cut: string[];
  /** a square's width on screen, in CSS pixels */
  cellPx: number;
}

const S = 10;
/** the tallest a map is drawn, in CSS pixels */
const MAX_H = 440;
/** more station dots than this are drawn small and see-through, or they bury the squares */
export const DENSE = 800;
/** numbered markers closer than this, in CSS pixels, would hide each other */
const MARK_GAP = 16;
/** a phone: only the first five marks are drawn */
const NARROW = 500;
const MAX_NARROW_MARKS = 5;
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

/** draw the map into host; returns its width over its height, and which marks were folded or left off */
export function drawMini(host: HTMLElement, d: CountrySummary, o: MiniOptions): MiniResult {
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
  /* the box's width on screen, so that squares and markers can be sized in pixels */
  const maxW = Math.max(160, Math.round((MAX_H * vw) / vh)),
    boxW = Math.min(maxW, host.clientWidth > 40 ? host.clientWidth - 16 : maxW),
    boxH = (boxW * vh) / vw;
  const cw = r1(cell * F.kx * S),
    ch = r1(cell * S),
    cellPx = (cell * F.kx * S * boxW) / vw,
    pts = o.points || [],
    oth = o.others?.points || [],
    dense = pts.length + oth.length > DENSE,
    paint = (ls: MiniLayer[]) =>
      ls
        .filter(l => l.cells.length)
        .map(l => {
          let p = "";
          for (const c of l.cells) p += `M${r1(X(west(c)))},${r1(Y(F.la[c] * cell + cell))}h${cw}v${ch}h${-cw}z`;
          return `<path d="${p}" fill="${l.fill}"${l.edge ? ` stroke="${l.fill}" stroke-width="1.6" vector-effect="non-scaling-stroke"` : ""}/>`;
        })
        .join("");
  const dotPath = (ps: number[][]) => {
      let p = "";
      for (const [lon, lat] of ps) p += `M${r1(X(near(lon, F.lon0)))},${r1(Y(lat))}h0`;
      return p;
    },
    line = (p: string, color: string, w: number, op = "") =>
      `<path d="${p}" fill="none" stroke="${color}"${op ? ` stroke-opacity="${op}"` : ""} stroke-width="${w}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
    /* stations: a dark dot with a pale halo; the second kind a ring in its own colour, so the two differ in shape
       as well as colour; where they are dense, small see-through dots of each colour */
    dots = (p: string, color: string, ring = false) =>
      !p
        ? ""
        : dense
          ? line(p, color, ring ? 2 : 1.6, ring ? ".75" : ".6")
          : ring
            ? line(p, "#fffefa", 6.6) + line(p, color, 4.8) + line(p, "#fffefa", 1.8)
            : line(p, "#fffefa", 4.6) + line(p, color, 2.6);
  /* marks: on a phone only the first five (and any that carry a warning); a mark on top of an earlier one is
     folded into that one's "+n" */
  const narrow = innerWidth < NARROW,
    placed: { x: number; y: number; m: MiniMark; more: string[] }[] = [],
    folded: string[] = [],
    cut: string[] = [];
  for (const [i, m] of (o.marks || []).entries()) {
    const x = (X(west(m.c) + cell / 2) - x0) / vw,
      y = (Y(F.la[m.c] * cell + cell / 2) - y0) / vh;
    if (narrow && i >= MAX_NARROW_MARKS && !m.keep) {
      cut.push(m.label);
      continue;
    }
    const under = placed.find(q => Math.hypot((q.x - x) * boxW, (q.y - y) * boxH) < MARK_GAP);
    if (under) {
      under.more.push(m.label);
      folded.push(m.label);
    } else placed.push({ x, y, m, more: [] });
  }
  host.innerHTML =
    `<div class="cpMiniBox" style="max-width:min(100%,${maxW}px)">` +
    `<svg viewBox="${r1(x0)} ${r1(y0)} ${r1(vw)} ${r1(vh)}" role="img" aria-label="${esc(o.label)}">` +
    `<path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/>` +
    paint(o.layers.filter(l => !(dense && l.over))) +
    `<path d="${lines}" fill="none" stroke="#1b1b1b" stroke-opacity=".7" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    (o.others ? dots(dotPath(oth), o.others.color, true) : "") +
    dots(dotPath(pts), "#1b1b1b") +
    (dense ? paint(o.layers.filter(l => l.over)) : "") +
    `<rect class="cpMiniOn" width="${cw}" height="${ch}" fill="none" stroke="#1b1b1b" stroke-width="2" vector-effect="non-scaling-stroke" visibility="hidden"/>` +
    `</svg>` +
    /* the first mark last, so it is drawn on top */
    placed
      .slice()
      .reverse()
      .map(
        ({ x, y, m, more }) =>
          `<span class="cpMiniMark${m.muted ? " muted" : ""}" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%" title="${esc(m.title + (more.length ? `; also here: ${more.join(", ")}` : ""))}">${esc(m.label)}${more.length ? `<i>+${more.length}</i>` : ""}</span>`,
      )
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
  return { aspect: vw / vh, folded, cut, cellPx };
}
