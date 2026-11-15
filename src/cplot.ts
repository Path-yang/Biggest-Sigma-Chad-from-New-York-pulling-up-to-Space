import type { CalendarMode, SeriesAnalysis, SeriesRow, YearRow } from "./types";
import { MON, MONL } from "./data";
import { fmt, short } from "./util";
import { classBreaks, classColours } from "./cmap";

/* =====================================================================
   COUNTRY CHARTS, drawn with Observable Plot: the calendar heatmap and the four charts under it.
   One quiet style for all of them: Instrument Sans, horizontal gridlines only, labels on the lines instead of legends.
   ===================================================================== */
/* One colour rule on every chart: red is the year being tested (the outlined month at the top), black is the worst
   year, a dashed grey line is the typical year, and pale grey is everything else. */
export const INK = "#1b1b1b";
const INK2 = "#55524c";
const GRID = "#e4e0d7";
const ZERO = "#ebe8e1";
export const RED = "#bd0026";
const TYPICAL = "#6b665c";
const CONTEXT = "#d8d4cb";
const BAR_SEEN = "#b8b2a7";
const BAR_CONV = "#dcd7cd";
const PAPER = "#faf9f6";
/** the calendar's ramp: ColorBrewer YlOrRd from its pale end, so quiet months read as cream and not orange */
export const CAL = ["#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"];
/** y domain top: at least 5, so a country with a handful of hotspots gets whole-number ticks */
const yTop = (v: number) => Math.max(5, niceMax(v));
const yAxis = (ymax: number) => ({
  domain: [0, ymax],
  grid: GRID,
  tickFormat: (v: number) => (Number.isInteger(v) ? short(v) : ""),
  label: null,
  tickSize: 0,
  ticks: 4,
});
/** year ticks: whole years only, at most n of them, always including the last */
function yearTicks(xs: number[], n: number) {
  if (xs.length === 1) return xs;
  const step = Math.max(1, Math.ceil((xs.length - 1) / (n - 1)));
  return xs.filter((_, i) => (xs.length - 1 - i) % step === 0);
}
const STYLE = {
  fontFamily: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
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
  /* pushed below the plot, the lowest label would sit on the month or year ticks: lift the stack back up */
  const floor = H - mB - 6;
  for (let i = out.length - 1; i >= 0; i--) {
    const lim = i === out.length - 1 ? floor : out[i + 1].py + out[i + 1].dy - 15;
    if (out[i].py + out[i].dy > lim) out[i].dy = lim - out[i].py;
  }
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
export function calendarClasses(R: SeriesAnalysis) {
  const c = classBreaks(R.ser.map(r => r.h));
  return { ...c, colours: classColours(c.breaks, CAL) };
}
export function calendarScale(R: SeriesAnalysis, mode: CalendarMode) {
  if (mode === "anom") return { type: "diverging-log", scheme: "RdBu", reverse: true, pivot: 1, domain: [0.25, 4], clamp: true };
  const c = calendarClasses(R);
  return c.breaks.length ? { type: "threshold", domain: c.breaks, range: c.colours } : { type: "ordinal", range: c.colours };
}
/** a year's total as the calendar's last column shows it: whole hotspots, and "<1" for a converted fraction */
const total = (v: number) => (v === 0 ? "0" : v < 1 ? "<1" : short(Math.round(v)));
export function calendar(top: HTMLElement, bottom: HTMLElement, R: SeriesAnalysis, o: CalendarOptions) {
  const Plot = Pl(),
    W = top.clientWidth || 640,
    ph = phone(W),
    rowH = ph ? 17 : 20,
    mL = ph ? 38 : 44,
    mR = ph ? 44 : 64,
    color = calendarScale(R, o.mode),
    totals = new Map(R.years.map(y => [y.y, y.h])),
    partYears = new Set(R.years.filter(y => y.part).map(y => y.y));
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
      /* the month still under way: hatched over its colour, with a dashed edge */
      Plot.cell(
        rows.filter(r => r.part),
        { x: "m", y: "y", fill: "url(#cpPartHatch)", stroke: INK2, strokeWidth: 1, strokeDasharray: "2,2", inset: 1.5 },
      ),
      f ? Plot.cell([f], { x: "m", y: "y", fill: "none", stroke: INK, strokeWidth: 2, inset: 0 }) : null,
      Plot.text(years, {
        y: (d: number) => d,
        text: (d: number) => total(totals.get(d) ?? 0) + (partYears.has(d) ? "*" : ""),
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
    if (rows.some(r => r.part))
      fig.insertAdjacentHTML(
        "afterbegin",
        `<defs><pattern id="cpPartHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="5" fill="${INK}" fill-opacity=".28"/></pattern></defs>`,
      );
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
      const v = R.ser.filter(r => r.m === m && !r.part).map(r => r.h);
      return { m, ...s, min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 };
    }),
    /* the chosen year's complete months: a month under way is not set against whole months */
    yr = R.ser.filter(r => r.y === year && !r.part),
    yEnd = yr.length ? yr[yr.length - 1] : null,
    ymax = yTop(Math.max(1e-9, ...st.map(s => s.max))),
    labs = spread(
      [{ v: st[11].med, text: "Typical", fill: TYPICAL }, ...(yEnd && yEnd.m === 11 ? [{ v: yEnd.h, text: String(year), fill: RED }] : [])],
      ymax,
      H,
      mT,
      mB,
    ),
    /* name the two bands where they are thick enough to hold a label and no line runs through it */
    px = (v: number) => (v / ymax) * (H - mT - mB),
    at = (f: (m: number) => number, k: number) => {
      const a = Math.floor(k),
        b = Math.min(11, a + 1);
      return f(a) + (f(b) - f(a)) * (k - a);
    },
    lines = (k: number) => [at(m => st[m].med, k), ...(yr.length ? [at(m => yr[Math.min(m, yr.length - 1)].h, k)] : [])],
    monthPx = (W - 44 - 64) / 11,
    /* the spot inside a band, over the label's width, furthest from the band's edges and from both lines */
    place = (lo: (m: number) => number, hi: (m: number) => number, t: string) => {
      const half = (t.length * 3.3) / monthPx;
      let best: { m: number; v: number; t: string } | null = null,
        score = 0;
      for (let m = 0; m <= 11; m += 0.25) {
        if (m - half < 0.2 || m + half > 10.8) continue;
        const near = [-1, -0.5, 0, 0.5, 1].map(f => m + f * half),
          bot = px(Math.max(...near.map(k => at(lo, k)))),
          top = px(Math.min(...near.map(k => at(hi, k)))),
          ls = near.flatMap(k => lines(k).map(px));
        for (let y = bot + 8; y <= top - 8; y += 2) {
          const clear = Math.min(y - bot, top - y, ...ls.map(l => Math.abs(l - y)));
          if (clear >= 10 && clear > score) {
            score = clear;
            best = { m, v: (y / (H - mT - mB)) * ymax, t };
          }
        }
      }
      return best ? [best] : [];
    },
    bandLabels = [
      ...place(
        m => st[m].q1,
        m => st[m].q3,
        "Middle half of years",
      ),
      ...place(
        m => st[m].q3,
        m => st[m].max,
        "Full range",
      ),
    ];
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
      y: yAxis(ymax),
      marks: [
        Plot.areaY(st, { x: "m", y1: "min", y2: "max", fill: "#efebe3" }),
        Plot.areaY(st, { x: "m", y1: "q1", y2: "q3", fill: "#e0dace" }),
        Plot.text(bandLabels, {
          x: "m",
          y: "v",
          text: "t",
          fill: INK2,
          fontSize: 12,
          stroke: (d: { t: string }) => (d.t === "Full range" ? "#efebe3" : "#e0dace"),
          strokeWidth: 3,
          paintOrder: "stroke",
        }),
        Plot.lineY(st, { x: "m", y: "med", stroke: TYPICAL, strokeWidth: 2, strokeDasharray: "4,3" }),
        yr.length ? Plot.lineY(yr, { x: "m", y: "h", stroke: RED, strokeWidth: 2.5 }) : null,
        yr.length ? Plot.dot(yr, { x: "m", y: "h", fill: RED, r: 2.6 }) : null,
        ...endLabels(Plot, labs, 11),
        /* a year that stops early is named at its last month, above the line */
        yEnd && yEnd.m < 11
          ? Plot.text([yEnd], {
              x: "m",
              y: "h",
              text: () => `${year} to ${MON[yEnd.m]}`,
              dy: -11,
              fill: RED,
              fontWeight: 600,
              stroke: PAPER,
              strokeWidth: 3,
              paintOrder: "stroke",
            })
          : null,
        Plot.ruleX(st, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
        Plot.tip(
          st,
          Plot.pointerX({
            x: "m",
            y: "med",
            ...TIP,
            title: (s: (typeof st)[number]) =>
              `${MONL[s.m]}\nTypical (median): ${fmt(s.med)} hotspots\nMiddle half of years: ${fmt(s.q1)} to ${fmt(s.q3)}\nRange: ${fmt(s.min)} to ${fmt(s.max)}` +
              (yr[s.m] ? `\n${year}: ${fmt(yr[s.m].h)}` : yr.length ? `\n${year}: not over yet` : "") +
              `\nClick to test ${MONL[s.m]} ${year} at the top`,
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", "Hotspots by calendar month: median, middle half and range of years");
  mount<{ m: number }>(el, fig, v => click(v.m));
  /* a band too steep to hold its name gets a swatch above the chart instead */
  const missing = [
    ["#e0dace", "Middle half of years"],
    ["#efebe3", "Full range"],
  ].filter(([, t]) => !bandLabels.some(b => b.t === t));
  /* it goes in the subhead's row, so the chart still lines up with its neighbour */
  const sub = el.previousElementSibling;
  sub?.querySelector(".cpMiniKey")?.remove();
  if (missing.length && sub) {
    const key = document.createElement("span");
    key.className = "cpMiniKey";
    key.innerHTML = missing.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("");
    sub.append(key);
  }
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
    worst = R.ranked[0],
    ymax = yTop(Math.max(1e-9, ...ys.map(y => Math.max(y.h, y.hi))) * 1.06),
    xs = ys.map(y => y.y),
    fill = (y: YearRow) => (y.y === o.focusYear ? RED : worst && y.y === worst.y ? INK : y.y < o.viirsYear ? BAR_CONV : BAR_SEEN);
  const fig = Plot.plot(
    base(W, H, {
      marginTop: 18,
      marginBottom: 30,
      marginLeft: 44,
      marginRight: 62,
      x: {
        domain: xs,
        ticks: yearTicks(xs, ph ? 4 : 7),
        tickFormat: (y: number) => String(y),
        label: null,
        tickSize: 0,
        padding: 0.18,
      },
      y: yAxis(ymax),
      marks: [
        Plot.barY(
          ys.filter(y => !y.part),
          { x: "y", y: "h", fill },
        ),
        /* the year under way: its total so far, as a dashed outline */
        Plot.barY(
          ys.filter(y => y.part),
          {
            x: "y",
            y: "h",
            fill: (y: YearRow) => (y.y === o.focusYear ? "#f2c9cf" : "#efebe3"),
            stroke: (y: YearRow) => (y.y === o.focusYear ? RED : INK2),
            strokeWidth: 1.2,
            strokeDasharray: "3,2",
          },
        ),
        Plot.text(
          ys.filter(y => y.part),
          { x: "y", y: "h", text: () => "so far", dy: -8, fill: INK2, fontSize: 11, stroke: PAPER, strokeWidth: 3, paintOrder: "stroke" },
        ),
        Plot.ruleX(conv, { x: "y", y1: "lo", y2: "hi", stroke: INK, strokeOpacity: 0.45 }),
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
              stroke: PAPER,
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
/** part.frac: the share of the partial month that has data (14/30): its point sits that far into the month, so the
 * line of the year under way stops at the date it reaches, not at the end of the month; label: "14 Nov" */
export function cumulative(el: HTMLElement, R: SeriesAnalysis, year: number, part: { frac: number; label: string } | null = null) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    mT = 16,
    mB = 30,
    rows: { y: number; m: number; x: number; c: number }[] = [];
  const partRows = new Set<string>();
  for (const yr of R.years) {
    let c = 0;
    for (const r of R.ser.filter(r => r.y === yr.y)) {
      rows.push({ y: yr.y, m: r.m, x: r.part && part ? r.m - 1 + part.frac : r.m, c: (c += r.h) });
      if (r.part) partRows.add(yr.y + "|" + r.m);
    }
  }
  const worst = R.ranked[0]?.y,
    has = rows.some(r => r.y === year),
    ymax = yTop(Math.max(1e-9, ...rows.map(r => r.c))),
    endOf = (y: number) => rows.filter(r => r.y === y).pop()?.c ?? 0,
    yearEnd = (y: number) => rows.filter(r => r.y === y).pop()?.x ?? 11,
    labs = spread(
      [
        ...(has ? [{ v: endOf(year), text: String(year), fill: RED }] : []),
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
      y: yAxis(ymax),
      marks: [
        Plot.lineY(
          rows.filter(r => r.y !== year && r.y !== worst),
          { x: "x", y: "c", z: "y", stroke: CONTEXT, strokeWidth: 1 },
        ),
        worst !== undefined && worst !== year
          ? Plot.lineY(
              rows.filter(r => r.y === worst),
              { x: "x", y: "c", stroke: INK, strokeWidth: 1.5 },
            )
          : null,
        Plot.lineY(
          rows.filter(r => r.y === year),
          { x: "x", y: "c", stroke: RED, strokeWidth: 2.5 },
        ),
        ...endLabels(
          Plot,
          labs.filter(l => yearEnd(+l.text) === 11),
          11,
        ),
        /* a year under way is named where its line stops */
        ...labs
          .filter(l => yearEnd(+l.text) < 11)
          .map(l =>
            Plot.text([l], {
              x: () => yearEnd(+l.text),
              y: () => l.v,
              text: () => l.text + " so far",
              dx: 6,
              textAnchor: "start",
              fill: l.fill,
              fontWeight: 600,
              stroke: PAPER,
              strokeWidth: 3,
              paintOrder: "stroke",
            }),
          ),
        Plot.tip(
          rows,
          Plot.pointer({
            x: "x",
            y: "c",
            ...TIP,
            title: (r: (typeof rows)[number]) =>
              `${r.y}, ${partRows.has(r.y + "|" + r.m) ? `1 January to ${part ? part.label : MONL[r.m] + " (month not over)"}` : `January to ${MONL[r.m]}`}\n${fmt(r.c)} hotspots so far`,
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
    /* whole years only: a year under way would look like a drop */
    ys = R.years.filter(y => !y.part).length ? R.years.filter(y => !y.part) : R.years,
    last = ys[ys.length - 1],
    band = ys.filter(y => y.y <= viirsYear),
    ymax = yTop(Math.max(1e-9, ...ys.map(y => Math.max(y.h, y.naive)), ...band.map(y => y.hi))),
    labs = spread(
      [
        { v: last.h, text: "Harmonized", fill: INK },
        { v: last.naive, text: "Raw", fill: TYPICAL },
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
        ticks: yearTicks(xs, ph ? 4 : 7),
      },
      y: yAxis(ymax),
      marks: [
        band.length > 1 ? Plot.areaY(band, { x: "y", y1: "lo", y2: "hi", fill: "#e6e1d6" }) : null,
        band.length > 2
          ? Plot.text([band[Math.floor(band.length / 2)]], {
              x: "y",
              y: "hi",
              text: () => "90% range",
              dy: -8,
              fill: INK2,
              fontSize: 12,
              stroke: PAPER,
              strokeWidth: 3,
              paintOrder: "stroke",
            })
          : null,
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
        Plot.lineY(ys, { x: "y", y: "naive", stroke: TYPICAL, strokeWidth: 1.6, strokeDasharray: "4,3" }),
        Plot.lineY(ys, { x: "y", y: "h", stroke: INK, strokeWidth: 2 }),
        one ? Plot.dot(ys, { x: "y", y: "naive", fill: TYPICAL }) : null,
        one ? Plot.dot(ys, { x: "y", y: "h", fill: INK }) : null,
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
    ymax = yTop(Math.max(1e-9, ...rows.map(r => r.v).filter(Number.isFinite))),
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
      x: {
        domain: xs.length > 1 ? [xs[0], xs[n]] : [xs[0] - 1, xs[0] + 1],
        tickFormat: "d",
        label: null,
        tickSize: 0,
        ticks: yearTicks(xs, ph ? 4 : 7),
      },
      y: yAxis(ymax),
      marks: [
        ...per.map(s =>
          Plot.lineY(
            xs.map((x, i) => ({ x, v: s.v[i] })),
            { x: "x", y: "v", stroke: s.c, strokeWidth: 1.8, strokeDasharray: s.dash },
          ),
        ),
        ...(xs.length === 1 ? per.map(s => Plot.dot([{ x: xs[0], v: s.v[0] }], { x: "x", y: "v", fill: s.c })) : []),
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

/* ---------- the 2026-2027 forecast, by calendar month ---------- */
export interface ForecastMonth {
  m: number;
  mean: number;
  lo: number;
  med: number;
  hi: number;
  /** the median of this calendar month, 2001-2025 */
  typ: number;
  pAny: number;
  pAbove: number;
  /** what 2026 brought, where the record has it; `part` marks a month that is not over */
  obs?: number | null;
  part?: string;
}
/** the 80% range as a pale band, the forecast's middle outcome in ink, and the typical month of 2001-2025 dashed */
export function forecastMonths(el: HTMLElement, rows: ForecastMonth[], year: number) {
  const Plot = Pl(),
    W = el.clientWidth || 600,
    ph = phone(W),
    H = ph ? 240 : 280,
    mT = 16,
    mB = 30,
    seen = rows.filter(r => r.obs != null),
    ymax = yTop(Math.max(1e-9, ...rows.flatMap(r => [r.hi, r.med, r.typ, r.obs ?? 0]))),
    pc = (p: number) => (p > 0.99 ? "over 99%" : p < 0.01 ? "under 1%" : Math.round(p * 100) + "%"),
    labs = spread(
      [
        { v: rows[11].typ, text: "Typical", fill: TYPICAL },
        { v: rows[11].med, text: String(year), fill: INK },
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
      marginRight: 64,
      x: {
        domain: [0, 11],
        ticks: MON.map((_, m) => m).filter(m => !ph || m % 2 === 0),
        tickFormat: (m: number) => MON[m],
        label: null,
        tickSize: 0,
      },
      y: yAxis(ymax),
      marks: [
        Plot.areaY(rows, { x: "m", y1: "lo", y2: "hi", fill: "#e0dace" }),
        Plot.lineY(rows, { x: "m", y: "typ", stroke: TYPICAL, strokeWidth: 2, strokeDasharray: "4,3" }),
        Plot.lineY(rows, { x: "m", y: "med", stroke: INK, strokeWidth: 2.2 }),
        Plot.dot(rows, { x: "m", y: "med", fill: INK, r: 2.4 }),
        Plot.dot(seen, { x: "m", y: "obs", fill: RED, r: 3.6, stroke: PAPER, strokeWidth: 1 }),
        ...endLabels(Plot, labs, 11),
        Plot.ruleX(rows, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
        Plot.tip(
          rows,
          Plot.pointerX({
            x: "m",
            y: "med",
            ...TIP,
            title: (r: ForecastMonth) =>
              `${MONL[r.m]} ${year}\nMiddle outcome: ${fmt(r.med)} hotspots\n8 in 10 between ${fmt(r.lo)} and ${fmt(r.hi)}\nExpected (mean): ${fmt(r.mean)}` +
              `\nTypical ${MONL[r.m]}, 2001–2025: ${fmt(r.typ)}\nChance of more than typical: ${pc(r.pAbove)}` +
              (r.pAny < 0.995 ? `\nChance of any hotspot: ${pc(r.pAny)}` : "") +
              (r.obs != null ? `\nSeen in ${year}${r.part ? ` (${r.part})` : ""}: ${fmt(r.obs)}` : ""),
          }),
        ),
      ],
    }),
  );
  fig.setAttribute("aria-label", `Forecast hotspots by month in ${year}, with the 80% range and the typical month of 2001 to 2025`);
  mount(el, fig);
}
