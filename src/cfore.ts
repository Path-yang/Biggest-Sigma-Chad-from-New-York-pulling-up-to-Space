import type { CountrySummary } from "./types";
import { MON, MONL } from "./data";
import { $, fmt, short } from "./util";
import { HF_DATASET, HF_PAGE, fileUrl, forecastPath, isNums, isObj, loadChecked } from "./hf";
import { theName } from "./world";
import { loadPlotLib } from "./libs";
import { type ForecastMonth, forecastMonths } from "./cplot";
import { classBreaks, classColours } from "./cmap";
import { cellCentre, drawMini, type MiniLayer } from "./minimap";
import { save } from "./downloads";

/* =====================================================================
   "2026 AND 2027" ON THE COUNTRY PAGE: forecast/v1/<Country>.json (scripts/build_world_forecast.py). Expected
   hotspots for the two years against the 2001-2025 average, the months with their 80% range, the chance of a
   hotspot in each grid square, and this country's own backtest score, said plainly. Where the forecast did no
   better than history alone, the page leads with the usual year instead.
   ===================================================================== */
interface MonthMetrics {
  crps_skill: number | null;
  brier_above: number;
  brier_above_base: number;
  cover80: number;
  cover80_base: number;
}
interface CellMetrics {
  auc: number | null;
  auc_base: number | null;
  brier: number;
  brier_base: number;
}
export interface CountryForecast {
  v: 1;
  country: string;
  name: string;
  data_through: string;
  month: { mean: number[]; lo: number[]; med: number[]; hi: number[]; p_any: number[]; p_above: number[] };
  year: Record<"2026" | "2027", { mean: number; trend_factor: number }>;
  same_2027: boolean;
  hist: { median: number[]; mean: number[]; p_any: number[]; annual_mean: number; y2025: number };
  cell: number;
  ncell: number;
  /** rows of four: cell index, chance of a hotspot in 2026, share of 2001-2025 years with one, expected hotspots */
  cell_rows: number[];
  metrics: { month: MonthMetrics; cell: CellMetrics | null };
  verdict: string;
  method: string;
}
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const numOrNull = (x: unknown) => x === null || num(x);
function isForecast(x: unknown, k: string): x is CountryForecast {
  if (!isObj(x) || x.v !== 1 || x.country !== k || typeof x.name !== "string") return false;
  const mo = x.month,
    h = x.hist,
    yr = x.year,
    me = x.metrics;
  if (!isObj(mo) || !["mean", "lo", "med", "hi", "p_any", "p_above"].every(s => isNums(mo[s], 24))) return false;
  if (!isObj(h) || !["median", "mean", "p_any"].every(s => isNums(h[s], 12)) || !num(h.annual_mean) || !num(h.y2025)) return false;
  if (!isObj(yr) || !["2026", "2027"].every(y => isObj(yr[y]) && num(yr[y].mean) && num(yr[y].trend_factor))) return false;
  if (!isObj(me) || !isObj(me.month) || !(me.cell === null || isObj(me.cell))) return false;
  const mm = me.month;
  return (
    numOrNull(mm.crps_skill) &&
    ["brier_above", "brier_above_base", "cover80", "cover80_base"].every(s => num(mm[s])) &&
    (me.cell === null || (numOrNull(me.cell.auc) && numOrNull(me.cell.auc_base))) &&
    num(x.cell) &&
    num(x.ncell) &&
    isNums(x.cell_rows) &&
    x.cell_rows.length % 4 === 0 &&
    typeof x.same_2027 === "boolean" &&
    typeof x.verdict === "string" &&
    typeof x.method === "string"
  );
}

/** across the 234 countries scored in forecast/v1 index.json: the median country's CRPS skill (0.03) */
const TYPICAL_GAIN = "about 3%";
const COUNTRIES_SCORED = 234;
/** places where most hotspots are lava, which no fire record can forecast */
const VOLCANIC = new Set(["Iceland"]);
/** chance classes for the map */
const P_BREAKS = [0.1, 0.25, 0.5, 0.75, 0.9];

const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pc = (p: number) => (p > 0.99 && p < 1 ? "over 99%" : p > 0 && p < 0.01 ? "under 1%" : Math.round(p * 100) + "%");
/** a share as a percentage with a sign: "+2.1%", "−8%" */
const signed = (x: number) => {
  const v = Math.abs(x * 100);
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${v < 1 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
};
const size = (x: number) => {
  const v = Math.abs(x * 100);
  return v > 0 && v < 1 ? "less than 1%" : `${Math.round(v)}%`;
};
const deg = (v: number, p: string, n: string, dp: number) => `${Math.abs(v).toFixed(dp)}°${v < 0 ? n : p}`;
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;

/* ---------- the open country ---------- */
interface FcView {
  k: string | null;
  d: CountrySummary | null;
  F: CountryForecast | null;
  year: 2026 | 2027;
  mode: "p" | "e";
}
const V: FcView = { k: null, d: null, F: null, year: 2026, mode: "p" };

/** a country page opened: clear the section; nothing is fetched until its summary has arrived */
export function fcOpen(k: string) {
  V.k = k;
  V.d = V.F = null;
  V.year = 2026;
  V.mode = "p";
  $("cFcKick").textContent = "2026 and 2027";
  $("cFcTitle").textContent = "2026 and 2027";
  $("cFcSub").textContent = $("cFcSrc").textContent = "";
  $("cFcMain").hidden = true;
  state("Loading the 2026–2027 forecast…");
}
export function fcClose() {
  V.k = null;
  V.d = V.F = null;
}
/** the summary is here: fetch the forecast */
export function fcStart(d: CountrySummary) {
  if (V.k !== d.country) return;
  V.d = d;
  load();
}
function load() {
  const k = V.k;
  if (!k) return;
  state("Loading the 2026–2027 forecast…");
  loadChecked(forecastPath(k), (x): x is CountryForecast => isForecast(x, k)).then(
    F => {
      if (V.k !== k) return;
      V.F = F;
      state("");
      render();
    },
    (e: unknown) => {
      if (V.k !== k) return;
      state(
        `The 2026–2027 forecast did not load${e instanceof Error ? ` (${e.message})` : ""}. The rest of this page is unaffected.`,
        true,
      );
    },
  );
}
function state(msg: string, retry = false) {
  $("cFcState").hidden = !msg;
  $("cFcMsg").textContent = msg;
  $("cFcRetry").hidden = !retry;
}
/** redraw the chart when its box changes width */
export function fcResize() {
  if (V.F && V.d && !$("cFcMain").hidden) chart();
}

/* ---------- the words and figures ---------- */
function render() {
  const F = V.F!,
    tn = theName(F.name),
    mm = F.metrics.month,
    sk = mm.crps_skill,
    avg = F.hist.annual_mean,
    e26 = F.year["2026"].mean,
    e27 = F.year["2027"].mean,
    skill = sk != null && sk > 0,
    volcanic = VOLCANIC.has(F.country);
  $("cFcSrc").innerHTML =
    `Data: <a href="${esc(fileUrl(forecastPath(F.country)))}" target="_blank" rel="noopener">${esc(forecastPath(F.country))}</a> from the Hugging Face dataset ` +
    `<a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built by scripts/build_world_forecast.py from the harmonized monthly record (summary/v2), data through December 2025. ` +
    `Hotspots are counted in VIIRS terms; MODIS years before 2012 are converted as on the rest of this page.`;
  if (avg === 0 && e26 === 0) {
    $("cFcTitle").textContent = "No fire on record, so there is nothing to forecast";
    $("cFcSub").textContent = `NASA's satellites counted no vegetation-fire hotspots in ${tn} from 2001 to 2025.`;
    $("cFcMain").hidden = true;
    return;
  }
  const vsAvg = (r: number) =>
    r >= 0.95 && r <= 1.05
      ? "close to the 2001–2025 average"
      : `${Math.round(Math.abs(r - 1) * 100)}% ${r > 1 ? "above" : "below"} the 2001–2025 average`;
  $("cFcTitle").textContent = skill
    ? `If recent years are a guide, ${tn} will see about ${fmt(e26)} hotspots in 2026, ${avg > 0 ? vsAvg(e26 / avg) : "after none on average in 2001–2025"}`
    : `This forecast did no better than the plain 2001–2025 record in ${tn}, so the usual year is the better guide`;
  $("cFcSub").textContent =
    `Worked out from the fire record alone (2001–2025, in VIIRS terms), with recent years counted more and a damped trend. ` +
    `It has no weather, fuel or ignition data, so it shows what a typical year looks like now. It cannot say which fires will happen, or whether a year will be unusual.` +
    (volcanic ? ` Most hotspots in ${tn} are lava from eruptions, which no fire record can forecast.` : "");
  figures(F, skill);
  skillText(F, skill);
  $("cFcMethod").textContent = F.method;
  $("cFcVerdict").textContent = `Scores for ${tn}: ${F.verdict}`;
  $("cFcDetailsT").textContent = `How this forecast is made, and its test scores for ${tn}`;
  $("cFcDlMsg").textContent = "";
  $("cFcMain").hidden = false;
  segs();
  chart();
  map();
}

function figures(F: CountryForecast, skill: boolean) {
  const sk = F.metrics.month.crps_skill ?? 0,
    avg = F.hist.annual_mean,
    e26 = F.year["2026"].mean,
    e27 = F.year["2027"].mean,
    item = (h: string, fig: string, small: string, p: string) =>
      `<div class="cpAns"><h2>${h}</h2><p class="cpFig">${fig}<small>${small}</small></p><p>${p}</p></div>`,
    track = item(
      "Track record, 2018–2025",
      sk === 0 ? "0%" : size(sk),
      skill ? "closer than history alone" : sk < 0 ? "further off than history alone" : "no closer than history alone",
      `Each year was forecast from the years before it. “History alone” counts every past year the same, with no trend.`,
    );
  if (skill) {
    const t = F.year["2027"].trend_factor / F.year["2026"].trend_factor - 1;
    $("cFcFigs").innerHTML =
      item(
        "Expected in 2026",
        fmt(e26),
        "hotspots",
        `An average year in 2001–2025 had ${fmt(avg)}, and 2025 had ${fmt(F.hist.y2025)}. Individual months can land well outside this; see the range below.`,
      ) +
      item(
        "Expected in 2027",
        fmt(e27),
        "hotspots",
        F.same_2027 || Math.abs(t) < 0.0005
          ? "The same as 2026: there is no recent trend to carry forward, and nothing else is known about 2027."
          : `The same months as 2026, ${t > 0 ? "raised" : "lowered"} by the recent trend (${signed(t)}). Nothing else is known about 2027.`,
      ) +
      track;
    return;
  }
  /* no skill: the usual year leads, and the method's own figure is mentioned, not featured */
  const med = F.hist.median,
    top = med
      .map((v, m) => ({ v, m }))
      .filter(o => o.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3),
    pk = top[0];
  const season = top.length
    ? item(
        "Usually busiest",
        top.length
          ? top
              .map(o => o.m)
              .sort((a, b) => a - b)
              .map(m => MON[m])
              .join(", ")
          : "No month",
        pk ? `a typical ${MONL[pk.m]} has ${nHot(pk.v)}` : "in a typical year every month has none",
        `The method's own figure for 2026 is ${fmt(e26)} hotspots, but it did not beat the plain record here, so we do not lean on it.`,
      )
    : item(
        "Usually busiest",
        "No usual season",
        "most years had no hotspots at all",
        `Hotspots came in a few years only. The method's own figure for 2026 is ${fmt(e26)}, but it did not beat the plain record here, so we do not lean on it.`,
      );
  $("cFcFigs").innerHTML =
    item("A usual year", fmt(avg), "hotspots, the 2001–2025 average", `2025 had ${fmt(F.hist.y2025)}.`) + season + track;
}

function skillText(F: CountryForecast, skill: boolean) {
  const tn = theName(F.name),
    mm = F.metrics.month,
    sk = mm.crps_skill ?? 0;
  const t =
    `<b>How well this did on 2018–2025.</b> Each year from 2018 to 2025 was forecast from the years before it and scored against what happened. ` +
    (skill
      ? `For ${esc(tn)}, the monthly forecasts were ${size(sk)} closer than history alone (every past year counted the same, with no trend). ` +
        `That is ${sk < 0.1 ? "a small gain" : "more than in most countries"}. Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}, and most of the gain comes from counting the VIIRS years since 2012 more than the older MODIS years. `
      : `For ${esc(tn)}, the monthly forecasts were ${sk < 0 ? `${size(sk)} further off than` : "no closer than"} history alone, so this forecast does no better than the past record here. ` +
        `Read the chart below as a picture of past years, with recent ones counted more, not as a forecast. Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}. `) +
    `The 80% range held the real month ${pc(mm.cover80)} of the time (history alone: ${pc(mm.cover80_base)})` +
    (mm.cover80 < 0.75 ? ", so here it is too narrow: expect more surprises than the band shows." : ".");
  $("cFcSkill").innerHTML = t;
}

/* ---------- the toggles ---------- */
function segs() {
  document
    .querySelectorAll<HTMLButtonElement>("#cFcYearSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.year) === V.year)));
  document
    .querySelectorAll<HTMLButtonElement>("#cFcMapSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === V.mode)));
}

/* ---------- the chart ---------- */
function chart() {
  const F = V.F!,
    y = V.year,
    i0 = (y - 2026) * 12,
    skill = (F.metrics.month.crps_skill ?? 0) > 0,
    rows: ForecastMonth[] = MON.map((_, m) => ({
      m,
      mean: F.month.mean[i0 + m],
      lo: F.month.lo[i0 + m],
      med: F.month.med[i0 + m],
      hi: F.month.hi[i0 + m],
      typ: F.hist.median[m],
      pAny: F.month.p_any[i0 + m],
      pAbove: F.month.p_above[i0 + m],
    })),
    meds = rows.map(r => r.med),
    pk = meds.indexOf(Math.max(...meds));
  $("cFcChartT").textContent = skill
    ? meds[pk] > 0
      ? `${MONL[pk]} looks like the busiest month of ${y}`
      : `Most months of ${y} look quiet`
    : `What past years suggest for each month of ${y}`;
  $("cFcChartS").innerHTML =
    `${skill ? "" : "Built from past years, recent ones counted more. "}The solid line is the middle outcome and the band holds 8 in 10 outcomes; the dashed line is the typical month of 2001–2025. ` +
    `The yearly figures above add up the expected (mean) months, which one big year can pull up.` +
    `<span class="cpMiniKey"><span><i style="background:#e0dace"></i>8 in 10 outcomes</span></span>`;
  const el = $("cFcChart");
  if (!window.Plot || !window.d3) {
    const k = V.k;
    if (!el.firstChild) el.innerHTML = `<p class="cpCap">Drawing…</p>`;
    loadPlotLib().then(
      () => V.k === k && V.F === F && chart(),
      () => {
        if (V.k === k)
          el.innerHTML = `<p class="cpCap">The chart did not load (jsdelivr or cdnjs did not answer). The numbers above are unaffected.</p>`;
      },
    );
    return;
  }
  forecastMonths(el, rows, y);
}

/* ---------- the map: one square per grid cell, coloured by its chance of a hotspot in 2026 ---------- */
function legend(title: string, cols: string[], labels: string[]) {
  return (
    `<div><b>${title}</b><div class="cpKey">` +
    cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : labels[i - 1]}</span></div>`).join("") +
    `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${labels[cols.length - 1] ?? ""}</span></div></div></div>`
  );
}
function map() {
  const F = V.F!,
    d = V.d!,
    tn = theName(F.name),
    host = $("cFcMap"),
    n = Math.min(F.ncell, F.cell_rows.length / 4, d.cells.length / 2),
    km = Math.round(d.cell * 111);
  $("cFcMapFig").hidden = n === 0 || F.cell !== d.cell;
  if ($("cFcMapFig").hidden) return;
  const p = new Float64Array(n),
    ph = new Float64Array(n),
    ex = new Float64Array(n);
  for (let r = 0; r < F.cell_rows.length; r += 4) {
    const c = F.cell_rows[r];
    if (c < 0 || c >= n) continue;
    p[c] = F.cell_rows[r + 1];
    ph[c] = F.cell_rows[r + 2];
    ex[c] = F.cell_rows[r + 3];
  }
  const all = Array.from({ length: n }, (_, c) => c),
    cls = (v: number, breaks: number[]) => breaks.filter(b => v >= b).length;
  let layers: MiniLayer[];
  if (V.mode === "p") {
    const cols = classColours(P_BREAKS);
    layers = cols.map((fill, i) => ({ fill, cells: all.filter(c => cls(p[c], P_BREAKS) === i), edge: n < 400 }));
    $("cFcLegend").innerHTML = legend("Chance of at least one hotspot in 2026", cols, [
      ...P_BREAKS.map(b => Math.round(b * 100) + "%"),
      "100%",
    ]);
    const even = all.filter(c => p[c] >= 0.5).length;
    $("cFcMapT").textContent =
      even === 0
        ? `No square in ${tn} has an even chance of a hotspot in 2026`
        : `${even === n ? "Every" : `${fmt(even)} of ${fmt(n)}`} square${even === 1 && even !== n ? "" : "s"} ${even === 1 ? "has" : "have"} an even or better chance of a hotspot in 2026`;
    $("cFcMapS").textContent =
      `Chance of at least one hotspot in 2026 in each ${d.cell}° square (about ${km} km across), from how often it burned before, recent years counted more. ` +
      `The squares are yearly, so there is no month-by-month map.`;
  } else {
    const { breaks, max } = classBreaks(Array.from(ex)),
      cols = classColours(breaks);
    layers = cols.map((fill, i) => ({ fill, cells: all.filter(c => ex[c] > 0 && cls(ex[c], breaks) === i), edge: n < 400 }));
    $("cFcLegend").innerHTML = legend("Expected hotspots in 2026", cols, [...breaks.map(b => short(b)), short(max)]);
    const vals = Array.from(ex).sort((a, b) => b - a),
      tot = vals.reduce((a, b) => a + b, 0);
    let acc = 0,
      k50 = 0;
    for (const v of vals) {
      acc += v;
      k50++;
      if (acc >= tot / 2) break;
    }
    const share = (k50 / n) * 100;
    $("cFcMapT").textContent =
      tot > 0 && n >= 10
        ? `Half of the expected 2026 hotspots fall in ${share < 1 ? "under 1" : Math.round(share)}% of the squares`
        : "Expected hotspots in 2026";
    $("cFcMapS").textContent =
      `The expected 2026 total shared out by each ${d.cell}° square's part of past hotspots, recent years counted more. A square's share of the past is the whole method: it does not know about new fires.`;
  }
  const cm = F.metrics.cell,
    dp = d.cell === 0.25 ? 3 : 2;
  let tested = "";
  if (cm && cm.auc != null && cm.auc_base != null)
    tested =
      ` Tested on 2018–2025, these chances told squares that burned from squares that did not with an AUC of ${cm.auc.toFixed(2)} (history alone ${cm.auc_base.toFixed(2)}; 0.5 is a coin toss, 1 is perfect).` +
      (cm.auc < 0.5 ? " Here that is worse than a coin toss, so do not read the map as a guide." : cm.auc < 0.65 ? " That is weak." : "");
  drawMini(host, d, {
    layers,
    label: `Map of ${tn} in squares, coloured by ${V.mode === "p" ? "the chance of at least one hotspot" : "the expected hotspots"} in 2026`,
    caption: $("cFcPick"),
    idle: (matchMedia("(pointer: coarse)").matches ? "Tap" : "Point at") + " a square for its numbers." + tested,
    pick: c => {
      if (c >= n) return null;
      const [lat, lon] = cellCentre(d, c);
      return (
        `<b>Near ${deg(lat, "N", "S", dp)}, ${deg(lon, "E", "W", dp)}</b>: ${pc(p[c])} chance of at least one hotspot in 2026. ` +
        `It had one in ${pc(ph[c])} of the years 2001–2025. Expected: ${nHot(ex[c])}.`
      );
    },
  });
}

/* ---------- download ---------- */
function csv() {
  const F = V.F;
  if (!F) return;
  const rows = ["year,month,expected_mean,p10,median,p90,chance_any_hotspot,chance_above_2001_2025_median,median_2001_2025,mean_2001_2025"];
  for (let i = 0; i < 24; i++) {
    const m = i % 12;
    rows.push(
      [
        2026 + Math.floor(i / 12),
        m + 1,
        F.month.mean[i],
        F.month.lo[i],
        F.month.med[i],
        F.month.hi[i],
        F.month.p_any[i],
        F.month.p_above[i],
        F.hist.median[m],
        F.hist.mean[m],
      ].join(","),
    );
  }
  save(`burn-calendar_${F.country}_forecast_2026-2027.csv`, rows.join("\n"), $("cFcDlMsg"));
}

/** wire the section's controls; called once */
export function fcEvents() {
  $("cFcRetry").onclick = () => {
    if (V.k && V.d) load();
  };
  document.querySelectorAll<HTMLButtonElement>("#cFcYearSeg button").forEach(
    b =>
      (b.onclick = () => {
        V.year = b.dataset.year === "2027" ? 2027 : 2026;
        segs();
        if (V.F) chart();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("#cFcMapSeg button").forEach(
    b =>
      (b.onclick = () => {
        V.mode = b.dataset.mode === "e" ? "e" : "p";
        segs();
        if (V.F && V.d) map();
      }),
  );
  $("cFcDl").onclick = csv;
}
