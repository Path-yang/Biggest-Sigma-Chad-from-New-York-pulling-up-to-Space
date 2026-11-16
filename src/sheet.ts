import type { Analysis, SheetTab, Show, StateCode } from "./types";
import { D, LAND_KM2, LAST_I, LAST_WORDS, MON, MONL, NAME, SAT_RULE, SLUG, STC, STS, VI0, Y0, fillNote, span } from "./data";
import { S } from "./state";
import { $, fmt, times } from "./util";
import { div, paintRamp, seq } from "./color";
import {
  analyseFor,
  countyRisk,
  harm,
  leadText,
  notFireNote,
  placeName,
  rankWords,
  riskFor,
  sameDaysFor,
  selMask,
  verdict,
  ytdFor,
} from "./model";
import { hideTip } from "./tooltip";
import { setCounty, showLabel } from "./map";
import { bars, calendarInto, lines } from "./charts";
import { stopPlay } from "./play";
import { render } from "./render";
import { renderStaff } from "./respui";
import { countyRiskFc, forecastLine, renderForecastSheet } from "./fcui";
import { olStart, renderOutlookSheet } from "./olui";
import { fcOn, isFc, pctP } from "./forecast";
import { fmtPop, popSentence, popState, popSuffix, popWhen } from "./pop";

export function renderArea(R: Analysis) {
  $("shTitle").textContent = placeName();
  $("shCrumb").textContent = (S.sel.type === "state" ? "State" : NAME[S.st!]) + ` · ${span(S.yFrom, S.yTo)}`;
  const ytd = ytdFor(R, S.st!, S.sel);
  $("shLead").textContent = leadText(R, ytd);
  if (R.total === 0) {
    $("a1").textContent = $("a2").textContent = "None";
    $("a1n").textContent = $("a2n").textContent = "";
  } else {
    const top = R.order.slice(0, 3);
    $("a1").textContent = top.map(o => MON[o.m]).join(", ");
    $("a1n").textContent =
      `These three months hold ${Math.round((top.reduce((a, o) => a + o.sum, 0) / R.total) * 100)}% of all hotspots. ${MONL[R.order[11].m]} is the quietest.`;
    $("a2").textContent = R.ranked
      .slice(0, 3)
      .map(y => y.y)
      .join(", ");
    $("a2n").textContent =
      R.ranked
        .slice(0, 3)
        .map(y => `${y.y}: ${fmt(y.h)}${y.y < 2012 ? " (converted)" : ""}`)
        .join(" · ") +
      `. An average year has ${fmt(R.mean)}.` +
      (R.partYear ? ` ${R.partYear.y} is left out until it is over.` : "") +
      (ytd ? ` ${ytd.y} so far: ${fmt(ytd.cur)} for ${ytd.span}, ${rankWords(ytd.rank, ytd.n)} for the same dates.` : "");
  }
  const v = verdict(R, S.focus, sameDaysFor(S.st!, S.sel)),
    fi = (S.focus[0] - Y0) * 12 + S.focus[1];
  $("fM").value = String(S.focus[1]);
  $("fY").value = String(S.focus[0]);
  if (!v) {
    $("a3").textContent = fi > LAST_I ? "No data yet" : "Outside the chosen years";
    $("a3n").textContent = fi > LAST_I ? `The record runs to ${LAST_WORDS}.` : "";
  } else if (v.noSame) {
    $("a3").innerHTML = `<span class="pill">${v.label}</span>`;
    $("a3n").textContent =
      `${fmt(v.f.h)} hotspots in ${MONL[v.fm]} ${v.fy} so far, to ${LAST_WORDS}. A part month cannot be set against whole months. ` +
      `The same days of past years are kept for the whole state and each county: choose one of them to test it.`;
  } else if (v.same && v.same.cur === 0 && v.same.past.every(x => x === 0)) {
    $("a3").textContent = "No hotspots";
    $("a3n").textContent = `No hotspots in ${v.same.span} in any year from ${v.same.years[0]}, so there is nothing to compare.`;
  } else if (v.same) {
    const sd = v.same;
    $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
    $("a3n").textContent =
      `${MONL[v.fm]} ${v.fy} is not over: ${fmt(sd.cur)} hotspots in ${sd.span}` +
      (sd.hi - sd.lo >= 1 ? ` (likely ${fmt(sd.lo)} to ${fmt(sd.hi)})` : "") +
      `, against a normal ${fmt(sd.med)} for the same days of ${sd.years[0]}–${sd.years[sd.years.length - 1]}. Rank ${v.rank} of ${v.n} years. Most of these days are from NOAA-20, converted to Suomi NPP terms` +
      (D.states[S.st!].partial?.filled_years?.length
        ? `; the days Suomi NPP missed in ${D.states[S.st!].partial!.filled_years!.join(", ")} are filled the same way.`
        : ".");
  } else {
    $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
    $("a3n").textContent =
      `${fmt(v.f.h)} hotspots against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` +
      (v.f.i < VI0
        ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.`
        : fillNote(v.f.i, S.st!)
          ? ` Seen by VIIRS: Suomi NPP, with ${fillNote(v.f.i, S.st!)}.`
          : " Seen directly by VIIRS.");
  }
  const rk = riskFor(R, S.rm),
    mo = MONL[S.rm];
  $("rmSheet").value = String(S.rm);
  $("a4").textContent = rk.n ? `${Math.round(rk.p * 100)}%` : "No data";
  $("a4n").textContent = rk.n
    ? `Fire was detected here in ${rk.k} of the ${rk.n} ${mo}s from ${rk.a} to ${rk.b}.` +
      (rk.k
        ? ` When it burns, typically ${fmt(rk.typical)} hotspots; the worst was ${fmt(rk.worst.h)} in ${rk.worst.y}. Most recent: ${rk.last}.`
        : "") +
      " History, not a forecast." +
      notFireNote(S.st!, selMask()) +
      forecastLine(S.st!)
    : "";
  const share = (x: number) => (x >= 0.095 ? Math.round(x * 100) + "%" : x >= 0.001 ? (x * 100).toFixed(1) + "%" : x > 0 ? "<0.1%" : "0%"),
    who = window.RESPONSE ? "Counties, and the stations that reach each place first by road," : "Counties";
  let watched: number[];
  if (isFc() && fcOn(S.st!)) {
    const yr = S.odds as number;
    $("watchTitle").textContent = `Where to watch in ${mo} ${yr}: forecast`;
    $("watchNote").textContent =
      `${who} ranked by their share of ${NAME[S.st!]}'s forecast fire risk for ${mo} ${yr}: each hexagon counts by its chance of at least one hotspot. ` +
      `The forecast is built from fire history alone, not weather, and says nothing about how each station is staffed. Tap one to see it on the map.`;
    const wl = countyRiskFc(S.st!, S.rm, yr).slice(0, 8);
    watched = wl.map(w => w.ci);
    $("watch").innerHTML = wl
      .map(
        (w, i) =>
          `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share(w.share)}</span><small>Chance of fire somewhere in the county ${pctP(w.p)} · about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons expected to burn${popSuffix(S.st!, w.ci)}</small></button>`,
      )
      .join("");
  } else {
    const wl = countyRisk(S.st!, S.rm).slice(0, 8);
    watched = wl.map(w => w.ci);
    $("watchTitle").textContent = `Where to watch in ${mo}: past odds`;
    $("watchNote").textContent =
      `${who} ranked by how often fire comes to their hexagons in ${mo}, ${rk.a}–${rk.b}: each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire. ` +
      `The percentage is their share of ${NAME[S.st!]}'s. This is the historical pattern, not a forecast for this year. Hotspots are what satellites saw burning, not calls or incidents, and this says nothing about how a station is staffed. Tap one to see it on the map.`;
    $("watch").innerHTML = wl
      .map(
        (w, i) =>
          `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share(w.share)}</span><small>Fire in ${w.k} of ${w.n} ${mo}s · about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons burn in an average ${mo} · about ${fmt(w.mean)} hotspots${popSuffix(S.st!, w.ci)}</small></button>`,
      )
      .join("");
  }
  const wp = popSentence(S.st!, watched, n => (n === 1 ? "This county" : `These ${n} counties`)),
    sp = popState(S.st!);
  $("watchPop").hidden = !wp;
  $("watchPop").textContent = wp + (wp && sp != null ? ` ${NAME[S.st!]} as a whole has ${fmtPop(sp)}.` : "");
  renderForecastSheet();
  renderStaff();
  renderOutlookSheet();
  $("watch")
    .querySelectorAll<HTMLButtonElement>(".w")
    .forEach(
      b =>
        (b.onclick = () => {
          closeSheet();
          S.layer = "chance";
          setCounty(+b.dataset.ci!);
        }),
    );
  const sh = S.show,
    ys = R.years,
    xs = ys.map(y => y.y),
    pick = (show: Show) => {
      stopPlay();
      S.layer = "count";
      S.show = show;
      render();
    };
  bars(
    $("chMonths"),
    MON,
    R.stats.map(z => z.med),
    {
      aria: "Typical hotspots by calendar month",
      sel: sh.t === "cmonth" ? sh.m : -1,
      lo: R.stats.map(z => z.q1),
      hi: R.stats.map(z => z.q3),
      whisk: () => true,
      tip: m =>
        `${MONL[m]}\nTypical: ${fmt(R.stats[m].med)} hotspots\nHalf of years fall between ${fmt(R.stats[m].q1)} and ${fmt(R.stats[m].q3)}`,
      click: m => pick(sh.t === "cmonth" && sh.m === m ? { t: "all" } : { t: "cmonth", m }),
    },
  );
  const top: number[] = [];
  ys.map((y, i) => [y.part ? 0 : y.h, i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .forEach(a => {
      if (a[0] > 0 && !top.some(i => Math.abs(i - a[1]) < 2)) top.push(a[1]);
    });
  bars(
    $("chYears"),
    xs,
    ys.map(y => y.h),
    {
      aria: "Hotspots per year",
      step: Math.ceil(xs.length / 9),
      sel: sh.t === "year" ? sh.y - S.yFrom : -1,
      avg: R.mean,
      top,
      hatch: i => xs[i] < 2012,
      part: i => !!ys[i].part,
      lo: ys.map(y => y.lo),
      hi: ys.map(y => y.hi),
      whisk: i => xs[i] < 2012,
      tip: i =>
        ys[i].part
          ? `${xs[i]} so far, to ${LAST_WORDS}: ${fmt(ys[i].h)} hotspots\nThe year is not over, so it is not set against whole years` +
            (ytd ? `\n${ytd.span}: ${rankWords(ytd.rank, ytd.n)} for the same dates` : "")
          : `${xs[i]}: ${fmt(ys[i].h)} hotspots\n${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` +
            (xs[i] < 2012 ? `\nConverted from MODIS, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "\nSeen by VIIRS"),
      click: i => pick(sh.t === "year" && sh.y === xs[i] ? { t: "all" } : { t: "year", y: xs[i] }),
    },
  );
  calendarInto($("cal"), R, {
    mode: S.mode,
    focus: true,
    click: r => {
      stopPlay();
      S.focus = [r.y, r.m];
      S.layer = "count";
      S.show = { t: "ym", y: r.y, m: r.m };
      render();
    },
  });
  $("calNote").textContent =
    (S.mode === "count"
      ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual and to put it on the map."
      : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.") +
    (R.partYear
      ? ` The record runs to ${LAST_WORDS}: the dashed month is not over and is compared with the same days of past years, and later months are blank, not zero. Months marked · have days filled from NOAA-20.`
      : "");
  paintRamp("calRamp", S.mode === "count" ? seq : t => div(t * 2 - 1));
  $("calLo").textContent = S.mode === "count" ? "fewer" : "⅛× normal";
  $("calHi").textContent = S.mode === "count" ? "more (log scale)" : "8× normal";
  /* whole years only: a year still under way would look like a drop */
  const fy = ys.filter(y => !y.part),
    fx = fy.map(y => y.y);
  lines(
    $("chSeam"),
    fx,
    [
      { v: fy.map(y => y.naive), c: "#6fa8ff" },
      { v: fy.map(y => y.h), c: "#ff8a3d" },
    ],
    {
      W: 660,
      vline: fx.indexOf(2012),
      aria: "Raw joined counts against the harmonized record",
      tip: i => `${fx[i]}\nHarmonized: ${fmt(fy[i].h)}\nRaw counts: ${fmt(fy[i].naive)}`,
    },
  );
  const avg = (a: number, b: number, k: "naive" | "h") => {
    const r = ys.filter(y => y.y >= a && y.y <= b);
    return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
  };
  const n0 = avg(2007, 2011, "naive"),
    n1 = avg(2012, 2016, "naive"),
    h0 = avg(2007, 2011, "h"),
    h1 = avg(2012, 2016, "h");
  $("seamNote").textContent =
    n0 && h0 && n1 != null && h1 != null && S.sel.type === "state"
      ? `Raw counts make 2012–2016 look ${(n1! / n0).toFixed(1)}× busier than 2007–2011. In the harmonized record the step is ${(h1! / h0).toFixed(1)}×.`
      : "The blue line jumps in 2012 only because the sensor changed. Choose the whole state and all years to measure the step.";
  const s = D.states[S.st!],
    val = s.val,
    pc = (x: number) => Math.round(x * 100) + "%";
  $("tiles").innerHTML =
    `<div class="tile"><b>${val.raw_factor.toFixed(1)}×</b><span>more hotspots from VIIRS than MODIS for the same fires in ${NAME[S.st!]}</span></div><div class="tile"><b>${pc(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc(val.annual_max_err)}</b><span>error in the worst tested year</span></div>`;
  $("maskTxt").textContent = `${s.mask.static_sites} sites removed in ${NAME[S.st!]}.`;
  $("satRule").textContent = SAT_RULE;
  $("rates").innerHTML =
    `<tr><th>Rate</th>${MON.map(m => `<th>${m}</th>`).join("")}</tr><tr><td>Terra+Aqua</td>${s.r_ta.map(r => `<td>${r.toFixed(1)}</td>`).join("")}</tr><tr><td>Terra only</td>${s.r_t.map(r => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
  $("mapNote").hidden = sh.t === "all" || S.layer === "chance";
  $("mapNoteTxt").textContent = "The map behind now shows: " + showLabel().toLowerCase() + ".";
}
function cmpStats(st: StateCode) {
  const R = analyseFor(st, { type: "state" }),
    s = D.states[st],
    tot = new Float64Array(s.counties.length),
    i0 = (S.yFrom - Y0) * 12,
    /* complete years only, like the totals it is a share of */
    i1 =
      R.partYear && R.ranked.length && !R.ranked[0].part
        ? Math.min((S.yTo - Y0 + 1) * 12, (R.partYear.y - Y0) * 12)
        : (S.yTo - Y0 + 1) * 12,
    rows = s.county_rows;
  for (let p = 0; p < rows.length; p += 5) {
    const i = rows[p + 1];
    if (i >= i0 && i < i1) tot[rows[p]] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
  }
  let k = 0;
  for (let c = 1; c < tot.length; c++) if (tot[c] > tot[k]) k = c;
  let acc = 0,
    season = 0;
  for (const o of R.order) {
    if (acc >= 0.8 * R.total) break;
    acc += o.sum;
    season++;
  }
  return {
    st,
    R,
    mean: R.mean,
    dens: (R.mean / LAND_KM2[st]) * 1000,
    peak: R.order[0].m,
    season,
    worst: R.ranked[0],
    worstX: R.mean ? R.ranked[0].h / R.mean : 0,
    county: s.counties[k].name,
    countyShare: R.total ? tot[k] / R.total : 0,
    ytd: ytdFor(R, st, { type: "state" }),
  };
}
type StateSummary = ReturnType<typeof cmpStats>;
/** one row of the side-by-side table: label, value, number for the bar (or null), small print (or "") */
type ScoreRow = [string, (c: StateSummary) => string, ((c: StateSummary) => number) | null, ((c: StateSummary) => string) | ""];
export function renderCompare() {
  const C = STS.map(cmpStats),
    big = C.slice().sort((a, b) => b.mean - a.mean)[0],
    small = C.find(c => c !== big)!;
  $("shTitle").textContent = STS.map(k => NAME[k]).join(" and ");
  $("shCrumb").textContent = `Compare states · ${span(S.yFrom, S.yTo)}`;
  $("cmpLead").textContent =
    small.mean > 0
      ? `${NAME[big.st]} records about ${Math.round(big.mean / small.mean)} times as many fire hotspots as ${NAME[small.st]} in an average year, and ${Math.round(big.dens / small.dens)} times as many for its size. ${NAME[small.st]} burns mostly in ${MONL[small.peak]}; ${NAME[big.st]} in ${MONL[big.peak]}.`
      : "";
  const rowsDef: ScoreRow[] = [
    ["Hotspots in an average year", c => fmt(c.mean), c => c.mean, ""],
    ["Per 1,000 km² of land, per year", c => fmt(c.dens), c => c.dens, ""],
    ["Busiest month", c => MONL[c.peak], null, c => `${Math.round((c.R.order[0].sum / c.R.total) * 100)}% of the year's hotspots`],
    ["Months that hold 80% of the fire", c => c.season + (c.season === 1 ? " month" : " months"), c => c.season, ""],
    [
      "Worst year",
      c => String(c.worst.y),
      c => c.worstX,
      c => `${times(c.worstX)} an average year${c.worst.y < 2012 ? " (converted)" : ""}`,
    ],
    ["Most active county", c => c.county, null, c => `${Math.round(c.countyShare * 100)}% of the state's hotspots`],
  ];
  if (STS.every(st => popState(st) != null))
    rowsDef.push(["Population", c => fmtPop(popState(c.st)!), c => popState(c.st)!, () => popWhen()]);
  if (C.every(c => c.ytd))
    rowsDef.push([
      `${C[0].ytd!.y} so far (${C[0].ytd!.span})`,
      c => fmt(c.ytd!.cur),
      c => (c.ytd!.med > 0 ? c.ytd!.cur / c.ytd!.med : 0),
      c =>
        `${c.ytd!.med > 0 ? times(c.ytd!.cur / c.ytd!.med) + " the typical " + c.ytd!.span + ", " : ""}${rankWords(c.ytd!.rank, c.ytd!.n)} for the same dates`,
    ]);
  let h = `<div class="sh"></div>` + C.map(c => `<div class="sh"><i style="background:${STC[c.st]}"></i>${NAME[c.st]}</div>`).join("");
  for (const [label, val, num, sub] of rowsDef) {
    const mx = num ? Math.max(...C.map(num)) : 0;
    h +=
      `<div class="sl">${label}</div>` +
      C.map(
        c =>
          `<div class="sv"><b>${val(c)}</b>${sub ? `<small>${sub(c)}</small>` : ""}${num ? `<div class="bar" style="width:${mx ? Math.max(0.5, (num(c) / mx) * 100) : 0}%;background:${STC[c.st]}"></div>` : ""}</div>`,
      ).join("");
  }
  $("score").innerHTML = h;
  const key = C.map(c => `<span><i style="background:${STC[c.st]};height:3px"></i>${NAME[c.st]}</span>`).join("");
  $("cmpKey1").innerHTML = $("cmpKey2").innerHTML = key;
  const share = (c: StateSummary) => c.R.stats.map(z => (c.R.total ? (z.sum / c.R.total) * 100 : 0)),
    /* whole years only: the year under way is in the row above, against the same dates */
    idx = (c: StateSummary) => c.R.years.filter(y => !y.part).map(y => (c.mean ? y.h / c.mean : 0)),
    xs = C[0].R.years.filter(y => !y.part).map(y => y.y);
  lines(
    $("chCmpMonths"),
    MON,
    C.map(c => ({ name: NAME[c.st], c: STC[c.st], v: share(c) })),
    {
      W: 560,
      h: 250,
      labels: true,
      every: 12,
      fy: v => Math.round(v) + "%",
      aria: "Share of yearly hotspots by month, by state",
      tip: m => MONL[m] + "\n" + C.map(c => `${NAME[c.st]}: ${share(c)[m].toFixed(1)}% of its year`).join("\n"),
    },
  );
  lines(
    $("chCmpYears"),
    xs,
    C.map(c => ({ name: NAME[c.st], c: STC[c.st], v: idx(c) })),
    {
      W: 560,
      h: 250,
      labels: true,
      base: 1,
      every: 9,
      fy: v => v + "×",
      aria: "Each year against the state's own average",
      tip: i => xs[i] + "\n" + C.map(c => `${NAME[c.st]}: ${times(idx(c)[i])} its average (${fmt(c.R.years[i].h)} hotspots)`).join("\n"),
    },
  );
  $("twoCal").innerHTML = C.map(
    c =>
      `<div><h4><span>${NAME[c.st]}</span><button class="link" type="button" data-open="${c.st}">Open ${NAME[c.st]}</button></h4><div class="cal compact" id="cal${c.st}"></div></div>`,
  ).join("");
  C.forEach(c => calendarInto($("cal" + c.st), c.R, { compact: true, mode: "count" }));
  $("twoCal")
    .querySelectorAll<HTMLButtonElement>("[data-open]")
    .forEach(
      b =>
        (b.onclick = () => {
          closeSheet(true);
          location.hash = SLUG[b.dataset.open as StateCode];
        }),
    );
  $("mapNote").hidden = true;
}
export function openSheet(tab: SheetTab) {
  S.sheet = tab;
  const w = $("sheetWrap");
  w.hidden = false;
  $("tabs").hidden = !S.st;
  $("tabArea").textContent = S.st ? placeName() : "";
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  $("paneArea").hidden = tab !== "area";
  $("paneCmp").hidden = tab !== "compare";
  $("sheet").scrollTop = 0;
  render();
  /* the full data lists the 14-day outlook: ask for the weather now, if it is not here yet */
  if (tab === "area" && S.st) olStart(S.st);
  $("shClose").focus();
}
export function closeSheet(silent?: boolean) {
  if (!S.sheet) return;
  S.sheet = null;
  $("sheetWrap").hidden = true;
  hideTip();
  if (!silent && location.hash === "#compare") location.hash = "";
}
