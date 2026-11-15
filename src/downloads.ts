import { D, Y0 } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { analyseFor, harm, hexState, selMask } from "./model";

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
