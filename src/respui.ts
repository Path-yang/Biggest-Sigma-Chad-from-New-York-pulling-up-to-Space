import type { Odds, StateCode, Tool } from "./types";
import type { MonthRisk } from "./response";
import { D, MONL, NAME } from "./data";
import { RT, S } from "./state";
import { $, fmt } from "./util";
import { NOT_FIRE, hexAtLonLat, hexPlace, hexState, notFire, riskYears } from "./model";
import {
  GAP_KM,
  calErrFor,
  closestAt,
  forecastRisk,
  gapList,
  monthRisk,
  planFor,
  planTest,
  respCredit,
  reachMean,
  respOf,
  staffUp,
  stationArea,
  stnLat,
  stnLon,
} from "./response";
import { V, centerOn, fitView, flyTo, onScreen } from "./map";
import { closeSheet, openSheet } from "./sheet";
import { stopPlay } from "./play";
import { render } from "./render";
import { fcOn, isFc, pctP } from "./forecast";

/* =====================================================================
   FIRE RESPONSE TOOLS on the page: the card panel, the lists in the sheet,
   and what they draw on the map.
   ===================================================================== */
const GAP_C = "#4fe3ff",
  STN_C = "#7fd8ff",
  EMBER = "#ff8a3d";
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => (x >= 0.095 ? Math.round(x * 100) + "%" : x >= 0.001 ? (x * 100).toFixed(1) + "%" : x > 0 ? "<0.1%" : "0%");
/** coverage shares, to one decimal so small gains show */
const pc1 = (x: number) => (x * 100).toFixed(1) + "%";
const km1 = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
const mins = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
const county = (st: StateCode, k: number) => D.states[st].counties[hexState(st).c[k]].name + " County";
/** hexagon width, centre to centre, in km */
const hexKm = (st: StateCode) => Math.round(D.states[st].hex_r * 111.2 * Math.sqrt(3));
const THR: [number, string][] = [
  [0.1, "1 year in 10"],
  [0.25, "1 year in 4"],
  [0.5, "1 year in 2"],
];
const thrLabel = (t: number) => (THR.find(x => Math.abs(x[0] - t) < 1e-6) || THR[1])[1];

/* ---------- what the current choices produce, worked out once per change ---------- */
let memo: { key: string; risk: ReturnType<typeof monthRisk>; gaps: ReturnType<typeof gapList>; staff: ReturnType<typeof staffUp> } | null =
  null;
function cur() {
  const st = S.st!,
    [a, b] = riskYears(),
    fc = isFc() && fcOn(st) ? (S.odds as number) : 0,
    key = [st, S.rm, a, b, RT.gapMin, fc].join("|");
  if (!memo || memo.key !== key) {
    const risk = (fc && forecastRisk(st, fc, S.rm)) || monthRisk(st, S.rm, a, b);
    memo = { key, risk, gaps: gapList(st, risk, RT.gapMin), staff: staffUp(st, S.rm, risk) };
  }
  return memo;
}
/** the fire risk the tools weigh places by, in words */
const riskWords = (r: MonthRisk, mo: string) =>
  r.fc ? `its forecast chance of fire in ${mo} ${r.fc} (from fire history, not weather)` : `how often it burned in ${mo}, ${r.a}–${r.b}`;
/** a line saying which odds the tools use */
const srcLine = (r: MonthRisk, mo: string) =>
  `<p class="srcLine">${r.fc ? `Using the <b>forecast for ${mo} ${r.fc}</b>` : `Using <b>past odds</b>, ${mo} ${r.a}–${r.b}`}${S.fire === "large" ? ". These tools weigh all fires, not only large ones." : ""}</p>`;
const curPlan = () => planFor(S.st!, cur().risk, S.rm, RT.planT, RT.planN);
let areaMemo: { key: string; mask: Uint8Array } | null = null;
function focusArea() {
  const key = [S.st, S.rm, RT.focusStn].join("|");
  if (!areaMemo || areaMemo.key !== key) areaMemo = { key, mask: stationArea(S.st!, S.rm, RT.focusStn) };
  return areaMemo.mask;
}
/** the place the closest-stations list is about: a clicked spot, else the selected hexagon, else a town's centre */
export function respTarget(): { k: number; lon: number; lat: number; what: string } | null {
  if (!S.st || !respOf(S.st)) return null;
  const hx = hexState(S.st),
    sl = S.sel;
  if (RT.tool === "near" && RT.pin) return { ...RT.pin, what: "the spot you clicked" };
  if (sl.type === "hex") return { k: sl.k, lon: hx.X[sl.k] / hx.K, lat: hx.Y[sl.k], what: "this hexagon's centre" };
  if (sl.type === "circle" && sl.label) {
    const k = hexAtLonLat(S.st, sl.lon, sl.lat);
    if (k >= 0) return { k, lon: sl.lon, lat: sl.lat, what: sl.label };
  }
  return null;
}

/* ---------- the card panel ---------- */
export function renderResp() {
  const st = S.st!,
    r = respOf(st);
  $("resp").hidden = !r;
  if (!r) return;
  const mo = MONL[S.rm],
    tool = RT.tool;
  document.querySelectorAll<HTMLButtonElement>("#toolSeg button").forEach(b => {
    const on = b.dataset.tool === tool;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("on", on);
  });
  $("respCtl").hidden = tool !== "gap" && tool !== "plan";
  $("gapCtl").hidden = tool !== "gap";
  $("planCtl").hidden = tool !== "plan";
  $("rmResp").value = String(S.rm);
  document.querySelectorAll<HTMLButtonElement>("#oddsResp button").forEach(b => {
    b.hidden = b.dataset.odds !== "past" && !fcOn(st);
    b.setAttribute("aria-pressed", String(b.dataset.odds === String(S.odds)));
  });
  document
    .querySelectorAll<HTMLButtonElement>("#gapSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.thr! === RT.gapMin)));
  document
    .querySelectorAll<HTMLButtonElement>("#planT button")
    .forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.t! === RT.planT)));
  $("planN").value = String(RT.planN);
  $("planNv").textContent = String(RT.planN);
  let h = "";
  if (RT.focusStn >= 0) h += focusHtml(st, mo);
  if (tool === "gap") h += gapHtml(st, mo);
  else if (tool === "plan") h += planHtml(st, mo);
  const t = respTarget();
  if (t) h += closestHtml(st, t);
  else if (tool === "near")
    h += `<p class="hint">Click anywhere in ${NAME[st]} to see the three stations with the shortest drive. Turn this off to click into counties again.</p>`;
  else if (!tool && RT.focusStn < 0)
    h += `<p class="hint">Find the stations closest to any spot, the places where fire is common but every station is more than ${GAP_KM} km away, or where extra crews would reach the most fire.</p>`;
  $("respOut").innerHTML = h;
  $("respOut")
    .querySelectorAll<HTMLButtonElement>("[data-go]")
    .forEach(b => (b.onclick = () => goHex(+b.dataset.go!)));
  $("respOut")
    .querySelectorAll<HTMLButtonElement>("[data-stn]")
    .forEach(
      b => (b.onclick = () => centerOn(stnLon(st, +b.dataset.stn!), stnLat(st, +b.dataset.stn!), Math.max(V.s, 150 / hexState(st).R), 700)),
    );
  $("respOut")
    .querySelectorAll<HTMLButtonElement>("[data-act]")
    .forEach(
      b =>
        (b.onclick = () => {
          const a = b.dataset.act;
          if (a === "clearStn") RT.focusStn = -1;
          if (a === "clearPin") RT.pin = null;
          if (a === "allGaps") {
            openSheet("area");
            requestAnimationFrame(() => $("gapSec").scrollIntoView({ block: "start" }));
            return;
          }
          render();
        }),
    );
  $("respCredit").textContent = respCredit().replace("(c)", "©");
}
function closestHtml(st: StateCode, t: NonNullable<ReturnType<typeof respTarget>>) {
  const c = closestAt(st, t.k, t.lon, t.lat)!,
    spot = t.what !== "this hexagon's centre",
    from = t.what === "the spot you clicked" ? "the spot" : esc(t.what),
    head = `<div class="rh"><span>Closest stations by road</span>${RT.tool === "near" && RT.pin ? `<button class="link" type="button" data-act="clearPin">Clear</button>` : ""}</div>`;
  if (!c.rows.length) return head + `<p class="hint">${c.why}</p>`;
  const how = (s: (typeof c.rows)[number]) =>
    s.via === "patch"
      ? `by road to the 2 km patch at ${from}`
      : s.via === "leg"
        ? `${mins(s.minC)} min (${km1(s.km)} km) by road to the hexagon centre, then about ${mins(s.min - s.minC)} min to ${from}`
        : s.via === "line"
          ? `estimated from the straight line`
          : `${km1(s.km)} km by road`;
  const rows = c.rows
    .map(
      (s, j) =>
        `<button type="button" class="nr" data-stn="${s.i}"><span class="bd">${j + 1}</span><b>${esc(s.name)}</b><span class="mn">${s.via === "leg" || s.via === "line" ? "~" : ""}${mins(s.min)} min</span><small>${s.town ? esc(s.town) + " · " : ""}${how(s)} · ${km1(s.crow)} km straight${spot ? " from " + from : ""}</small></button>`,
    )
    .join("");
  const legNote = c.rows.some(s => s.via === "leg" || s.via === "line")
    ? ` ${spot ? `${from.charAt(0).toUpperCase() + from.slice(1)} is` : "It is"} ${km1(c.off)} km from the centre of its ${hexKm(st)} km hexagon, where the road search ends, so a ~ time is estimated from straight-line distance: the drive to the centre plus the last stretch, or straight from the station, whichever is shorter. These estimates are often 15–30% off, and a closer station can be missing from the three.`
    : "";
  return (
    head +
    `<div class="nl">${rows}</div><p class="hint">Road searches to the hexagon's centre${c.rows.some(s => s.via === "patch") ? ", and to the 2 km patch at the spot where fire was seen there" : ""}, at set speeds for each kind of road, with no traffic. Estimated drives, not response times.${legNote}</p>` +
    (c.fine && !c.rows.some(s => s.i === c.fine!.i)
      ? `<p class="hint">Fire was seen in the 2 km patch here. Its fastest station by road is ${esc(c.fine.name)}, ${mins(c.fine.min)} min.</p>`
      : "")
  );
}
function gapHtml(st: StateCode, mo: string) {
  const { gaps, risk } = cur(),
    r = respOf(st)!,
    n = gaps.list.length,
    rule = gapRule(risk, mo),
    when = risk.fc ? `${mo} ${risk.fc}` : mo;
  if (!n)
    return `${srcLine(risk, mo)}<p class="big"><b>None</b> in ${when}.</p><p class="hint">No place in ${NAME[st]} has ${rule}. ${gaps.far ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but ${risk.fc ? `none has that high a forecast chance in ${when}` : `they burn less often than that in ${mo}`}.` : `Every hexagon has a station within ${GAP_KM} km.`}</p>`;
  const rows = gaps.list
    .slice(0, 6)
    .map(k => gapRow(st, k, risk, r.crow10[k] / 10, r.min10[3 * k], r.top[3 * k]))
    .join("");
  return (
    `${srcLine(risk, mo)}<p class="big"><b>${n}</b> ${n === 1 ? "place" : "places"} to watch in ${when}</p><p class="hint"><i class="gk"></i>Outlined on the map: hexagons with ${rule}.</p><div class="nl">${rows}</div>` +
    (n > 6 ? `<button class="link" type="button" data-act="allGaps">See all ${n} in the full data</button>` : "")
  );
}
/** the gap rule in words */
const gapRule = (risk: MonthRisk, mo: string) =>
  (risk.fc
    ? `a forecast chance of fire in ${mo} ${risk.fc} of at least ${Math.round(RT.gapMin * 100)}%`
    : `fire in ${mo} in at least ${thrLabel(RT.gapMin)} (${risk.a}–${risk.b})`) +
  ` and every station more than ${GAP_KM} km away in a straight line`;
function gapRow(st: StateCode, k: number, risk: MonthRisk, crow: number, min10: number, top: number) {
  const hx = hexState(st),
    p = risk.p[k];
  return `<button type="button" class="nr" data-go="${k}"><span class="bd gap">!</span><b>${esc(hexPlace(st, k))}</b><span class="mn">${km1(crow)} km</span><small>${esc(county(st, k))} · ${risk.fc ? `forecast chance ${pctP(p)}` : `fire in ${pct(p)} of years`} · ${min10 >= 0 ? `fastest drive ${mins(min10 / 10)} min, ${esc(hx.stn.names[top][0])}` : "no road link to a station"}</small></button>`;
}
function planHtml(st: StateCode, mo: string) {
  const { risk } = cur();
  if (!risk.ptot) return `<p class="hint">No fire was seen in ${NAME[st]} in ${mo}, ${risk.a}–${risk.b}, so there is nothing to cover.</p>`;
  const p = curPlan(),
    T = RT.planT,
    k = p.sites.length,
    end = k ? p.after[k - 1] : p.before,
    [ta, tb] = riskYears(),
    test = planTest(st, S.rm, ta, tb, T, RT.planN);
  let h =
    srcLine(risk, mo) +
    `<div class="cov"><div><span>Today</span><b>${pc1(p.before)}</b></div><span class="arr">→</span><div><span>With ${k} more ${k === 1 ? "crew" : "crews"}</span><b class="em">${pc1(end)}</b></div></div>` +
    `<div class="covBar" role="img" aria-label="${pc1(p.before)} covered today, ${pc1(end)} with the added crews"><i style="width:${(p.before * 100).toFixed(1)}%"></i><i class="add" style="width:${((end - p.before) * 100).toFixed(1)}%"></i></div>` +
    `<p class="hint">Share of ${mo}'s fire risk within ${T} minutes' drive of a station. Each hexagon counts by ${riskWords(risk, mo)}. Each crew below shows the percentage points it adds.</p>`;
  if (k < RT.planN)
    h += `<p class="hint">${k ? `Only ${k} ${k === 1 ? "crew adds" : "crews add"} anything.` : "No crew adds anything."} Every other place with fire in ${mo} is already within ${T} minutes or has no road link.</p>`;
  h +=
    `<div class="nl">` +
    p.sites
      .map(
        (s, j) =>
          `<button type="button" class="nr" data-go="${s.k}"><span class="bd site">${j + 1}</span><b>${esc(hexPlace(st, s.k))}</b><span class="mn">+${(s.gain * 100).toFixed(1)} pts</span><small>${esc(county(st, s.k))}</small></button>`,
      )
      .join("") +
    `</div>`;
  if (test)
    h += `<p class="hint test"><b>${risk.fc ? "The method, checked on past years." : "Checked on later years."}</b> Sites chosen from ${test.train[0]}–${test.train[1]} cover ${pc1(test.greedy)} of ${mo}'s fire risk in ${test.test[0]}–${test.test[1]} (stations alone: ${pc1(test.today)}). Putting the same number of crews in the busiest places no station reaches in time covers ${pc1(test.busiest)}.</p>`;
  const err = calErrFor(respOf(st)!.cal, T),
    reach = reachMean(st, T);
  h +=
    `<p class="hint">Each crew goes, one at a time, to the hexagon centre that brings the most still-uncovered fire risk within ${T} minutes. Stations use their road drive times; new sites use an estimate from straight-line distance` +
    (err ? `, typically ${err.lo === err.hi ? err.lo : `${err.lo}–${err.hi}`}% off at ${err.km0}–${err.km1} km in tests.` : ".") +
    (reach < 2
      ? ` At ${T} minutes a new site reaches on average ${reach.toFixed(1)} of the ${hexKm(st)} km hexagons, mostly its own, so the planner picks nearly the same places as simply taking the busiest places no station reaches in time.`
      : "") +
    `</p>`;
  return h;
}
function focusHtml(st: StateCode, mo: string) {
  const i = RT.focusStn,
    hx = hexState(st),
    row = cur().staff.rows.find(r => r.i === i),
    risk = cur().risk,
    n = risk.n;
  if (risk.fc)
    return (
      `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div>` +
      `<p class="hint"><i class="sk"></i>${row ? `First to reach ${pct(row.share)} of ${NAME[st]}'s forecast fire risk for ${mo} ${risk.fc}, across the ${row.hexes} outlined ${row.hexes === 1 ? "hexagon" : "hexagons"}. The likeliest has a ${pctP(row.top || 0)} chance of fire.` : `None of the forecast fire risk for ${mo} ${risk.fc} falls in the area this station reaches first.`}</p>`
    );
  return (
    `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div>` +
    `<p class="hint"><i class="sk"></i>${row ? `First by road to ${pct(row.share)} of ${NAME[st]}'s ${mo} fire: about ${row.e < 10 ? row.e.toFixed(1) : fmt(row.e)} of the ${row.hexes} outlined ${row.hexes === 1 ? "hexagon" : "hexagons"} have fire in an average ${mo}. Fire there in ${row.k} of ${n} years, about ${fmt(row.hot || 0)} hotspots in an average ${mo}.` : `No fire in ${mo} falls in the area this station reaches first.`}</p>`
  );
}
function goHex(k: number) {
  const hx = hexState(S.st!);
  S.sel = { type: "hex", k };
  render();
  centerOn(hx.X[k] / hx.K, hx.Y[k], 150 / hx.R, 900);
}

/* ---------- the sheet: stations to staff up, and the full list of gaps ---------- */
export function renderStaff() {
  const st = S.st!,
    on = !!respOf(st);
  $("staffBox").hidden = !on;
  $("gapSec").hidden = !on;
  if (!on) return;
  const { staff, gaps, risk } = cur(),
    mo = MONL[S.rm],
    hx = hexState(st);
  $("staff").innerHTML = staff.rows.length
    ? staff.rows
        .slice(0, 8)
        .map(
          (w, j) =>
            `<button type="button" class="w" data-stn="${w.i}"><span class="rk">${j + 1}</span><b>${esc(hx.stn.names[w.i][0])}</b><span class="pc">${pct(w.share)}</span><small>${hx.stn.names[w.i][1] ? esc(hx.stn.names[w.i][1]) + " · " : ""}${risk.fc ? `first to ${w.hexes} ${w.hexes === 1 ? "hexagon" : "hexagons"} · the likeliest has a ${pctP(w.top)} forecast chance` : `fire in its area in ${w.k} of ${risk.n} years · about ${fmt(w.hot || 0)} hotspots in an average ${mo}`}</small></button>`,
        )
        .join("")
    : `<p class="note small">${risk.fc ? `No forecast fire risk in ${mo} ${risk.fc}.` : `No hotspots in ${mo}, ${risk.a}–${risk.b}.`}</p>`;
  $("staff")
    .querySelectorAll<HTMLButtonElement>("[data-stn]")
    .forEach(b => (b.onclick = () => showStation(+b.dataset.stn!)));
  const top8 = staff.rows.slice(0, 8).reduce((a, w) => a + w.share, 0),
    oneYear = !risk.fc && staff.rows.slice(0, 8).filter(w => w.k === 1).length;
  $("staffNote").textContent = staff.rows.length
    ? (risk.fc
        ? `These 8 stations are first by road to ${pct(top8)} of the state's forecast fire risk for ${mo} ${risk.fc}: each hexagon counts by its chance of fire, split among stations the way its ${mo} fire fell since 2012.`
        : `These 8 stations are first by road to ${pct(top8)} of the state's ${mo} fire; ${fmt(staff.stations)} stations are first to some. Each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire.`) +
      (oneYear ? ` ${oneYear} of them ${oneYear === 1 ? "rests" : "rest"} on fire in a single year.` : "") +
      (staff.noneShare > 0.0005 ? ` ${pct(staff.noneShare)} of it falls where no station has a road link.` : "") +
      " Hotspots are what satellites saw burning, mostly in a few big wildfires: they are not calls or incidents, and this says nothing about how a station is staffed."
    : "";
  const n = gaps.list.length,
    r = respOf(st)!;
  $("gapTitle").textContent = `Far from a station in ${mo}${risk.fc ? " " + risk.fc : ""}: ${n} ${n === 1 ? "place" : "places"}`;
  $("gapNote").textContent =
    `Hexagons with ${gapRule(risk, mo)}. ` +
    (n
      ? "Tap one to see it on the map. The drive time is to the fastest station by road."
      : gaps.far
        ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but none of them ${risk.fc ? "has that high a forecast chance" : "burns that often"} in ${mo}.`
        : "") +
    " Change the rule under Fire response on the map.";
  $("gapList").innerHTML = gaps.list.map(k => gapRow(st, k, risk, r.crow10[k] / 10, r.min10[3 * k], r.top[3 * k])).join("");
  $("gapList")
    .querySelectorAll<HTMLButtonElement>("[data-go]")
    .forEach(
      b =>
        (b.onclick = () => {
          closeSheet();
          setTool("gap");
          goHex(+b.dataset.go!);
        }),
    );
  $("respMethod").innerHTML = methodHtml(st);
}
function showStation(i: number) {
  closeSheet();
  const st = S.st!,
    hx = hexState(st);
  RT.focusStn = i;
  stopPlay();
  S.layer = "chance";
  S.show = { t: "all" };
  const m = focusArea();
  let x0 = hx.stn.X[i],
    x1 = x0,
    y0 = hx.stn.Y[i],
    y1 = y0;
  for (let k = 0; k < hx.n; k++)
    if (m[k]) {
      x0 = Math.min(x0, hx.X[k]);
      x1 = Math.max(x1, hx.X[k]);
      y0 = Math.min(y0, hx.Y[k]);
      y1 = Math.max(y1, hx.Y[k]);
    }
  const p = hx.R * 3,
    f = fitView({ x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p });
  f.s = Math.min(f.s, V.fit * 8);
  render();
  flyTo(f, 800);
  if (innerWidth > 900) requestAnimationFrame(() => $("resp").scrollIntoView({ block: "start" }));
}
/* ---------- how it works ---------- */
function methodHtml(st: StateCode) {
  const R = window.RESPONSE!,
    r = respOf(st)!,
    t = r.cal.test,
    o = (s: StateCode) => window.RESPONSE![s].cal.test;
  return (
    `<p>${howShort(st)}</p>` +
    `<ul class="steps">` +
    `<li><b>Roads.</b> OpenStreetMap (Geofabrik extract of ${R.osm[st].timestamp.slice(0, 10)}), ${fmt(R.osm[st].graph.vertices)} road points. Speeds by road class: motorway ${R.speeds_kmh.motorway}, primary ${R.speeds_kmh.primary}, secondary ${R.speeds_kmh.secondary}, residential ${R.speeds_kmh.residential}, track ${R.speeds_kmh.track} km/h; posted limits are used where tagged, slightly reduced, up to ${R.cap_kmh} km/h. One-way rules apply on freeways only. The walk from a point to its nearest road is counted at ${R.access_kmh} km/h; a point more than ${R.snap_max_km} km from a road gets no time.</li>` +
    `<li><b>Stations.</b> The ${fmt(r.ns)} fire and EMS stations in the page's station list for ${NAME[st]}. Stations in neighbouring states are not counted, so places near the state line may have a closer one.</li>` +
    `<li><b>Closest stations</b> are exact road searches to each hexagon's centre. For a spot away from the centre, the last stretch is estimated (the rule below), or the 2 km patch's own road search is used where it is shorter. <b>First-due areas</b> split each hexagon's fire equally among the 2 km patches inside it that burned in that month since 2012, and give each patch to its fastest station. <b>Stations</b> are ranked by the fire in their first-due area, each hexagon counted by its chance of fire; hotspots are satellite detections, not calls or incidents.</li>` +
    `<li><b>New crew sites</b> use a rule that estimates drive time from straight-line distance: a speed for each distance band plus a few local minutes for each hexagon. On places held out of the fit its typical error over all distances is ${t.bands_plus_local.med_abs_pct}% here (one speed for every distance: ${t.one_speed.med_abs_pct}%), but ${bandErr(st)} at the short distances the planner uses. In New York ${o("NY").bands_plus_local.med_abs_pct}% against ${o("NY").one_speed.med_abs_pct}% overall; in California ${o("CA").bands_plus_local.med_abs_pct}% against ${o("CA").one_speed.med_abs_pct}%. Good for ranking, not for promising a time. At the ${hexKm(st)} km hexagon size a new site within 10–15 minutes reaches little beyond its own hexagon.</li>` +
    `<li><b>Fire risk</b> is, with past odds, the share of years ${riskYears().join("–")} with a hotspot in the month: history, not a forecast. With Forecast 2026 or 2027 it is the forecast chance of at least one hotspot (see “Forecast 2026–2027” above), which is also built from fire history alone and knows nothing about weather; first-due areas still split each hexagon the way its fire fell since 2012. The tools always weigh all fires, not only large ones.${NOT_FIRE[st].length ? ` The ${NOT_FIRE[st].map(x => x.name.replace(/^the /, "")).join(" and ")} ${NOT_FIRE[st].length === 1 ? "is" : "are"} left out: its hotspots are heat from the plant, not fire, so ${notFire(st).reduce((a, v) => a + v, 0)} hexagons count as having none.` : ""}</li></ul>` +
    `<p class="note small">${esc(respCredit().replace("(c)", "©"))}</p>`
  );
}
/** the estimating rule's error at the planner's distances, in words */
const bandErr = (st: StateCode) => {
  const e = calErrFor(respOf(st)!.cal, 30);
  return e ? `${e.lo === e.hi ? e.lo : `${e.lo}–${e.hi}`}% at ${e.km0}–${e.km1} km` : "more";
};
const howShort = (st: StateCode) =>
  `Drive times come from OpenStreetMap roads at a set speed for each kind of road, from the ${fmt(respOf(st)!.ns)} fire and EMS stations in the station list. There is no traffic, no signal delay and no time to get out of the station, and we do not know which stations are staffed or what they have, so these are estimated drives, not response times.`;

/* ---------- controls ---------- */
function setTool(t: Tool | null) {
  RT.tool = t;
  if (t !== "near") RT.pin = null;
  if (t === "gap" || t === "plan") {
    stopPlay();
    S.layer = "chance";
    S.fire = "any";
    S.show = { t: "all" };
  }
}
/** the places a statewide tool points at: the gaps listed on the card, or the crew sites */
function toolPlaces(): number[] {
  if (RT.tool === "gap") return cur().gaps.list.slice(0, 6);
  if (RT.tool === "plan" && cur().risk.ptot) return curPlan().sites.map(s => s.k);
  return [];
}
/** after a statewide tool or its settings change: when most of its places are off screen, fly to show them all */
function showToolPlaces() {
  if (!S.st) return;
  const ks = toolPlaces(),
    hx = hexState(S.st);
  if (!ks.length || ks.filter(k => onScreen(hx.X[k], hx.Y[k])).length * 2 >= ks.length) return;
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9;
  for (const k of ks) {
    x0 = Math.min(x0, hx.X[k]);
    x1 = Math.max(x1, hx.X[k]);
    y0 = Math.min(y0, hx.Y[k]);
    y1 = Math.max(y1, hx.Y[k]);
  }
  const p = hx.R * 4,
    f = fitView({ x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p });
  f.s = Math.min(f.s, V.fit * 6);
  flyTo(f, 800);
}
/** on a phone the card sits under the map: bring the tool's answer into view */
const showOut = () => {
  if (innerWidth <= 900 && RT.tool) requestAnimationFrame(() => $("respOut").scrollIntoView({ block: "nearest", behavior: "smooth" }));
};
/** redraw after a change to a tool's settings, then show its places */
const retool = () => {
  render();
  showToolPlaces();
};
export function respEvents() {
  document.querySelectorAll<HTMLButtonElement>("#toolSeg button").forEach(
    b =>
      (b.onclick = () => {
        const t = b.dataset.tool as Tool;
        setTool(RT.tool === t ? null : t);
        retool();
        if (innerWidth > 900 && RT.tool) requestAnimationFrame(() => $("resp").scrollIntoView({ block: "nearest" }));
      }),
  );
  $("rmResp").innerHTML = MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("rmResp").onchange = () => {
    S.rm = +$("rmResp").value;
    retool();
  };
  document.querySelectorAll<HTMLButtonElement>("#oddsResp button").forEach(
    b =>
      (b.onclick = () => {
        S.odds = (b.dataset.odds === "past" ? "past" : +b.dataset.odds!) as Odds;
        retool();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("#gapSeg button").forEach(
    b =>
      (b.onclick = () => {
        RT.gapMin = +b.dataset.thr!;
        retool();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("#planT button").forEach(
    b =>
      (b.onclick = () => {
        RT.planT = +b.dataset.t!;
        retool();
      }),
  );
  $("planN").oninput = () => {
    RT.planN = Math.max(1, Math.min(20, Math.round(+$("planN").value) || 1));
    $("planNv").textContent = String(RT.planN);
    retool();
  };
}
/** a new state: forget the clicked spot and the picked station */
export function respReset() {
  RT.pin = null;
  RT.focusStn = -1;
  memo = null;
  if (RT.tool === "gap" || RT.tool === "plan") S.layer = "chance";
  if (S.st) $("respHowTxt").textContent = respOf(S.st) ? howShort(S.st) : "";
}
/** a click on the map while "Closest stations" is on; true if the click was used */
export function respClick(lon: number, lat: number, k: number) {
  if (RT.tool !== "near" || !S.st || !respOf(S.st)) return false;
  RT.pin = k >= 0 ? { lon, lat, k } : null;
  render();
  const cl = RT.pin && closestAt(S.st, k, lon, lat);
  if (cl && cl.rows.length && V.s < V.fit * 2.5) {
    /* from the whole-state view, come close enough to tell the three stations apart */
    const hx = hexState(S.st),
      xs = [lon * hx.K, ...cl.rows.map(s => hx.stn.X[s.i])],
      ys = [lat, ...cl.rows.map(s => hx.stn.Y[s.i])],
      p = hx.R * 2,
      f = fitView({ x0: Math.min(...xs) - p, x1: Math.max(...xs) + p, y0: Math.min(...ys) - p, y1: Math.max(...ys) + p });
    f.s = Math.min(f.s, V.fit * 24);
    flyTo(f, 800);
  }
  if (k < 0)
    $("respOut").insertAdjacentHTML("afterbegin", `<p class="hint">That spot is outside ${NAME[S.st]}. Click inside the state.</p>`);
  showOut();
  return true;
}
/** extra lines for a hexagon's tooltip while a response tool is on */
export function respTip(k: number) {
  const r = S.st && respOf(S.st);
  if (!r || !RT.tool || k < 0) return "";
  const m = r.min10[3 * k];
  return (
    `\nFrom the hexagon's centre: nearest station ${km1(r.crow10[k] / 10)} km in a straight line` +
    (m >= 0 ? `, fastest drive ${mins(m / 10)} min` : ", no road link to a station") +
    (RT.tool === "near" ? "\nClick for the three closest stations" : "")
  );
}

/* ---------- on the map ---------- */
export function drawResponse(c: CanvasRenderingContext2D, sx: (X: number) => number, sy: (Y: number) => number, R: number) {
  const st = S.st;
  if (!st || !respOf(st)) return;
  const hx = hexState(st),
    W = V.W,
    H = V.H,
    rr = R * 0.93,
    on = (x: number, y: number, m: number) => x > -m && y > -m && x < W + m && y < H + m;
  const hexP = (k: number, s = 1) => {
    const x = sx(hx.X[k]),
      y = sy(hx.Y[k]);
    if (!on(x, y, rr)) return false;
    c.beginPath();
    if (rr < 3.5) {
      c.arc(x, y, 3, 0, 7);
      return true;
    }
    for (let a = 0; a < 6; a++) {
      const t = (Math.PI / 180) * (30 + 60 * a);
      a ? c.lineTo(x + rr * s * Math.cos(t), y - rr * s * Math.sin(t)) : c.moveTo(x + rr * s * Math.cos(t), y - rr * s * Math.sin(t));
    }
    c.closePath();
    return true;
  };
  const badge = (x: number, y: number, txt: string, fill: string, ink: string, r = 9) => {
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = "rgba(0,0,0,.75)";
    c.stroke();
    c.fillStyle = ink;
    c.font = "600 11px 'JetBrains Mono',monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(txt, x, y + 0.5);
  };
  const station = (i: number, label: string) => {
    const x = sx(hx.stn.X[i]),
      y = sy(hx.stn.Y[i]);
    if (!on(x, y, 20)) return;
    c.fillStyle = STN_C;
    c.strokeStyle = "#fff";
    c.lineWidth = 1.6;
    c.beginPath();
    c.rect(x - 5.5, y - 5.5, 11, 11);
    c.fill();
    c.stroke();
    if (label) badge(x + 13, y - 12, label, "#fff", "#04121c", 8.5);
  };
  c.save();
  c.setLineDash([]);
  if (RT.tool === "gap") {
    c.strokeStyle = GAP_C;
    c.lineWidth = R > 8 ? 2.4 : 2;
    for (const k of cur().gaps.list) if (hexP(k)) c.stroke();
  }
  if (RT.tool === "plan" && cur().risk.ptot) {
    const p = curPlan();
    c.strokeStyle = EMBER;
    c.lineWidth = 1.3;
    c.globalAlpha = 0.9;
    for (let k = 0; k < hx.n; k++) if (p.by[k] >= 0 && hexP(k, 0.9)) c.stroke();
    c.globalAlpha = 1;
    p.sites.forEach((s, j) => {
      const x = sx(hx.X[s.k]),
        y = sy(hx.Y[s.k]);
      if (on(x, y, 12)) badge(x, y, String(j + 1), EMBER, "#1b0c02", 10);
    });
  }
  if (RT.focusStn >= 0) {
    const m = focusArea();
    c.strokeStyle = "#fff";
    c.lineWidth = 1.8;
    for (let k = 0; k < hx.n; k++) if (m[k] && hexP(k)) c.stroke();
    station(RT.focusStn, "");
  }
  /* the planner numbers its crew sites; numbered stations beside them would read as the same list */
  const t = RT.tool === "plan" ? null : respTarget(),
    cl = t && closestAt(st, t.k, t.lon, t.lat);
  if (t && cl) {
    const x0 = sx(t.lon * hx.K),
      y0 = sy(t.lat);
    c.setLineDash([6, 5]);
    for (const [col, lw] of [
      ["rgba(0,0,0,.6)", 3.6],
      ["rgba(255,255,255,.95)", 1.6],
    ] as [string, number][]) {
      c.strokeStyle = col;
      c.lineWidth = lw;
      c.beginPath();
      for (const s of cl.rows) {
        c.moveTo(x0, y0);
        c.lineTo(sx(hx.stn.X[s.i]), sy(hx.stn.Y[s.i]));
      }
      c.stroke();
    }
    c.setLineDash([]);
    cl.rows.forEach((s, j) => station(s.i, String(j + 1)));
    c.beginPath();
    c.arc(x0, y0, 6.5, 0, 7);
    c.fillStyle = EMBER;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#fff";
    c.stroke();
  }
  c.restore();
}
