/* The copilot's tools. Each tool does three things:
     1. returns a compact JSON result for the model to reason over,
     2. emits a result card (a fixed, human-readable layout drawn by the page),
     3. emits a map action (fly to a place, set the period, highlight districts).
   The model never invents numbers: every figure in a card comes from the measurement here. */

import { N, MI_FIRST, MI_LAST, LEVEL_NAME, searchPlaces, loadRegion, loadChildren, geocode, bboxPolygon, countryList, countryTotals } from "./data.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LAST_YEAR = 2000 + Math.floor(MI_LAST / 12), LAST_MONTH = MI_LAST % 12;   // Oct 2026
const mi = (y, m) => (y - 2000) * 12 + m;
const has = x => x >= MI_FIRST && x <= MI_LAST;
const fmt = n => Math.round(n).toLocaleString("en-US");
const short = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
const r1 = x => Math.round(x * 10) / 10;

function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
const pctOf = (v, usual) => usual > 0 ? (v - usual) / usual * 100 : null;
const pctTxt = p => p == null ? "no usual level" : p >= 300 ? `${Math.round(p / 100 + 1)} times the usual` : `${Math.abs(p).toFixed(0)}% ${p >= 0 ? "above" : "below"} usual`;
function levelOf(p) {
  if (p == null) return { text: "No usual level", cls: "flat" };
  if (p >= 100) return { text: "Far above usual", cls: "high" };
  if (p >= 25) return { text: "Above usual", cls: "up" };
  if (p > -25) return { text: "About usual", cls: "flat" };
  return { text: "Below usual", cls: "down" };
}
/** Every year's value for one calendar month (m is 0-based). */
const monthVals = (S, m) => { const out = []; for (let y = 2000; y <= LAST_YEAR; y++) if (has(mi(y, m))) out.push({ y, v: S[mi(y, m)] }); return out; };
const usualMonth = (S, m) => median(monthVals(S, m).map(r => r.v));
/** Totals for the complete years 2001 to 2025. */
function yearTotals(S) {
  const out = [];
  for (let y = 2001; y <= LAST_YEAR; y++) {
    let sum = 0, n = 0;
    for (let m = 0; m < 12; m++) if (has(mi(y, m))) { sum += S[mi(y, m)]; n++; }
    if (n === 12) out.push({ y, v: sum });
  }
  return out;
}
function trendPerDecade(rows) {
  if (rows.length < 8) return null;
  const mx = rows.reduce((t, r) => t + r.y, 0) / rows.length, my = rows.reduce((t, r) => t + r.v, 0) / rows.length;
  if (!(my > 0)) return null;
  return rows.reduce((t, r) => t + (r.y - mx) * (r.v - my), 0) / rows.reduce((t, r) => t + (r.y - mx) ** 2, 0) * 10 / my * 100;
}
const trendTxt = t => t == null ? "not enough data" : Math.abs(t) < 3 ? "steady" : `${t > 0 ? "up" : "down"} ${Math.abs(t).toFixed(0)}% per decade`;
const peakMonth = S => { let best = 0, bv = -1; for (let m = 0; m < 12; m++) { const u = usualMonth(S, m); if (u > bv) { bv = u; best = m; } } return best; };

export class ToolError extends Error {}

/* ------------------------------------------------------------------ places */
const ID_RE = /^([A-Z]{3}(\.\d+){0,2}|osm:[a-z]\d+)$/;

/**
 * Turn what the model passed as `place` into a place with an outline.
 * Accepts: "selection", "view", a place id from find_place, or a name such as "Los Angeles County, California".
 */
export async function resolvePlace(T, place) {
  const p = String(place || "selection").trim(), sel = T.ctx.selection;
  if (/^(selection|selected|this|here|current)$/i.test(p)) {
    if (!sel) return { id: "world", name: "Whole world", label: "Whole world", level: -1 };
    if (sel.kind === "region") return resolvePlace(T, sel.id);
    return { id: "custom", name: sel.name || "Selected area", label: sel.name || "Selected area", level: 3, custom: true, series: sel.series, b: sel.bbox || null };
  }
  if (/^(view|map|screen)$/i.test(p)) {
    const b = T.ctx.view && T.ctx.view.bbox;
    if (!b) throw new ToolError("The map view is not known. Ask the user to select an area or name a place.");
    return { id: "view", name: "Current map view", label: "Current map view", level: 3, b, g: bboxPolygon(b), temp: true };
  }
  if (/^world$/i.test(p) || /^(the )?(whole )?(world|earth|globe)$/i.test(p)) return { id: "world", name: "Whole world", label: "Whole world", level: -1 };
  if (ID_RE.test(p)) {
    const r = p.startsWith("osm:") ? await T.store.get("place:" + p) : await loadRegion(T.env, p);
    if (!r) throw new ToolError(`Unknown place id ${p}. Use find_place.`);
    return r;
  }
  const hits = await searchPlaces(T.env, p);
  if (hits.length && hits[0].score >= 50) {
    // several places with exactly this name and nothing to tell them apart: take the one with the most fire
    const tied = hits.filter(h => h.score > hits[0].score - 3).slice(0, 3);
    if (tied.length > 1) {
      const loaded = (await Promise.all(tied.map(h => loadRegion(T.env, h.id)))).filter(Boolean);
      const totals = await Promise.all(loaded.map(async r => (await seriesOf(T, r)).reduce((t, v) => t + v, 0)));
      const best = loaded[totals.indexOf(Math.max(...totals))];
      if (best) { hits.sort((x, y) => (y.id === best.id) - (x.id === best.id)); }
    }
    const r = await loadRegion(T.env, hits[0].id);
    if (r) {
      const alt = hits.slice(1).filter(h => h.score > hits[0].score - 14).map(h => `${h.label} (${LEVEL_NAME[h.level]}, id ${h.id})`);
      if (alt.length) r.alsoMatches = alt.slice(0, 3);
      if (hits[0].spelling) r.spellingCorrectedFrom = p;
      return r;
    }
  }
  const osm = await geocode(T.env, p).catch(() => null);
  if (osm) { await T.store.put("place:" + osm.id, osm); return osm; }
  throw new ToolError(`No place called "${p}" was found. Try the official name, add the state or country, or ask the user.`);
}

/** The monthly harmonized record for a place, measured now (and remembered for this chat). */
export async function seriesOf(T, place) {
  if (place.id === "world") return T.world();
  if (place.custom) return Float64Array.from(place.series || new Array(N).fill(0));
  if (!place.temp) { const hit = await T.store.get("s:" + place.id); if (hit) return Float64Array.from(hit); }
  const { series } = await T.measure([place]);
  if (!place.temp) await T.store.put("s:" + place.id, Array.from(series[0], r1));
  return series[0];
}
export async function seriesOfMany(T, places) {
  const out = new Array(places.length), missing = [];
  await Promise.all(places.map(async (p, i) => { const hit = await T.store.get("s:" + p.id); if (hit) out[i] = Float64Array.from(hit); else missing.push(i); }));
  if (missing.length) {
    const { series } = await T.measure(missing.map(i => places[i]));
    await Promise.all(missing.map((i, j) => { out[i] = series[j]; return T.store.put("s:" + places[i].id, Array.from(series[j], r1)); }));
  }
  return out;
}
/** What the page needs to show a place: outline source, bounds, and the series for the side panel. */
function mapPlace(place, S) {
  if (place.id === "world") return { id: "world", name: "Whole world" };
  const out = { id: place.id, name: place.name, label: place.label, level: place.level, b: place.b };
  if (place.custom) return { ...out, keep: true };
  if (place.pack) out.pack = place.pack; else out.g = place.g;
  if (S) out.series = Array.from(S, r1);
  return out;
}
/** A short unambiguous way to name the place in a follow-up question. */
const askName = p => p.level === 2 && p.within && p.within[0] ? `${p.name}, ${p.within[0]}` : p.level === 1 && p.alsoMatches && p.within && p.within[0] ? `${p.name}, ${p.within[0]}` : p.id === "world" ? "the world" : p.custom || p.temp ? "this area" : p.name;
const unitsOf = p => p.id === "world" ? "countries" : p.level === 0 ? "states" : p.id.startsWith("USA") ? "counties" : "districts";
const kindOf = p => p.level >= 0 && p.level <= 2 ? LEVEL_NAME[p.level] : p.id === "world" ? "world" : "area";
const noteOf = p => ({ ...(p.alsoMatches ? { other_places_with_this_name: p.alsoMatches } : {}), ...(p.spellingCorrectedFrom ? { spelling_corrected_from: p.spellingCorrectedFrom } : {}) });

/* ------------------------------------------------------------------ tools */
const PLACE_ARG = {
  type: "string",
  description: 'Which place. One of: a name with context ("Los Angeles County, California", "Punjab, India", "Colorado"), a place id from find_place, "selection" (the area the user has selected in the app), "view" (what the map currently shows), or "world".',
};

export const TOOLS = [
  {
    name: "find_place",
    description: "Look up countries, states/provinces and districts/counties by name. Only needed to disambiguate (several places share a name) or to check a place exists; the other tools accept names directly.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: 'Official English name, e.g. "Los Angeles", "West Bengal".' },
      within: { type: "string", description: "Optional state or country to narrow the search." },
    }, required: ["query"] },
    status: a => `Finding ${a.query} on the map`,
    async run(a, T) {
      const hits = await searchPlaces(T.env, a.query, { within: a.within });
      if (!hits.length) { const o = await geocode(T.env, [a.query, a.within].filter(Boolean).join(", ")).catch(() => null); if (o) { await T.store.put("place:" + o.id, o); return { matches: [{ id: o.id, name: o.label, kind: "place" }] }; } }
      return { matches: hits.map(h => ({ id: h.id, name: h.label, kind: LEVEL_NAME[h.level] })) };
    },
  },
  {
    name: "area_report",
    description: "Fire activity in one place for a period, compared with what is usual there. Moves the map to the place and period and shows a result card. Use for 'how was X in <month/year>', 'how many hotspots in <month year>', 'was <year> unusual', 'what is happening in X now'. Give year and month for one month, year alone for a whole year, month alone for what that month is usually like, neither for the latest month.",
    parameters: { type: "object", properties: {
      place: PLACE_ARG,
      year: { type: "integer", description: "2000 to 2026." },
      month: { type: "integer", description: "1 to 12." },
    }, required: ["place"] },
    status: a => `Reading the fire record for ${labelArg(a.place)}`,
    async run(a, T) {
      const place = await resolvePlace(T, a.place), S = await seriesOf(T, place);
      let { year, month } = a;
      const m = month ? month - 1 : null;
      if (year && (year < 2000 || year > LAST_YEAR)) throw new ToolError(`The record covers Nov 2000 to ${MONTHS[LAST_MONTH]} ${LAST_YEAR}. For a future period use the outlook tool.`);
      if (year && m != null && !has(mi(year, m))) throw new ToolError(`No complete data for ${MONTH_FULL[m]} ${year}. The record covers Nov 2000 to ${MONTH_FULL[LAST_MONTH]} ${LAST_YEAR}. For a future month use the outlook tool.`);
      const base = { place: place.label, kind: kindOf(place), ...noteOf(place) };

      if (year && m == null) {                                   // a whole year
        const rows = yearTotals(S), cur = rows.find(r => r.y === year), months = [], usual = [];
        for (let k = 0; k < 12; k++) { months.push(has(mi(year, k)) ? S[mi(year, k)] : null); usual.push(usualMonth(S, k)); }
        const partial = !cur, total = months.reduce((t, v) => t + (v || 0), 0);
        const usualSame = usual.reduce((t, v, k) => t + (months[k] == null ? 0 : v), 0), p = pctOf(total, usualSame);
        const rank = cur ? rows.slice().sort((x, y) => y.v - x.v).findIndex(r => r.y === year) + 1 : null;
        const peakK = months.reduce((b, v, k) => (v || 0) > (months[b] || 0) ? k : b, 0);
        T.card({ kind: "snapshot", eyebrow: place.label, title: `${year}${partial ? " (incomplete year)" : ""}`, badge: levelOf(p),
          big: { value: fmt(total), caption: `hotspots · ${pctTxt(p)} (${fmt(usualSame)})` },
          chart: { type: "bars", title: `Month by month, ${year}`, labels: MONTHS, values: months, ref: usual, refLabel: "usual", highlight: [peakK] },
          rows: [rank && { k: "Rank among full years", v: `${ordinal(rank)} most active of ${rows.length}` }, { k: "Busiest month", v: `${MONTH_FULL[peakK]} · ${fmt(months[peakK] || 0)}` }].filter(Boolean),
          suggest: [`Compare ${year} and ${year > 2001 ? year - 1 : year + 1} in ${askName(place)}`, `Is fire increasing in ${askName(place)}?`],
          go: { place: mapPlace(place, S), year, month: -1 } });
        T.action({ type: "goto", place: mapPlace(place, S), year, month: -1, toast: `${place.name} · ${year}` });
        return { ...base, period: String(year), complete_year: !partial, hotspots: Math.round(total), usual_for_same_months: Math.round(usualSame), percent_vs_usual: p == null ? null : Math.round(p),
          level: levelOf(p).text, rank_among_full_years: rank, full_years: rows.length, busiest_month: MONTH_FULL[peakK], months: months.map((v, k) => v == null ? null : { month: MONTHS[k], hotspots: Math.round(v), usual: Math.round(usual[k]) }).filter(Boolean) };
      }

      if (!year && m != null) {                                  // what a calendar month is usually like
        const vals = monthVals(S, m), usual = median(vals.map(r => r.v)), hi = vals.reduce((b, r) => r.v > b.v ? r : b, vals[0]), lo = vals.reduce((b, r) => r.v < b.v ? r : b, vals[0]);
        T.card({ kind: "snapshot", eyebrow: place.label, title: `A usual ${MONTH_FULL[m]}`, big: { value: fmt(usual), caption: "hotspots in a usual year" },
          chart: { type: "bars", title: `Every ${MONTH_FULL[m]} since ${vals[0].y}`, labels: vals.map(r => String(r.y)), values: vals.map(r => r.v), highlight: [vals.indexOf(hi)], refLine: usual, refLabel: "usual" },
          rows: [{ k: "Most active", v: `${hi.y} · ${fmt(hi.v)}` }, { k: "Quietest", v: `${lo.y} · ${fmt(lo.v)}` }],
          suggest: [`What should we expect in ${askName(place)} next ${MONTH_FULL[m]}?`, `What was the worst year in ${askName(place)}?`],
          go: { place: mapPlace(place, S), year: hi.y, month: m } });
        T.action({ type: "goto", place: mapPlace(place, S), year: hi.y, month: m, toast: `${place.name} · ${MONTH_FULL[m]} ${hi.y}, its most active ${MONTH_FULL[m]}` });
        return { ...base, period: `${MONTH_FULL[m]} (all years)`, usual_hotspots: Math.round(usual), most_active: { year: hi.y, hotspots: Math.round(hi.v) }, quietest: { year: lo.y, hotspots: Math.round(lo.v) } };
      }

      const latest = !year;                                       // one month (the latest if none given)
      const x = latest ? MI_LAST : mi(year, m), yy = 2000 + Math.floor(x / 12), mm = x % 12;
      const vals = monthVals(S, mm), v = S[x], usual = median(vals.map(r => r.v)), p = pctOf(v, usual);
      const rank = vals.slice().sort((a2, b2) => b2.v - a2.v).findIndex(r => r.y === yy) + 1;
      let ytd = 0, ytdUsual = 0;
      for (let k = 0; k <= mm; k++) if (has(mi(yy, k))) { ytd += S[mi(yy, k)]; ytdUsual += usualMonth(S, k); }
      T.card({ kind: "snapshot", eyebrow: place.label, title: `${MONTH_FULL[mm]} ${yy}`, badge: levelOf(p),
        big: { value: fmt(v), caption: `hotspots · ${pctTxt(p)} (${fmt(usual)})` },
        chart: { type: "bars", title: `Every ${MONTH_FULL[mm]} since ${vals[0].y}`, labels: vals.map(r => String(r.y)), values: vals.map(r => r.v), highlight: [vals.findIndex(r => r.y === yy)], refLine: usual, refLabel: "usual" },
        rows: [{ k: `Rank among ${MONTH_FULL[mm]}s`, v: `${ordinal(rank)} most active of ${vals.length}` }, { k: `${yy} up to ${MONTHS[mm]}`, v: `${fmt(ytd)} · ${pctTxt(pctOf(ytd, ytdUsual))}` }],
        suggest: [`Was ${yy} unusual for ${askName(place)}?`, `What should we expect in ${askName(place)} next ${MONTH_FULL[mm]}?`],
        go: { place: mapPlace(place, S), year: yy, month: mm } });
      T.action({ type: "goto", place: mapPlace(place, S), year: yy, month: mm, toast: `${place.name} · ${MONTH_FULL[mm]} ${yy}` });
      return { ...base, period: `${MONTH_FULL[mm]} ${yy}`, is_latest_complete_month: x === MI_LAST, hotspots: Math.round(v), usual_for_this_month: Math.round(usual), percent_vs_usual: p == null ? null : Math.round(p), level: levelOf(p).text,
        rank_among_same_months: rank, same_months_on_record: vals.length, year_to_date: { hotspots: Math.round(ytd), usual: Math.round(ytdUsual) } };
    },
  },
  {
    name: "area_history",
    description: "The long-term record of one place, 2001 to 2025: totals per year, the most active years, the most unusual years, the usual fire season and the trend. Use for 'worst year', 'most unusual year', 'is fire increasing here', 'when is fire season'. Moves the map to the place.",
    parameters: { type: "object", properties: { place: PLACE_ARG }, required: ["place"] },
    status: a => `Going through 26 years of fire in ${labelArg(a.place)}`,
    async run(a, T) {
      const place = await resolvePlace(T, a.place), S = await seriesOf(T, place), rows = yearTotals(S);
      if (!rows.some(r => r.v > 0)) throw new ToolError(`No hotspots were recorded in ${place.label} between 2001 and 2025.`);
      const med = median(rows.map(r => r.v)), top = rows.slice().sort((x, y) => y.v - x.v).slice(0, 5);
      const odd = rows.map(r => ({ ...r, p: pctOf(r.v, med) })).filter(r => r.p != null);
      const above = odd.slice().sort((x, y) => y.p - x.p).slice(0, 3), below = odd.slice().sort((x, y) => x.p - y.p).slice(0, 2);
      const pk = peakMonth(S), tr = trendPerDecade(rows), usual12 = MONTHS.map((_, k) => usualMonth(S, k)), yearSum = usual12.reduce((t, v) => t + v, 0);
      const season = usual12.map((v, k) => ({ k, v })).filter(o => yearSum > 0 && o.v / yearSum >= 0.12).map(o => MONTHS[o.k]);
      T.card({ kind: "history", eyebrow: place.label, title: "Fire record, 2001 to 2025", big: { value: String(top[0].y), caption: `most active year · ${fmt(top[0].v)} hotspots` },
        chart: { type: "bars", title: "Hotspots per year", labels: rows.map(r => String(r.y)), values: rows.map(r => r.v), highlight: top.slice(0, 3).map(t => rows.findIndex(r => r.y === t.y)), refLine: med, refLabel: "usual year" },
        rows: [{ k: "Most active years", v: top.slice(0, 3).map(r => `${r.y} (${short(r.v)})`).join(", ") },
          { k: "Most unusual year", v: `${above[0].y} · ${pctTxt(above[0].p)}` },
          { k: "Quietest year", v: `${below[0].y} · ${pctTxt(below[0].p)}` },
          { k: "Fire season", v: season.length ? `${season.join(", ")} · peak ${MONTH_FULL[pk]}` : `peak ${MONTH_FULL[pk]}` },
          { k: "Trend", v: trendTxt(tr), cls: tr == null || Math.abs(tr) < 3 ? "" : tr > 0 ? "up" : "down" }],
        suggest: [`How was ${askName(place)} in ${top[0].y}?`, top[1] ? `Compare ${top[0].y} and ${top[1].y} in ${askName(place)}` : null].filter(Boolean),
        go: { place: mapPlace(place, S), year: top[0].y, month: -1 } });
      T.action({ type: "goto", place: mapPlace(place, S), year: top[0].y, month: -1, toast: `${place.name} · ${top[0].y}, its most active year` });
      return { place: place.label, kind: kindOf(place), ...noteOf(place), usual_year_hotspots: Math.round(med), most_active_years: top.map(r => ({ year: r.y, hotspots: Math.round(r.v) })),
        most_unusual_years_above: above.map(r => ({ year: r.y, percent_above_usual: Math.round(r.p) })), quietest_years: below.map(r => ({ year: r.y, percent_vs_usual: Math.round(r.p) })),
        usual_peak_month: MONTH_FULL[pk], fire_season_months: season, trend: trendTxt(tr), yearly_totals: rows.map(r => ({ year: r.y, hotspots: Math.round(r.v) })) };
    },
  },
  {
    name: "compare",
    description: "Compare fire activity side by side. Either several places (give `places`, 2 to 4, optionally with year and/or month), or several years in one place (give `place` and `years`, 2 to 4). Shows both on the map and a comparison card.",
    parameters: { type: "object", properties: {
      places: { type: "array", items: { type: "string" }, description: "2 to 4 places to compare with each other (names, ids, or \"selection\")." },
      place: { type: "string", description: "The single place, when comparing years." },
      years: { type: "array", items: { type: "integer" }, description: "2 to 4 years to compare within `place`." },
      year: { type: "integer", description: "Optional year when comparing places." },
      month: { type: "integer", description: "Optional month 1 to 12 when comparing places." },
    } },
    status: a => a.years && a.years.length > 1 ? `Comparing ${a.years.join(" and ")} in ${labelArg(a.place)}` : `Comparing ${(a.places || []).map(labelArg).join(" and ")}`,
    async run(a, T) {
      if (a.years && a.years.length >= 2) {                      // years within one place
        const place = await resolvePlace(T, a.place || "selection"), S = await seriesOf(T, place), years = a.years.slice(0, 4);
        const bad = years.find(y => y < 2000 || y > LAST_YEAR);
        if (bad) throw new ToolError(`${bad} is outside the record (2000 to ${LAST_YEAR}).`);
        const usual = MONTHS.map((_, k) => usualMonth(S, k));
        const rows = years.map(y => {
          const vals = MONTHS.map((_, k) => has(mi(y, k)) ? S[mi(y, k)] : null), total = vals.reduce((t, v) => t + (v || 0), 0);
          const same = usual.reduce((t, v, k) => t + (vals[k] == null ? 0 : v), 0), pk = vals.reduce((b, v, k) => (v || 0) > (vals[b] || 0) ? k : b, 0);
          return { y, vals, total, p: pctOf(total, same), pk, full: vals.every(v => v != null) };
        });
        const [A, B] = rows, diff = B.total > 0 ? (A.total - B.total) / B.total * 100 : null;
        T.card({ kind: "compare", eyebrow: place.label, title: years.join(" against "),
          chart: { type: "lines", title: "Hotspots per month", labels: MONTHS, series: rows.map((r, i) => ({ name: String(r.y), values: r.vals, tone: i })).concat([{ name: "usual", values: usual, tone: "ref" }]) },
          table: { head: ["", ...rows.map(r => String(r.y))], rows: [
            ["Hotspots", ...rows.map(r => fmt(r.total) + (r.full ? "" : "*"))],
            ["Against usual", ...rows.map(r => pctTxt(r.p))],
            ["Busiest month", ...rows.map(r => `${MONTH_FULL[r.pk]} (${short(r.vals[r.pk] || 0)})`)]] },
          foot: rows.some(r => !r.full) ? "* incomplete year" : undefined, go: { place: mapPlace(place, S), year: A.y, month: -1 } });
        T.action({ type: "goto", place: mapPlace(place, S), year: A.y, month: -1, toast: `${place.name} · ${years.join(" against ")}` });
        return { place: place.label, comparing: "years", years: rows.map(r => ({ year: r.y, complete: r.full, hotspots: Math.round(r.total), percent_vs_usual: r.p == null ? null : Math.round(r.p), busiest_month: MONTH_FULL[r.pk] })),
          first_vs_second_percent: diff == null ? null : Math.round(diff) };
      }
      const names = (a.places || []).slice(0, 4);
      if (names.length < 2) throw new ToolError("Give two or more places, or one place with two or more years.");
      const places = await Promise.all(names.map(n => resolvePlace(T, n))), series = await Promise.all(places.map(p => seriesOf(T, p)));
      const m = a.month ? a.month - 1 : null, year = a.year;
      if (year && (year < 2000 || year > LAST_YEAR)) throw new ToolError(`${year} is outside the record (2000 to ${LAST_YEAR}).`);
      const period = year && m != null ? `${MONTH_FULL[m]} ${year}` : year ? String(year) : m != null ? `a usual ${MONTH_FULL[m]}` : "a usual year";
      const stats = places.map((p, i) => {
        const S = series[i], usual12 = MONTHS.map((_, k) => usualMonth(S, k)), rows = yearTotals(S);
        let value, usual, line;
        if (year && m != null) { value = has(mi(year, m)) ? S[mi(year, m)] : null; usual = usual12[m]; line = MONTHS.map((_, k) => has(mi(year, k)) ? S[mi(year, k)] : null); }
        else if (year) { line = MONTHS.map((_, k) => has(mi(year, k)) ? S[mi(year, k)] : null); value = line.reduce((t, v) => t + (v || 0), 0); usual = usual12.reduce((t, v, k) => t + (line[k] == null ? 0 : v), 0); }
        else if (m != null) { value = usual12[m]; usual = null; line = usual12; }
        else { value = median(rows.map(r => r.v)); usual = null; line = usual12; }
        return { p, value, usual, pct: usual == null || value == null ? null : pctOf(value, usual), line, pk: peakMonth(S), tr: trendPerDecade(rows) };
      });
      const tbl = [[year ? "Hotspots" : "Usual hotspots", ...stats.map(s => s.value == null ? "no data" : fmt(s.value))]];
      if (year) tbl.push(["Against usual", ...stats.map(s => s.pct == null ? "n/a" : pctTxt(s.pct))]);
      tbl.push(["Usual peak month", ...stats.map(s => MONTH_FULL[s.pk])], ["Long-term trend", ...stats.map(s => trendTxt(s.tr))]);
      T.card({ kind: "compare", eyebrow: `Comparison · ${period}`, title: places.map(p => p.name).join(" and "),
        chart: { type: "lines", title: year ? `Hotspots per month, ${year}` : "Hotspots per month in a usual year", labels: MONTHS, series: stats.map((s, i) => ({ name: s.p.name, values: s.line, tone: i })) },
        table: { head: ["", ...places.map(p => p.name)], rows: tbl } });
      T.action({ type: "outline", places: places.map((p, i) => mapPlace(p, series[i])), year: year || null, month: m == null ? -1 : m, toast: `Comparing ${places.map(p => p.name).join(" and ")}` });
      return { comparing: "places", period, places: stats.map(s => ({ place: s.p.label, kind: kindOf(s.p), ...noteOf(s.p), hotspots: s.value == null ? null : Math.round(s.value), percent_vs_usual: s.pct == null ? null : Math.round(s.pct), usual_peak_month: MONTH_FULL[s.pk], trend: trendTxt(s.tr) })) };
    },
  },
  {
    name: "outlook",
    description: "What to expect in a future (or any) calendar month, estimated from the last 10 years of that month. With by='subregions' it ranks the states of a country or the districts/counties of a state and highlights the ones to watch on the map. With by='area' it gives the expected level for the place itself. Use for 'which counties should I watch in July 2027', 'what should we expect in X next August'. This is a history-based estimate, not a weather forecast.",
    parameters: { type: "object", properties: {
      place: PLACE_ARG,
      month: { type: "integer", description: "Target month, 1 to 12." },
      year: { type: "integer", description: "Target year, e.g. 2027. Only used for labelling." },
      by: { type: "string", enum: ["subregions", "area"], description: "subregions: rank the states or districts inside the place. area: the place as a whole." },
    }, required: ["place", "month"] },
    status: a => `Checking the last ten ${MONTH_FULL[(a.month || 1) - 1]}s across ${labelArg(a.place)}`,
    async run(a, T) {
      const o = await outlook(T, a);
      T.card(o.card); T.action(o.action);
      return o.result;
    },
  },
  {
    name: "population_exposure",
    description: "United States only. How many people live in the counties expected to see the most fire in a given month (the 'high' and 'elevated' watch counties from the outlook). Use for 'how many people live in high-risk areas of California in August'. Counts everyone living in those counties, not only people near fires.",
    parameters: { type: "object", properties: {
      place: { type: "string", description: 'A US state, e.g. "California".' },
      month: { type: "integer", description: "Target month, 1 to 12." },
      year: { type: "integer", description: "Target year, for labelling." },
    }, required: ["place", "month"] },
    status: a => `Counting people in the counties to watch in ${labelArg(a.place)}`,
    async run(a, T) {
      const o = await outlook(T, { ...a, by: "subregions" });
      if (!o.parent.id.startsWith("USA.") || o.parent.level !== 1) throw new ToolError("Population figures are only available for US states. Ask for a US state such as California.");
      const pop = await T.population();
      if (!pop) throw new ToolError("Population data is not loaded.");
      const rows = o.ranked.filter(r => r.watch !== "low").map(r => ({ ...r, pop: pop[r.id] || 0 }));
      const sum = w => rows.filter(r => r.watch === w).reduce((t, r) => t + r.pop, 0), high = sum("high"), elev = sum("elevated");
      const statePop = o.ranked.reduce((t, r) => t + (pop[r.id] || 0), 0);
      T.card({ kind: "exposure", eyebrow: `${o.parent.label} · ${o.when}`, title: "People living in the counties to watch",
        big: { value: fmt(high), caption: `people in ${rows.filter(r => r.watch === "high").length} high-watch counties` },
        rows: [{ k: "Elevated-watch counties", v: `${fmt(elev)} more people` }, { k: "Share of the state's population", v: statePop ? `${((high + elev) / statePop * 100).toFixed(0)}% live in a watch county` : "n/a" }],
        rank: { title: "Counties to watch, by population", items: rows.sort((x, y) => y.pop - x.pop).slice(0, 8).map(r => ({ id: r.id, name: r.name, chip: { text: r.watch === "high" ? "High" : "Elevated", cls: r.watch === "high" ? "high" : "up" }, value: short(r.pop), sub: `people · about ${fmt(r.expected)} hotspots expected`, b: r.b })) },
        foot: "Everyone living in those counties, from US Census county estimates. Most residents are far from any fire; read this as the population of the areas to watch, not the number at risk." });
      T.action(o.action);
      return { place: o.parent.label, month: o.when, people_in_high_watch_counties: high, people_in_elevated_watch_counties: elev, state_population: statePop,
        counties: rows.slice(0, 8).map(r => ({ county: r.name, watch: r.watch, population: r.pop, expected_hotspots: r.expected })), caveat: "Whole-county populations; not the number of people near fires." };
    },
  },
  {
    name: "ask_user",
    description: "Ask the user one short question when you cannot answer without it, for example which area or which month they mean and nothing in the conversation or the app state tells you. Offer 2 to 4 likely answers they can tap. Prefer making a sensible assumption and saying so; ask only when a wrong guess would waste their time. Calling this ends your turn.",
    parameters: { type: "object", properties: {
      question: { type: "string", description: "The question, one sentence." },
      options: { type: "array", items: { type: "string" }, description: "2 to 4 short answers the user can tap, each a complete reply such as 'California' or 'Next month, worldwide'." },
    }, required: ["question", "options"] },
    status: () => "One question for you",
    async run(a, T) { T.ask(String(a.question || "").slice(0, 300), (a.options || []).slice(0, 4).map(o => String(o).slice(0, 60))); return { asked: true }; },
  },
  {
    name: "run_analysis",
    description: `For any data question the other tools do not answer directly: ranking the states or districts of a place for a PAST month or year, totals across several places, counting months above a threshold, custom periods, ratios, "which part of X had the most fire in 2025", and so on. You write the body of an async JavaScript function; it runs in a sandbox with no network access.
Available in the code:
  await fire.place(name)          -> { id, name, label, kind }     name like "Burundi" or "Fresno County, California"; also "selection" or "view"
  await fire.subregions(placeId)  -> [{ id, name }]                states of a country, or districts/counties of a state; [] if none
  await fire.placesIn(place, kind) -> [{ id, name, label }]        kind "countries" | "states" | "districts"; the ones lying inside place, where place is "view", "selection" or a place id. Use this for "in this region / on screen / in the area I drew".
  await fire.countries({ year, month }) -> [{ id, name, hotspots }] every country at once, sorted high to low; month (1-12) optional. Fast: use it for any worldwide ranking instead of loading countries one by one.
  await fire.monthly(idOrIds)     -> number[] (or number[][] for an array of ids, at most 250), monthly hotspot counts
  at(series, year, month)         -> hotspots in that month (month 1-12), or null outside Nov 2000 to Oct 2026
  yearTotal(series, year), usual(series, month), usualYear(series), median(numbers), MONTHS
The code must return an object:
  { summary: <small JSON with the facts you will state>,
    table: { title, columns: [..up to 4 names], rows: [[..]] }   // optional, at most 12 rows, already sorted, numbers rounded
    map: { focus: placeId, places: [placeIds to outline, at most 40], year, month } }   // optional
Keep it short. Fetch many series with one fire.monthly([...]) call, not a loop of calls.`,
    parameters: { type: "object", properties: {
      code: { type: "string", description: "Body of an async function, ending in a return statement." },
      purpose: { type: "string", description: "A few words on what is being worked out, shown to the user, e.g. 'Ranking Burundi's provinces for 2025'." },
    }, required: ["code", "purpose"] },
    status: a => a.purpose || "Working it out from the record",
    async run(a, T) {
      let out;
      try { out = await T.analyze(String(a.code || "")); }
      catch (err) { throw new ToolError(`The code failed: ${String(err && err.message || err).slice(0, 300)}. Fix it and try again.`); }
      if (!out || typeof out !== "object") throw new ToolError("The code must return an object with a summary.");
      const tb = out.table;
      if (tb && Array.isArray(tb.rows) && tb.rows.length) {
        const cols = (tb.columns || []).slice(0, 4).map(String);
        T.card({ kind: "table", eyebrow: "Worked out for this question", title: String(tb.title || a.purpose || "Result").slice(0, 90),
          table: { plain: true, head: cols, rows: tb.rows.slice(0, 12).map(r => (Array.isArray(r) ? r : [r]).slice(0, 4).map(v => typeof v === "number" ? fmt(v) : String(v == null ? "" : v))) },
          foot: "Computed from the monthly record for this question." });
      }
      const m = out.map;
      if (m && (m.focus || (m.places && m.places.length))) {
        const ids = [...new Set((m.places || []).map(String))].slice(0, 40);
        const places = (await Promise.all(ids.map(id => resolvePlace(T, id).catch(() => null)))).filter(p => p && p.id !== "world").map(p => mapPlace(p));
        const focus = m.focus ? await resolvePlace(T, String(m.focus)).catch(() => null) : null;
        T.action({ type: "mark", focus: focus && focus.id !== "world" ? mapPlace(focus) : null, places, year: Number.isInteger(m.year) ? m.year : null, month: Number.isInteger(m.month) ? m.month - 1 : -1,
          toast: focus ? focus.name : places[0] ? places[0].name : "" });
      }
      const text = JSON.stringify({ summary: out.summary == null ? null : out.summary, table: tb && tb.rows ? { columns: tb.columns, rows: tb.rows.slice(0, 12) } : undefined });
      return text.length > 6000 ? { error: "The result is too large. Return a smaller summary (top 10 at most)." } : JSON.parse(text);
    },
  },
];

const labelArg = p => { const s = String(p || "this area"); return /^(selection|view)$/i.test(s) ? (s === "view" ? "the map view" : "the selected area") : ID_RE.test(s) ? "that place" : s; };

/** Shared by outlook and population_exposure. */
async function outlook(T, a) {
  const m = (a.month || 0) - 1;
  if (m < 0 || m > 11) throw new ToolError("month must be 1 to 12.");
  const place = await resolvePlace(T, a.place);
  const lastY = m <= LAST_MONTH ? LAST_YEAR : LAST_YEAR - 1, years = Array.from({ length: 10 }, (_, i) => lastY - 9 + i);
  const when = `${MONTH_FULL[m]}${a.year ? " " + a.year : ""}`;
  const estimate = S => {
    const vals = years.map(y => S[mi(y, m)]), med = median(vals), recent = (vals[7] + vals[8] + vals[9]) / 3, sorted = vals.slice().sort((x, y) => x - y);
    return { vals, med, recent, expected: 0.6 * med + 0.4 * recent, lo: sorted[2], hi: sorted[7], active: vals.filter(v => v >= Math.max(1, med * 0.5)).length };
  };
  const foot = `Estimated from the ${MONTH_FULL[m]}s of ${years[0]} to ${years[9]}: 60% the middle value, 40% the last three years. It does not know about this year's weather, drought or fuel.`;
  const world = place.id === "world" && a.by !== "area";
  const kids = a.by === "area" ? [] : world ? await countryList(T.env) : await loadChildren(T.env, place.id);

  if (!kids.length) {                                            // the place as a whole
    const S = await seriesOf(T, place), e = estimate(S), usualAll = usualMonth(S, m);
    const card = { kind: "outlook", eyebrow: place.label, title: `Outlook for ${when}`, big: { value: `about ${fmt(e.expected)}`, caption: `hotspots expected · usually between ${fmt(e.lo)} and ${fmt(e.hi)}` },
      chart: { type: "bars", title: `The last ten ${MONTH_FULL[m]}s`, labels: years.map(String), values: e.vals, highlight: [7, 8, 9], refLine: e.med, refLabel: "middle value" },
      rows: [{ k: "Last three years", v: `${fmt(e.recent)} on average`, cls: e.recent > e.med * 1.15 ? "up" : e.recent < e.med * 0.85 ? "down" : "" }, { k: `A usual ${MONTH_FULL[m]} since 2000`, v: fmt(usualAll) }], foot };
    return { card, action: { type: "goto", place: mapPlace(place, S), year: lastY, month: m, toast: `${place.name} · ${MONTH_FULL[m]} ${lastY} for reference` }, parent: place, when, ranked: [],
      result: { place: place.label, month: when, basis: `last ten ${MONTH_FULL[m]}s (${years[0]}-${years[9]})`, expected_hotspots: Math.round(e.expected), likely_range: [Math.round(e.lo), Math.round(e.hi)], last_three_year_average: Math.round(e.recent), ten_year_middle: Math.round(e.med), note: "History-based estimate, not a weather forecast." } };
  }

  let series;
  if (world) {                                                   // every country at once, from the worldwide monthly layers
    const layers = await Promise.all(years.map(y => countryTotals(T.env, `m/${mi(y, m)}`)));
    series = kids.map((_, k) => { const s = new Float64Array(N); years.forEach((y, j) => { s[mi(y, m)] = layers[j][k]; }); return s; });
  } else series = await seriesOfMany(T, kids);
  const ranked = kids.map((k, i) => ({ id: k.id, name: k.name, b: k.b, ...estimate(series[i]) })).sort((x, y) => y.expected - x.expected);
  const total = ranked.reduce((t, r) => t + r.expected, 0);
  let cum = 0;
  for (const r of ranked) {
    r.watch = total > 0 && r.expected >= 1 && cum < total * 0.5 ? "high" : total > 0 && r.expected >= 1 && cum < total * 0.8 ? "elevated" : "low";
    cum += r.expected; r.expected = Math.round(r.expected);
  }
  const nHigh = ranked.filter(r => r.watch === "high").length, nElev = ranked.filter(r => r.watch === "elevated").length, kind = unitsOf(place);
  const top = ranked.slice(0, 8);
  const card = { kind: "outlook", eyebrow: place.label, title: `Where to watch in ${when}`,
    big: { value: String(nHigh), caption: `of ${ranked.length} ${kind} account for half of the fire expected · about ${fmt(total)} hotspots in all` },
    rank: { title: `Ranked by expected hotspots · bars show the last ten ${MONTH_FULL[m]}s (${years[0]} to ${years[9]})`, items: top.map(r => ({ id: r.id, name: r.name, b: r.b,
      chip: { text: r.watch === "high" ? "High" : r.watch === "elevated" ? "Elevated" : "Low", cls: r.watch === "high" ? "high" : r.watch === "elevated" ? "up" : "flat" },
      value: `~${fmt(r.expected)}`, sub: `${r.active} of 10 years active${r.recent > r.med * 1.25 ? " · rising lately" : r.recent < r.med * 0.75 ? " · easing lately" : ""}`, spark: r.vals.map(Math.round) })) },
    rows: [{ k: "High watch", v: `${nHigh} ${kind}` }, { k: "Elevated watch", v: `${nElev} ${kind}` }], foot,
    suggest: [place.id.startsWith("USA.") && place.level === 1 ? `How many people live in the watch counties of ${place.name} in ${MONTH_FULL[m]}?` : null,
      top[0] ? (world ? `Which parts of ${top[0].name} should I watch in ${MONTH_FULL[m]}?` : `How was ${top[0].name}, ${place.name} last ${MONTH_FULL[m]}?`) : null].filter(Boolean) };
  const action = { type: "highlight", parent: world ? { id: "world", name: "Whole world", b: [-170, -55, 180, 72] } : mapPlace(place), pack: kids[0].pack, year: lastY, month: m,
    items: ranked.filter(r => r.watch !== "low").slice(0, 60).map(r => ({ id: r.id, name: r.name, watch: r.watch, expected: r.expected })), toast: `${place.name} · where to watch in ${MONTH_FULL[m]}` };
  return { card, action, parent: place, when, ranked,
    result: { place: place.label, month: when, basis: `last ten ${MONTH_FULL[m]}s (${years[0]}-${years[9]})`, expected_hotspots_total: Math.round(total), subregions_ranked: ranked.length, high_watch_count: nHigh, elevated_watch_count: nElev,
      top: top.map(r => ({ name: r.name, watch: r.watch, expected_hotspots: r.expected, years_active_of_10: r.active, last_three_year_average: Math.round(r.recent), ten_year_middle: Math.round(r.med) })), note: "History-based estimate, not a weather forecast." } };
}

export const toolSchemas = TOOLS.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
