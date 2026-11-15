import type { CountyOutlook, OutlookScore, StateCode } from "./types";
import { D, NAME } from "./data";
import { S } from "./state";
import { $, times } from "./util";
import { div, rgb } from "./color";
import { hexState, selMask } from "./model";
import { setCounty } from "./map";
import { closeSheet } from "./sheet";
import { stopPlay } from "./play";
import { render } from "./render";
import { save } from "./downloads";
import { pctP } from "./forecast";
import { RARE, olData, olLoad, olOn, olRun } from "./outlook";

/* =====================================================================
   THE 14-DAY OUTLOOK on the page: the "Next 14 days" map layer and its bar,
   the card's row, and the ranked counties with the method in the sheet.
   ===================================================================== */
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => pctP(x, true);
/** the weather's effect, wx_ratio = p ÷ the model's chance with no weather, colours the map; the scale runs from half to twice */
const ratioT = (r: number) => Math.max(-1, Math.min(1, Math.log2(r)));
const RATIO_STOPS: [number, string][] = [
  [0.5, "½×"],
  [0.71, "0.7×"],
  [1, "no change"],
  [1.41, "1.4×"],
  [2, "2×+"],
];
/** the weather raises or lowers a county's chance by at least a tenth; counties where fire is rare now are left out */
const raised = (o: CountyOutlook) => o.base >= RARE && o.wx_ratio >= 1.1;
const lowered = (o: CountyOutlook) => o.base >= RARE && o.wx_ratio <= 0.9;
const OM = `<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>`;

/** the outlook of county ci, if the weather is in */
const rowOf = (st: StateCode, ci: number): CountyOutlook | null => {
  const r = olRun(st);
  return r && r.status === "ok" ? r.rows[ci] || null : null;
};
/** "Nov 15" */
const dayName = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
/** "Nov 15 – Nov 28, 2026" */
export const olRange = (st: StateCode) => {
  const r = olRun(st);
  return r && r.today ? `${dayName(r.today)} – ${dayName(r.end)}, ${r.end.slice(0, 4)}` : "";
};
const weatherCue = (o: CountyOutlook) =>
  o.wx_ratio >= 1.1
    ? `weather pushes it up (${times(o.wx_ratio)})`
    : o.wx_ratio <= 0.9
      ? `weather pulls it down (${times(o.wx_ratio)})`
      : "weather changes it little";
/** "33% (usual for these dates 27%)" */
const sayOutlook = (o: CountyOutlook) => `${pct(o.p)} (usual for these dates ${pct(o.base)})`;
/** the backtest's skill of the model used here, for one state */
const skill = (st: StateCode) => olData()!.states[st].metrics.backtest["full model (observed next 14 days)"];

/* ---------- the map ---------- */
/** fill colour and opacity for a county on the outlook layer; null where there is no outlook */
export function olFill(st: StateCode, ci: number): { c: string; a: number } | null {
  const o = rowOf(st, ci);
  if (!o) return null;
  return { c: rgb(div(ratioT(o.wx_ratio))), a: o.base < RARE ? 0.32 : 0.86 };
}
/** the hover text for a county */
export function olTip(ci: number): string {
  const st = S.st!,
    r = olRun(st),
    o = rowOf(st, ci);
  if (!r || r.status === "loading") return "Getting the weather forecast…";
  if (r.status !== "ok") return "No outlook: " + r.err;
  if (!o) return "No outlook here: the weather forecast had gaps for this county.";
  return (
    `Next 14 days, ${olRange(st)}:\n${pct(o.p)} chance of at least one hotspot\n` +
    `Usual for these dates: ${pct(o.base)}\n` +
    (o.base >= RARE
      ? `The ${weatherCue(o)}, against the model's ${pct(o.norm)} with no weather`
      : `Fire is rare here now, so the weather's effect is mostly noise`)
  );
}
export function olLegend() {
  const st = S.st!,
    r = olRun(st),
    when = r && r.status === "ok" ? olRange(st) : "";
  $("legTitle").textContent = `Next 14 days${when ? ", " + when : ""}: how the weather forecast moves the chance of a hotspot`;
  if (!r || r.status !== "ok") {
    $("legSw").innerHTML = "";
    $("legCap").textContent =
      !r || r.status === "loading" || r.status === "idle" ? "Getting the weather forecast…" : "No outlook data right now.";
    return;
  }
  let g = "";
  RATIO_STOPS.forEach(([v, lab], i) => {
    const x = 6 + i * 47;
    g += `<rect x="${x}" y="4" width="43" height="20" rx="3" fill="${rgb(div(ratioT(v)))}"/><text x="${x + 21.5}" y="40" text-anchor="middle">${lab}</text>`;
  });
  $("legSw").innerHTML =
    `<svg viewBox="0 0 244 46" role="img" aria-label="Blue counties: the weather lowers the chance; red: it raises it">${g}</svg>`;
  $("legCap").textContent =
    "Red: the weather forecast raises the chance of a hotspot, blue: it lowers it, against the model's chance for these dates with no weather. Faded: fire is rare here now (usual under 3%), so the effect is noisy. Weather: Open-Meteo.";
}
/** the bar under the map while the outlook layer is on */
export function renderOutlookBar() {
  const st = S.st!,
    on = olOn(st),
    ol = S.layer === "outlook";
  $("layerSeg").querySelector<HTMLButtonElement>('[data-layer="outlook"]')!.hidden = !on;
  $("olBar").hidden = !ol;
  if (!ol) return;
  const r = olRun(st),
    sk = skill(st);
  $("olRetry").hidden = !r || !(r.status === "error" || (r.status === "ok" && r.missing > 0));
  $("olKey").hidden = !r || r.status !== "ok";
  if (!r || r.status === "loading" || r.status === "idle") {
    $("olNote").innerHTML =
      `<b>Next 14 days</b>: getting the weather forecast from ${OM}…` +
      (r && r.slow ? " The weather service is slow right now; this can take up to half a minute." : "");
    return;
  }
  if (r.status === "error") {
    $("olNote").innerHTML = `<b>Next 14 days</b>: no outlook right now. ${esc(r.err)} The rest of the page works without it.`;
    return;
  }
  const n = r.rows.length,
    up = r.rows.filter(o => o && raised(o)).length,
    down = r.rows.filter(o => o && lowered(o)).length;
  $("olNote").innerHTML =
    `<b>Next 14 days, ${olRange(st)}</b>: how the weather forecast moves each county's chance of at least one hotspot.` +
    `<span class="more"> It raises the chance in ${up} of ${n} counties and lowers it in ${down}.</span>` +
    ` Tested with the weather that actually happened, it beat the usual odds by only ${(sk.bss * 100).toFixed(1)}%; real forecasts do less well.` +
    ` Weather: ${OM} (ECMWF).` +
    (r.missing ? ` No forecast for ${r.missing} ${r.missing === 1 ? "county" : "counties"}${r.err ? ": " + esc(r.err) : "."}` : "");
}

/* ---------- the card ---------- */
/** the card's chance row while the outlook layer is on */
export function olCard(): { q: string; v: string; title: string } | null {
  const st = S.st!,
    r = olRun(st);
  if (S.layer !== "outlook" || !olOn(st)) return null;
  if (!r || r.status !== "ok")
    return {
      q: "Next 14 days",
      v: r && r.status === "error" ? "No forecast" : "…",
      title: r && r.status === "error" ? r.err : "Getting the weather forecast.",
    };
  const sl = S.sel,
    hx = hexState(st),
    ci = sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -1;
  if (ci >= 0) {
    const o = r.rows[ci],
      cn = D.states[st].counties[ci].name;
    if (!o) return { q: `Next 14 days, ${cn}`, v: "No forecast", title: "The weather forecast had gaps for this county." };
    return {
      q: `Next 14 days, ${cn}`,
      v: o.base >= RARE ? `${pct(o.p)}, weather ${times(o.wx_ratio)}` : pct(o.p),
      title: `Chance of at least one hotspot in ${cn} County, ${olRange(st)}: ${sayOutlook(o)}. The ${weatherCue(o)} (the model gives ${pct(o.norm)} with no weather). A small nudge on the usual odds, not a fire-danger rating.`,
    };
  }
  /* the whole state, or a drawn area: count the counties it touches */
  const m = selMask(),
    touch = new Set<number>();
  for (let k = 0; k < hx.n; k++) if (m[k]) touch.add(hx.c[k]);
  const rows = [...touch].map(c => r.rows[c]).filter((o): o is CountyOutlook => !!o),
    up = rows.filter(raised).length;
  return {
    q: "Counties the weather raises, 14 days",
    v: `${up} of ${rows.length}`,
    title: `Counties where the weather forecast raises the chance of a hotspot over ${olRange(st)} by at least a tenth, against the model's chance for these dates with no weather (counties where fire is rare now are left out). Open the full data for the list.`,
  };
}

/* ---------- the sheet: counties to watch in the next 14 days ---------- */
let sortBy: "p" | "ratio" = "p",
  showAll = false;
const ROWS: [string, string][] = [
  ["climatology", "The usual odds alone (the baseline)"],
  ["recalibrated climatology", "The usual odds, recalibrated: no weather at all"],
  ["climatology + past 30 days", "+ weather of the past 30 days (needs no forecast)"],
  ["past 30 days + observed next 7 days", "+ the next 7 days' weather, as it turned out"],
  ["full model (observed next 14 days)", "+ the next 14 days' weather, as it turned out: the model used here"],
];
const yearsBetter = (s: OutlookScore) => {
  const v = Object.values(s.bss_by_year);
  return `${v.filter(x => x > 0).length} of ${v.length}`;
};
export function renderOutlookSheet() {
  const st = S.st!,
    on = olOn(st);
  $("olSec").hidden = !on;
  if (!on) return;
  const O = olData()!,
    so = O.states[st],
    bt = so.metrics.backtest,
    r = olRun(st),
    sk = skill(st);
  document
    .querySelectorAll<HTMLButtonElement>("#olSort button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sort === sortBy)));
  $("olSort").hidden = $("olMore").hidden = $("olCsv").hidden = !r || r.status !== "ok";
  $("olRetryS").hidden = !r || !(r.status === "error" || (r.status === "ok" && r.missing > 0));
  if (!r || r.status !== "ok") {
    $("olTitle").textContent = "Counties to watch in the next 14 days";
    $("olNoteS").textContent =
      !r || r.status === "loading" || r.status === "idle"
        ? "Getting the weather forecast from Open-Meteo…" +
          (r && r.slow ? " The weather service is slow right now; this can take up to half a minute." : "")
        : `No outlook right now. ${r.err} Everything else on the page still works.`;
    $("olList").innerHTML = "";
  } else {
    const n = r.rows.length,
      rows = r.rows.map((o, ci) => ({ o, ci })).filter((x): x is { o: CountyOutlook; ci: number } => !!x.o),
      list =
        sortBy === "p"
          ? rows.sort((a, b) => b.o.p - a.o.p || b.o.wx_ratio - a.o.wx_ratio)
          : rows.filter(x => x.o.base >= RARE).sort((a, b) => b.o.wx_ratio - a.o.wx_ratio || b.o.p - a.o.p),
      shown = showAll ? list : list.slice(0, 9),
      up = rows.filter(x => raised(x.o)).length,
      down = rows.filter(x => lowered(x.o)).length;
    $("olTitle").textContent = `Counties to watch in the next 14 days: ${olRange(st)}`;
    $("olNoteS").textContent =
      `Each county's chance of at least one VIIRS hotspot from ${dayName(r.today)} through ${dayName(r.end)}, from its usual odds for these dates and Open-Meteo's weather forecast. ` +
      `The weather raises the chance in ${up} of ${n} counties and lowers it in ${down}, against the model's chance with no weather. ` +
      (r.missing
        ? `${r.missing} ${r.missing === 1 ? "county has" : "counties have"} no forecast this time${r.err ? " (" + r.err.charAt(0).toLowerCase() + r.err.slice(1).replace(/\.$/, "") + ")" : ""}; Retry asks again. `
        : "") +
      (sortBy === "p"
        ? "Ranked by chance. "
        : `Ranked by how much the weather raises the chance; counties where fire is usually under ${Math.round(RARE * 100)}% at this time of year are left out, since there the effect is mostly noise. `) +
      "A hotspot is a satellite detection, often a farm or prescribed burn: this is not a fire-danger rating. Tap a county to see it on the map.";
    $("olList").innerHTML = shown
      .map(
        ({ o, ci }, i) =>
          `<button type="button" class="w" data-ci="${ci}"><span class="rk">${i + 1}</span><b>${esc(D.states[st].counties[ci].name)}</b><span class="pc">${pct(o.p)}</span><small>Usual for these dates ${pct(o.base)}${o.base >= RARE ? ` · ${weatherCue(o)}` : " · fire is rare here now"}</small></button>`,
      )
      .join("");
    $("olMore").textContent = showAll ? "Show the top 9" : `Show all ${list.length}`;
    $("olMore").hidden = list.length <= 9;
  }
  $("olList")
    .querySelectorAll<HTMLButtonElement>(".w")
    .forEach(
      b =>
        (b.onclick = () => {
          closeSheet();
          stopPlay();
          S.layer = "outlook";
          setCounty(+b.dataset.ci!);
        }),
    );
  /* how it was built, with the backtest */
  $("olHow").innerHTML =
    `Each county's <b>usual chance</b> is how often VIIRS saw a hotspot there in the same 14-day window of the year, ${so.climatology.years[0]}–${so.climatology.years[1]}. ` +
    `A small model (a logistic regression, fitted on ${so.metrics.years[0]}–${so.metrics.years[so.metrics.years.length - 1]}) nudges it with ${OM}'s ECMWF weather: rain and drying over the past 30 days and the next 14, above all the number of dry days ahead. ` +
    `<b>The test is generous:</b> it gave the model the weather that actually happened, and even then it beat the usual odds by only ${(sk.bss * 100).toFixed(1)}%. A real forecast goes wrong, more so in the second week, so expect less; real forecasts were not tested, because Open-Meteo's archive of past forecasts was beyond its free daily limit. ` +
    `The usual odds and the model were built from data to ${so.climatology.years[1]} and are left as they were: the 2026 hotspots now on the calendar are not in them.`;
  const recal = bt["recalibrated climatology"],
    /* Brier skill against the recalibrated usual odds, from the two skills against the usual odds */
    beyond = (s: OutlookScore) => (recal ? 1 - (1 - s.bss) / (1 - recal.bss) : null),
    sp = (x: number | null) => (x == null ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(2) + "%");
  $("olTable").innerHTML =
    `<tr><th>Tested on ${so.metrics.years[0]}–${so.metrics.years[so.metrics.years.length - 1]}, one year left out at a time</th><th>Brier</th><th>Against the usual odds</th><th>Against the recalibrated odds</th><th>AUC</th><th>Years better than usual</th></tr>` +
    ROWS.filter(([k]) => bt[k])
      .map(([k, lab]) => {
        const s = bt[k],
          base = k === "climatology",
          wx = !base && k !== "recalibrated climatology",
          last = k === ROWS[ROWS.length - 1][0];
        return `<tr><td class="u">${lab}</td><td>${s.brier.toFixed(4)}</td><td>${base ? "–" : sp(s.bss)}</td><td class="${last ? "em" : ""}">${wx ? sp(beyond(s)) : "–"}</td><td>${s.auc.toFixed(3)}</td><td>${base ? "–" : yearsBetter(s)}</td></tr>`;
      })
      .join("");
  const p30 = bt["climatology + past 30 days"],
    p30b = p30 ? beyond(p30) : null;
  $("olKeyS").textContent =
    `${NAME[st]}: ${so.metrics.rows.toLocaleString("en-US")} county-days, ${Math.round((so.metrics.events / so.metrics.rows) * 100)}% with a hotspot in the 14 days that followed. ` +
    "Part of every gain over the usual odds needs no weather: refitting the usual odds alone (the second row) already helps. That refit is the model's chance with no weather, which the map compares against, so the map shows the weather's own effect. " +
    (p30b != null && p30b <= 0.001
      ? `Here the past 30 days of weather add nothing beyond that refit (${sp(p30b)}); all the weather's skill is in the days ahead. `
      : "") +
    "Brier: the average squared gap between the chance given and what happened; lower is better. Against the usual or the recalibrated odds: the Brier skill score against that row. AUC: how often a county-window with a hotspot got a higher chance than one without; 0.5 is a coin toss. " +
    "We expect the live outlook to land between the past-30-days row, which needs no forecast, and the last; that was not tested.";
  $("olSrc").innerHTML =
    `Weather: ${OM} forecast API, ECMWF IFS 0.25° model${r && r.status === "ok" && r.fallback ? `, with Open-Meteo's best-match model for ${r.fallback} ${r.fallback === 1 ? "county" : "counties"} where ECMWF had gaps` : ""} (data CC BY 4.0)` +
    (r && r.status === "ok" ? `, fetched at ${new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "") +
    `. Model trained on ERA5 reanalysis from the Open-Meteo archive. Hotspots: NASA FIRMS, VIIRS (Suomi NPP).`;
}
function csvOutlook() {
  const st = S.st!,
    r = olRun(st);
  if (!r || r.status !== "ok") return;
  const rows = ["state,county,fips,first_day,last_day,chance_any_hotspot,usual_chance,chance_without_weather,weather_ratio,ratio_to_usual"];
  r.rows.forEach((o, ci) => {
    const c = D.states[st].counties[ci];
    rows.push(
      [
        st,
        `"${c.name}"`,
        c.fips,
        o ? o.today : "",
        o ? r.end : "",
        o ? o.p.toFixed(4) : "",
        o ? o.base.toFixed(4) : "",
        o ? o.norm.toFixed(4) : "",
        o ? o.wx_ratio.toFixed(3) : "",
        o ? o.ratio.toFixed(3) : "",
      ].join(","),
    );
  });
  save(`outlook-14day_${st}_${r.today}.csv`, rows.join("\n"), $("olMsg"));
}

/* ---------- getting it ---------- */
/** fetch the outlook for a state once the reader asks for it (its map layer or the full data), unless a fresh one is
 * here; force asks again for what is missing. Redraw when it arrives. */
export function olStart(st: StateCode, force = false) {
  olLoad(st, () => S.st === st && render(), force);
}
export function olEvents() {
  const retry = () => S.st && olStart(S.st, true);
  $("olRetry").onclick = retry;
  $("olRetryS").onclick = retry;
  document.querySelectorAll<HTMLButtonElement>("#olSort button").forEach(
    b =>
      (b.onclick = () => {
        sortBy = b.dataset.sort === "ratio" ? "ratio" : "p";
        render();
      }),
  );
  $("olMore").onclick = () => {
    showAll = !showAll;
    render();
  };
  $("olCsv").onclick = csvOutlook;
}
