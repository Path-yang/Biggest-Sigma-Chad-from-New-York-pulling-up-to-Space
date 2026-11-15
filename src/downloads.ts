import type { StateCode } from "./types";
import { D, NM, Y0 } from "./data";
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
export function csvCal() {
  const R = analyseFor(S.st!, S.sel),
    rows = [
      "year,month,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,median_for_calendar_month,ratio_to_median",
    ];
  R.ser.forEach(r =>
    rows.push(
      [
        r.y,
        r.m + 1,
        r.h.toFixed(2),
        r.lo.toFixed(2),
        r.hi.toFixed(2),
        `"${r.src}"`,
        r.T,
        r.A,
        r.V,
        r.med.toFixed(2),
        r.med > 0 ? (r.h / r.med).toFixed(3) : "",
      ].join(","),
    ),
  );
  save(`burn-calendar_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
}
export function csvHot() {
  const s = D.states[S.st!],
    hx = hexState(S.st!),
    mask = selMask(),
    cr = s.hex_rows,
    rows = [
      "hex_center_lat,hex_center_lon,county,year,month,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,harmonized_viirs_equivalent,source",
    ];
  for (let p = 0; p < cr.length; p += 5) {
    const k = cr[p],
      i = cr[p + 1],
      y = Y0 + Math.floor(i / 12);
    if (!mask[k] || y < S.yFrom || y > S.yTo) continue;
    const h = harm(S.st!, i, cr[p + 2], cr[p + 3], cr[p + 4]);
    rows.push(
      [
        hx.Y[k].toFixed(3),
        (hx.X[k] / hx.K).toFixed(3),
        `"${s.counties[hx.c[k]].name}"`,
        y,
        (i % 12) + 1,
        cr[p + 2],
        cr[p + 3],
        cr[p + 4],
        h.h.toFixed(2),
        `"${h.src}"`,
      ].join(","),
    );
  }
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
