import type { CountrySummary } from "./types";
import { MON, MONL } from "./data";
import { $, fmt, short, times } from "./util";
import { HF_DATASET, HF_PAGE, fileUrl, forecastPath, isNums, isObj, loadChecked } from "./hf";
import { theName } from "./world";
import { loadPlotLib } from "./libs";
import { type ForecastMonth, forecastMonths } from "./cplot";
import { classBreaks, classColours } from "./cmap";
import { cellCentre, drawMini, type MiniLayer } from "./minimap";
import { save } from "./downloads";

/* =====================================================================
   THE FORECAST ON THE COUNTRY PAGE: forecast/v1/<Country>.json (scripts/build_world_forecast.py), made from the
   record through 2025. Most of 2026 has now happened (summary/v3 runs to 14 November), so the section first checks
   the forecast against 2026 so far, next to the usual year, and only then gives the rest of 2026 and 2027. Where
   the forecast did no better than history alone in its own 2018-2025 test, the usual year leads.
   ===================================================================== */
interface MonthMetrics {
  crps_skill: number | null;
  brier_above: number;
  brier_above_base: number;
  cover80: number;
  cover80_base: number;
}
interface CellMetrics {
  cell_years: number;
  rate: number;
  auc: number | null;
  auc_base: number | null;
  brier: number;
  brier_base: number;
  mae: number;
  mae_base: number;
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
  const mm = me.month,
    mc = me.cell;
  return (
    numOrNull(mm.crps_skill) &&
    ["brier_above", "brier_above_base", "cover80", "cover80_base"].every(s => num(mm[s])) &&
    (mc === null || (numOrNull(mc.auc) && numOrNull(mc.auc_base) && ["cell_years", "rate", "mae", "mae_base"].every(s => num(mc[s])))) &&
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
/** the build script's own verdict calls a skill between -0.02 and 0.02 "about as good as history alone" */
const SKILL_MIN = 0.02;
/** places whose hotspots are mostly not vegetation fire, and what they are instead */
const NOT_FIRE: Record<string, string> = {
  Iceland: "Most hotspots in Iceland are lava from eruptions, which no fire record can forecast.",
  Antarctica:
    "Antarctica has almost no vegetation, so its hotspots are likely volcanic heat (Mount Erebus has a lava lake) or heat from stations, not fire.",
};
/** chance classes for the map */
const P_BREAKS = [0.1, 0.25, 0.5, 0.75, 0.9];
/** a cell test with fewer burned cell-years than this says little */
const MIN_POSITIVES = 20;

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
/** an expected count, never a fraction of a hotspot: "fewer than 1", "3", "1,250", "342,000" */
const about = (x: number) => {
  if (x === 0) return "0";
  if (x < 1) return "fewer than 1";
  if (x < 1000) return fmt(Math.round(x));
  /* three significant figures: the forecast's own numbers are rounded that way */
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return fmt(Math.round(x / p) * p);
};
/** "hotspot" or "hotspots" after about(x) */
const hs = (x: number) => (x > 0 && x < 1.5 ? "hotspot" : "hotspots");
/** "about 1,250 hotspots", "fewer than 1 hotspot" */
const aboutN = (x: number) => (x > 0 && x < 1 ? "fewer than 1 hotspot" : `about ${about(x)} ${hs(x)}`);
/** a middle outcome in words: one rare year can make the mean a fraction while the middle is none */
const midWords = (x: number) => (x < 0.5 ? "The middle outcome is none" : `The middle outcome is about ${about(x)}`);
/** how the forecast's months were made, for the pages where it did no better than the usual year */
const builtWords = (tf: number) =>
  Math.abs(tf - 1) < 0.005
    ? "built from past years with recent ones counted more"
    : `built from past years with recent ones counted more and the recent trend applied (×${tf.toFixed(2)})`;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const skilled = (F: CountryForecast) => (F.metrics.month.crps_skill ?? 0) > SKILL_MIN;

/* ---------- 2026 so far, against what the forecast expected for the same dates ---------- */
interface Check {
  /** last day with data, 1-based, and its 0-based month */
  day: number;
  mon: number;
  /** complete months (January to the month before `mon`) */
  full: number;
  /** what the satellites saw, month by month from January; index `full` is the partial month */
  obs: number[];
  cur: number;
  /** the same dates: the forecast's expected (mean) and middle path, and the 2001-2025 average */
  exp: number;
  mid: number;
  usual: number;
  /** the same dates in the VIIRS years only (2012-2025, gap-filled like 2026), as at the top of the page */
  viirs: { mean: number; med: number; from: number; to: number } | null;
  /** the 2026 method rerun on 2025 against the archive the forecast was built from: share off, and whether the page warns */
  gap: { pct: number; warn: boolean } | null;
  /** complete months inside the forecast's 80% range */
  inRange: number;
  /** the days of 2026 still to come, or null when the year is over */
  rest: { from: string; exp: number; mid: number; usual: number } | null;
  /** "14 Nov" */
  to: string;
}
function checkOf(F: CountryForecast, d: CountrySummary): Check | null {
  const p = d.partial,
    y = d.y2026;
  if (!p || !y || p.y !== 2026 || d.y0 > 2026) return null;
  const i0 = (2026 - d.y0) * 12,
    mon = p.m - 1,
    full = p.i - i0;
  if (full !== mon || mon < 0 || mon > 11 || d.monthly.V.length <= p.i || !(p.days_in_month > 0)) return null;
  const frac = Math.min(1, Math.max(0, p.day1 / p.days_in_month)),
    obs = d.monthly.V.slice(i0, p.i + 1),
    upTo = (a: number[]) => sum(a.slice(0, full)) + a[full] * frac,
    after = (a: number[]) => a[full] * (1 - frac) + sum(a.slice(full + 1, 12)),
    m = F.month;
  let inRange = 0;
  for (let k = 0; k < full; k++) if (obs[k] >= m.lo[k] && obs[k] <= m.hi[k]) inRange++;
  const over = mon === 11 && frac >= 1,
    t = y.ytd,
    jc = y.join_check_2025;
  return {
    day: p.day1,
    mon,
    full,
    obs,
    cur: y.ytd.cur,
    exp: upTo(m.mean),
    mid: upTo(m.med),
    usual: upTo(F.hist.mean),
    viirs: t.V.length ? { mean: sum(t.V) / t.V.length, med: t.V_stats.median, from: t.years[0], to: t.years[1] } : null,
    gap: jc && num(jc.V_pct) ? { pct: jc.V_pct / 100, warn: !!jc.warn } : null,
    inRange,
    rest: over
      ? null
      : {
          from: frac < 1 ? `${p.day1 + 1} ${MON[mon]}` : `1 ${MON[mon + 1]}`,
          exp: after(m.mean),
          mid: after(m.med),
          usual: after(F.hist.mean),
        },
    to: `${p.day1} ${MON[mon]}`,
  };
}
/** "13% more than", "close to", "2.4 times" */
function rel(cur: number, ref: number) {
  if (ref <= 0) return cur > 0 ? "more than" : "the same as";
  const r = cur / ref;
  if (r >= 2) return `${times(r).replace("×", "")} times`;
  if (Math.abs(r - 1) < 0.05) return "close to";
  return `${Math.round(Math.abs(r - 1) * 100)}% ${r > 1 ? "more" : "fewer"} than`;
}

/* ---------- the open country ---------- */
interface FcView {
  k: string | null;
  d: CountrySummary | null;
  F: CountryForecast | null;
  C: Check | null;
  year: 2026 | 2027;
  mode: "p" | "e";
}
const V: FcView = { k: null, d: null, F: null, C: null, year: 2026, mode: "p" };

/** a country page opened: clear the section; nothing is fetched until its summary has arrived */
export function fcOpen(k: string) {
  V.k = k;
  V.d = V.F = V.C = null;
  V.year = 2026;
  V.mode = "p";
  $("cFcTitle").textContent = "2026 and 2027";
  $("cFcSub").textContent = $("cFcSrc").textContent = "";
  $("cFcMain").hidden = true;
  [
    "cFcFigs", "cFcAhead", "cFcSkill", "cFcChart", "cFcMap", "cFcLegend", "cFcPick", "cFcCheckT", "cFcAheadT",
    "cFcChartT", "cFcChartS", "cFcMapT", "cFcMapS", "cFcMethod", "cFcVerdict", "cFcDlMsg",
  ].forEach(id => ($(id).innerHTML = ""));
  state(k ? "Loading the forecast…" : "");
}
/** the page closed or the address matched nothing: forget the country and empty the section */
export function fcClose() {
  fcOpen("");
  V.k = null;
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
  state("Loading the forecast…");
  loadChecked(forecastPath(k), (x): x is CountryForecast => isForecast(x, k)).then(
    F => {
      if (V.k !== k || !V.d) return;
      V.F = F;
      V.C = checkOf(F, V.d);
      state("");
      render();
    },
    (e: unknown) => {
      if (V.k !== k) return;
      state(`The forecast did not load${e instanceof Error ? ` (${e.message})` : ""}. The rest of this page is unaffected.`, true);
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
    C = V.C,
    tn = theName(F.name),
    avg = F.hist.annual_mean,
    e26 = F.year["2026"].mean,
    skill = skilled(F),
    sk = F.metrics.month.crps_skill ?? 0;
  $("cFcSrc").innerHTML =
    `Data: <a href="${esc(fileUrl(forecastPath(F.country)))}" target="_blank" rel="noopener">${esc(forecastPath(F.country))}</a> from the Hugging Face dataset ` +
    `<a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built by scripts/build_world_forecast.py from the harmonized monthly record (summary/v2), data through December 2025. ` +
    `Hotspots are counted in VIIRS terms; MODIS years before 2012 are converted as on the rest of this page.` +
    (C ? ` 2026 so far is from summary/v3, as at the top of this page.` : "");
  if (avg === 0 && e26 === 0) {
    $("cFcTitle").textContent = "No fire on record, so there is nothing to forecast";
    $("cFcSub").textContent =
      `NASA's satellites counted no vegetation-fire hotspots in ${tn} from 2001 to 2025.` +
      (C ? ` 2026 so far, to ${C.to}: ${nHot(C.cur)}.` : "");
    $("cFcMain").hidden = true;
    return;
  }
  $("cFcTitle").textContent = skill
    ? C
      ? C.exp >= 5
        ? `By ${C.day} ${MONL[C.mon]}, ${tn} had ${nHot(C.cur)} in 2026, ${rel(C.cur, C.exp)} the ${about(C.exp)} this forecast expected`
        : `By ${C.day} ${MONL[C.mon]}, ${tn} had ${nHot(C.cur)} in 2026; this forecast expected ${C.exp < 1 ? "fewer than 1" : `about ${about(C.exp)}`}`
      : `From the record through 2025, this forecast expected ${aboutN(e26)} in ${tn} in 2026`
    : `This forecast did ${sk > 0 ? "about as well as" : "no better than"} the plain 2001–2025 record in ${tn}, so the usual year is ${sk > 0 ? "just as good a" : "the better"} guide`;
  $("cFcSub").textContent =
    `Made from the fire record through December 2025 (in VIIRS terms), with recent years counted more and a damped trend. ` +
    `It has no weather, fuel or ignition data, so it shows what a typical year looks like now. It cannot say which fires will happen, or whether a year will be unusual.` +
    (C
      ? ` Most of 2026 has now happened, so it is checked here against what the satellites saw.`
      : ` 2026 so far did not load, so the forecast is not checked against it here.`) +
    (NOT_FIRE[F.country] ? ` ${NOT_FIRE[F.country]}` : "");
  figures(F, C, skill);
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

const item = (h: string, fig: string, small: string, p: string) =>
  `<div class="cpAns"><h2>${h}</h2><p class="cpFig">${fig}<small>${small}</small></p><p>${p}</p></div>`;

function figures(F: CountryForecast, C: Check | null, skill: boolean) {
  const sk = F.metrics.month.crps_skill ?? 0,
    avg = F.hist.annual_mean,
    e26 = F.year["2026"].mean,
    e27 = F.year["2027"].mean,
    mid = (y: 2026 | 2027) => sum(F.month.med.slice((y - 2026) * 12, (y - 2025) * 12)),
    even = Math.abs(sk) <= SKILL_MIN && sk !== 0,
    track = item(
      "Track record, 2018–2025",
      even ? "About even" : sk === 0 ? "0%" : size(sk),
      even
        ? `with history alone (${size(sk)} ${sk > 0 ? "closer" : "further off"})`
        : sk > 0
          ? "closer than history alone"
          : sk < 0
            ? "further off than history alone"
            : "no closer than history alone",
      `Each year was forecast from the years before it. “History alone” counts every past year the same, with no trend.`,
    );

  /* the check: 2026 so far against the forecast and the usual year, for the same dates */
  $("cFcCheckT").hidden = $("cFcFigs").hidden = !C;
  if (C) {
    /* -1: the forecast came clearly closer than the baseline, 1: clearly further off, 0: about as close. "Clearly"
       means by a tenth and by more than the 2026 method's own measured difference from the archive. */
    const tol = C.gap ? Math.abs(C.gap.pct) * C.cur : 0,
      eF = Math.abs(C.cur - C.exp),
      vs = (base: number) => {
        const eB = Math.abs(C.cur - base);
        return eF < eB * 0.9 && eB - eF > tol ? -1 : eB < eF * 0.9 && eF - eB > tol ? 1 : 0;
      },
      vsAll = vs(C.usual),
      vsV = C.viirs ? vs(C.viirs.mean) : vsAll,
      vName = "the VIIRS years alone",
      phr = (c: number) => (c < 0 ? "closer than" : c > 0 ? "further off than" : "about as close as"),
      closer = !C.viirs
        ? `In 2026 so far the forecast came ${phr(vsAll)} the usual year.`
        : vsAll === vsV
          ? vsAll < 0
            ? `In 2026 so far the forecast came closer than both the 2001–2025 average and ${vName}.`
            : vsAll > 0
              ? `In 2026 so far both the 2001–2025 average and ${vName} came closer than the forecast.`
              : `In 2026 so far the forecast came about as close as both the 2001–2025 average and ${vName}.`
          : `In 2026 so far the forecast came ${phr(vsAll)} the 2001–2025 average and ${phr(vsV)} ${vName}.` +
            (vsAll < 0 ? " Most of its gain comes from counting the VIIRS years more." : ""),
      care =
        C.gap && C.gap.warn
          ? ` Read 2026 with care: run on 2025, the 2026 method came out ${Math.round(Math.abs(C.gap.pct) * 100)}% ${C.gap.pct > 0 ? "higher" : "lower"} than the archive this forecast was built from.`
          : "",
      seen = item("2026 so far", fmt(C.cur), `hotspots, 1 Jan–${C.to}`, `What the satellites saw, as at the top of this page.${care}`),
      fc = item(
        "This forecast, same dates",
        about(C.exp),
        `${hs(C.exp)} expected on average`,
        `Made before 2026 began. ${C.mid < 0.5 ? "Its middle path has no hotspots." : `Its middle path adds up to ${about(C.mid)}.`}` +
          (C.full >= 3
            ? ` ${C.inRange} of the ${C.full} complete months fell inside its 80% range; about ${Math.round(C.full * 0.8)} would be on target.`
            : ""),
      ),
      usual = item(
        "A usual year, same dates",
        about(C.usual),
        `${hs(C.usual)}, the 2001–2025 average`,
        `History alone: every past year counted the same.` +
          (C.viirs
            ? ` The VIIRS years alone (${C.viirs.from}–${C.viirs.to}) had ${about(C.viirs.mean)} on average for these dates (typical ${fmt(C.viirs.med)}, as at the top of this page).`
            : "") +
          ` ${closer} One year is a small test.`,
      );
    $("cFcCheckT").textContent = `2026 so far, to ${C.to}, against the forecast`;
    $("cFcFigs").innerHTML = seen + (skill ? fc + usual : usual + fc);
  }

  /* what is still ahead */
  const trend = F.year["2027"].trend_factor / F.year["2026"].trend_factor - 1,
    trendText =
      F.same_2027 || Math.abs(trend) < 0.0005
        ? "The same as 2026: there is no recent trend to carry forward, and nothing else is known about 2027."
        : `The same months as 2026, ${trend > 0 ? "raised" : "lowered"} by the recent trend (${signed(trend)}). Nothing else is known about 2027.`;
  if (skill) {
    const first = C
      ? C.rest
        ? item(
            "Rest of 2026",
            about(C.rest.exp),
            `${hs(C.rest.exp)} expected on average, ${C.rest.from}–31 Dec`,
            `${midWords(C.rest.mid)}. A usual year has ${about(C.rest.usual)} in these weeks.`,
          )
        : ""
      : item(
          "2026, as forecast",
          about(e26),
          `${hs(e26)} expected on average`,
          `Forecast from the record through 2025; ${mid(2026) < 0.5 ? "its middle path has no hotspots" : `its middle path adds up to about ${about(mid(2026))}`}. An average year in 2001–2025 had ${about(avg)}.`,
        );
    $("cFcAheadT").textContent = C ? (C.rest ? "Still ahead: the rest of 2026, and 2027" : "Still ahead: 2027") : "2026 and 2027, as forecast";
    $("cFcAhead").innerHTML =
      first +
      item(
        "2027",
        about(e27),
        `${hs(e27)} expected on average`,
        `${midWords(mid(2027))}; one big past year can pull the average up. ${trendText}`,
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
    pk = top[0],
    own = `The method's own figure for 2027 is ${about(e27)} on average, but it did not beat the plain record here, so we do not lean on it.`;
  const season = pk
    ? item(
        "Usually busiest",
        top
          .map(o => o.m)
          .sort((a, b) => a - b)
          .map(m => MON[m])
          .join(", "),
        `a typical ${MONL[pk.m]} has ${about(pk.v)} ${hs(pk.v)}`,
        own,
      )
    : item("Usually busiest", "No usual month", "each month had none in at least half the years 2001–2025", own);
  $("cFcAheadT").textContent = `Still ahead: the usual year is ${sk > 0 ? "just as good a" : "the better"} guide`;
  $("cFcAhead").innerHTML =
    item(
      "A usual year",
      about(avg),
      `${hs(avg)}, the 2001–2025 average`,
      `2025 had ${fmt(F.hist.y2025)}.` + (C?.rest ? ` A usual ${C.rest.from}–31 Dec has ${about(C.rest.usual)}.` : ""),
    ) +
    season +
    track;
}

function skillText(F: CountryForecast, skill: boolean) {
  const tn = theName(F.name),
    mm = F.metrics.month,
    sk = mm.crps_skill ?? 0,
    tiny = F.hist.annual_mean < 5;
  const t =
    `<b>How well this did on 2018–2025.</b> Each year from 2018 to 2025 was forecast from the years before it and scored against what happened. ` +
    (skill
      ? `For ${esc(tn)}, the monthly forecasts were ${size(sk)} closer than history alone (every past year counted the same, with no trend). ` +
        (tiny
          ? `With so few hotspots a year, that score rests on very few months with fire. `
          : `That is ${sk < 0.1 ? "a small gain" : "more than in most countries"}. `) +
        `Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}, and most of the gain comes from counting the VIIRS years since 2012 more than the older MODIS years. `
      : `For ${esc(tn)}, the monthly forecasts were ${
          Math.abs(sk) <= SKILL_MIN && sk !== 0
            ? `about as good as history alone (${size(sk)} ${sk > 0 ? "closer" : "further off"})`
            : sk < 0
              ? `${size(sk)} further off than history alone`
              : "no closer than history alone"
        }, so this forecast adds nothing over the past record here. ` +
        `The chart below shows its months, ${builtWords(F.year["2026"].trend_factor)}; in tests they did no better than the dashed line, the typical month. ` +
        `Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}. `) +
    `The one setting used for every country was picked on these same years, so these scores flatter it slightly. ` +
    `The 80% range held the real month ${pc(mm.cover80)} of the time (history alone: ${pc(mm.cover80_base)})` +
    (mm.cover80 < 0.75 ? ", so here it is too narrow: expect more surprises than the band shows." : ".") +
    (mapBelowChance(F)
      ? ` Its map of squares is left out: tested on 2018–2025, it told squares that burned from squares that did not worse than a coin toss (AUC ${F.metrics.cell!.auc!.toFixed(2)}).`
      : "");
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
    C = V.C,
    y = V.year,
    i0 = (y - 2026) * 12,
    skill = skilled(F),
    tf = F.year[y === 2026 ? "2026" : "2027"].trend_factor,
    rows: ForecastMonth[] = MON.map((_, m) => ({
      m,
      mean: F.month.mean[i0 + m],
      lo: F.month.lo[i0 + m],
      med: F.month.med[i0 + m],
      hi: F.month.hi[i0 + m],
      typ: F.hist.median[m],
      pAny: F.month.p_any[i0 + m],
      pAbove: F.month.p_above[i0 + m],
      obs: y === 2026 && C && m <= C.full ? C.obs[m] : null,
      part: y === 2026 && C && m === C.full ? `1–${C.day} ${MON[m]}, not over` : undefined,
    })),
    meds = rows.map(r => r.med),
    pk = meds.indexOf(Math.max(...meds)),
    built = builtWords(tf),
    key =
      `<span class="cpMiniKey"><span><i style="background:#e0dace"></i>8 in 10 outcomes</span>` +
      (y === 2026 && C ? `<span><i class="cpKeyDot"></i>2026 as seen</span>` : "") +
      `</span>`;
  if (y === 2026 && C) {
    $("cFcChartT").textContent =
      C.full >= 3
        ? `${C.inRange} of the ${C.full} complete months of 2026 fell inside the forecast's 80% range`
        : `2026 so far against the forecast's months`;
    $("cFcChartS").innerHTML =
      `Red dots: 2026 as the satellites saw it, ${C.full ? `January to ${MONL[C.full - 1]}` : "so far"}; ${MONL[C.mon]} is not over and is left off (point at it for its first ${C.day} days). ` +
      `The band holds 8 in 10 outcomes of the forecast made before the year began, the solid line is its middle outcome, and the dashed line is the typical month of 2001–2025. ` +
      (skill ? "" : `The forecast's months are ${built}; in its tests it did no better than the dashed line. `) +
      key;
  } else {
    $("cFcChartT").textContent =
      y === 2026
        ? `What the forecast expected for each month of 2026`
        : skill
          ? meds[pk] > 0
            ? `${MONL[pk]} looks like the busiest month of 2027`
            : `Most months of 2027 look quiet`
          : `What past years suggest for each month of 2027`;
    $("cFcChartS").innerHTML =
      (skill ? "" : `These months are ${built}; in tests that did no better than the dashed line. `) +
      `The solid line is the middle outcome and the band holds 8 in 10 outcomes; the dashed line is the typical month of 2001–2025. ` +
      `The yearly figures above add up the expected (mean) months, which one big year can pull up.` +
      key;
  }
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
/** squares with at least a 1 in 10 chance: fewer than this draw as a few specks */
const MIN_MAP_SQUARES = 10;
/** the per-square test burned enough squares to count, and the map did worse than a coin toss */
const mapBelowChance = (F: CountryForecast) => {
  const cm = F.metrics.cell;
  return !!cm && cm.auc != null && cm.cell_years * cm.rate >= MIN_POSITIVES && cm.auc < 0.5;
};
function mapUseful(F: CountryForecast) {
  let k = 0;
  for (let r = 1; r < F.cell_rows.length; r += 4) if (F.cell_rows[r] >= 0.1) k++;
  return k >= MIN_MAP_SQUARES && !mapBelowChance(F);
}
function legend(title: string, cols: string[], labels: string[]) {
  return (
    `<div><b>${title}</b><div class="cpKey">` +
    cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : labels[i - 1]}</span></div>`).join("") +
    `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${labels[cols.length - 1] ?? ""}</span></div></div></div>`
  );
}
/** cells with a hotspot in 2026 so far (summary/v3), by cell index */
function burned2026(d: CountrySummary) {
  const out = new Set<number>(),
    yi = 2026 - d.y0,
    r = d.cell_rows;
  if (!d.partial) return out;
  for (let p = 0; p + 4 < r.length; p += 5) if (r[p + 1] === yi && r[p + 2] > 0) out.add(r[p]);
  return out;
}
function map() {
  const F = V.F!,
    d = V.d!,
    C = V.C,
    tn = theName(F.name),
    host = $("cFcMap"),
    n = Math.min(F.ncell, F.cell_rows.length / 4, d.cells.length / 2),
    km = Math.round(d.cell * 111);
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
  /* a handful of squares with even a 1 in 10 chance makes an empty-looking map, and a map that tested worse than a
     coin toss is no guide: leave it out (the track-record paragraph says why) */
  $("cFcMapFig").hidden = n < 5 || F.cell !== d.cell || !mapUseful(F);
  if ($("cFcMapFig").hidden) {
    host.innerHTML = "";
    return;
  }
  const all = Array.from({ length: n }, (_, c) => c),
    cls = (v: number, breaks: number[]) => breaks.filter(b => v >= b).length,
    seen = C ? burned2026(d) : null,
    cm = F.metrics.cell,
    enough = !!cm && cm.cell_years * cm.rate >= MIN_POSITIVES,
    dp = d.cell === 0.25 ? 3 : 2;
  let layers: MiniLayer[],
    tested = "";
  if (V.mode === "p") {
    const cols = classColours(P_BREAKS);
    layers = cols.map((fill, i) => ({ fill, cells: all.filter(c => cls(p[c], P_BREAKS) === i), edge: n < 400 }));
    $("cFcLegend").innerHTML = legend("Chance of at least one hotspot in 2026, as forecast", cols, [
      ...P_BREAKS.map(b => Math.round(b * 100) + "%"),
      "100%",
    ]);
    const evenSet = all.filter(c => p[c] >= 0.5),
      even = evenSet.length;
    $("cFcMapT").textContent =
      even === 0
        ? `The forecast gave no square in ${tn} an even chance of a hotspot in 2026`
        : `The forecast gave ${even === n ? "every square" : `${fmt(even)} of ${fmt(n)} squares`} an even or better chance of a hotspot in 2026`;
    let check = "";
    if (seen) {
      const share = (cs: number[]) => (cs.length ? pc(cs.filter(c => seen.has(c)).length / cs.length) : ""),
        rest = all.filter(c => p[c] < 0.5),
        fresh = [...seen].filter(c => c >= F.ncell).length;
      check =
        ` By ${C!.to}, ${even && rest.length ? `${share(evenSet)} of those squares had a hotspot in 2026, and ${share(rest)} of the others` : `${share(all)} of the squares had a hotspot in 2026`}` +
        (fresh ? `; ${fmt(fresh)} square${fresh === 1 ? "" : "s"} with none in 2001–2025 burned, which this map could not foresee.` : ".");
    }
    $("cFcMapS").textContent =
      `Forecast from the record through 2025: the chance of at least one hotspot in 2026 in each ${d.cell}° square (about ${km} km north to south), from how often it burned before, recent years counted more. ` +
      `The squares are yearly, so there is no month-by-month map.` +
      check;
    if (cm && cm.auc != null && cm.auc_base != null)
      tested = !enough
        ? " Too few squares burned in 2018–2025 to test these chances."
        : ` Tested on 2018–2025, these chances told squares that burned from squares that did not with an AUC of ${cm.auc.toFixed(2)} (history alone ${cm.auc_base.toFixed(2)}; 0.5 is a coin toss, 1 is perfect).` +
          (cm.auc < 0.5
            ? " Here that is worse than a coin toss, so do not read the map as a guide."
            : Math.abs(cm.auc - cm.auc_base) < 0.01
              ? " That is no better than history alone."
              : cm.auc < 0.65
                ? " That is weak."
                : "");
  } else {
    const { breaks, max } = classBreaks(Array.from(ex)),
      cols = classColours(breaks);
    layers = cols.map((fill, i) => ({ fill, cells: all.filter(c => ex[c] > 0 && cls(ex[c], breaks) === i), edge: n < 400 }));
    $("cFcLegend").innerHTML = legend("Expected hotspots in 2026, as forecast", cols, [...breaks.map(b => short(b)), short(max)]);
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
        ? `The forecast put half of the expected 2026 hotspots in ${share < 1 ? "under 1" : Math.round(share)}% of the squares`
        : "Expected hotspots in 2026, as forecast";
    $("cFcMapS").textContent =
      `The expected 2026 total shared out by each ${d.cell}° square's part of past hotspots, recent years counted more. A square's share of the past is the whole method: it does not know about new fires.`;
    if (cm && enough)
      tested =
        cm.mae > cm.mae_base
          ? " Tested on 2018–2025, these per-square numbers were further off than history alone."
          : cm.mae < cm.mae_base * 0.99
            ? ` Tested on 2018–2025, these per-square numbers were ${size(1 - cm.mae / cm.mae_base)} closer than history alone.`
            : " Tested on 2018–2025, these per-square numbers were about as close as history alone.";
  }
  drawMini(host, d, {
    layers,
    label: `Map of ${tn} in squares, coloured by ${V.mode === "p" ? "the chance of at least one hotspot" : "the expected hotspots"} in 2026, as forecast`,
    caption: $("cFcPick"),
    idle: (matchMedia("(pointer: coarse)").matches ? "Tap" : "Point at") + " a square for its numbers." + tested,
    pick: c => {
      if (c >= n) return null;
      const [lat, lon] = cellCentre(d, c);
      return (
        `<b>Near ${deg(lat, "N", "S", dp)}, ${deg(lon, "E", "W", dp)}</b>: the forecast gave a ${pc(p[c])} chance of at least one hotspot in 2026 (expected: ${ex[c] === 0 ? "none" : aboutN(ex[c])}). ` +
        `It had one in ${pc(ph[c])} of the years 2001–2025.` +
        (seen ? ` 2026 to ${C!.to}: ${seen.has(c) ? "it had a hotspot" : "no hotspot yet"}.` : "")
      );
    },
  });
}

/* ---------- download ---------- */
function csv() {
  const F = V.F,
    C = V.C;
  if (!F) return;
  const rows = [
    "year,month,expected_mean,p10,median,p90,chance_any_hotspot,chance_above_2001_2025_median,median_2001_2025,mean_2001_2025,seen_2026,seen_2026_status",
  ];
  for (let i = 0; i < 24; i++) {
    const m = i % 12,
      seen = C && i <= C.full ? C.obs[i] : null;
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
        seen ?? "",
        seen == null ? "" : i === C!.full ? `days_1_to_${C!.day}` : "complete",
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
