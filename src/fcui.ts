import type { Analysis, FcBacktest, FireKind, LargeBacktest, Odds, StateCode } from "./types";
import { D, MON, MONL, NAME } from "./data";
import { S } from "./state";
import { $, fmt } from "./util";
import { hexState, notFireNote, riskFor, riskYears, selMask } from "./model";
import { hideTip, showTip } from "./tooltip";
import { stopPlay } from "./play";
import { render } from "./render";
import { FC_YEARS, fcData, fcHex, fcOn, fcSame, isFc, largeOf, largeYears, monthWhen, pastLargeIn, pctGain, pctP } from "./forecast";

/* =====================================================================
   FORECAST ON THE PAGE: the chance-of-fire controls on the map, the card's
   chance row, and the evidence in the sheet (backtest against past odds).
   ===================================================================== */
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const NY_WHY = "The large-fire switch is California only: it needs official fire boundary maps, which this site has only from CAL FIRE.";

/** a Brier gain in words; "modestly better" only from 2% up */
export const verdictWord = (s: number) =>
  s >= 0.1
    ? "clearly better than"
    : s >= 0.02
      ? "modestly better than"
      : s > 0.005
        ? "slightly better than"
        : s > -0.005
          ? "about the same as"
          : "worse than";
const largeSkill2 = (b: LargeBacktest) => 1 - b.model.brier / b.history_alone.brier;
/** how far below what happened the any-fire forecast's total ran in the tests (0.17 = 17% low) */
const runsLow = (st: StateCode) => {
  const b = fcData()!.backtest[st].hex.model;
  return 1 - b.mean_p / b.base_rate;
};

/* ---------- controls on the map ---------- */
export function renderOdds() {
  const st = S.st!,
    ch = S.layer === "chance",
    fc = fcOn(st),
    L = largeOf(st);
  $("oddsBar").hidden = !ch;
  $("playMap").hidden = $("tlMain").hidden = S.layer !== "count";
  ["oddsSeg", "oddsSheet"].forEach(id =>
    document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach(b => {
      b.hidden = b.dataset.odds !== "past" && !fc;
      b.setAttribute("aria-pressed", String(b.dataset.odds === String(S.odds)));
    }),
  );
  $("oddsSheet").hidden = !fc;
  $("fireSeg").hidden = !L;
  document
    .querySelectorAll<HTMLButtonElement>("#fireSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.fire === S.fire)));
  if (!ch) return;
  const big = S.fire === "large",
    F = fcData(),
    mo = MONL[S.rm];
  let h: string;
  if (isFc()) {
    const bt = F!.backtest[st].hex,
      low = runsLow(st);
    h = big
      ? `<b>Forecast for ${monthWhen()}</b>: chance a large fire starts and reaches each hexagon, from fire history alone, not weather.<span class="more"> It picks out the likelier places and months better than past odds but cannot tell a big fire year from a quiet one.</span>`
      : `<b>Forecast for ${monthWhen()}</b>: chance of at least one hotspot, from fire history alone, not weather.<span class="more"> Tested on 2018–2025, ${verdictWord(bt.brier_skill_vs_history)} past odds.</span>` +
        (low > 0.1 ? ` In tests it ran ${Math.round(low * 100)}% low overall.` : "");
    if (S.odds === 2027 && fcSame(st, big ? "large" : "any"))
      h += ` <span class="more">The 2027 map equals 2026's: the model found no trend to carry forward here.</span>`;
  } else if (big) {
    const [a, b] = largeYears();
    h = `<b>Past odds of a large fire</b> (1,000+ acres)<span class="more"> on CAL FIRE's fire perimeter maps</span> in ${mo}, ${a}–${b}. History, not a forecast.`;
  } else {
    const [a, b] = riskYears();
    h = `<b>Past odds</b>: share of ${mo}s ${a < b ? `${a}–${b}` : a} with a hotspot<span class="more">, complete years only</span>. History, not a forecast.`;
  }
  if (!L) h += ` <span title="${esc(NY_WHY)}">Large fires: California only.</span>`;
  $("oddsNote").innerHTML = h;
  $("oddsNote").title = L ? "" : NY_WHY;
}

/* ---------- the card's chance row ---------- */
export function chanceCard(R: Analysis): { q: string; v: string; title: string } {
  const st = S.st!,
    sl = S.sel,
    mo = MON[S.rm],
    big = S.fire === "large" && !!largeOf(st);
  if (!isFc() || !fcOn(st)) {
    if (big) {
      const [a, b] = largeYears(),
        r = pastLargeIn(st, selMask(), S.rm, a, b);
      return {
        q: `Large fire in ${mo}, past`,
        v: pctP(r.k / r.n, true),
        title: `A large fire (1,000+ acres) started and reached this area in ${r.k} of the ${r.n} ${MONL[S.rm]}s ${a}–${b}. History, not a forecast.`,
      };
    }
    const rk = riskFor(R, S.rm);
    return {
      q: `Chance of fire in ${mo}`,
      v: rk.n ? Math.round(rk.p * 100) + "%" : "n/a",
      title: `Share of the ${MONL[S.rm]}s ${rk.a}–${rk.b} with a hotspot here. History, not a forecast.${notFireNote(st, selMask())}`,
    };
  }
  const year = S.odds as number,
    fire: FireKind = big ? "large" : "any",
    w = fcHex(st, fire, year, S.rm)!,
    what = big ? "a large fire" : "fire",
    q = `${big ? "Large fire" : "Fire"}, ${mo} ${year} forecast`;
  if (sl.type === "hex")
    return { q, v: pctP(w[sl.k]), title: `Forecast chance of ${what} in this hexagon in ${MONL[S.rm]} ${year}, from fire history alone.` };
  if (sl.type === "county") {
    const c = fcHex(st, fire, year, S.rm, true),
      hx = hexState(st);
    let top = 0;
    for (let k = 0; k < hx.n; k++) if (hx.c[k] === sl.ci && w[k] > top) top = w[k];
    return {
      q,
      v: pctP(Math.max(c ? c[sl.ci] : 0, top)),
      title: `Forecast chance of ${what} somewhere in the county in ${MONL[S.rm]} ${year}, from fire history alone.`,
    };
  }
  const m = selMask();
  let s = 0,
    n = 0;
  for (let k = 0; k < w.length; k++)
    if (m[k]) {
      s += w[k];
      n++;
    }
  return {
    q: `Hexagons with ${big ? "large " : ""}fire, ${mo} ${year}`,
    v: "≈ " + (s < 10 ? s.toFixed(1) : fmt(s)),
    title:
      `Expected number of the ${fmt(n)} hexagons here with ${big ? "a large fire" : "at least one hotspot"} in ${MONL[S.rm]} ${year}: the sum of their forecast chances.` +
      (!big && runsLow(st) > 0.1
        ? ` In tests ${NAME[st]} totals ran about ${Math.round(runsLow(st) * 100)}% low, so this is probably too low.`
        : ""),
  };
}
/** a sentence on the forecast for the sheet's "odds of fire" answer */
export function forecastLine(st: StateCode): string {
  if (!fcOn(st)) return "";
  const sl = S.sel,
    hx = hexState(st),
    mo = MONL[S.rm],
    val = (y: number) => {
      const w = fcHex(st, "any", y, S.rm)!;
      if (sl.type === "hex") return pctP(w[sl.k]);
      if (sl.type === "county") {
        const c = fcHex(st, "any", y, S.rm, true)!;
        let top = 0;
        for (let k = 0; k < hx.n; k++) if (hx.c[k] === sl.ci && w[k] > top) top = w[k];
        return pctP(Math.max(c[sl.ci], top));
      }
      const m = selMask();
      let s = 0;
      for (let k = 0; k < w.length; k++) if (m[k]) s += w[k];
      return "about " + (s < 10 ? s.toFixed(1) : fmt(s)) + " hexagons with fire";
    };
  return ` The forecast, from fire history alone: ${FC_YEARS.map(y => `${mo} ${y} ${val(y)}`).join(", ")}.`;
}

/* ---------- the sheet: is the forecast better than past odds? ---------- */
const br = (x: number) => x.toPrecision(3);
const auc = (x: number | null) => (x == null ? "–" : x.toFixed(3));
export function renderForecastSheet() {
  const st = S.st!,
    F = fcData();
  $("fcSec").hidden = !fcOn(st);
  $("dlFcBox").hidden = !fcOn(st);
  if (!F || !fcOn(st)) return;
  const B = F.backtest[st],
    L = largeOf(st),
    h = B.hex,
    c = B.county,
    lh = L ? L.backtest.hex.horizon_1y : null,
    lc = L ? L.backtest.county.horizon_1y : null;
  /* one-line verdict, from the numbers */
  let v = `Any fire: <b>${verdictWord(Math.min(h.brier_skill_vs_history, c.brier_skill_vs_history))} past odds</b>. Predicting each year 2018–2025 from the years before it, its Brier score was ${pctGain(h.brier_skill_vs_history)} lower for hexagons (better in ${h.years_model_better_brier} years) and ${pctGain(c.brier_skill_vs_history)} lower for counties.`;
  if (lh && lc)
    v += ` Large fires: <b>${verdictWord(lh.brier_skill_vs_history_alone)} past odds</b> for hexagons (${pctGain(lh.brier_skill_vs_history_alone)} lower), only ${pctGain(lh.brier_skill_vs_state_seasonal_average)} better than the state's plain seasonal average, and ${verdictWord(lc.brier_skill_vs_history_alone)} past odds for counties.`;
  $("fcVerdict").innerHTML = v;
  const same = [fcSame(st, "any") && "hexagons", fcSame(st, "any", true) && "counties"].filter(Boolean) as string[];
  $("fcNote").textContent =
    `It gives the chance of at least one hotspot in each hexagon and county, in each month of 2026 and 2027${L ? ", and in California the chance that a large fire (1,000+ acres) starts and reaches it" : ""}. It is built from fire history alone, to December 2025: no weather, fuel or ignitions, and none of the 2026 data now on the calendar. So it is the long-run chance for the month, not a warning that a given month will be unusual. Pick Forecast 2026 or 2027 on the map's Chance of fire layer, or above, to use it.` +
    (same.length
      ? ` For ${NAME[st]} ${same.join(" and ")}, any fire, 2027's chances are the same as 2026's: the backtest chose no trend term there, so the two years differ only in how far ahead they were tested.`
      : "");
  $("dlFcNote").textContent =
    "The forecast for every month of 2026 and 2027, for the area chosen above, with past odds alongside. Chances run from 0 to 1; 0 means under 0.0005." +
    (same.length ? ` For ${NAME[st]} ${same.join(" and ")}, the 2027 rows repeat 2026's any-fire chances.` : "") +
    " The county file gives a county at least its likeliest hexagon's chance, as the page does.";
  const row = (u: string, m: FcBacktest) =>
    `<tr><td class="u">${u}</td><td>${br(m.model.brier)}</td><td>${br(m.history_alone.brier)}</td><td class="em">${pctGain(m.brier_skill_vs_history)}</td><td>${auc(m.model.auc)}</td><td>${auc(m.history_alone.auc)}</td><td>${m.years_model_better_brier}</td><td>${pctGain(m.horizon2.brier_skill_vs_history)}</td></tr>`;
  const lrow = (u: string, b: { horizon_1y: LargeBacktest; horizon_2y: LargeBacktest }) =>
    `<tr><td class="u">${u}</td><td>${br(b.horizon_1y.model.brier)}</td><td>${br(b.horizon_1y.history_alone.brier)}</td><td class="em">${pctGain(b.horizon_1y.brier_skill_vs_history_alone)}</td><td>${auc(b.horizon_1y.model.auc)}</td><td>${auc(b.horizon_1y.history_alone.auc)}</td><td>–</td><td>${pctGain(largeSkill2(b.horizon_2y))}</td></tr>`;
  $("fcTable").innerHTML =
    `<tr><th>Tested on 2018–2025</th><th>Brier, forecast</th><th>Brier, past odds</th><th>Lower by</th><th>AUC, forecast</th><th>AUC, past odds</th><th>Years better</th><th>2 years ahead, lower by</th></tr>` +
    `<tr class="grp"><td colspan="8">Any fire: at least one hotspot</td></tr>` +
    row("Hexagons", h) +
    row("Counties", c) +
    (L
      ? `<tr class="grp"><td colspan="8">Large fires: 1,000+ acres, CAL FIRE perimeters</td></tr>` +
        lrow("Hexagons", L.backtest.hex) +
        lrow("Counties", L.backtest.county)
      : "");
  $("fcKey").textContent =
    "Brier score: the average squared gap between the chance given and what happened; lower is better. AUC: how often a place that burned was given a higher chance than one that did not; 0.5 is a coin toss, 1 is perfect. Past odds: the share of earlier years with fire in that place and month, which is what the map shows under Past odds. 2 years ahead is the 2027 case: trained on years up to two before the test year." +
    (L ? " Large fires have no per-year Brier table, so that column is blank." : "");
  /* reliability */
  const anyRel = relChart(`Any fire, hexagons`, norm(h.model.reliability || []), norm(h.history_alone.reliability || []));
  const largeRel =
    L && lh
      ? relChart(
          `Large fires, hexagons`,
          lh.reliability_model.map(r => ({ lo: r.pred_range[0], hi: r.pred_range[1], n: r.n, p: r.mean_pred, o: r.observed })),
          lh.reliability_history_alone.map(r => ({ lo: r.pred_range[0], hi: r.pred_range[1], n: r.n, p: r.mean_pred, o: r.observed })),
        )
      : "";
  $("fcRel").innerHTML = anyRel + largeRel;
  $("fcRel")
    .querySelectorAll<SVGCircleElement>("circle[data-tip]")
    .forEach(el => {
      el.onmousemove = e => showTip(e, el.dataset.tip!);
      el.onmouseleave = hideTip;
    });
  /* limits, written from the numbers */
  const lim: string[] = [];
  const py = h.per_year,
    g = (r: FcBacktest["per_year"][number]) => 1 - r.brier_model / r.brier_history;
  if (py.length > 1)
    lim.push(
      `<b>The gain is shrinking</b> as history piles up: for hexagons it was ${pctGain(g(py[0]))} in ${py[0].year} and ${pctGain(g(py[py.length - 1]))} in ${py[py.length - 1].year}, so expect the low end for 2026.`,
    );
  const low = (h.model.reliability || []).filter(r => r.bin[1] <= 0.01 && r.n >= 50 && r.mean_p && r.observed != null);
  if (low.length) {
    const ratios = low.map(r => r.observed! / r.mean_p!),
      obs = low.map(r => r.observed!);
    lim.push(
      `<b>Small chances run low.</b> Where the forecast said under 1%, fire came ${Math.min(...ratios).toFixed(1)}–${Math.max(...ratios).toFixed(1)} times as often as it said, though still only ${pctP(Math.min(...obs))}–${pctP(Math.max(...obs))} of the time.`,
    );
  }
  const z = (h.history_alone.reliability || []).find(r => r.bin[0] === 0 && r.n > 0);
  if (z && z.observed)
    lim.push(
      `Past odds said 0% for ${fmt(z.n)} of the ${fmt(h.history_alone.n)} test hexagon-months; fire came in ${pctP(z.observed)} of them. The forecast gives such places a small chance instead of none.`,
    );
  const ratio = h.model.mean_p / h.model.base_rate;
  if (ratio < 0.9)
    lim.push(
      `<b>${NAME[st]} runs low overall.</b> In the tests the forecast expected ${pctP(h.model.mean_p)} of hexagon-months to have fire; ${pctP(h.model.base_rate)} did, because fire there has been rising. Treat any ${NAME[st]} total as probably too low.`,
    );
  if (L && lh) {
    const ev = Object.entries(lh.model.expected_vs_observed_by_year).map(([y, [e, o]]) => ({ y, e, o, r: o / Math.max(1, e) })),
      hi = ev.reduce((a, b) => (b.r > a.r ? b : a)),
      lo = ev.reduce((a, b) => (b.r < a.r ? b : a));
    lim.push(
      `<b>Large fires: it cannot tell a big year from a quiet one.</b> It expected about ${Math.round(hi.e)} large-fire hexagon-months in ${hi.y}, which had ${hi.o}, and about ${Math.round(lo.e)} in ${lo.y}, which had ${lo.o}. Read it as typical odds for the place and month. Its strength is ranking: ${pctGain(lh.model.share_of_events_in_top_risk.top_5pct)} of the hexagon-months that had a large fire were in its top 5%, against ${pctGain(lh.history_alone.share_of_events_in_top_risk.top_5pct)} for past odds and ${pctGain(lh.state_seasonal_average.share_of_events_in_top_risk.top_5pct)} for the state's seasonal average. Much of its AUC (${auc(lh.model.auc)}) comes from the season alone: a rule that knows only the month scores ${auc(lh.state_seasonal_average.auc)}, and past odds ${auc(lh.history_alone.auc)}.`,
    );
  }
  lim.push(
    `Counties and hexagons are forecast separately (${esc(B.county_below_its_likeliest_hex)} have a county chance below that of its likeliest hexagon); the page shows the higher of the two for a county.`,
  );
  $("fcLimits").innerHTML = lim.map(t => `<li>${t}</li>`).join("");
  $("fcMethod").innerHTML =
    `<p>${esc(F.method)}</p><p class="note small" style="margin-top:6px">Settings for ${NAME[st]}: hexagons ${esc(h.final_settings_label)}; counties ${esc(c.final_settings_label)}. Settings for each test year were chosen only on earlier years (${esc(h.settings_chosen_on)}).</p>` +
    (L
      ? `<p style="margin-top:8px"><b>Large fires.</b> ${esc(L.definition)} ${esc(L.method)}</p>` +
        `<ul class="steps">${L.limits.map(t => `<li>${esc(t)}</li>`).join("")}<li>${Math.round(L.firms_inside.viirs * 100)}% of California's VIIRS hotspots fall inside a large-fire perimeter while it burned, but far fewer in quiet years, so large fires and all fires make different maps.</li></ul>` +
        `<p class="note small" style="margin-top:6px">${esc(L.credit)} <a href="${esc(L.source_page)}" target="_blank" rel="noopener">CAL FIRE FRAP fire perimeters</a>, retrieved ${esc(L.retrieved)}.</p>`
      : `<p class="note small" style="margin-top:6px">${esc(NY_WHY)}</p>`);
}
interface RelPoint {
  lo: number;
  hi: number;
  n: number;
  p: number | null;
  o: number | null;
}
const norm = (r: { bin: [number, number]; n: number; mean_p: number | null; observed: number | null }[]): RelPoint[] =>
  r.map(b => ({ lo: b.bin[0], hi: b.bin[1], n: b.n, p: b.mean_p, o: b.observed }));
/** predicted against observed, on square-root axes so small chances are visible; dot size by number of cases */
function relChart(title: string, model: RelPoint[], hist: RelPoint[]) {
  const W = 540,
    H = 330,
    ml = 50,
    mr = 14,
    mt = 26,
    mb = 40,
    ok = (r: RelPoint) => r.n >= 20 && r.p != null && r.o != null,
    pts = [...model.filter(ok), ...hist.filter(ok)],
    top = Math.max(0.01, ...pts.map(r => Math.max(r.p!, r.o!))) * 1.08,
    sc = (v: number) => Math.sqrt(Math.max(0, v) / top),
    X = (v: number) => ml + sc(v) * (W - ml - mr),
    Y = (v: number) => H - mb - sc(v) * (H - mt - mb),
    nMax = Math.max(1, ...pts.map(r => r.n)),
    lab = (v: number) => (v === 0 ? "0" : v >= 0.01 ? Math.round(v * 100) + "%" : (v * 100).toFixed(1) + "%");
  let g = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(top)}" y2="${Y(top)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="4 4"/>`;
  let last = -99;
  for (const t of [0, 0.001, 0.003, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1]) {
    if (t > top) break;
    if (X(t) - last < 34) continue;
    last = X(t);
    g +=
      `<line x1="${X(t)}" x2="${X(t)}" y1="${Y(0)}" y2="${Y(0) + 4}" stroke="rgba(255,255,255,.4)"/><text x="${X(t)}" y="${Y(0) + 16}" text-anchor="middle">${lab(t)}</text>` +
      `<line x1="${ml - 4}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="rgba(255,255,255,${t ? 0.07 : 0.3})"/><text x="${ml - 7}" y="${Y(t) + 4}" text-anchor="end">${lab(t)}</text>`;
  }
  g += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle">chance given</text><text x="${ml - 7}" y="12" text-anchor="end">fire came</text><text x="${X(top) - 4}" y="${Y(top) + 14}" text-anchor="end" style="fill:rgba(255,255,255,.5)">dashed line: fire came as often as said</text>`;
  const series = (rs: RelPoint[], col: string, who: string) => {
    const r = rs.filter(ok);
    let s = `<polyline fill="none" stroke="${col}" stroke-width="1.6" stroke-opacity=".7" points="${r.map(b => `${X(b.p!).toFixed(1)},${Y(b.o!).toFixed(1)}`).join(" ")}"/>`;
    for (const b of r)
      s += `<circle cx="${X(b.p!).toFixed(1)}" cy="${Y(b.o!).toFixed(1)}" r="${(2.5 + 5 * Math.sqrt(b.n / nMax)).toFixed(1)}" fill="${col}" stroke="#000" stroke-width="1" data-tip="${esc(`${who} said ${lab(b.lo)}–${lab(b.hi)}\n${fmt(b.n)} hexagon-months, ${pctP(b.p!, true)} on average\nFire came in ${pctP(b.o!, true)}`)}"/>`;
    return s;
  };
  g += series(hist, "#6fa8ff", "Past odds") + series(model, "#ff8a3d", "Forecast");
  return (
    `<div><h4>${title}: how often fire came, by chance given</h4><div class="key"><span><i style="background:var(--ember)"></i>Forecast</span><span><i style="background:var(--cool)"></i>Past odds</span><span>Dot size: number of cases. Groups of under 20 left out.</span></div>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: observed share of fire against the chance given, for the forecast and for past odds">${g}</svg></div>`
  );
}

/* ---------- controls ---------- */
export function oddsEvents() {
  const setOdds = (b: HTMLButtonElement) => {
    S.odds = (b.dataset.odds === "past" ? "past" : +b.dataset.odds!) as Odds;
    render();
  };
  ["oddsSeg", "oddsSheet"].forEach(id =>
    document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach(b => (b.onclick = () => setOdds(b))),
  );
  document.querySelectorAll<HTMLButtonElement>("#fireSeg button").forEach(
    b =>
      (b.onclick = () => {
        stopPlay();
        S.fire = b.dataset.fire === "large" ? "large" : "any";
        render();
      }),
  );
}
/** the counties that come first by forecast fire risk in month m of a forecast year: the same rule as the stations,
 * each county by the sum of its hexagons' chances, with its share of the state's */
export function countyRiskFc(st: StateCode, m: number, year: number) {
  const w = fcHex(st, "any", year, m)!,
    cp = fcHex(st, "any", year, m, true),
    hx = hexState(st),
    cs = D.states[st].counties,
    sum = new Float64Array(cs.length),
    top = new Float32Array(cs.length);
  let all = 0;
  for (let k = 0; k < hx.n; k++) {
    sum[hx.c[k]] += w[k];
    all += w[k];
    if (w[k] > top[hx.c[k]]) top[hx.c[k]] = w[k];
  }
  return cs
    .map((c, ci) => ({ ci, name: c.name, e: sum[ci], share: all ? sum[ci] / all : 0, p: Math.max(cp ? cp[ci] : 0, top[ci]) }))
    .sort((x, y) => y.e - x.e || y.p - x.p);
}
