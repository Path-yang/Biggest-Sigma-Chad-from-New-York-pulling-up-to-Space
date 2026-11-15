import type { StateCode } from "./types";
import { FOCUS0, NAME, PRESET, SLUG, STS } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { hexState } from "./model";
import { V, fitView, flyTo, mapSize, setDraw } from "./map";
import { closeSheet, openSheet } from "./sheet";
import { stopPlay } from "./play";
import { render } from "./render";
import { G, aimAt } from "./globe";
import { closeCountry, countryMissing, openCountry } from "./country";
import { loadIndex } from "./hf";
import { WORLD, lonSpan, shapeOf, slugOf } from "./world";
import { respReset } from "./respui";
import { extrasReady, loadExtras } from "./extras";
import { closeGlance, openGlance } from "./glance";

/* =====================================================================
   VIEWS AND WIRING
   ===================================================================== */
function openState(st: StateCode, fresh?: boolean) {
  closeCountry();
  stopPlay();
  closeSheet(true);
  S.st = st;
  S.sel = { type: "state" };
  S.show = { t: "all" };
  S.layer = "count";
  /* the forecast and large-fire choices start fresh in each state, like the layer */
  S.odds = "past";
  S.fire = "any";
  respReset();
  V.mask = null;
  V.fineOn = false;
  S.focus = FOCUS0.slice();
  setDraw(false);
  $("hero").hidden = true;
  G.stop && G.stop();
  $("app").hidden = false;
  $("card").scrollTop = 0;
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
  /* the response tools, the forecast and the outlook arrive a moment later the first time */
  if (!extrasReady())
    loadExtras().then(() => {
      if (S.st !== st) return;
      respReset();
      render();
    });
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
    G.pending = "#" + SLUG[st];
    location.hash = SLUG[st];
  }
}
/** open a country by its FIRMS name: its map view (#g/), or with `full` its full record (#c/); from the globe, fly there first */
export function goCountry(k: string, full = false) {
  const h = (full ? "#c/" : "#g/") + slugOf(k);
  if (location.hash !== h) {
    G.pending = h;
    location.hash = h;
  }
}
/** hide the globe and the state view, for the country view to take the screen */
function leaveForCountry() {
  stopPlay();
  closeSheet(true);
  S.st = null;
  $("app").classList.remove("in");
  $("app").hidden = true;
  $("hero").hidden = true;
  G.stop && G.stop();
}
/** a country address: find the country by its slug (in world.js, else in the dataset's index), then fly or open */
async function routeCountry(hash: string) {
  /* any spelling that folds to the same slug opens the country: "#c/United_States", "#c/cote-d'ivoire" */
  /* "#c/brazil/area=..." : the country is the first part; the area tools read the rest */
  let raw = hash.slice(3).split("/")[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* a malformed escape such as %E0: match the text as it is */
  }
  const slug = slugOf(raw);
  let k = WORLD.find(c => slugOf(c.k) === slug)?.k;
  if (!k) {
    k = await loadIndex()
      .then(list => list.find(c => slugOf(c.country) === slug)?.country)
      .catch(() => undefined);
    if (location.hash !== hash) return;
  }
  const shape = k ? shapeOf(k) : undefined;
  if (k && shape && G.pending === hash && G.ok && !$("hero").hidden) {
    const key = k,
      b = shape.b;
    G.pending = null;
    G.flyTo!(aimAt(shape.c[0], shape.c[1], Math.min(lonSpan(shape), 180) * Math.cos((shape.c[1] * Math.PI) / 180) + (b[3] - b[1])), () => {
      if (location.hash !== hash) return;
      leaveForCountry();
      openOne(hash, key);
    });
    return;
  }
  G.pending = null;
  leaveForCountry();
  if (k) openOne(hash, k);
  else {
    closeGlance();
    countryMissing(slug, hash.slice(0, 3));
    /* nothing to go up to */
    $("cUp").hidden = true;
  }
}
/** "#g/": the country's map view; "#c/": its full record */
function openOne(hash: string, k: string) {
  if (hash.startsWith("#g/")) {
    closeCountry();
    openGlance(k);
  } else {
    closeGlance();
    $("cUp").hidden = false;
    openCountry(k);
  }
}
export function route() {
  if (location.hash.startsWith("#c/") || location.hash.startsWith("#g/")) {
    routeCountry(location.hash);
    return;
  }
  closeCountry();
  closeGlance();
  const st = STS.find(k => "#" + SLUG[k] === location.hash);
  if (!st) {
    closeSheet(true);
    openHero();
    if (location.hash === "#compare") openSheet("compare");
    return;
  }
  loadExtras();
  if (G.pending === location.hash && G.ok && !$("hero").hidden) {
    G.pending = null;
    G.flyTo!({ ry: G.st![st].ry, rx: G.st![st].rx, z: 1.62 }, () => openState(st, true));
  } else {
    G.pending = null;
    openState(st, !$("hero").hidden);
  }
}
