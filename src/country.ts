import type { CalendarMode, CountrySummary, Epochs, SensorSeries, SeriesAnalysis, SeriesRow, YearRow } from "./types";
import { MON, MONL } from "./data";
import { $, fmt, short, times } from "./util";
import { analyseSeries, harmWith, verdict } from "./model";
import { save } from "./downloads";
import { HF_DATASET, HF_PAGE, fileUrl, loadSummary, summaryPath } from "./hf";
import { nameOf } from "./world";
import { loadFonts, loadMapLib, loadPlotLib } from "./libs";
import { classColours, destroyMap, fitAll, mapData, showMap } from "./cmap";
import { annual, calendar, calendarClasses, cumulative, seam, seasonal, sensorLines } from "./cplot";

/* =====================================================================
   COUNTRY VIEW: one country's summary, fetched from Hugging Face when the reader opens it, laid out as a
   light report page. The map (MapLibre) and the charts (Observable Plot) load on first use; the text works without.
   ===================================================================== */
interface CountryView {
  /** FIRMS name of the open country, or null when the view is closed */
  k: string | null;
  d: CountrySummary | null;
  R: SeriesAnalysis | null;
  yFrom: number;
  yTo: number;
  /** [year, month] tested for "was it unusual?" */
  focus: number[];
  mode: CalendarMode;
  /** the country and years the map shows now, so changing the tested month does not redraw it */
  mapKey: string;
}
const CV: CountryView = { k: null, d: null, R: null, yFrom: 2001, yTo: 2025, focus: [2025, 0], mode: "count", mapKey: "" };
/** first year each sensor's record covers in the dataset; Aqua's comes from the file */
const SENSOR_FROM = { T: 2000, V: 2012, N20: 2018 };
const SENSORS: { s: keyof SensorSeries; name: string; c: string; dash?: string }[] = [
  /* MODIS in greys, VIIRS in blues; red is kept for the year being tested */
  { s: "T", name: "Terra", c: "#1b1b1b" },
  { s: "A", name: "Aqua", c: "#8a8478", dash: "5,4" },
  { s: "V", name: "Suomi NPP", c: "#2166ac" },
  { s: "N20", name: "NOAA-20", c: "#4393c3", dash: "5,4" },
];
const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pc = (x: number | null) => (x == null ? "n/a" : Math.round(x * 100) + "%");
/** "1 hotspot", "2 hotspots", "0.4 hotspots" */
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
const epochs = (d: CountrySummary): Epochs => ({
  vi0: (d.viirs_from[0] - d.y0) * 12 + d.viirs_from[1] - 1,
  aq0: (d.aqua_from[0] - d.y0) * 12 + d.aqua_from[1] - 1,
  bins: d.bins,
});
/** first whole year seen by VIIRS: the year VIIRS starts, as the rest of the page counts it */
const viirsYear = (d: CountrySummary) => d.viirs_from[0];
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
/** "the United States", "France": the names that read with an article in a sentence */
function the(name: string) {
  return /^(United|Republic|Democratic|Dominican|Central African|Czech|Federated|Russian|Holy)|Islands$|^(Netherlands|Philippines|Bahamas|Gambia|Maldives|Comoros|Seychelles|Gaza Strip|West Bank)$/.test(
    name,
  )
    ? "the " + name
    : name;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "2005" or "2001–2025" */
const yrs = () => (CV.yFrom === CV.yTo ? String(CV.yFrom) : `${CV.yFrom}–${CV.yTo}`);
/** "2026-10-10" as "10 October 2026" */
const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONL[m - 1]} ${y}` : iso.slice(0, 10);
};
/** places where most hotspots are lava, not burning vegetation; the satellites cannot tell them apart */
const VOLCANIC = new Set(["Iceland"]);
const coarse = () => matchMedia("(pointer: coarse)").matches;
/** a stepped legend: one swatch per class, the class edges written under the joins */
function stepped(title: string, cols: string[], breaks: number[], max: number) {
  if (!breaks.length)
    return `<b>${title}</b><div class="cpKey"><div class="cpStep"><i style="background:${cols[0]}"></i><span>${short(max)}</span></div></div>`;
  return (
    `<b>${title}</b><div class="cpKey">` +
    cols
      .map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`)
      .join("") +
    `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${short(max)}</span></div></div>`
  );
}
/** a run of months as a range when they are next to each other: "Jul–Sep", else "Aug, Jul, Sep" */
function monthRun(ms: number[]) {
  const s = ms.slice().sort((a, b) => a - b);
  if (s.length > 1 && s.every((m, i) => i === 0 || m === s[i - 1] + 1)) return `${MON[s[0]]}–${MON[s[s.length - 1]]}`;
  /* December to February counts as a run too */
  if (s.length === 3 && s[0] === 0 && s[2] === 11 && (s[1] === 1 || s[1] === 10)) return s[1] === 1 ? `Dec–${MON[1]}` : `${MON[10]}–Jan`;
  return s.map(m => MON[m]).join(", ");
}

export const countryOpen = () => CV.k !== null;
export function openCountry(k: string) {
  if (CV.k === k && CV.d) return;
  CV.k = k;
  CV.d = CV.R = null;
  CV.mapKey = "";
  loadFonts();
  const el = $("country");
  el.hidden = false;
  el.scrollTop = 0;
  $("cName").textContent = nameOf(k);
  $("cCrumb").textContent = "Fire, month by month";
  requestAnimationFrame(() => el.classList.add("in"));
  load();
}
export function closeCountry() {
  if (CV.k === null) return;
  CV.k = null;
  CV.mapKey = "";
  destroyMap();
  const el = $("country");
  el.classList.remove("in");
  el.hidden = true;
}
/** a country address that matched nothing */
export function countryMissing(slug: string) {
  CV.k = "";
  CV.d = CV.R = null;
  destroyMap();
  loadFonts();
  const el = $("country");
  el.hidden = false;
  el.classList.add("in");
  $("cName").textContent = "No such country";
  $("cCrumb").textContent = "Fire, month by month";
  $("cBody").hidden = $("cCtl").hidden = true;
  $("cStatus").hidden = false;
  $("cBar").parentElement!.hidden = $("cRetry").hidden = true;
  $("cMsg").textContent = `Nothing lives at "#c/${slug}". Go back to the globe and pick a country there, or search for one by name.`;
}

function load() {
  const k = CV.k!,
    name = nameOf(k);
  $("cBody").hidden = $("cCtl").hidden = true;
  $("cStatus").hidden = false;
  $("cRetry").hidden = true;
  $("cBar").parentElement!.hidden = false;
  $("cBar").style.width = "0";
  $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face…`;
  /* the libraries download alongside the data */
  loadMapLib().catch(() => undefined);
  loadPlotLib().catch(() => undefined);
  loadSummary(k, (got, total) => {
    if (CV.k !== k) return;
    const mb = (n: number) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
    if (total && got <= total) {
      $("cBar").style.width = (got / total) * 100 + "%";
      $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face… ${mb(got)} of ${mb(total)}`;
    } else $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face… ${mb(got)}`;
  })
    .then(d => {
      if (CV.k !== k) return;
      CV.d = d;
      start(d);
    })
    .catch((e: unknown) => {
      if (CV.k !== k) return;
      $("cBar").parentElement!.hidden = true;
      $("cMsg").textContent = `${name}'s record did not arrive from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("cRetry").hidden = false;
    });
}
function start(d: CountrySummary) {
  const yo: string[] = [];
  for (let y = d.y0; y <= d.y1; y++) yo.push(`<option>${y}</option>`);
  $("cFrom").innerHTML = $("cTo").innerHTML = $("cfY").innerHTML = yo.join("");
  CV.yFrom = d.y0;
  CV.yTo = d.y1;
  $("cFrom").value = String(d.y0);
  $("cTo").value = String(d.y1);
  /* test the busiest month of the latest year by default */
  const last = (d.y1 - d.y0) * 12,
    ep = epochs(d),
    hs = MON.map((_, m) => harmWith(d, ep, last + m, d.monthly.T[last + m], d.monthly.A[last + m], d.monthly.V[last + m]).h);
  CV.focus = [d.y1, hs.indexOf(Math.max(...hs))];
  if (Math.max(...hs) === 0)
    for (let i = last + 11; i >= 0; i--)
      if (harmWith(d, ep, i, d.monthly.T[i], d.monthly.A[i], d.monthly.V[i]).h > 0) {
        CV.focus = [d.y0 + Math.floor(i / 12), i % 12];
        break;
      }
  $("cStatus").hidden = true;
  $("cBody").hidden = $("cCtl").hidden = false;
  $("cName").textContent = d.name;
  renderCountry();
}

function renderCountry() {
  const d = CV.d;
  if (!d) return;
  const ep = epochs(d),
    R = analyseSeries({
      T: d.monthly.T,
      A: d.monthly.A,
      V: d.monthly.V,
      y0: d.y0,
      yFrom: CV.yFrom,
      yTo: CV.yTo,
      vi0: ep.vi0,
      harm: (i, t, a, v) => harmWith(d, ep, i, t, a, v),
    });
  CV.R = R;
  $("cCrumb").textContent = `Fire, month by month · ${yrs()}`;
  $("cLead").textContent = lead(d, R);
  $("cDate").textContent =
    `Fire detections from NASA satellites, ${d.y0}–${d.y1}. Years before ${viirsYear(d)} come from an older satellite and are adjusted to match. ` +
    `Data as of ${longDate(d.source.firms_updated)}.`;
  answers(R);
  const key = `${d.country}|${CV.yFrom}|${CV.yTo}`;
  if (key !== CV.mapKey) {
    CV.mapKey = key;
    drawMap(d);
  }
  method(d);
  calendarText(d, R);
  chartText(d, R);
  drawCharts();
}

/* ---------- words ---------- */
function lead(d: CountrySummary, R: SeriesAnalysis) {
  const name = the(d.name);
  if (R.total === 0) return `No vegetation fire hotspots were counted in ${name} in ${yrs()}.`;
  const peak = R.order[0].m,
    w = R.ranked[0],
    span = CV.yTo - CV.yFrom + 1;
  let t = `${cap(name)} burns most in ${MONL[peak]}.`;
  if (span > 2 && R.mean > 0)
    t += ` ${w.y} was its worst year ${span === d.y1 - d.y0 + 1 ? "on record" : `between ${CV.yFrom} and ${CV.yTo}`}, with ${times(w.h / R.mean)} the hotspots of an average year.`;
  if (VOLCANIC.has(d.country)) t += ` Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.`;
  if (CV.yFrom < viirsYear(d) && d.val.monthly_wape != null && d.val.monthly_wape > 1)
    t += ` Treat the years before ${viirsYear(d)} as rough: tested on years VIIRS saw, converted months were off by ${pc(d.val.monthly_wape)} on average.`;
  return t;
}

function answers(R: SeriesAnalysis) {
  if (R.total === 0) {
    $("ca1").textContent = $("ca2").textContent = "None";
    $("ca1n").textContent = $("ca2n").textContent = "No hotspots in these years.";
  } else {
    /* only months and years with hotspots; a place with fires in one month gets one */
    const top = R.order.slice(0, 3).filter(o => o.sum > 0),
      worst = R.ranked.slice(0, 3).filter(y => y.h > 0),
      quiet = R.order.filter(o => o.sum === 0),
      share = Math.round((top.reduce((a, o) => a + o.sum, 0) / R.total) * 100);
    $("ca1").textContent = monthRun(top.map(o => o.m));
    $("ca1n").textContent =
      (top.length === 1
        ? `Every hotspot fell in ${MONL[top[0].m]}.`
        : `${top.length === 2 ? "These two months" : "These three months"} hold ${share}% of all hotspots.`) +
      (quiet.length > 1
        ? ` ${quiet.length} months had none in these years.`
        : ` ${MONL[R.order[11].m]} is the quietest${quiet.length ? ", with none" : ""}.`);
    const vy = viirsYear(CV.d!),
      est = worst.some(y => y.y < vy);
    $("ca2").textContent = worst.map(y => y.y).join(", ");
    $("ca2n").innerHTML =
      worst.map(y => `<span class="cpRow">${y.y} · ${fmt(y.h)}${y.y < vy ? "*" : ""}</span>`).join("") +
      `<span class="cpRow">An average year: ${fmt(R.mean)}</span>` +
      (est ? `<span class="cpRow cpFn">* estimated from the older satellite</span>` : "");
  }
  const v = verdict(R, CV.focus),
    vi0 = epochs(CV.d!).vi0;
  $("cfM").value = String(CV.focus[1]);
  $("cfY").value = String(CV.focus[0]);
  if (!v) {
    $("ca3").textContent = "Outside the chosen years";
    $("ca3n").textContent = "Pick a month inside the years chosen at the top.";
  } else if (R.ser.every(r => r.m !== v.fm || r.h === 0)) {
    $("ca3").textContent = "No hotspots";
    $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
  } else {
    $("ca3").innerHTML = `<span class="${v.cls}">${esc(v.label)}</span><small>${esc(v.mult)}</small>`;
    $("ca3n").textContent =
      `${cap(nHot(v.f.h))} against a normal ${fmt(v.med)}; ${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal(v.rank)} busiest`} of ${v.n} ${MONL[v.fm]}s.` +
      (v.f.i < vi0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
  }
}

function calendarText(d: CountrySummary, R: SeriesAnalysis) {
  /* how often the busiest month of the year is the same month */
  const peaks = new Array(12).fill(0);
  let n = 0;
  for (const y of R.years) {
    const rows = R.ser.filter(r => r.y === y.y);
    const top = rows.reduce((a, r) => (r.h > a.h ? r : a), rows[0]);
    if (top.h > 0) {
      peaks[top.m]++;
      n++;
    }
  }
  const pm = peaks.indexOf(Math.max(...peaks)),
    most = R.total > 0 ? R.order[0].m : pm;
  $("cCalTitle").textContent =
    n <= 2
      ? CV.yFrom === CV.yTo
        ? `Every month of ${CV.yFrom}`
        : `Every month from ${CV.yFrom} to ${CV.yTo}`
      : pm === most || peaks[pm] > n / 2
        ? `${MONL[pm]} was the busiest month in ${peaks[pm]} of ${n} years`
        : `${MONL[most]} has the most fire in total, but the busiest month moves from year to year`;
  $("cCalSub").textContent = CV.yFrom === CV.yTo ? `${CV.yFrom}, by month.` : `${CV.yFrom} to ${CV.yTo}, newest at the top.`;
  document
    .querySelectorAll<HTMLButtonElement>("#cModeSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === CV.mode)));
  const vy = viirsYear(d);
  $("cCalTopH").textContent = CV.yTo >= vy ? `Seen by VIIRS, ${Math.max(vy, CV.yFrom)}–${CV.yTo}` : "";
  $("cCalBotH").textContent = CV.yFrom < vy ? `Converted from MODIS, ${CV.yFrom}–${Math.min(vy - 1, CV.yTo)}` : "";
  $("cCalNote").textContent =
    CV.mode === "count"
      ? `The outlined month is the one tested at the top; click any month to test it instead.`
      : `Each month against the median of the same month in ${yrs()}. Click any month to test it.`;
  /* the legend: the same stepped classes the calendar is drawn with */
  const cc = calendarClasses(R);
  $("cCalLegend").innerHTML =
    CV.mode === "count"
      ? cc.max > 0
        ? `<div>${stepped("Hotspots in a month", cc.colours, cc.breaks, cc.max)}</div>` + `<span class="cpNone"><i></i>none</span>`
        : ""
      : `<div class="cpRamp"><span>¼ of normal</span><i style="background:linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)"></i><span>4× normal</span></div><span>white: a normal month</span>`;
}

function chartText(d: CountrySummary, R: SeriesAnalysis) {
  const st = R.stats,
    meds = st.map(s => s.med),
    pk = meds.indexOf(Math.max(...meds)),
    lo = meds.indexOf(Math.min(...meds)),
    fy = CV.focus[0],
    span = yrs(),
    top = R.order.slice(0, 3).filter(o => o.sum > 0),
    topShare = R.total > 0 ? top.reduce((a, o) => a + o.sum, 0) / R.total : 0;
  $("cMonthsT").textContent =
    R.total === 0
      ? "No month stands out"
      : meds[lo] >= 10 && meds[pk] / meds[lo] >= 1.5
        ? `A typical ${MONL[pk]} has ${times(meds[pk] / meds[lo])} the hotspots of a typical ${MONL[lo]}`
        : topShare >= 0.5 && top.length > 1
          ? `${topShare >= 0.8 ? "Almost all" : "Most"} of the fire in ${the(d.name)} comes in ${monthRun(top.map(o => o.m))}; a typical ${MONL[lo]} has ${meds[lo] === 0 ? "none" : nHot(meds[lo])}`
          : meds[pk] > 0
            ? `A typical ${MONL[pk]} brings ${nHot(meds[pk])}; ${meds[lo] === 0 ? `a typical ${MONL[lo]}, none` : "the other months are close behind"}`
            : `Most months pass with no hotspots at all`;
  $("cMonthsS").textContent = `Hotspots per month, ${span}, with ${fy} in red. Click a month to test it.`;
  const w = R.ranked[0];
  $("cYearsT").textContent =
    R.total === 0
      ? "No year stands out"
      : R.years.length > 1 && R.mean > 0
        ? `${w.y} was the worst year, at ${times(w.h / R.mean)} the average`
        : `${fmt(w.h)} hotspots in ${w.y}`;
  $("cYearsS").textContent =
    `Hotspots per year, with ${fy} in red. Paler bars are estimated from the older satellite, with a line for the likely range.`;
  const fyRow = R.years.find(y => y.y === fy),
    rank = fyRow ? R.ranked.indexOf(fyRow) + 1 : 0;
  $("cCumT").textContent =
    !fyRow || R.total === 0
      ? "How each year adds up"
      : rank === 1
        ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the most of any year`
        : rank === R.years.length
          ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the fewest of ${R.years.length} years`
          : `${fy} ended with ${fmt(fyRow.h)} hotspots, the ${ordinal(rank)} most of ${R.years.length} years`;
  $("cCumS").textContent = `Running total of hotspots from January, one line per year.`;
  const ys = R.years,
    avg = (a: number, b: number, k: "naive" | "h") => {
      const r = ys.filter(y => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
  const n0 = avg(2007, 2011, "naive"),
    n1 = avg(2012, 2016, "naive"),
    h0 = avg(2007, 2011, "h"),
    h1 = avg(2012, 2016, "h");
  const can = n0 != null && h0 != null && n1 != null && h1 != null && n0 > 0 && h0 > 0;
  $("cSeamT").textContent = can
    ? `Joined raw, 2012 looks like a ${(n1! / n0!).toFixed(1)}× jump. Harmonized, it is ${(h1! / h0!).toFixed(1)}×`
    : "Raw counts against the harmonized record";
  $("cSeamNote").textContent = can
    ? `Average hotspots a year, 2012–2016 against 2007–2011. The jump in the raw line is the change of satellite, not more fire.`
    : n0 === 0 || h0 === 0
      ? "MODIS counted no hotspots here in 2007–2011, so the step at 2012 cannot be measured."
      : "The dashed line jumps in 2012 only because the sensor changed. Choose years from 2007 to 2016 or wider to measure the step.";
  /* nothing to chart for a place with no hotspots in these years */
  const none = R.total === 0;
  $("cCharts").hidden = $("cRawFig").hidden = none;
  $("cNoFire").hidden = !none;
  $("cNoFire").textContent = none ? `No fire was detected in ${the(d.name)} in ${span}, so there is nothing to chart.` : "";
}

/* ---------- charts, once Plot has loaded ---------- */
function chartsFailed() {
  const msg = `<p class="cpMapMsg" style="position:static">The charts did not load (cdnjs or jsdelivr did not answer). The numbers above are unaffected; reload to try again.</p>`;
  ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach(id => ($(id).innerHTML = msg));
  $("cCal2").innerHTML = "";
}
function drawCharts() {
  const d = CV.d,
    R = CV.R;
  if (!d || !R) return;
  if (!window.Plot || !window.d3) {
    const k = CV.k;
    ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach(id => {
      if (!$(id).firstChild) $(id).innerHTML = `<p class="cpCap">Drawing…</p>`;
    });
    loadPlotLib().then(
      () => CV.k === k && drawCharts(),
      () => CV.k === k && chartsFailed(),
    );
    return;
  }
  const N20 = d.monthly.N20,
    vy = viirsYear(d),
    pick = (y: number, m: number) => {
      CV.focus = [y, m];
      renderCountry();
    };
  calendar($("cCal"), $("cCal2"), R, {
    mode: CV.mode,
    focus: CV.focus,
    viirsYear: vy,
    tip: (r: SeriesRow) =>
      `${MONL[r.m]} ${r.y}: ${nHot(r.h)}\nNormal for ${MONL[r.m]}: ${fmt(r.med)}` +
      (r.med > 0 || r.h > 0 ? ` (${times(r.ratio)} normal)` : "") +
      `\n${r.src}` +
      (r.i < epochs(d).vi0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") +
      `\nRaw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])} (not used)` +
      `\nClick to test this month`,
    click: r => pick(r.y, r.m),
  });
  seasonal($("cMonths"), R, CV.focus[0], m => pick(CV.focus[0], m));
  annual($("cYears"), R, {
    viirsYear: vy,
    focusYear: CV.focus[0],
    tip: (y: YearRow) =>
      `${y.y}: ${nHot(y.h)}` +
      (R.mean > 0 ? `\n${y.h >= R.mean ? "+" : ""}${Math.round((y.h / R.mean - 1) * 100)}% against the average year` : "") +
      (y.y < vy ? `\nEstimated from MODIS, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "\nSeen by VIIRS") +
      `\nClick to test ${MONL[CV.focus[1]]} ${y.y}`,
    click: y => pick(y, CV.focus[1]),
  });
  cumulative($("cCum"), R, CV.focus[0]);
  seam($("cSeam"), R, vy);
  const from = { ...SENSOR_FROM, A: d.aqua_from[0] },
    xs = R.years.map(y => y.y);
  sensorLines(
    $("cRaw"),
    xs,
    SENSORS.map(z => ({
      name: z.name,
      c: z.c,
      dash: z.dash,
      v: xs.map(y => {
        if (y < from[z.s]) return NaN;
        const i = (y - d.y0) * 12;
        return d.monthly[z.s].slice(i, i + 12).reduce((a, b) => a + b, 0);
      }),
    })),
  );
}

/* ---------- the map ---------- */
function mapMsg(text: string) {
  $("cMap").innerHTML = `<p class="cpMapMsg">${esc(text)}</p>`;
}
function drawMap(d: CountrySummary) {
  const data = mapData(d, CV.yFrom, CV.yTo),
    k = d.country;
  /* the legend: one step per class, numbers on the edges between them */
  $("cMapLegend").innerHTML = data.n
    ? `<div>${stepped("Hotspots per square", classColours(data.breaks), data.breaks, data.max)}</div>`
    : "";
  /* how concentrated the burning is: the share of burning squares that hold half the hotspots */
  const vals = data.cells.features.map(f => f.properties.n).sort((a, b) => b - a),
    tot = vals.reduce((a, b) => a + b, 0);
  let acc = 0,
    k50 = 0;
  for (const v of vals) {
    acc += v;
    k50++;
    if (acc >= tot / 2) break;
  }
  const share = vals.length ? (k50 / vals.length) * 100 : 0;
  $("cMapTitle").textContent =
    tot > 0 && vals.length >= 10
      ? `Half of all hotspots fell in ${share < 1 ? "under 1" : Math.round(share)}% of the squares that burned`
      : "Where it burns";
  $("cMapSub").textContent = `Hotspots counted in each ${d.cell}° square (about ${Math.round(d.cell * 111)} km across), ${yrs()}.`;
  const name = the(d.name);
  $("cMapNote").innerHTML = data.n
    ? (coarse()
        ? "Tap a square for its numbers. Use two fingers to move and zoom."
        : "Hover over a square for its numbers. Use the buttons, or Ctrl/⌘ and scroll, to zoom.") +
      (data.cropped ? ` <button class="cpText cpSmall" id="cMapAll" type="button">Show all of ${esc(name)}</button>` : "") +
      `<span id="cMapBase"></span>`
    : `No hotspots were counted anywhere in ${esc(name)} in these years, so the map has no squares.<span id="cMapBase"></span>`;
  const all = document.getElementById("cMapAll");
  if (all) all.onclick = fitAll;
  const go = () => {
    if (CV.k !== k || !CV.d) return;
    showMap($("cMap"), d, data, CV.yFrom, CV.yTo, mapMsg, () => {
      const b = document.getElementById("cMapBase");
      if (b && CV.k === k) b.textContent = " The background map did not load, so only the squares and the outline are shown.";
    });
  };
  if (window.maplibregl) go();
  else {
    mapMsg("Loading the map…");
    loadMapLib().then(go, () => {
      if (CV.k === k) mapMsg("The map did not load (cdnjs did not answer). The numbers on this page are unaffected; reload to try again.");
    });
  }
}

/* ---------- method and trust ---------- */
function method(d: CountrySummary) {
  const val = d.val;
  const item = (v: string, t: string) => `<div><dt>${v}</dt><dd>${t}</dd></div>`;
  $("cTiles").innerHTML =
    item(
      val.raw_factor == null ? "n/a" : val.raw_factor.toFixed(1) + "×",
      `more hotspots from VIIRS than MODIS for the same fires in ${esc(the(d.name))}, 2012–2025`,
    ) +
    item(pc(val.annual_med_err), "typical error of a converted year, tested on years we could check") +
    item(pc(val.annual_max_err), "error in the worst tested year") +
    item(pc(val.monthly_wape), "typical error of a converted month, weighted by size");
  $("cRateNote").textContent = d.rate_note;
  $("cFilter").textContent = d.filter;
  $("cCell").textContent = `${d.cell}°`;
  const row = (label: string, a: number[]) => `<tr><td>${label}</td>${a.map(r => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
  $("cRates").innerHTML =
    `<tr><th>VIIRS per MODIS hotspot</th>${MON.map(m => `<th>${m}</th>`).join("")}</tr>` +
    row("Terra+Aqua", d.r_ta) +
    row("90% low", d.r_ta_lo) +
    row("90% high", d.r_ta_hi) +
    row("Terra only", d.r_t);
  $("cLoyo").innerHTML =
    `<tr><th>Held-out year</th><th>Seen by VIIRS</th><th>Predicted from MODIS</th><th>Raw MODIS</th><th>Error</th></tr>` +
    val.loyo
      .map(
        r =>
          `<tr><td>${Number(r.y)}</td><td>${fmt(r.obs)}</td><td>${fmt(r.pred)}</td><td>${fmt(r.modis)}</td><td>${r.obs > 0 ? (r.pred >= r.obs ? "+" : "") + Math.round((r.pred / r.obs - 1) * 100) + "%" : "n/a"}</td></tr>`,
      )
      .join("");
  const path = summaryPath(d.country),
    url = fileUrl(path);
  $("cSrc").innerHTML =
    `Data: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(path)}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, ` +
    `built from ${d.source.files} FIRMS files (latest FIRMS update ${esc(d.source.firms_updated.slice(0, 10))}). ` +
    `We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">https://earthdata.nasa.gov/firms</a>), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (<a href="https://earthdata.nasa.gov/lance" target="_blank" rel="noopener">https://earthdata.nasa.gov/lance</a>) and NASA's Earth Science Data and Information System (ESDIS). ` +
    `Outlines: Natural Earth.`;
}

function csv() {
  const d = CV.d,
    R = CV.R;
  if (!d || !R) return;
  const N20 = d.monthly.N20,
    rows = [
      "year,month,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs_not_used",
    ];
  R.ser.forEach(r =>
    rows.push([r.y, r.m + 1, r.h.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2), `"${r.src}"`, r.T, r.A, r.V, N20[r.i]].join(",")),
  );
  save(`burn-calendar_${d.country}_${CV.yFrom}-${CV.yTo}.csv`, rows.join("\n"), $("cDlMsg"));
}

/** wire the country view's controls; called once */
export function countryEvents() {
  $("cBack").onclick = () => {
    location.hash = "";
  };
  $("cRetry").onclick = () => {
    if (CV.k) load();
  };
  $("cFrom").onchange = $("cTo").onchange = e => {
    let a = +$("cFrom").value,
      b = +$("cTo").value;
    if (a > b) {
      if (e.target === $("cFrom")) b = a;
      else a = b;
    }
    CV.yFrom = a;
    CV.yTo = b;
    /* keep the tested month inside the chosen years */
    CV.focus = [Math.min(b, Math.max(a, CV.focus[0])), CV.focus[1]];
    $("cFrom").value = String(a);
    $("cTo").value = String(b);
    renderCountry();
  };
  $("cfM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("cfM").onchange = $("cfY").onchange = () => {
    CV.focus = [+$("cfY").value, +$("cfM").value];
    renderCountry();
  };
  document.querySelectorAll<HTMLButtonElement>("#cModeSeg button").forEach(
    b =>
      (b.onclick = () => {
        CV.mode = b.dataset.mode === "anom" ? "anom" : "count";
        renderCountry();
      }),
  );
  $("cDl").onclick = csv;
  /* the charts are drawn to their box's width; redraw them when it changes */
  let rt: number | undefined,
    lastW = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = $("cBody").clientWidth;
      if (!CV.d || $("country").hidden || w === lastW) return;
      lastW = w;
      drawCharts();
    }, 150);
  });
}
