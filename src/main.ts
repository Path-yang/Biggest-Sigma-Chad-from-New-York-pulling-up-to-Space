import type { CalendarMode, Layer, Palette, SheetTab, StateCode } from "./types";
import { FULL_Y1, MON, MONL, NAME, PRESET, SLUG, STS, Y0, Y1 } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { hexState } from "./model";
import { V, centerOn, fitView, mapDraw, mapEvents, mapSize, selBounds, setDraw, tileProbe, zoomSel } from "./map";
import { closeSheet, openSheet } from "./sheet";
import { stopPlay, togglePlay } from "./play";
import { csvCal, csvForecast, csvForecastCounty, csvHot } from "./downloads";
import { render } from "./render";
import { G, globeInit } from "./globe";
import { go, goCountry, route } from "./views";
import { countryEvents } from "./country";
import { loadIndex } from "./hf";
import { WORLD } from "./world";
import { respEvents } from "./respui";
import { oddsEvents } from "./fcui";
import { olEvents, olStart } from "./olui";
import { copilotInit } from "./copilot";

/** a place the hero's search can open: a country by its FIRMS name, or one of the two detailed states */
type Findable = { name: string; k: string } | { name: string; st: StateCode };
const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^st /, "saint ");
/** other names people type, folded, to FIRMS names; checked before any partial match */
const ALIAS: Record<string, string> = {
  us: "United_States",
  usa: "United_States",
  "u s": "United_States",
  "u s a": "United_States",
  america: "United_States",
  "united states of america": "United_States",
  uk: "United_Kingdom",
  "u k": "United_Kingdom",
  britain: "United_Kingdom",
  "great britain": "United_Kingdom",
  england: "United_Kingdom",
  scotland: "United_Kingdom",
  wales: "United_Kingdom",
  "northern ireland": "United_Kingdom",
  "ivory coast": "Cote_d_Ivoire",
  drc: "Democratic_Republic_of_the_Congo",
  "dr congo": "Democratic_Republic_of_the_Congo",
  "congo kinshasa": "Democratic_Republic_of_the_Congo",
  "congo brazzaville": "Republic_of_Congo",
  burma: "Myanmar",
  czechia: "Czech_Republic",
  turkiye: "Turkey",
  "cabo verde": "Cape_Verde",
  "east timor": "Timor-Leste",
  "viet nam": "Vietnam",
  holland: "Netherlands",
  faeroe: "Faeroe_Islands",
  "faeroe islands": "Faeroe_Islands",
  swaziland: "Swaziland",
  macedonia: "Macedonia_Former_Yugoslav_Republic_of",
  micronesia: "Federated_States_of_Micronesia",
  uae: "United_Arab_Emirates",
  bosnia: "Bosnia_and_Herzegovina",
  "south korea": "Republic_of_Korea",
  "north korea": "Dem_Rep_Korea",
};
function heroSearch() {
  const list: Findable[] = [...STS.map(st => ({ name: NAME[st], st })), ...WORLD.map(c => ({ name: c.n, k: c.k }))];
  const fill = () => {
    $("countryList").innerHTML = list
      .map(f => f.name)
      .sort((a, b) => a.localeCompare(b))
      .map(n => `<option value="${n.replace(/"/g, "&quot;")}"></option>`)
      .join("");
  };
  fill();
  /* countries in the data without an outline: only the dataset's index knows them */
  let asked = false;
  $("heroFind").onfocus = () => {
    if (asked) return;
    asked = true;
    loadIndex()
      .then(idx => {
        const have = new Set(WORLD.map(c => c.k)),
          extra = idx.filter(c => !have.has(c.country));
        if (!extra.length) return;
        list.push(...extra.map(c => ({ name: c.name, k: c.country })));
        fill();
      })
      .catch(() => (asked = false));
  };
  const find = (q: string) => {
    const f = fold(q);
    if (!f) return null;
    const alias = ALIAS[f];
    return (
      list.find(c => fold(c.name) === f || ("k" in c && fold(c.k) === f)) ||
      (alias && list.find(c => "k" in c && c.k === alias)) ||
      list.find(c => fold(c.name).startsWith(f)) ||
      /* a word inside the name, such as "guinea" in "Papua New Guinea"; not single letters or pairs */
      (f.length >= 3 && list.find(c => (" " + fold(c.name)).includes(" " + f))) ||
      null
    );
  };
  const open = (hit: Findable) => {
    $("heroFind").value = "";
    $("heroMsg").textContent = "";
    $("heroFind").blur();
    if ("st" in hit) go(hit.st);
    else goCountry(hit.k);
  };
  $("heroForm").onsubmit = e => {
    e.preventDefault();
    const q = $("heroFind").value,
      hit = find(q);
    if (hit) open(hit);
    else $("heroMsg").textContent = q.trim() ? `No country called "${q.trim()}". Try another spelling.` : "Type a country's name.";
  };
  /* picking a suggestion from the list opens it straight away */
  $("heroFind").oninput = e => {
    $("heroMsg").textContent = "";
    if (e instanceof InputEvent && e.inputType && e.inputType !== "insertReplacementText") return;
    const v = fold($("heroFind").value),
      hit = list.find(c => fold(c.name) === v);
    if (hit) open(hit);
  };
}

function init() {
  const yo: string[] = [];
  for (let y = Y0; y <= Y1; y++) yo.push(`<option>${y}</option>`);
  $("yTo").innerHTML = $("fY").innerHTML = yo.join("");
  /* the first year must be a complete one: a range holding only the part year has no normal to compare with */
  $("yFrom").innerHTML = yo.slice(0, FULL_Y1 - Y0 + 1).join("");
  $("yFrom").value = String(Y0);
  $("yTo").value = String(Y1);
  $("fM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("yFrom").onchange = $("yTo").onchange = e => {
    let a = +$("yFrom").value,
      b = +$("yTo").value;
    if (a > b) {
      if ((e.target as HTMLElement).id === "yFrom") b = a;
      else a = b;
    }
    S.yFrom = a;
    S.yTo = b;
    $("yFrom").value = String(a);
    $("yTo").value = String(b);
    stopPlay();
    if (S.show.y && (S.show.y < a || S.show.y > b)) S.show = { t: "all" };
    render();
  };
  $("fM").onchange = $("fY").onchange = () => {
    S.focus = [+$("fY").value, +$("fM").value];
    render();
  };
  $("pal").onchange = e => {
    S.pal = (e.target as HTMLSelectElement).value as Palette;
    render();
  };
  $("rmMap").innerHTML = $("rmSheet").innerHTML = MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("rmMap").onchange = $("rmSheet").onchange = e => {
    S.rm = +(e.target as HTMLSelectElement).value;
    render();
  };
  document.querySelectorAll<HTMLButtonElement>("#layerSeg button").forEach(
    b =>
      (b.onclick = () => {
        stopPlay();
        S.layer = b.dataset.layer as Layer;
        if (S.layer !== "count") S.show = { t: "all" };
        render();
        /* the outlook's weather is fetched when its layer is first picked (a failed one is tried again) */
        if (S.layer === "outlook" && S.st) olStart(S.st);
      }),
  );
  $("town").onchange = e => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    if (!q) return;
    const ts = hexState(S.st!).towns,
      t = ts.find(t => t.n.toLowerCase() === q) || ts.find(t => t.n.toLowerCase().startsWith(q));
    if (!t) {
      $("hint").textContent = `No town or city called "${(e.target as HTMLInputElement).value}" in ${NAME[S.st!]}.`;
      return;
    }
    (e.target as HTMLInputElement).value = "";
    S.sel = { type: "circle", lat: t.lat, lon: t.lon, rad: 15, label: t.n };
    render();
    centerOn(t.lon, t.lat, 2400);
  };
  tileProbe();
  $("drawBtn").onclick = () => setDraw(!S.draw);
  $("stnChk").onchange = e => {
    S.stn = (e.target as HTMLInputElement).checked;
    mapDraw();
  };
  const tr = $("tlTrack");
  let tlDrag = false;
  const yearAt = (e: MouseEvent) => {
    const r = tr.getBoundingClientRect(),
      n = S.yTo - S.yFrom + 1;
    return S.yFrom + Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const setYear = (y: number) => {
    stopPlay();
    if (S.layer === "count" && S.show.t === "year" && S.show.y === y) return;
    S.layer = "count";
    S.show = { t: "year", y };
    render();
  };
  tr.onpointerdown = e => {
    tr.setPointerCapture(e.pointerId);
    tlDrag = true;
    setYear(yearAt(e));
  };
  tr.onpointermove = e => {
    if (tlDrag) setYear(yearAt(e));
  };
  tr.onpointerup = tr.onpointercancel = () => {
    tlDrag = false;
  };
  tr.onkeydown = e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 1 : -1,
      cur = S.show.t === "year" ? S.show.y : d > 0 ? S.yFrom - 1 : S.yTo + 1;
    setYear(Math.max(S.yFrom, Math.min(S.yTo, cur + d)));
  };
  $("showReset").onclick = () => {
    stopPlay();
    S.show = { t: "all" };
    render();
  };
  $("play").onclick = $("playMap").onclick = togglePlay;
  $("toGlobe").onclick = () => {
    location.hash = "";
  };
  $("swap").onclick = () => {
    location.hash = SLUG[STS.find(k => k !== S.st)!];
  };
  $("openData").onclick = () => openSheet("area");
  $("openCmp").onclick = () => openSheet("compare");
  $("heroCmp").onclick = () => {
    location.hash = "compare";
  };
  $("shClose").onclick = $("scrim").onclick = () => closeSheet();
  $("seeMap").onclick = () => closeSheet();
  addEventListener("keydown", e => {
    if (e.key === "Escape" && S.sheet) closeSheet();
  });
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b => (b.onclick = () => openSheet(b.dataset.tab as SheetTab)));
  const usePt = (lat: number, lon: number, rad: number) => {
    if (!isFinite(lat) || !isFinite(lon) || !(rad > 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      $("dlMsg").textContent = "Enter a latitude, a longitude and a radius first.";
      return;
    }
    S.sel = { type: "circle", lat, lon, rad };
    zoomSel();
    render();
    $("sheet").scrollTop = 0;
  };
  $("applyPt").onclick = () => usePt(parseFloat($("lat").value), parseFloat($("lon").value), parseFloat($("rad").value));
  $("preset").onclick = () => {
    const p = PRESET[S.st!];
    $("lat").value = String(p.lat);
    $("lon").value = String(p.lon);
    $("rad").value = String(p.rad);
    S.focus = p.focus.slice();
    S.show = { t: "ym", y: p.focus[0], m: p.focus[1] };
    usePt(p.lat, p.lon, p.rad);
  };
  document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach(
    b =>
      (b.onclick = () => {
        S.mode = b.dataset.mode as CalendarMode;
        render();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>(".pick,.tag").forEach(b => {
    b.onclick = () => go(b.dataset.st as StateCode);
    b.onmouseenter = () => G.hover && G.hover(b.dataset.st as StateCode);
    b.onmouseleave = () => G.hover && G.hover(null);
  });
  heroSearch();
  countryEvents();
  $("dlCal").onclick = csvCal;
  $("dlHot").onclick = csvHot;
  $("dlFc").onclick = csvForecast;
  $("dlFcC").onclick = csvForecastCounty;
  mapEvents();
  respEvents();
  oddsEvents();
  olEvents();
  copilotInit();
  let rt: number | undefined;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!S.st) return;
      mapSize();
      const f = fitView(hexState(S.st));
      V.fit = f.s;
      Object.assign(V, fitView(selBounds()));
      mapDraw();
    }, 120);
  });
  globeInit().catch(() => $("hero").classList.add("noglobe"));
  addEventListener("hashchange", route);
  route();
}
init();
