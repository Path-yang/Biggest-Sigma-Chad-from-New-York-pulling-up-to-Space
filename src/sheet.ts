import type { Analysis, SheetTab, Show, StateCode } from "./types";
import { D, LAND_KM2, MON, MONL, NAME, SLUG, STC, STS, VI0, Y0 } from "./data";
import { S } from "./state";
import { $, fmt, times } from "./util";
import { div, paintRamp, seq } from "./color";
import { analyseFor, countyRisk, harm, leadText, placeName, riskFor, verdict } from "./model";
import { hideTip } from "./tooltip";
import { setCounty, showLabel } from "./map";
import { bars, calendarInto, lines } from "./charts";
import { stopPlay } from "./play";
import { render } from "./render";

export function renderArea(R: Analysis) {
  $("shTitle").textContent = placeName();
  $("shCrumb").textContent = (S.sel.type === "state" ? "State" : NAME[S.st!]) + ` · ${S.yFrom}–${S.yTo}`;
  $("shLead").textContent = leadText(R);
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
        .join(" · ") + `. An average year has ${fmt(R.mean)}.`;
  }
  const v = verdict(R);
  $("fM").value = String(S.focus[1]);
  $("fY").value = String(S.focus[0]);
  if (!v) {
    $("a3").textContent = "Outside the chosen years";
    $("a3n").textContent = "";
  } else {
    $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
    $("a3n").textContent =
      `${fmt(v.f.h)} hotspots against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` +
      (v.f.i < VI0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
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
      " History, not a forecast."
    : "";
  const wl = countyRisk(S.st!, S.rm).slice(0, 8);
  $("watchTitle").textContent = `Where to watch in ${mo}: ${NAME[S.st!]} counties`;
  $("watch").innerHTML = wl
    .map(
      (w, i) =>
        `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${Math.round(w.p * 100)}%</span><small>Fire in ${w.k} of ${w.n} ${mo}s · typically ${fmt(w.med)} hotspots</small></button>`,
    )
    .join("");
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
  ys.map((y, i) => [y.h, i])
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
      fill: i => (xs[i] < 2012 ? "url(#hatch)" : "#ff8a3d"),
      lo: ys.map(y => y.lo),
      hi: ys.map(y => y.hi),
      whisk: i => xs[i] < 2012,
      tip: i =>
        `${xs[i]}: ${fmt(ys[i].h)} hotspots\n${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` +
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
    S.mode === "count"
      ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual and to put it on the map."
      : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.";
  paintRamp("calRamp", S.mode === "count" ? seq : t => div(t * 2 - 1));
  $("calLo").textContent = S.mode === "count" ? "fewer" : "⅛× normal";
  $("calHi").textContent = S.mode === "count" ? "more (log scale)" : "8× normal";
  lines(
    $("chSeam"),
    xs,
    [
      { v: ys.map(y => y.naive), c: "#6fa8ff" },
      { v: ys.map(y => y.h), c: "#ff8a3d" },
    ],
    {
      W: 660,
      vline: xs.indexOf(2012),
      aria: "Raw joined counts against the harmonized record",
      tip: i => `${xs[i]}\nHarmonized: ${fmt(ys[i].h)}\nRaw counts: ${fmt(ys[i].naive)}`,
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
    n0 && h0 && S.sel.type === "state"
      ? `Raw counts make 2012–2016 look ${(n1! / n0).toFixed(1)}× busier than 2007–2011. In the harmonized record the step is ${(h1! / h0).toFixed(1)}×.`
      : "The blue line jumps in 2012 only because the sensor changed. Choose the whole state and all years to measure the step.";
  const s = D.states[S.st!],
    val = s.val,
    pc = (x: number) => Math.round(x * 100) + "%";
  $("tiles").innerHTML =
    `<div class="tile"><b>${val.raw_factor.toFixed(1)}×</b><span>more hotspots from VIIRS than MODIS for the same fires in ${NAME[S.st!]}</span></div><div class="tile"><b>${pc(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc(val.annual_max_err)}</b><span>error in the worst tested year</span></div>`;
  $("maskTxt").textContent = `${s.mask.static_sites} sites removed in ${NAME[S.st!]}.`;
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
    i1 = (S.yTo - Y0 + 1) * 12,
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
  $("shCrumb").textContent = `Compare states · ${S.yFrom}–${S.yTo}`;
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
    idx = (c: StateSummary) => c.R.years.map(y => (c.mean ? y.h / c.mean : 0)),
    xs = C[0].R.years.map(y => y.y);
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
  $("shClose").focus();
}
export function closeSheet(silent?: boolean) {
  if (!S.sheet) return;
  S.sheet = null;
  $("sheetWrap").hidden = true;
  hideTip();
  if (!silent && location.hash === "#compare") location.hash = "";
}
