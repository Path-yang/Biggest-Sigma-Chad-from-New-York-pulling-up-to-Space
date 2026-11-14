import type { Analysis } from "./types";
import { D, MON, NAME, STS } from "./data";
import { S } from "./state";
import { $, fmt } from "./util";
import { hexState, leadText, placeName, riskFor, stationsFor, verdict } from "./model";
import { setCounty, showLabel } from "./map";

/* =====================================================================
   CARD, SHEET, COMPARE
   ===================================================================== */
export function renderCard(R: Analysis) {
  const hx = hexState(S.st!),
    sl = S.sel,
    cty = (ci: number) => D.states[S.st!].counties[ci].name + " County";
  $("place").textContent = placeName();
  $("lead").textContent = leadText(R);
  $("crumb").innerHTML =
    (sl.type === "state"
      ? "State"
      : `<button type="button" data-go="state">${NAME[S.st!]}</button>` +
        (sl.type === "hex" ? ` › <button type="button" data-ci="${hx.c[sl.k]}">${cty(hx.c[sl.k])}</button>` : "")) +
    ` · ${S.yFrom}–${S.yTo}`;
  $("crumb")
    .querySelectorAll("button")
    .forEach(b => (b.onclick = () => setCounty(b.dataset.go ? null : +b.dataset.ci!)));
  const sf = stationsFor(S.st!, sl);
  $("c5q").textContent = sf.rad ? `Fire stations within ${sf.rad} km` : "Fire and EMS stations";
  $("c5").textContent =
    sf.n.toLocaleString("en-US") +
    (sf.near != null && sf.near < 1e8 ? ` · nearest ${sf.near < 10 ? sf.near.toFixed(1) : Math.round(sf.near)} km` : "");
  $("hint").textContent =
    sl.type === "state"
      ? "Click a county, then a hexagon, to zoom in. Scroll to zoom, drag to move."
      : sl.type === "county"
        ? "Click a hexagon in this county to zoom into it."
        : "Click a small hexagon to go closer. Blue squares are fire and EMS stations.";
  $("c1").textContent = R.total
    ? R.order
        .slice(0, 3)
        .map(o => MON[o.m])
        .join(", ")
    : "None";
  $("c2").textContent = R.total
    ? R.ranked
        .slice(0, 3)
        .map(y => y.y)
        .join(", ")
    : "None";
  const v = verdict(R);
  $("c3q").textContent = `${MON[S.focus[1]]} ${S.focus[0]}`;
  $("c3").innerHTML = v ? `<span class="pill ${v.cls}" style="margin:0">${v.label}</span>` : "Outside these years";
  const rk = riskFor(R, S.rm);
  $("c4q").textContent = `Chance of fire in ${MON[S.rm]}`;
  $("c4").textContent = rk.n ? Math.round(rk.p * 100) + "%" : "n/a";
  $("openCmp").textContent = "Compare with " + NAME[STS.find(k => k !== S.st)!];
}
export function renderTimeline(R: Analysis) {
  const ys = R.years,
    n = ys.length,
    W = 600,
    bw = W / n,
    mx = Math.max(1, ...ys.map(y => y.h)),
    cur = S.show.t === "year" && S.layer === "count" ? S.show.y : null;
  let g = "";
  ys.forEach((y, i) => {
    const h = Math.max(2, 32 * Math.sqrt(y.h / mx)),
      on = y.y === cur;
    g += `<rect x="${i * bw + 1.5}" y="${38 - h}" width="${bw - 3}" height="${h}" rx="2" fill="${on ? "#ff8a3d" : cur == null ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.28)"}"/>`;
    if (on || (i % 4 === 0 && (cur == null || Math.abs(y.y - cur) > 2)))
      g += `<text x="${(i + 0.5) * bw}" y="51" text-anchor="middle" ${on ? 'class="hl"' : ""}>${y.y}</text>`;
  });
  if (cur != null) {
    const x = (cur - S.yFrom + 0.5) * bw;
    g += `<line x1="${x}" x2="${x}" y1="4" y2="40" stroke="#fff" stroke-width="2"/><circle cx="${x}" cy="5" r="5" fill="#fff"/>`;
  }
  const tr = $("tlTrack");
  tr.innerHTML = `<svg viewBox="0 0 ${W} 54" aria-hidden="true">${g}</svg>`;
  tr.setAttribute("aria-valuemin", String(S.yFrom));
  tr.setAttribute("aria-valuemax", String(S.yTo));
  tr.setAttribute("aria-valuenow", String(cur == null ? S.yTo : cur));
  tr.setAttribute("aria-valuetext", cur == null ? "All years" : String(cur));
  const yr = cur != null ? ys[cur - S.yFrom] : null;
  $("tlLabel").innerHTML = yr
    ? `<b>${cur}</b>${fmt(yr.h)} hotspots${cur! < 2012 ? " (converted from MODIS)" : ""}`
    : S.layer === "chance"
      ? "Drag along the years to see where each one burned"
      : S.show.t === "all"
        ? "Drag along the years to see where each one burned"
        : "Map shows: " + showLabel();
  $("showReset").hidden = S.layer === "chance" || S.show.t === "all";
}
