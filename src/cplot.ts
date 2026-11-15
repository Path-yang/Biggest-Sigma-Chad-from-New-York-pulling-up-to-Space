import type { CalendarMode, SeriesAnalysis, SeriesRow, YearRow } from "./types";
import { MON, MONL } from "./data";
import { fmt, short } from "./util";
import { FIRE } from "./cmap";

/* =====================================================================
   COUNTRY CHARTS, drawn with Observable Plot: the calendar heatmap and the four charts under it.
   One quiet style for all of them: Public Sans, horizontal gridlines only, labels on the lines instead of legends.
   ===================================================================== */
export const INK = "#1b1b1b";
const INK2 = "#55524c";
const GRID = "#e4e0d7";
const ZERO = "#ebe8e1";
export const RED = "#bd0026";
const STYLE = {
  fontFamily: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: "13px",
  fontVariantNumeric: "tabular-nums lining-nums",
  background: "transparent",
  color: INK,
  overflow: "visible",
};
const TIP = { fill: "#fffefa", stroke: INK, fontSize: 13, textPadding: 8, lineHeight: 1.35 };

const Pl = () => window.Plot;
function niceMax(v: number) {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))),
    f = v / p;
  for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
  return 10 * p;
}
/** put the figure in its box, and call back with the datum under the pointer when the reader clicks */
function mount<T>(el: HTMLElement, fig: SVGSVGElement & { value?: T }, click?: (v: T) => void) {
  el.replaceChildren(fig);
  if (click) {
    fig.style.cursor = "pointer";
    fig.addEventListener("click", () => {
      if (fig.value != null) click(fig.value);
    });
  }
}
/** labels at the right-hand end of lines, nudged apart so they never overlap; y in data units */
interface EndLabel {
  v: number;
  text: string;
  fill: string;
  weight?: number;
}
function spread(items: EndLabel[], ymax: number, H: number, mT: number, mB: number) {
  const px = (v: number) => mT + (1 - v / ymax) * (H - mT - mB),
    out = items.map(it => ({ ...it, py: px(it.v), dy: 0 })).sort((a, b) => a.py - b.py);
  for (let i = 1; i < out.length; i++)
    if (out[i].py + out[i].dy - (out[i - 1].py + out[i - 1].dy) < 15) out[i].dy = out[i - 1].py + out[i - 1].dy + 15 - out[i].py;
  return out;
}
function endLabels(Plot: any, items: ReturnType<typeof spread>, x: number) {
  return items.map(it =>
    Plot.text([it], {
      x: () => x,
      y: () => it.v,
      text: () => it.text,
      dx: 7,
      dy: it.dy,
      textAnchor: "start",
      fill: it.fill,
      fontWeight: it.weight ?? 600,
    }),
  );
}
const phone = (W: number) => W < 560;
const base = (W: number, H: number, o: Record<string, unknown>) => ({ width: W, height: H, style: STYLE, ...o });

/* ---------- the calendar: one row per year, one column per month ---------- */
export interface CalendarOptions {
  mode: CalendarMode;
  focus: number[];
  /** first year VIIRS is used as observed; the rows from then on are drawn as one block, the converted years as another */
  viirsYear: number;
  tip: (r: SeriesRow) => string;
  click: (r: SeriesRow) => void;
}
/** the colour scale of the calendar, shared by both blocks and by the legend */
export function calendarScale(R: SeriesAnalysis, mode: CalendarMode) {
  if (mode === "anom") return { type: "diverging-log", scheme: "RdBu", reverse: true, pivot: 1, domain: [0.25, 4], clamp: true };
  const pos = R.ser.filter(r => r.h > 0).map(r => r.h),
    lo = Math.max(0.1, Math.min(...pos, Infinity)),
    hi = Math.max(lo * 1.01, ...pos);
  return { type: "log", domain: [lo, hi], interpolate: window.d3.interpolateRgbBasis(FIRE), clamp: true };
}
export function calendar(top: HTMLElement, bottom: HTMLElement, R: SeriesAnalysis, o: CalendarOptions) {
  const Plot = Pl(),
    W = top.clientWidth || 640,
    ph = phone(W),
    rowH = ph ? 17 : 20,
    mL = ph ? 38 : 44,
    mR = ph ? 44 : 64,
    color = calendarScale(R, o.mode),
    totals = new Map(R.years.map(y => [y.y, y.h]));
  const part = (el: HTMLElement, rows: SeriesRow[], head: boolean) => {
    if (!rows.length) {
      el.replaceChildren();
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const years = [...new Set(rows.map(r => r.y))].sort((a, b) => b - a),
      mT = head ? 26 : 4,
      H = years.length * rowH + mT + 4,
      f = rows.find(r => r.y === o.focus[0] && r.m === o.focus[1]);
    const marks = [
      Plot.cell(rows, { x: "m", y: "y", fill: o.mode === "count" ? ZERO : "ratio", inset: 1 }),
      o.mode === "count"
        ? Plot.cell(
            rows.filter(r => r.h > 0),
            { x: "m", y: "y", fill: "h", inset: 1 },
          )
        : null,
      f ? Plot.cell([f], { x: "m", y: "y", fill: "none", stroke: INK, strokeWidth: 2, inset: 0 }) : null,
      Plot.text(years, {
        y: (d: number) => d,
        text: (d: number) => short(totals.get(d) ?? 0),
        frameAnchor: "right",
        dx: 10,
        textAnchor: "start",
        fill: INK2,
      }),
      head
        ? Plot.text([ph ? "Total" : "Year total"], {
            text: (d: string) => d,
            frameAnchor: "top-right",
            dx: 10,
            dy: -18,
            textAnchor: "start",
            fill: INK2,
          })
        : null,
      Plot.tip(rows, Plot.pointer({ x: "m", y: "y", title: o.tip, ...TIP })),
    ];
    const fig = Plot.plot(
      base(W, H, {
        marginLeft: mL,
        marginRight: mR,
        marginTop: mT,
        marginBottom: 4,
        padding: 0,
        x: head
          ? {
              axis: "top",
              domain: MON.map((_, m) => m),
              tickFormat: (m: number) => (ph ? MON[m][0] : MON[m]),
              tickSize: 0,
              label: null,
              tickPadding: 8,
            }
          : { axis: null, domain: MON.map((_, m) => m) },
        y: { domain: years, tickFormat: (y: number) => String(y), tickSize: 0, label: null, tickPadding: 8 },
        color,
        marks,
      }),
    );
    fig.setAttribute("aria-label", `Hotspots per month, ${years[years.length - 1]} to ${years[0]}`);
    mount<SeriesRow>(el, fig, o.click);
  };
  part(
    top,
    R.ser.filter(r => r.y >= o.viirsYear),
    true,
  );
  part(
    bottom,
    R.ser.filter(r => r.y < o.viirsYear),
    !R.ser.some(r => r.y >= o.viirsYear),
  );
}

/* ---------- a typical year: the median month with the range of all years, and the chosen year over it ---------- */
export function seasonal(el: HTMLElement, R: SeriesAnalysis, year: number, click: (m: number) => void) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    mT = 16,
    mB = 30,
    st = R.stats.map((s, m) => {
      const v = R.ser.filter(r => r.m === m).map(r => r.h);
      return { m, ...s, min: Math.min(...v), max: Math.max(...v) };
    }),
    yr = R.ser.filter(r => r.y === year),
    ymax = niceMax(Math.max(1e-9, ...st.map(s => s.max))),
    labs = spread(
      [{ v: st[11].med, text: "Median", fill: RED }, ...(yr.length ? [{ v: yr[11].h, text: String(year), fill: INK }] : [])],
      ymax,
      H,
      mT,
      mB,
    );
  const fig = Plot.plot(
    base(W, H, {
      marginTop: mT,
      marginBottom: mB,
      marginLeft: 44,
      marginRight: 64,
      x: {
        domain: [0, 11],
        ticks: MON.map((_, m) => m).filter(m => !ph || m % 2 === 0),
        tickFormat: (m: number) => MON[m],
        label: null,
        tickSize: 0,
      },
      y: { domain: [0, ymax], grid: GRID, tickFormat: short, label: null, tickSize: 0, ticks: 4 },
      marks: [
        Plot.areaY(st, { x: "m", y1: "min", y2: "max", fill: "#f4e7cf" }),
        Plot.areaY(st, { x: "m", y1: "q1", y2: "q3", fill: "#fdd49e" }),
        Plot.lineY(st, { x: "m", y: "med", stroke: RED, strokeWidth: 2.2 }),
        yr.length ? Plot.lineY(yr, { x: "m", y: "h", stroke: INK, strokeWidth: 1.5 }) : null,
        yr.length ? Plot.dot(yr, { x: "m", y: "h", fill: INK, r: 2.2 }) : null,
        ...endLabels(Plot, labs, 11),
        Plot.ruleX(st, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
        Plot.tip(
          st,
          Plot.pointerX({
            x: "m",
            y: "med",
            ...TIP,
            title: (s: (typeof st)[number]) =>
              `${MONL[s.m]}\nMedian: ${fmt(s.med)} hotspots\nMiddle half of years: ${fmt(s.q1)} to ${fmt(s.q3)}\nRange: ${fmt(s.min)} to ${fmt(s.max)}` +
              (yr.length ? `\n${year}: ${fmt(yr[s.m].h)}` : ""),
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Hotspots by calendar month: median, middle half and range of years");
  mount<{ m: number }>(el, fig, v => click(v.m));
}

/* ---------- hotspots per year ---------- */
export function annual(
  el: HTMLElement,
  R: SeriesAnalysis,
  o: { viirsYear: number; focusYear: number; tip: (y: YearRow) => string; click: (y: number) => void },
) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    ys = R.years,
    conv = ys.filter(y => y.y < o.viirsYear),
    seen = ys.filter(y => y.y >= o.viirsYear),
    worst = R.ranked[0],
    focus = ys.find(y => y.y === o.focusYear),
    ymax = niceMax(Math.max(1e-9, ...ys.map(y => Math.max(y.h, y.hi))) * 1.06),
    every = ys.length > 14 ? (ph ? 6 : 4) : ys.length > 7 ? 2 : 1;
  const fig = Plot.plot(
    base(W, H, {
      marginTop: 18,
      marginBottom: 30,
      marginLeft: 44,
      marginRight: 62,
      x: {
        domain: ys.map(y => y.y),
        ticks: ys.map(y => y.y).filter(y => (ys[ys.length - 1].y - y) % every === 0),
        tickFormat: (y: number) => String(y),
        label: null,
        tickSize: 0,
        padding: 0.18,
      },
      y: { domain: [0, ymax], grid: GRID, tickFormat: short, label: null, tickSize: 0, ticks: 4 },
      marks: [
        Plot.barY(conv, { x: "y", y: "h", fill: "#fdae6b" }),
        Plot.barY(seen, { x: "y", y: "h", fill: "#e34a33" }),
        Plot.ruleX(conv, { x: "y", y1: "lo", y2: "hi", stroke: INK, strokeOpacity: 0.55 }),
        focus ? Plot.barY([focus], { x: "y", y: "h", fill: "none", stroke: INK, strokeWidth: 1.5 }) : null,
        R.mean > 0 ? Plot.ruleY([R.mean], { stroke: INK, strokeDasharray: "3,3", strokeOpacity: 0.8 }) : null,
        R.mean > 0
          ? Plot.text([R.mean], {
              y: (d: number) => d,
              frameAnchor: "right",
              text: () => `Average\n${short(R.mean)}`,
              dx: 6,
              textAnchor: "start",
              lineHeight: 1.15,
              fill: INK,
            })
          : null,
        worst && worst.h > 0
          ? Plot.text([worst], {
              x: "y",
              y: (d: YearRow) => (d.y < o.viirsYear ? Math.max(d.h, d.hi) : d.h),
              text: (d: YearRow) => String(d.y),
              dy: -9,
              fontWeight: 600,
              fill: INK,
              stroke: "#faf9f6",
              strokeWidth: 4,
              paintOrder: "stroke",
            })
          : null,
        Plot.tip(ys, Plot.pointerX({ x: "y", y: "h", title: o.tip, ...TIP })),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Hotspots per year");
  mount<YearRow>(el, fig, v => o.click(v.y));
}

/* ---------- running total through the year, one line per year ---------- */
export function cumulative(el: HTMLElement, R: SeriesAnalysis, year: number) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    mT = 16,
    mB = 30,
    rows: { y: number; m: number; c: number }[] = [];
  for (const yr of R.years) {
    let c = 0;
    for (const r of R.ser.filter(r => r.y === yr.y)) rows.push({ y: yr.y, m: r.m, c: (c += r.h) });
  }
  const worst = R.ranked[0]?.y,
    ymax = niceMax(Math.max(1e-9, ...rows.map(r => r.c))),
    endOf = (y: number) => rows.find(r => r.y === y && r.m === 11)?.c ?? 0,
    labs = spread(
      [
        { v: endOf(year), text: String(year), fill: RED },
        ...(worst !== undefined && worst !== year ? [{ v: endOf(worst), text: String(worst), fill: INK }] : []),
      ],
      ymax,
      H,
      mT,
      mB,
    );
  const fig = Plot.plot(
    base(W, H, {
      marginTop: mT,
      marginBottom: mB,
      marginLeft: 44,
      marginRight: 48,
      x: {
        domain: [0, 11],
        ticks: MON.map((_, m) => m).filter(m => !ph || m % 2 === 0),
        tickFormat: (m: number) => MON[m],
        label: null,
        tickSize: 0,
      },
      y: { domain: [0, ymax], grid: GRID, tickFormat: short, label: null, tickSize: 0, ticks: 4 },
      marks: [
        Plot.lineY(
          rows.filter(r => r.y !== year && r.y !== worst),
          { x: "m", y: "c", z: "y", stroke: "#cdc7bb", strokeWidth: 1 },
        ),
        worst !== undefined && worst !== year
          ? Plot.lineY(
              rows.filter(r => r.y === worst),
              { x: "m", y: "c", stroke: INK, strokeWidth: 1.5 },
            )
          : null,
        Plot.lineY(
          rows.filter(r => r.y === year),
          { x: "m", y: "c", stroke: RED, strokeWidth: 2.4 },
        ),
        ...endLabels(Plot, labs, 11),
        Plot.tip(
          rows,
          Plot.pointer({
            x: "m",
            y: "c",
            ...TIP,
            title: (r: (typeof rows)[number]) => `${r.y}, January to ${MONL[r.m]}\n${fmt(r.c)} hotspots so far`,
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Running total of hotspots through each year");
  mount(el, fig);
}

/* ---------- the harmonization proof: raw counts joined as they are, against the converted record ---------- */
export function seam(el: HTMLElement, R: SeriesAnalysis, viirsYear: number) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    mT = 22,
    mB = 30,
    ys = R.years,
    last = ys[ys.length - 1],
    band = ys.filter(y => y.y <= viirsYear),
    ymax = niceMax(Math.max(1e-9, ...ys.map(y => Math.max(y.h, y.naive)), ...band.map(y => y.hi))),
    labs = spread(
      [
        { v: last.h, text: "Harmonized", fill: RED },
        { v: last.naive, text: "Raw", fill: INK2 },
      ],
      ymax,
      H,
      mT,
      mB,
    );
  const xs = ys.map(y => y.y),
    one = xs.length === 1;
  const fig = Plot.plot(
    base(W, H, {
      marginTop: mT,
      marginBottom: mB,
      marginLeft: 44,
      marginRight: 86,
      x: {
        domain: one ? [xs[0] - 1, xs[0] + 1] : [xs[0], xs[xs.length - 1]],
        tickFormat: "d",
        label: null,
        tickSize: 0,
        ticks: ph ? 4 : 7,
      },
      y: { domain: [0, ymax], grid: GRID, tickFormat: short, label: null, tickSize: 0, ticks: 4 },
      marks: [
        band.length > 1 ? Plot.areaY(band, { x: "y", y1: "lo", y2: "hi", fill: "#fcbba1", fillOpacity: 0.6 }) : null,
        xs[0] < viirsYear && xs[xs.length - 1] >= viirsYear
          ? [
              Plot.ruleX([viirsYear], { stroke: INK, strokeOpacity: 0.45 }),
              Plot.text([viirsYear], {
                x: (d: number) => d,
                frameAnchor: "top",
                dy: -14,
                dx: 4,
                textAnchor: "start",
                text: () => "VIIRS starts",
                fill: INK2,
              }),
            ]
          : null,
        Plot.lineY(ys, { x: "y", y: "naive", stroke: INK2, strokeWidth: 1.5, strokeDasharray: "4,3" }),
        Plot.lineY(ys, { x: "y", y: "h", stroke: RED, strokeWidth: 2.2 }),
        one ? Plot.dot(ys, { x: "y", y: "h", fill: RED }) : null,
        ...endLabels(Plot, labs, last.y),
        Plot.ruleX(ys, Plot.pointerX({ x: "y", stroke: "#b9b3a6" })),
        Plot.tip(
          ys,
          Plot.pointerX({
            x: "y",
            y: "h",
            ...TIP,
            title: (y: YearRow) =>
              `${y.y}\nHarmonized: ${fmt(y.h)}` +
              (y.y <= viirsYear ? `, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "") +
              `\nRaw counts: ${fmt(y.naive)}`,
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Raw joined counts against the harmonized record");
  mount(el, fig);
}

/* ---------- what each satellite saw, raw ---------- */
export interface SensorLine {
  name: string;
  c: string;
  dash?: string;
  v: number[];
}
export function sensorLines(el: HTMLElement, xs: number[], per: SensorLine[]) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 270,
    mT = 16,
    mB = 30,
    rows = per.flatMap(s => xs.map((x, i) => ({ s: s.name, x, v: s.v[i] }))),
    ymax = niceMax(Math.max(1e-9, ...rows.map(r => r.v).filter(Number.isFinite))),
    n = xs.length - 1,
    labs = spread(
      per.filter(s => Number.isFinite(s.v[n])).map(s => ({ v: s.v[n], text: s.name, fill: s.c })),
      ymax,
      H,
      mT,
      mB,
    );
  const fig = Plot.plot(
    base(W, H, {
      marginTop: mT,
      marginBottom: mB,
      marginLeft: 44,
      marginRight: 92,
      x: { domain: xs.length > 1 ? [xs[0], xs[n]] : [xs[0] - 1, xs[0] + 1], tickFormat: "d", label: null, tickSize: 0, ticks: ph ? 4 : 7 },
      y: { domain: [0, ymax], grid: GRID, tickFormat: short, label: null, tickSize: 0, ticks: 4 },
      marks: [
        ...per.map(s =>
          Plot.lineY(
            xs.map((x, i) => ({ x, v: s.v[i] })),
            { x: "x", y: "v", stroke: s.c, strokeWidth: 1.8, strokeDasharray: s.dash },
          ),
        ),
        ...endLabels(Plot, labs, xs[n]),
        Plot.ruleX(xs, Plot.pointerX({ x: (d: number) => d, stroke: "#b9b3a6" })),
        Plot.tip(
          xs,
          Plot.pointerX({
            x: (d: number) => d,
            frameAnchor: "top",
            ...TIP,
            title: (x: number) => {
              const i = xs.indexOf(x);
              return `${x}\n` + per.map(s => `${s.name}: ${Number.isFinite(s.v[i]) ? fmt(s.v[i]) : "not flying"}`).join("\n");
            },
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Raw detections per year from each satellite");
  mount(el, fig);
}
