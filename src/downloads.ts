import type { StateCode } from "./types";
import { D, FILL_SRC, FULL_I, LAST_DATE, LAST_I, NM, Y0, fillDays } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { analyseFor, harm, hexState, notFire, riskYears, selMask } from "./model";
import { FC_YEARS, fcData, fcOn, largeMarked, largeOf, largeYears } from "./forecast";

/* ---------- downloads ---------- */
const selSlug = () => `${S.st}-${S.sel.type === "county" ? D.states[S.st!].counties[S.sel.ci].name.replace(/\W+/g, "") : S.sel.type}`;
/** hand the reader a CSV file, and say how it went in msg */
export async function save(filename: string, data: string, msg: HTMLElement = $("dlMsg")) {
  try {
    const d = window.claude && (await window.claude.use("downloads"));
    if (d) {
      await d.save({ filename, data });
      msg.textContent = `Saved ${filename}.`;
      return;
    }
  } catch (e) {
    msg.textContent = "The download was declined.";
    return;
  }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    msg.textContent = `Saved ${filename}.`;
  } catch (e) {
    msg.textContent = "Downloads are not available in this view.";
  }
}
/** MODIS columns after the last MODIS month in data.js are blank: MODIS was not fetched for 2026 */
const modisThrough = () => {
  const t = D.meta.modis_through;
  return t ? (t[0] - Y0) * 12 + t[1] - 1 : NM - 1;
};
/** how complete a month is: "complete", "partial_to_2026-11-14" */
export const monthStatus = (i: number) => (i <= FULL_I ? "complete" : i <= LAST_I ? `partial_to_${LAST_DATE}` : "no_data");
/** the days of month i in state st that Suomi NPP missed and NOAA-20 filled, converted to Suomi NPP terms
 * ("2026-03-10 2026-03-11"; past outages too), and the days estimated from the days either side */
function fillDates(i: number, st: StateCode) {
  const f = fillDays(i, st),
    pre = `${Y0 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-`,
    iso = (d: number[]) => d.map(x => pre + String(x).padStart(2, "0")).join(" ");
  return { n20: iso(f.n20), interp: iso(f.interp), any: f.n20.length + f.interp.length > 0 };
}
export function csvCal() {
  const st = S.st!,
    s = D.states[st],
    R = analyseFor(st, S.sel),
    mt = modisThrough(),
    whole = S.sel.type === "state",
    m26 = new Map((s.y2026?.months ?? []).map(m => [m.i, m])),
    gaps = new Map((s.hist_gaps ?? []).map(g => [g.i, g])),
    rows = [
      "year,month,month_status,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs_on_filled_days,noaa20_converted_snpp_terms,days_from_noaa20_converted,days_estimated_from_neighbours,median_for_calendar_month,ratio_to_median",
    ];
  /* a partial month's median and ratio are for the same days of past years (blank where the area has none). On months
     with days from NOAA-20, raw_snpp_viirs is Suomi NPP as observed; the per-day split is known for the whole state
     only, so for a county or smaller area those columns are blank on 2026 months with filled days */
  R.ser.forEach(r => {
    const f = fillDates(r.i, st),
      m = m26.get(r.i),
      g = gaps.get(r.i);
    let snpp: string | number = r.V,
      n20raw: string | number = "",
      n20conv: string | number = "";
    if (f.any && m) {
      snpp = whole ? m.snpp : "";
      n20raw = whole ? m.n20_raw : "";
      n20conv = whole ? m.n20_converted : "";
    } else if (f.any && g) {
      n20raw = whole ? g.n20_gap : "";
      n20conv = (r.h - (r.V - (whole ? g.snpp_gap : 0))).toFixed(2);
      if (!whole) n20conv = "";
    }
    rows.push(
      [
        r.y,
        r.m + 1,
        monthStatus(r.i),
        r.h.toFixed(2),
        r.lo.toFixed(2),
        r.hi.toFixed(2),
        `"${f.any ? FILL_SRC : r.src}"`,
        r.i > mt ? "" : r.T,
        r.i > mt ? "" : r.A,
        snpp,
        n20raw,
        n20conv,
        f.n20,
        f.interp,
        Number.isFinite(r.med) ? r.med.toFixed(2) : "",
        r.med > 0 ? (r.h / r.med).toFixed(3) : "",
      ].join(","),
    );
  });
  save(`burn-calendar_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
}
export function csvHot() {
  const s = D.states[S.st!],
    hx = hexState(S.st!),
    mask = selMask(),
    cr = s.hex_rows,
    mt = modisThrough(),
    gapHex = new Map<number, number>(),
    rows = [
      "hex_center_lat,hex_center_lon,county,year,month,month_status,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,harmonized_viirs_equivalent,source,days_from_noaa20_converted,days_estimated_from_neighbours",
    ];
  /* past Suomi NPP outage days filled from NOAA-20: the change per hexagon-month */
  const gh = s.gap_hex_rows ?? [];
  for (let p = 0; p < gh.length; p += 3) gapHex.set(gh[p] * NM + gh[p + 1], gh[p + 2]);
  const push = (k: number, i: number, T: number, A: number, V: number) => {
    const y = Y0 + Math.floor(i / 12);
    if (!mask[k] || y < S.yFrom || y > S.yTo) return;
    const h = harm(S.st!, i, T, A, V),
      f = fillDates(i, S.st!),
      dh = gapHex.get(k * NM + i) ?? 0;
    gapHex.delete(k * NM + i);
    rows.push(
      [
        hx.Y[k].toFixed(3),
        (hx.X[k] / hx.K).toFixed(3),
        `"${s.counties[hx.c[k]].name}"`,
        y,
        (i % 12) + 1,
        monthStatus(i),
        i > mt ? "" : T,
        i > mt ? "" : A,
        /* Suomi NPP as observed; blank on 2026 months with days from NOAA-20, whose per-hexagon split is not kept */
        f.any && y >= 2026 ? "" : V,
        Math.max(0, h.h + dh).toFixed(2),
        `"${f.any ? FILL_SRC : h.src}"`,
        f.n20,
        f.interp,
      ].join(","),
    );
  };
  for (let p = 0; p < cr.length; p += 5) push(cr[p], cr[p + 1], cr[p + 2], cr[p + 3], cr[p + 4]);
  /* hexagon-months that Suomi NPP saw nothing in but NOAA-20 did, on past outage days */
  [...gapHex.keys()].forEach(key => push(Math.floor(key / NM), key % NM, 0, 0, 0));
  save(`hotspots-hex_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
}

/* ---------- forecast downloads: every month of 2026 and 2027, with past odds alongside ---------- */
/** permille to a chance 0..1 with three decimals, exactly as stored */
const pm = (v: number) => (v / 1000).toFixed(3);
/** past odds of each hexagon (or county) in each calendar month: share of years a..b with fire */
function pastShares(n: number, a: number, b: number, hit: (u: number, i: number) => boolean) {
  const o = new Float32Array(n * 12);
  for (let u = 0; u < n; u++)
    for (let m = 0; m < 12; m++) {
      let c = 0;
      for (let y = a; y <= b; y++) if (hit(u, (y - Y0) * 12 + m)) c++;
      o[u * 12 + m] = c / (b - a + 1);
    }
  return o;
}
/** the rows of the hexagon forecast file for the chosen area */
export function forecastHexRows(st: StateCode = S.st!, mask: Uint8Array = selMask()) {
  const F = fcData()!,
    hx = hexState(st),
    s = D.states[st],
    n = hx.n,
    any = F[st].any.p,
    L = largeOf(st),
    LM = largeMarked(st),
    [a, b] = riskYears(),
    [la, lb] = largeYears(),
    nf = notFire(st),
    pa = pastShares(n, a, b, (k, i) => !nf[k] && hx.H[k * NM + i] > 0),
    pl = L && LM ? pastShares(n, la, lb, (k, i) => LM[k * NM + i] === 1) : null,
    rows = [
      `state,county,hex_id,hex_center_lat,hex_center_lon,year,month,p_any${L ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`,
    ];
  for (let k = 0; k < n; k++) {
    if (!mask[k]) continue;
    const head = `${st},"${s.counties[hx.c[k]].name}",${k},${hx.Y[k].toFixed(4)},${(hx.X[k] / hx.K).toFixed(4)}`;
    FC_YEARS.forEach((y, yi) => {
      for (let m = 0; m < 12; m++) {
        const t = (yi * 12 + m) * n + k;
        rows.push(
          `${head},${y},${m + 1},${pm(any[t])}${L ? "," + pm(L.p[t]) : ""},${pa[k * 12 + m].toFixed(3)}${pl ? "," + pl[k * 12 + m].toFixed(3) : ""}`,
        );
      }
    });
  }
  return rows;
}
/** the rows of the county forecast file: the counties the chosen area touches. As on the page, a county's chance of
 * any fire is at least that of its likeliest hexagon (the two are forecast separately) */
export function forecastCountyRows(st: StateCode = S.st!, mask: Uint8Array = selMask()) {
  const F = fcData()!,
    hx = hexState(st),
    s = D.states[st],
    nc = s.counties.length,
    hexAny = F[st].any.p,
    any = F[st].any.county!.slice(),
    L = largeOf(st),
    [a, b] = riskYears(),
    [la, lb] = largeYears(),
    seen = new Uint8Array(nc),
    fire = new Uint8Array(nc * NM),
    big = new Uint8Array(nc * NM),
    cr = s.county_rows;
  for (let k = 0; k < hx.n; k++) if (mask[k]) seen[hx.c[k]] = 1;
  for (let t = 0; t < 12 * FC_YEARS.length; t++)
    for (let k = 0; k < hx.n; k++) {
      const u = t * nc + hx.c[k];
      if (hexAny[t * hx.n + k] > any[u]) any[u] = hexAny[t * hx.n + k];
    }
  for (let p = 0; p < cr.length; p += 5) if (harm(st, cr[p + 1], cr[p + 2], cr[p + 3], cr[p + 4]).h > 0) fire[cr[p] * NM + cr[p + 1]] = 1;
  if (L)
    for (let p = 0; p < L.past.county_rows.length; p += 4)
      if (L.past.county_rows[p + 2] > 0) big[L.past.county_rows[p] * NM + L.past.county_rows[p + 1]] = 1;
  const pa = pastShares(nc, a, b, (c, i) => fire[c * NM + i] === 1),
    pl = L ? pastShares(nc, la, lb, (c, i) => big[c * NM + i] === 1) : null,
    rows = [
      `state,county,fips,year,month,p_any${L && L.county ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`,
    ];
  for (let c = 0; c < nc; c++) {
    if (!seen[c]) continue;
    FC_YEARS.forEach((y, yi) => {
      for (let m = 0; m < 12; m++) {
        const t = (yi * 12 + m) * nc + c;
        rows.push(
          `${st},"${s.counties[c].name}",${s.counties[c].fips},${y},${m + 1},${pm(any[t])}${L && L.county ? "," + pm(L.county[t]) : ""},${pa[c * 12 + m].toFixed(3)}${pl ? "," + pl[c * 12 + m].toFixed(3) : ""}`,
        );
      }
    });
  }
  return rows;
}
export function csvForecast() {
  if (!fcOn(S.st!)) return;
  save(`forecast-hex_${selSlug()}_2026-2027.csv`, forecastHexRows().join("\n"));
}
export function csvForecastCounty() {
  if (!fcOn(S.st!)) return;
  save(`forecast-county_${selSlug()}_2026-2027.csv`, forecastCountyRows().join("\n"));
}
