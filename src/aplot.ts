import type { AreaStats, Frame } from "./acells";
import { idxOf } from "./acells";
import { MON, MONL } from "./data";
import { fmt, short, times } from "./util";
import { classBreaks, classColours } from "./cmap";
import { CAL, INK, RED } from "./cplot";

/* =====================================================================
   AREA CHARTS (Observable Plot), in the country page's colour rules: red is the year being looked at, black the
   most active year, a dashed grey line the usual year, pale grey everything else.
   ===================================================================== */
const INK2 = "#55524c";
const GRID = "#e4e0d7";
const ZERO = "#ebe8e1";
const TYPICAL = "#6b665c";
const BAR_SEEN = "#b8b2a7";
const BAR_CONV = "#dcd7cd";
const PAPER = "#faf9f6";
const STYLE = {
  fontFamily: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums lining-nums",
  background: "transparent",
  color: INK,
  overflow: "visible",
};
const TIP = { fill: "#fffefa", stroke: INK, fontSize: 12, textPadding: 7, lineHeight: 1.35 };
/** the colours for areas side by side: told apart by colour and by dash, never by red alone */
export const PIN_COLOURS = ["#1b1b1b", "#2166ac", "#b2182b", "#7a6a3a"];
export const PIN_DASH = ["", "", "5,3", "2,2"];

function niceMax(v: number) {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))),
    f = v / p;
  for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
  return 10 * p;
}
const yTop = (v: number) => Math.max(5, niceMax(v));
const yAxis = (ymax: number) => ({
  domain: [0, ymax],
  grid: GRID,
  tickFormat: (v: number) => (Number.isInteger(v) ? short(v) : ""),
  label: null,
  tickSize: 0,
  ticks: 4,
});
function mount<T>(el: HTMLElement, fig: SVGSVGElement & { value?: T }, click?: (v: T) => void) {
  el.replaceChildren(fig);
  if (click) {
    fig.style.cursor = "pointer";
    fig.addEventListener("click", () => {
      if (fig.value != null) click(fig.value);
    });
  }
}
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;

/* ---------- the calendar: years down, months across, and the usual year at the foot ---------- */
export interface CalCell {
  /** row label: a year, or "Usual" */
  r: string;
  y: number;
  m: number;
  v: number;
  usual: number;
  /** v / usual, NaN when the month is not compared */
  ratio: number;
  part: boolean;
}
export function calendarCells(F: Frame, S: ArrayLike<number>, st: AreaStats): CalCell[] {
  const out: CalCell[] = [];
  for (let i = 0; i < F.nm; i++) {
    const y = F.y0 + Math.floor(i / 12),
      m = i % 12,
      v = S[i],
      u = st.usual[m],
      part = !!F.partial && i === F.partial.i;
    out.push({ r: String(y), y, m, v, usual: u, part, ratio: part ? NaN : u > 0 ? v / u : v > 0 ? 4 : 1 });
  }
  for (let m = 0; m < 12; m++) out.push({ r: "Usual", y: 0, m, v: st.usual[m], usual: st.usual[m], part: false, ratio: 1 });
  return out;
}
export function calendarScale(cells: CalCell[]) {
  const c = classBreaks(cells.filter(x => x.r !== "Usual").map(x => x.v));
  return { ...c, colours: classColours(c.breaks, CAL) };
}
export function calendar(
  el: HTMLElement,
  cells: CalCell[],
  mode: "count" | "anom",
  pick: { y: number; m: number } | null,
  click: (c: CalCell) => void,
) {
  const Plot = window.Plot,
    W = el.clientWidth || 360,
    rows = [...new Set(cells.map(c => c.r))].sort((a, b) => (a === "Usual" ? 1 : b === "Usual" ? -1 : +b - +a)),
    rowH = W < 340 ? 12 : 13,
    H = rows.length * rowH + 26,
    sc = calendarScale(cells),
    color =
      mode === "anom"
        ? { type: "diverging-log", scheme: "RdBu", reverse: true, pivot: 1, domain: [0.25, 4], clamp: true }
        : sc.breaks.length
          ? { type: "threshold", domain: sc.breaks, range: sc.colours }
          : { type: "ordinal", range: sc.colours },
    f = pick ? cells.find(c => c.r === String(pick.y) && c.m === pick.m) : null,
    shown = mode === "anom" ? cells.filter(c => !c.part && (c.v > 0 || c.usual > 0)) : cells.filter(c => c.v > 0);
  const fig = Plot.plot({
    width: W,
    height: H,
    style: STYLE,
    marginLeft: 40,
    marginRight: 4,
    marginTop: 22,
    marginBottom: 4,
    padding: 0,
    x: {
      axis: "top",
      domain: MON.map((_, m) => m),
      tickFormat: (m: number) => (W < 380 ? MON[m][0] : MON[m]),
      tickSize: 0,
      label: null,
      tickPadding: 6,
    },
    y: { domain: rows, tickSize: 0, label: null, tickPadding: 6, tickFormat: (r: string) => (r === "Usual" ? "Usual" : r) },
    color,
    marks: [
      Plot.cell(cells, { x: "m", y: "r", fill: ZERO, inset: 0.5 }),
      Plot.cell(shown, { x: "m", y: "r", fill: mode === "anom" ? "ratio" : "v", inset: 0.5 }),
      /* the month still under way: a dashed edge, never compared */
      Plot.cell(
        cells.filter(c => c.part),
        { x: "m", y: "r", fill: "none", stroke: INK2, strokeWidth: 1, strokeDasharray: "2,2", inset: 1 },
      ),
      Plot.ruleY(["Usual"], { stroke: INK, strokeWidth: 1, dy: -rowH / 2 - 1 }),
      f ? Plot.cell([f], { x: "m", y: "r", fill: "none", stroke: INK, strokeWidth: 2 }) : null,
      Plot.tip(
        cells,
        Plot.pointer({
          x: "m",
          y: "r",
          ...TIP,
          title: (c: CalCell) =>
            c.r === "Usual"
              ? `A usual ${MONL[c.m]}: ${nHot(c.usual)}\n(median of the complete years)`
              : c.part
                ? `${MONL[c.m]} ${c.y}, so far: ${nHot(c.v)}\nNot over, so not compared with a usual ${MONL[c.m]}`
                : `${MONL[c.m]} ${c.y}: ${nHot(c.v)}\nUsual ${MONL[c.m]}: ${fmt(c.usual)}` +
                  (c.usual > 0 ? ` (${times(c.v / c.usual)} usual)` : c.v > 0 ? " (usually none)" : "") +
                  `\nClick to show it on the map`,
        }),
      ),
    ],
  });
  fig.setAttribute("aria-label", "Hotspots in the area, each month of each year");
  mount<CalCell>(el, fig, c => c.r !== "Usual" && click(c));
  return sc;
}

/* ---------- the season: every year in pale grey, the usual year dashed, the chosen year in red ---------- */
export function season(el: HTMLElement, F: Frame, S: ArrayLike<number>, st: AreaStats, year: number, click: (m: number) => void) {
  const Plot = window.Plot,
    W = el.clientWidth || 360,
    H = 210,
    pts: { y: number; m: number; v: number }[] = [];
  for (let i = 0; i < F.nm; i++) {
    if (F.partial && i === F.partial.i) continue;
    pts.push({ y: F.y0 + Math.floor(i / 12), m: i % 12, v: S[i] });
  }
  const top = st.top?.y,
    yr = pts.filter(p => p.y === year),
    usual = st.usual.map((v, m) => ({ m, v })),
    ymax = yTop(Math.max(1e-9, ...pts.map(p => p.v)));
  const fig = Plot.plot({
    width: W,
    height: H,
    style: STYLE,
    marginLeft: 40,
    marginRight: 12,
    marginTop: 12,
    marginBottom: 24,
    x: { domain: [0, 11], ticks: [0, 2, 4, 6, 8, 10], tickFormat: (m: number) => MON[m], label: null, tickSize: 0 },
    y: yAxis(ymax),
    marks: [
      Plot.lineY(
        pts.filter(p => p.y !== year && p.y !== top),
        { x: "m", y: "v", z: "y", stroke: "#ddd8ce", strokeWidth: 1 },
      ),
      top !== undefined && top !== year
        ? Plot.lineY(
            pts.filter(p => p.y === top),
            { x: "m", y: "v", stroke: INK, strokeWidth: 1.5 },
          )
        : null,
      Plot.lineY(usual, { x: "m", y: "v", stroke: TYPICAL, strokeWidth: 2, strokeDasharray: "4,3" }),
      yr.length ? Plot.lineY(yr, { x: "m", y: "v", stroke: RED, strokeWidth: 2.5 }) : null,
      yr.length ? Plot.dot(yr, { x: "m", y: "v", fill: RED, r: 2.4 }) : null,
      Plot.ruleX(usual, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
      Plot.tip(
        usual,
        Plot.pointerX({
          x: "m",
          y: "v",
          ...TIP,
          title: (u: { m: number; v: number }) => {
            const a = yr.find(p => p.m === u.m);
            return (
              `${MONL[u.m]}\nUsual: ${nHot(u.v)}` +
              (a ? `\n${year}: ${fmt(a.v)}` : year === F.cy ? `\n${year}: not over yet` : "") +
              (top !== undefined && top !== year ? `\n${top} (most active year): ${fmt(S[idxOf(F, top, u.m)])}` : "") +
              `\nClick to show ${MONL[u.m]} ${year} on the map`
            );
          },
        }),
      ),
    ],
  });
  fig.setAttribute("aria-label", `Hotspots by month: ${year} against a usual year`);
  mount<{ m: number }>(el, fig, u => click(u.m));
}

/* ---------- hotspots per year, with the trend when it is clear ---------- */
export function trend(
  el: HTMLElement,
  F: Frame,
  S: ArrayLike<number>,
  st: AreaStats,
  viirsYear: number,
  year: number,
  click: (y: number) => void,
) {
  const Plot = window.Plot,
    W = el.clientWidth || 360,
    H = 200,
    ys = st.years.map(r => ({ ...r, part: false }));
  if (F.cy > F.yb) {
    let t = 0;
    for (let i = idxOf(F, F.cy, 0); i < F.nm; i++) t += S[i];
    ys.push({ y: F.cy, v: t, part: true });
  }
  const top = st.top?.y,
    xs = ys.map(r => r.y),
    ymax = yTop(Math.max(1e-9, ...ys.map(r => r.v)) * 1.08),
    fill = (r: { y: number }) => (r.y === year ? RED : r.y === top ? INK : r.y < viirsYear ? BAR_CONV : BAR_SEEN);
  /* the fitted trend through the complete years, drawn only when it is clear of the year-to-year noise */
  const tr = st.trend,
    line = tr?.clear ? st.years.map(r => ({ y: r.y, v: Math.max(0, Math.expm1(tr.a + tr.b * (r.y - F.y0))) })) : [];
  const step = Math.max(1, Math.ceil((xs.length - 1) / (W < 340 ? 3 : 4)));
  const fig = Plot.plot({
    width: W,
    height: H,
    style: STYLE,
    marginLeft: 40,
    marginRight: 12,
    marginTop: 14,
    marginBottom: 24,
    x: {
      domain: xs,
      ticks: xs.filter((_, i) => (xs.length - 1 - i) % step === 0),
      tickFormat: (y: number) => String(y),
      label: null,
      tickSize: 0,
      padding: 0.18,
    },
    y: yAxis(ymax),
    marks: [
      Plot.barY(
        ys.filter(r => !r.part),
        { x: "y", y: "v", fill },
      ),
      Plot.barY(
        ys.filter(r => r.part),
        { x: "y", y: "v", fill: "#efebe3", stroke: INK2, strokeWidth: 1.1, strokeDasharray: "3,2" },
      ),
      line.length ? Plot.lineY(line, { x: "y", y: "v", stroke: INK, strokeWidth: 1.4, strokeDasharray: "5,3" }) : null,
      Plot.tip(
        ys,
        Plot.pointerX({
          x: "y",
          y: "v",
          ...TIP,
          title: (r: { y: number; v: number; part: boolean }) =>
            r.part
              ? `${r.y} so far: ${nHot(r.v)}\nNot over, so not ranked`
              : `${r.y}: ${nHot(r.v)}` +
                (st.mean > 0 ? `\n${r.v >= st.mean ? "+" : ""}${Math.round((r.v / st.mean - 1) * 100)}% against the average year` : "") +
                (r.y < viirsYear ? "\nConverted from MODIS" : "\nSeen by VIIRS") +
                `\nClick to show ${r.y} on the map`,
        }),
      ),
    ],
  });
  fig.setAttribute("aria-label", "Hotspots in the area per year, with the trend line");
  mount<{ y: number }>(el, fig, r => click(r.y));
}

/* ---------- areas side by side: each one's usual month ---------- */
export interface CompareLine {
  label: string;
  usual: number[];
  /** each month's usual % of its year */
  share: number[];
  colour: string;
  dash: string;
}
export function compareChart(el: HTMLElement, lines: CompareLine[], share: boolean) {
  const Plot = window.Plot,
    W = el.clientWidth || 360,
    H = 200,
    pts = lines.flatMap(l => l.usual.map((v, m) => ({ l: l.label, m, v: share ? l.share[m] : v, raw: v, c: l.colour, d: l.dash }))),
    ymax = share ? Math.max(10, niceMax(Math.max(...pts.map(p => p.v)))) : yTop(Math.max(1e-9, ...pts.map(p => p.v)));
  const fig = Plot.plot({
    width: W,
    height: H,
    style: STYLE,
    marginLeft: 40,
    marginRight: 24,
    marginTop: 12,
    marginBottom: 24,
    x: { domain: [0, 11], ticks: [0, 2, 4, 6, 8, 10], tickFormat: (m: number) => MON[m], label: null, tickSize: 0 },
    y: { ...yAxis(ymax), tickFormat: (v: number) => (share ? `${v}%` : Number.isInteger(v) ? short(v) : "") },
    marks: [
      ...lines.map(l =>
        Plot.lineY(
          pts.filter(p => p.l === l.label),
          { x: "m", y: "v", stroke: l.colour, strokeWidth: 2, strokeDasharray: l.dash || null },
        ),
      ),
      Plot.text(
        lines.map(l => pts.filter(p => p.l === l.label)[11]),
        {
          x: "m",
          y: "v",
          text: "l",
          dx: 8,
          textAnchor: "start",
          fill: "c",
          fontWeight: 600,
          stroke: PAPER,
          strokeWidth: 3,
          paintOrder: "stroke",
        },
      ),
      Plot.tip(
        pts,
        Plot.pointer({
          x: "m",
          y: "v",
          ...TIP,
          title: (p: (typeof pts)[number]) =>
            share
              ? `${p.l}, ${MONL[p.m]}: usually ${Math.round(p.v)}% of the year's hotspots\n(median over the complete years)`
              : `${p.l}, a usual ${MONL[p.m]}: ${nHot(p.raw)}`,
        }),
      ),
    ],
  });
  fig.setAttribute("aria-label", "A usual year in each area");
  mount(el, fig);
}
