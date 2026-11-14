import type { Analysis, CalendarMode, SeriesRow } from "./types";
import { MON, MONL, VI0, Y0 } from "./data";
import { S } from "./state";
import { fmt, short } from "./util";
import { div, inkOn, rgb, seq } from "./color";
import { hideTip, showTip } from "./tooltip";

interface Margin {
  l: number;
  r: number;
  t: number;
  b: number;
}
interface BarOptions {
  aria: string;
  h?: number;
  /** index of the selected bar, or -1 */
  sel: number;
  fill?: (i: number) => string;
  /** range whiskers, drawn on the bars where whisk(i) is true */
  lo?: number[];
  hi?: number[];
  whisk?: (i: number) => boolean;
  /** bars that get their label written above them */
  top?: number[];
  /** label every step-th bar on the axis */
  step?: number;
  avg?: number | null;
  tip: (i: number) => string;
  click: (i: number) => void;
}
interface LineSeries {
  v: number[];
  c: string;
  name?: string;
}
interface LineOptions {
  aria: string;
  W?: number;
  h?: number;
  labels?: boolean;
  every?: number;
  fy?: (v: number) => string;
  /** index of the "VIIRS starts" marker; absent or negative for none */
  vline?: number;
  base?: number | null;
  tip: (i: number) => string;
}
interface CalendarOptions {
  mode: CalendarMode;
  compact?: boolean;
  focus?: boolean;
  click?: (r: SeriesRow) => void;
}

/* =====================================================================
   CHARTS
   ===================================================================== */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))),
    f = v / p;
  for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
  return 10 * p;
}
const HATCH = `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#ff8a3d" opacity=".22"/><rect width="2.2" height="5" fill="#ff8a3d"/></pattern></defs>`;
function grid(W: number, m: Margin, ph: number, ymax: number, fy: (v: number) => string, n: number) {
  let s = "";
  for (let k = 0; k <= n; k++) {
    const v = (ymax * k) / n,
      y = m.t + ph * (1 - k / n);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.1)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${fy(v)}</text>`;
  }
  return s;
}
export function bars(el: HTMLElement, xs: (string | number)[], vals: number[], o: BarOptions) {
  const W = 560,
    H = o.h || 240,
    m = { l: 42, r: 8, t: 18, b: 22 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    n = xs.length,
    bw = pw / n;
  const ymax = niceMax(Math.max(1e-9, ...vals) * 1.08),
    Y = (v: number) => m.t + ph * (1 - Math.min(1, v / ymax));
  let s = HATCH + grid(W, m, ph, ymax, short, 2);
  vals.forEach((v, i) => {
    const x = m.l + bw * i + 1.5,
      w = Math.max(1, bw - 3),
      y = Y(v),
      cx = x + w / 2;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0.5, m.t + ph - y)}" rx="3" fill="${o.fill ? o.fill(i) : "#ff8a3d"}" ${o.sel === i ? 'stroke="#fff" stroke-width="2"' : ""}/>`;
    if (o.lo && o.whisk!(i))
      s += `<line x1="${cx}" x2="${cx}" y1="${Y(o.lo[i])}" y2="${Y(o.hi![i])}" stroke="#dfe5ee" stroke-width="1.3"/>`;
    if (o.top && o.top.includes(i)) s += `<text class="hl" x="${cx}" y="${y - 5}" text-anchor="middle">${xs[i]}</text>`;
    if (i % (o.step || 1) === 0) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${xs[i]}</text>`;
  });
  if (o.avg != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.avg)}" y2="${Y(o.avg)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
  vals.forEach(
    (v, i) =>
      (s += `<rect data-i="${i}" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${ph + 18}" fill="transparent" style="cursor:pointer"/>`),
  );
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s}</svg>`;
  el.querySelectorAll<SVGRectElement>("rect[data-i]").forEach(r => {
    const i = +r.dataset.i!;
    r.onmousemove = e => showTip(e, o.tip(i));
    r.onmouseleave = hideTip;
    r.onclick = () => o.click(i);
  });
}
/* one or more lines on a shared axis; with o.labels the line ends are named directly */
export function lines(el: HTMLElement, xs: (string | number)[], sers: LineSeries[], o: LineOptions) {
  const W = o.W || 620,
    H = o.h || 230,
    m = { l: 42, r: o.labels ? 92 : 10, t: 12, b: 22 },
    pw = W - m.l - m.r,
    ph = H - m.t - m.b,
    n = xs.length,
    fy = o.fy || short;
  const ymax = niceMax(Math.max(1e-9, ...sers.flatMap(z => z.v))),
    X = (i: number) => m.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1)),
    Y = (v: number) => m.t + ph * (1 - Math.min(1, v / ymax));
  let s = grid(W, m, ph, ymax, fy, 2);
  xs.forEach((x, i) => {
    if (i % Math.ceil(n / (o.every || 7)) === 0) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${x}</text>`;
  });
  if (o.vline! >= 0)
    s += `<line x1="${X(o.vline!)}" x2="${X(o.vline!)}" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" stroke-dasharray="3 3"/><text class="hl" x="${X(o.vline!) + 5}" y="${m.t + 10}">VIIRS starts</text>`;
  if (o.base != null)
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.base)}" y2="${Y(o.base)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
  sers.forEach(z => {
    s += `<path d="M${z.v.map((v, i) => `${X(i)},${Y(v)}`).join("L")}" fill="none" stroke="${z.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  if (o.labels) {
    const ends = sers.map(z => ({ z, y: Y(z.v[n - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach(
      e =>
        (s += `<circle cx="${X(n - 1)}" cy="${Y(e.z.v[n - 1])}" r="4" fill="${e.z.c}" stroke="#0b0f18" stroke-width="2"/><text class="hl" x="${X(n - 1) + 9}" y="${e.y + 4}">${e.z.name}</text>`),
    );
  }
  s += `<line id="xh" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s}</svg>`;
  const hit = el.querySelector<SVGRectElement>("svg > rect")!,
    xl = el.querySelector<SVGLineElement>("#xh")!;
  hit.onmousemove = e => {
    const b = hit.getBoundingClientRect(),
      i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1))));
    xl.setAttribute("x1", String(X(i)));
    xl.setAttribute("x2", String(X(i)));
    xl.setAttribute("visibility", "visible");
    showTip(e, o.tip(i));
  };
  hit.onmouseleave = () => {
    xl.setAttribute("visibility", "hidden");
    hideTip();
  };
}
export function calendarInto(el: HTMLElement, R: Analysis, o: CalendarOptions) {
  const lmax = Math.log1p(Math.max(1, ...R.ser.map(r => r.h))),
    cmp = !!o.compact;
  el.style.gridTemplateColumns = cmp ? "34px repeat(12,minmax(0,1fr))" : "44px repeat(12,minmax(0,1fr)) 70px";
  let h =
    `<div></div>` +
    MON.map(m => `<div class="h">${cmp ? m[0] : m}</div>`).join("") +
    (cmp ? "" : `<div class="h" style="text-align:right">Year total</div>`);
  for (let y = S.yTo; y >= S.yFrom; y--) {
    if (y === 2011 && S.yTo >= 2012)
      h += `<div class="split">${cmp ? "converted from MODIS below" : "seen by VIIRS above · converted from MODIS below"}</div>`;
    h += `<div class="y">${y}</div>`;
    for (let m = 0; m < 12; m++) {
      const r = R.ser[(y - S.yFrom) * 12 + m],
        c = o.mode === "anom" ? div(Math.log2(r.ratio) / 3) : r.h === 0 ? [22, 28, 40] : seq(0.06 + (0.94 * Math.log1p(r.h)) / lmax);
      h += `<button type="button" ${cmp ? 'tabindex="-1"' : ""} class="c${o.focus && S.focus[0] === y && S.focus[1] === m ? " focus" : ""}" data-i="${r.i}" style="background:${rgb(c)};color:${inkOn(c)}" aria-label="${MON[m]} ${y}: ${fmt(r.h)} hotspots">${cmp || r.h === 0 ? "" : short(r.h)}</button>`;
    }
    if (!cmp) h += `<div class="t">${fmt(R.years[y - S.yFrom].h)}</div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll<HTMLButtonElement>(".c").forEach(b => {
    const r = R.ser[+b.dataset.i! - (S.yFrom - Y0) * 12];
    b.onmousemove = e =>
      showTip(
        e,
        `${MONL[r.m]} ${r.y}: ${fmt(r.h)} hotspots\nNormal for ${MON[r.m]}: ${fmt(r.med)}\n${r.src}` +
          (r.i < VI0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : ""),
      );
    b.onmouseleave = hideTip;
    if (o.click) b.onclick = () => o.click!(r);
  });
}
