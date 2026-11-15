import type { CalendarMode, CountrySummary, Epochs, Harmonized, SameDays, SensorSeries, SeriesAnalysis, SeriesRow, YearRow, YearToDate } from "./types";
import { MON, MONL, SAT_RULE } from "./data";
import { $, fmt, short, times } from "./util";
import { analyseSeries, harmWith, partSpan, rankWords, verdict, ytdSentence } from "./model";
import { save } from "./downloads";
import { HF_DATASET, HF_PAGE, fileUrl, loadSummary, pathOf } from "./hf";
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
/** months with data in a summary: v3 stops at the partial month, v2 runs to December */
const nMonths = (d: CountrySummary) => d.n_months ?? (d.y1 - d.y0 + 1) * 12;
/** the partial last month of a v3 summary, 0-based month, or null */
const partOf = (d: CountrySummary) => (d.partial ? { i: d.partial.i, y: d.partial.y, m: d.partial.m - 1, day: d.partial.day1 } : null);
/** "14 Nov 2026" */
const lastWords = (d: CountrySummary) => {
  const p = partOf(d);
  return p ? `${p.day} ${MON[p.m]} ${p.y}` : `31 Dec ${d.y1}`;
};
/** "2005", "2001–2025", or "2001–14 Nov 2026" when the last year is partial */
const yrs = () => {
  const p = CV.d ? partOf(CV.d) : null;
  if (p && CV.yTo >= p.y) return CV.yFrom === CV.yTo ? `${CV.yTo} to ${p.day} ${MON[p.m]}` : `${CV.yFrom}–${lastWords(CV.d!)}`;
  return CV.yFrom === CV.yTo ? String(CV.yFrom) : `${CV.yFrom}–${CV.yTo}`;
};
/** the partial month against the same days of 2012-2025 (gap-filled like 2026), from v3 */
function sameDays(d: CountrySummary): SameDays | null {
  const y = d.y2026,
    p = partOf(d);
  if (!y || !p) return null;
  const sd = y.same_days,
    years: number[] = [];
  for (let k = sd.years[0]; k <= sd.years[1]; k++) years.push(k);
  return { span: partSpan(p.m, p.day), cur: sd.cur, lo: sd.cur_lo, hi: sd.cur_hi, years, past: sd.V, med: sd.V_stats.median };
}
/** 2026 to date against 1 January to the same day of 2012-2025 (gap-filled like 2026), from v3 */
function ytdOf(d: CountrySummary): YearToDate | null {
  const y = d.y2026,
    p = partOf(d);
  if (!y || !p) return null;
  const t = y.ytd,
    years: number[] = [];
  for (let k = t.years[0]; k <= t.years[1]; k++) years.push(k);
  return {
    span: `1 Jan–${p.day} ${MON[p.m]}`,
    withPart: true,
    y: p.y,
    cur: t.cur,
    lo: t.cur_lo,
    hi: t.cur_hi,
    years,
    past: t.V,
    med: t.V_stats.median,
    rank: t.rank,
    n: t.V.length + 1,
  };
}
/** month i's days filled from NOAA-20, as words for a tooltip, or "" */
function convNote(d: CountrySummary, i: number) {
  const g = d.y2026?.hist_gaps?.find(x => x.i === i);
  if (g)
    return `${g.days.length} ${g.days.length === 1 ? "day" : "days"} (${g.days.join(", ")} ${MON[i % 12]}) of Suomi NPP outage, filled from NOAA-20 converted to Suomi NPP terms: ${fmt(g.filled)}, likely ${fmt(g.lo)} to ${fmt(g.hi)} (the archive's Suomi NPP count alone is ${fmt(g.v2)})`;
  const c = d.y2026?.conv_months.find(x => x.i === i);
  if (!c) return "";
  const days = c.days,
    run = days.length > 1 && days[days.length - 1] - days[0] === days.length - 1 ? `${days[0]}–${days[days.length - 1]}` : days.join(", ");
  const it = c.interp_days ?? [],
    parts = [
      days.length
        ? `${days.length} ${days.length === 1 ? "day" : "days"} (${run} ${MON[c.m - 1]}) from NOAA-20, converted to Suomi NPP terms: ${nHot(c.v_conv)}`
        : "",
      it.length
        ? `${it.join(", ")} ${MON[c.m - 1]} estimated from the days either side, because both satellites missed ${the(d.name)}'s overpasses: ${nHot(c.v_interp ?? 0)}`
        : "",
    ].filter(Boolean);
  return `${parts.join("; ")}; ${fmt(c.v)} in all, likely ${fmt(c.v_lo)} to ${fmt(c.v_hi)} for the month`;
}
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
  $("cTo").innerHTML = $("cfY").innerHTML = yo.join("");
  /* the first year must be a complete one: a range holding only the part year has no normal to compare with */
  $("cFrom").innerHTML = yo.slice(0, (partOf(d) ? partOf(d)!.y - 1 : d.y1) - d.y0 + 1).join("");
  CV.yFrom = d.y0;
  CV.yTo = d.y1;
  $("cFrom").value = String(d.y0);
  $("cTo").value = String(d.y1);
  /* test the latest complete month by default (October 2026 in v3; the partial month after it can be picked) */
  const p = partOf(d),
    last = p ? p.i - 1 : nMonths(d) - 1;
  CV.focus = [d.y0 + Math.floor(last / 12), last % 12];
  $("cStatus").hidden = true;
  $("cBody").hidden = $("cCtl").hidden = false;
  $("cName").textContent = d.name;
  renderCountry();
}

const FILL_SRC = "VIIRS Suomi NPP + NOAA-20 on days Suomi NPP missed, converted";
/** the harmonized month, with the days Suomi NPP missed filled from NOAA-20: in 2026 (already in monthly.V, with the
 * range of the conversion) and in past outages from 2018 (y2026.hist_gaps; the file keeps v2's value in monthly.V) */
function harmFilled(d: CountrySummary, ep: Epochs) {
  const y26 = d.y2026,
    p = partOf(d),
    gaps = new Map((y26?.hist_gaps ?? []).map(g => [g.i, g])),
    conv = new Map((y26?.conv_months ?? []).map(c => [c.i, c])),
    i26 = p && y26 ? p.i - (y26.v_obs.length - 1) : Infinity;
  return (i: number, t: number, a: number, v: number): Harmonized => {
    const g = gaps.get(i);
    if (g) return { h: g.filled, lo: g.lo, hi: g.hi, src: FILL_SRC };
    const x = harmWith(d, ep, i, t, a, v);
    if (i >= i26 && y26 && conv.has(i)) return { h: v, lo: y26.v_lo[i - i26], hi: y26.v_hi[i - i26], src: FILL_SRC };
    return x;
  };
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
      nm: nMonths(d),
      partI: partOf(d)?.i ?? -1,
      partMed: sameDays(d)?.med ?? null,
      harm: harmFilled(d, ep),
    });
  CV.R = R;
  $("cCrumb").textContent = `Fire, month by month · ${yrs()}`;
  $("cLead").textContent = lead(d, R);
  $("cDate").textContent =
    (d.partial
      ? `Fire detections from NASA satellites, ${d.y0} to ${longDate(d.last_date!)}; ${d.partial.y} is not over, so it is counted “so far” and compared only with the same dates of past years. `
      : `Fire detections from NASA satellites, ${d.y0}–${d.y1}. `) +
    `Years before ${viirsYear(d)} come from an older satellite and are adjusted to match. ` +
    (d.partial
      ? `Archive as of ${longDate(d.source.firms_updated)}; ${d.partial.y} from the FIRMS API.`
      : `Data as of ${longDate(d.source.firms_updated)}.`) +
    (d.v === 2 ? ` 2026 so far could not be loaded from Hugging Face, so this shows ${d.y0}–${d.y1} only. Reload the page to try again.` : "");
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
  if (R.any === 0) return `No vegetation fire hotspots were counted in ${name} in ${yrs()}.`;
  const t2 = R.partYear ? ytdOf(d) : null;
  if (R.total === 0)
    return `No vegetation fire hotspots were counted in ${name} in the complete years chosen.` + (t2 ? " " + ytdSentence(t2) : "");
  const peak = R.order[0].m,
    w = R.ranked[0],
    full = R.years.filter(y => !y.part),
    a = full[0]?.y ?? CV.yFrom,
    b = full[full.length - 1]?.y ?? CV.yTo;
  let t = `${cap(name)} burns most in ${MONL[peak]}.`;
  if (full.length > 2 && R.mean > 0)
    t += ` ${w.y} was its worst ${a === d.y0 && b === (partOf(d) ? partOf(d)!.y - 1 : d.y1) ? "complete year on record" : `year between ${a} and ${b}`}, with ${times(w.h / R.mean)} the hotspots of an average year.`;
  if (t2) t += " " + ytdSentence(t2);
  const jc = d.y2026?.join_check_2025;
  if (t2 && jc?.warn)
    t += ` Read ${t2.y} here with care: run on 2025, the method used for ${t2.y} came out ${Math.abs(jc.V_pct).toFixed(0)}% ${jc.V_pct > 0 ? "higher" : "lower"} than the archive.`;
  if (VOLCANIC.has(d.country)) t += ` Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.`;
  if (CV.yFrom < viirsYear(d) && d.val.monthly_wape != null && d.val.monthly_wape > 1)
    t += ` Treat the years before ${viirsYear(d)} as rough: tested on years VIIRS saw, converted months were off by ${pc(d.val.monthly_wape)} on average.`;
  return t;
}

function answers(R: SeriesAnalysis) {
  const d = CV.d!,
    t2 = R.partYear ? ytdOf(d) : null;
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
      (t2 ? `<span class="cpRow">${t2.y} so far (${t2.span}): ${fmt(t2.cur)}, ${rankWords(t2.rank, t2.n)} for the same dates</span>` : "") +
      (est ? `<span class="cpRow cpFn">* estimated from the older satellite</span>` : "");
  }
  const v = verdict(R, CV.focus, sameDays(d)),
    vi0 = epochs(d).vi0,
    fi = (CV.focus[0] - d.y0) * 12 + CV.focus[1];
  $("cfM").value = String(CV.focus[1]);
  $("cfY").value = String(CV.focus[0]);
  if (!v && fi >= nMonths(d)) {
    $("ca3").textContent = "No data yet";
    $("ca3n").textContent = `The record runs to ${longDate(d.last_date ?? `${d.y1}-12-31`)}. Pick an earlier month.`;
  } else if (!v) {
    $("ca3").textContent = "Outside the chosen years";
    $("ca3n").textContent = "Pick a month inside the years chosen at the top.";
  } else if (v.noSame) {
    $("ca3").textContent = "Not over yet";
    $("ca3n").textContent = `${cap(nHot(v.f.h))} so far. A month that is not over cannot be set against whole months.`;
  } else if (v.same && v.same.cur === 0 && v.same.past.every(x => x === 0)) {
    $("ca3").textContent = "No hotspots";
    $("ca3n").textContent = `No hotspots in ${v.same.span} in any year, so there is nothing to compare.`;
  } else if (v.same) {
    const sd = v.same;
    $("ca3").innerHTML = `<span class="${v.cls}">${esc(v.label)}</span><small>${esc(v.mult)}</small>`;
    $("ca3n").textContent =
      `${MONL[v.fm]} ${v.fy} is not over. ${cap(nHot(sd.cur))} in ${sd.span}` +
      (sd.hi - sd.lo >= 1 ? ` (likely ${fmt(sd.lo)} to ${fmt(sd.hi)})` : "") +
      ` against a normal ${fmt(sd.med)} for the same days of ${sd.years[0]}–${sd.years[sd.years.length - 1]}; ` +
      `${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal(v.rank)} busiest`} of ${v.n}. ` +
      `Suomi NPP stopped on 2 November, so most of these days are NOAA-20 converted to Suomi NPP terms; past days Suomi NPP missed are filled the same way.`;
  } else if (R.ser.every(r => r.m !== v.fm || r.h === 0)) {
    $("ca3").textContent = "No hotspots";
    $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
  } else {
    $("ca3").innerHTML = `<span class="${v.cls}">${esc(v.label)}</span><small>${esc(v.mult)}</small>`;
    $("ca3n").textContent =
      `${cap(nHot(v.f.h))} against a normal ${fmt(v.med)}; ${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal(v.rank)} busiest`} of ${v.n} ${MONL[v.fm]}s.` +
      (v.f.i < vi0
        ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.`
        : convNote(d, v.f.i)
          ? ` Seen by VIIRS (Suomi NPP), with ${convNote(d, v.f.i)}.`
          : " Seen directly by VIIRS.");
  }
}

function calendarText(d: CountrySummary, R: SeriesAnalysis) {
  /* how often the busiest month of the year is the same month */
  const peaks = new Array(12).fill(0);
  let n = 0;
  for (const y of R.years) {
    if (y.part) continue;
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
  const pt = partOf(d),
    toWords = pt && CV.yTo >= pt.y ? lastWords(d) : String(CV.yTo);
  $("cCalTopH").textContent = CV.yTo >= vy ? `Seen by VIIRS, ${Math.max(vy, CV.yFrom)}–${toWords}` : "";
  $("cCalBotH").textContent = CV.yFrom < vy ? `Converted from MODIS, ${CV.yFrom}–${Math.min(vy - 1, CV.yTo)}` : "";
  $("cCalNote").textContent =
    (CV.mode === "count"
      ? `The outlined month is the one tested at the top; click any month to test it instead.`
      : `Each month against the median of the same month in ${yrs()}. Click any month to test it.`) +
    (R.partYear && pt
      ? ` ${pt.y} runs to ${pt.day} ${MONL[pt.m]}: the dashed ${MONL[pt.m]} is not over and is compared with the same days of past years, December is blank because it has not happened, and the starred total is so far. Months with days Suomi NPP missed use NOAA-20 for those days, converted; hover for which.`
      : "");
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
  $("cMonthsS").textContent =
    `Hotspots per month, ${span}, with ${fy} in red. ` +
    (R.partYear && fy === R.partYear.y ? `Complete months only: ${MONL[partOf(d)!.m]} is not over. ` : "") +
    `Click a month to test it.`;
  const w = R.ranked[0];
  $("cYearsT").textContent =
    R.total === 0
      ? "No year stands out"
      : R.years.length > 1 && R.mean > 0
        ? `${w.y} was the worst year, at ${times(w.h / R.mean)} the average`
        : `${fmt(w.h)} hotspots in ${w.y}`;
  $("cYearsS").textContent =
    `Hotspots per year, with ${fy} in red. Paler bars are estimated from the older satellite, with a line for the likely range.` +
    (R.partYear ? ` The dashed bar is ${R.partYear.y} so far, to ${lastWords(d)}; it is not ranked against whole years.` : "");
  const fyRow = R.years.find(y => y.y === fy),
    rank = fyRow ? R.ranked.indexOf(fyRow) + 1 : 0,
    t2 = fyRow?.part ? ytdOf(d) : null;
  $("cCumT").textContent =
    !fyRow || R.any === 0
      ? "How each year adds up"
      : fyRow.part
        ? t2
          ? `${fy} so far: ${fmt(t2.cur)} hotspots by ${t2.span.replace("1 Jan–", "")}, ${rankWords(t2.rank, t2.n)} for the same dates`
          : `${fy} so far: ${fmt(fyRow.h)} hotspots to ${lastWords(d)}`
        : rank === 1
          ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the most of any year`
          : rank === R.years.length
            ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the fewest of ${R.years.length} years`
            : `${fy} ended with ${fmt(fyRow.h)} hotspots, the ${ordinal(rank)} most of ${R.years.length} years`;
  $("cCumS").textContent =
    `Running total of hotspots from January, one line per year.` +
    (R.partYear
      ? ` ${R.partYear.y}'s line stops at ${lastWords(d).replace(/ \d+$/, "")}; compare it with the other lines at the same point.`
      : "");
  const ys = R.years.filter(y => !y.part),
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
  const none = R.any === 0;
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
    y26 = d.y2026 && d.partial ? d.y2026 : null,
    vy = viirsYear(d),
    pick = (y: number, m: number) => {
      CV.focus = [y, m];
      renderCountry();
    };
  calendar($("cCal"), $("cCal2"), R, {
    mode: CV.mode,
    focus: CV.focus,
    viirsYear: vy,
    tip: (r: SeriesRow) => {
      const cn = convNote(d, r.i),
        k = r.i - (y26 ? partOf(d)!.i - (y26.v_obs.length - 1) : 0),
        obs = y26 && k >= 0 && k < y26.v_obs.length ? y26.v_obs[k] : null;
      return (
        (r.part
          ? `${MONL[r.m]} ${r.y}, ${partSpan(r.m, partOf(d)!.day)} so far: ${nHot(r.h)}\nNormal for the same days: ${fmt(r.med)}`
          : `${MONL[r.m]} ${r.y}: ${nHot(r.h)}\nNormal for ${MONL[r.m]}: ${fmt(r.med)}`) +
        (Number.isFinite(r.ratio) && (r.med > 0 || r.h > 0) ? ` (${times(r.ratio)} normal)` : "") +
        `\n${r.src}` +
        (r.i < epochs(d).vi0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") +
        (cn ? `\nIncludes ${cn}` : "") +
        (obs != null
          ? `\nRaw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(obs)} (its complete days), NOAA-20 ${fmt(N20[r.i])}${cn ? " (used only for the days Suomi NPP missed)" : " (not used)"}`
          : `\nRaw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])}${cn ? " (used only for the days Suomi NPP missed)" : " (not used)"}`) +
        `\nClick to test this month`
      );
    },
    click: r => pick(r.y, r.m),
  });
  seasonal($("cMonths"), R, CV.focus[0], m => pick(CV.focus[0], m));
  annual($("cYears"), R, {
    viirsYear: vy,
    focusYear: CV.focus[0],
    tip: (y: YearRow) => {
      if (y.part) {
        const t2 = ytdOf(d);
        return (
          `${y.y} so far, to ${lastWords(d)}: ${nHot(y.h)}` +
          (t2 ? `\n${rankWords(t2.rank, t2.n)} for ${t2.span} (typical ${fmt(t2.med)})` : "") +
          `\nNot ranked against whole years\nClick to test ${MONL[CV.focus[1]]} ${y.y}`
        );
      }
      return (
        `${y.y}: ${nHot(y.h)}` +
        (R.mean > 0 ? `\n${y.h >= R.mean ? "+" : ""}${Math.round((y.h / R.mean - 1) * 100)}% against the average year` : "") +
        (y.y < vy ? `\nEstimated from MODIS, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "\nSeen by VIIRS") +
        `\nClick to test ${MONL[CV.focus[1]]} ${y.y}`
      );
    },
    click: y => pick(y, CV.focus[1]),
  });
  const pp = partOf(d);
  cumulative($("cCum"), R, CV.focus[0], pp && d.partial ? { frac: pp.day / d.partial.days_in_month, label: `${pp.day} ${MON[pp.m]}` } : null);
  seam($("cSeam"), R, vy);
  /* whole years only: a year under way would read as a fall in every sensor */
  const from = { ...SENSOR_FROM, A: d.aqua_from[0] },
    xs = R.years.filter(y => !y.part).map(y => y.y);
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
  const y26 = d.y2026,
    p = partOf(d),
    jc = y26?.join_check_2025;
  $("cSatRule").textContent = p ? SAT_RULE : "Suomi NPP only from 2012; NOAA-20 is not added, which would count the same fires twice.";
  $("c2026").hidden = !y26;
  $("c2026").textContent = y26
    ? `2026, to ${longDate(d.last_date!)}: from the FIRMS API (standard processing to July, near real time after), counted with the same filter. ` +
      `${y26.mask_note.split(" The task first asked")[0]} ` +
      (jc
        ? `Rerun on 2025, this 2026 method differed from the published 2025 count for ${the(d.name)} by ${jc.V_pct >= 0 ? "+" : "−"}${Math.abs(jc.V_pct).toFixed(1)}%` +
          (jc.warn ? `, more than the 5% most countries stay within, so read ${p!.y} against past years with that in mind.` : ".")
        : "")
    : "";
  $("cLimits").textContent = p
    ? `Limits. The record runs to ${longDate(d.last_date!)}, the last complete day; ${p.y} is a partial year, counted “so far” and compared only with the same dates in past years, and ${MONL[p.m]} ${p.y} covers days 1–${p.day}. ` +
      `Converted months are estimates and small countries are noisy: MODIS misses many small fires, so a converted zero can hide real burning. Suomi NPP outages from 2018 on are filled from NOAA-20 the same way as in ${p.y} (the published file keeps the archive's Suomi NPP count and gives the filled one alongside); earlier gaps and cloud are not corrected. A hotspot is one satellite pixel that looked like fire, not a fire count or burned area.`
    : `Limits. The record ends in December ${d.y1}. Converted months are estimates and small countries are noisy: MODIS misses many small fires, so a converted zero can hide real burning. Satellite outages and cloud are not corrected. A hotspot is one satellite pixel that looked like fire, not a fire count or burned area.`;
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
  const path = pathOf(d),
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
    p = partOf(d),
    conv = new Map((d.y2026?.conv_months ?? []).map(c => [c.i, c])),
    rows = [
      "year,month,month_status,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs,noaa20_days_used_converted,noaa20_converted_snpp_terms,days_estimated_from_neighbours,estimated_snpp_terms",
    ];
  /* 2026: harmonized = Suomi NPP on its complete days + NOAA-20 x rate on the days it missed, never both;
     raw_snpp_viirs is then Suomi NPP's own complete days, and the range is that of the conversion */
  const gaps = new Map((d.y2026?.hist_gaps ?? []).map(g => [g.i, g]));
  R.ser.forEach(r => {
    const c = conv.get(r.i),
      g = gaps.get(r.i),
      k = p && d.y2026 ? r.i - (p.i - (d.y2026.v_obs.length - 1)) : -1,
      in26 = k >= 0 && !!d.y2026 && k < d.y2026.v_obs.length;
    rows.push(
      [
        r.y,
        r.m + 1,
        r.part ? `partial_to_${d.last_date}` : "complete",
        r.h.toFixed(2),
        (in26 ? d.y2026!.v_lo[k] : r.lo).toFixed(2),
        (in26 ? d.y2026!.v_hi[k] : r.hi).toFixed(2),
        `"${c || g ? FILL_SRC : r.src}"`,
        r.T,
        r.A,
        /* Suomi NPP as observed: in 2026 on the days it is used; for a past outage month, the whole month as archived */
        in26 ? d.y2026!.v_obs[k] : r.V,
        N20[r.i],
        c ? `"${c.days.join(" ")}"` : g ? `"${g.days.join(" ")}"` : "",
        c ? c.v_conv : g ? g.n20_conv : "",
        c?.interp_days ? `"${c.interp_days.join(" ")}"` : "",
        c?.interp_days ? (c.v_interp ?? "") : "",
      ].join(","),
    );
  });
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
