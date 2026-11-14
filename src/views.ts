import type { StateCode } from "./types";
import { NAME, PRESET, SLUG, STS } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { hexState } from "./model";
import { V, fitView, flyTo, mapSize, setDraw } from "./map";
import { closeSheet, openSheet } from "./sheet";
import { stopPlay } from "./play";
import { render } from "./render";
import { G } from "./globe";

/* =====================================================================
   VIEWS AND WIRING
   ===================================================================== */
function openState(st: StateCode, fresh?: boolean) {
  stopPlay();
  closeSheet(true);
  S.st = st;
  S.sel = { type: "state" };
  S.show = { t: "all" };
  S.layer = "count";
  V.mask = null;
  V.fineOn = false;
  S.focus = PRESET[st].focus.slice();
  setDraw(false);
  $("hero").hidden = true;
  G.stop && G.stop();
  $("app").hidden = false;
  scrollTo(0, 0);
  $("swap").textContent = "Switch to " + NAME[STS.find(k => k !== st)!];
  $("pal").value = S.pal;
  $("preset").textContent = PRESET[st].name;
  $("lat").value = $("lon").value = "";
  $("townList").innerHTML = hexState(st)
    .towns.map(t => `<option value="${t.n}">`)
    .join("");
  mapSize();
  const f = fitView(hexState(st));
  V.fit = f.s;
  Object.assign(V, f, { s: f.s * (fresh ? 0.55 : 1) });
  render();
  requestAnimationFrame(() => {
    $("app").classList.add("in");
    if (fresh) flyTo(f, 1100);
  });
}
function openHero() {
  stopPlay();
  S.st = null;
  $("app").classList.remove("in");
  $("app").hidden = true;
  const h = $("hero");
  h.hidden = false;
  h.classList.remove("leaving");
  if (G.ok) G.reset!();
}
export function go(st: StateCode) {
  if (location.hash !== "#" + SLUG[st]) {
    G.pending = st;
    location.hash = SLUG[st];
  }
}
export function route() {
  const st = STS.find(k => "#" + SLUG[k] === location.hash);
  if (!st) {
    closeSheet(true);
    openHero();
    if (location.hash === "#compare") openSheet("compare");
    return;
  }
  if (G.pending === st && G.ok && !$("hero").hidden) {
    G.pending = null;
    G.flyTo!(st, () => openState(st, true));
  } else {
    G.pending = null;
    openState(st, !$("hero").hidden);
  }
}
