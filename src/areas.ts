import type { CountrySummary } from "./types";
import type { AreaStats, Estimate, Frame, Grid, Trend } from "./acells";
import type { Shape } from "./ashape";
import { FILL_SRC, MON, MONL } from "./data";
import { $, fmt, short, times } from "./util";
import { NoCells, TREND_MIN_MEAN, TREND_MIN_YEARS, estimate, frameOf, idxOf, loadGrid, seriesOf, stats, watchYears } from "./acells";
import { areaKm2, bbox, decode, describe, encode, km, latW, lonW, midLon, ring, roundArea, simplify, tester } from "./ashape";
import { PIN_COLOURS, calendar, calendarCells, compareChart, season, trend } from "./aplot";
import { FIRE, classColours, hideCellPopup, nice, onMapReady } from "./cmap";
import { loadPlotLib } from "./libs";
import { save } from "./downloads";
import { near, shapeOf, slugOf, theName } from "./world";

/* =====================================================================
   AREA TOOLS on the country map: draw a rectangle, a circle or a freehand shape (or type coordinates), and see
   that area's own record: this year against a usual one, a calendar of every month, the season and the trend, a
   month-by-month map with Play, up to four areas side by side, a CSV, a link, and where to watch next.
   The squares come from Hugging Face cells/v1 and load the first time the reader opens these tools.
   ===================================================================== */
type Tool = "rect" | "circle" | "poly";
interface Area {
  shape: Shape | null;
  /** squares counted: those whose centre falls inside the shape */
  idx: Int32Array;
  S: Float64Array;
  st: AreaStats;
}
interface Pin extends Area {
  letter: string;
  colour: string;
}
/** a pinned area named in the address, with its letter when the address gives one */
interface WantPin {
  s: Shape;
  letter: string | null;
}
interface AreaState {
  k: string | null;
  d: CountrySummary | null;
  g: Grid | null;
  F: Frame | null;
  /** the fetch failed: why */
  err: string;
  open: boolean;
  cur: Area | null;
  /** the shape asked for before the squares arrived */
  want: Shape | null;
  wantPins: WantPin[];
  /** a panel section asked for before the squares arrived */
  wantBlock: string | null;
  pins: Pin[];
  cal: "count" | "anom";
  seasonY: number;
  watchM: number;
  watchOn: boolean;
  time: { on: boolean; y: number; m: number };
  tool: Tool | null;
  map: any;
  lon0: number;
  /** numbered squares of the watch list, and the letters of pinned areas */
  markers: any[];
  pinMarks: any[];
  popup: any;
}
const A: AreaState = {
  k: null,
  d: null,
  g: null,
  F: null,
  err: "",
  open: false,
  cur: null,
  want: null,
  wantPins: [],
  wantBlock: null,
  pins: [],
  cal: "count",
  seasonY: 0,
  watchM: 11,
  watchOn: false,
  time: { on: false, y: 2025, m: 7 },
  tool: null,
  map: null,
  lon0: 0,
  markers: [],
  pinMarks: [],
  popup: null,
};
let playTimer: number | undefined;
const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
/** a grid square's size in words, at a latitude: "0.1° (about 11 by 8 km here)" */
function cellWords(lat: number) {
  const c = A.g?.cell ?? 0,
    ns = c * 111.2,
    ew = ns * Math.cos((lat * Math.PI) / 180),
    r = (v: number) => (v >= 20 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v)));
  return `${c}°` + (ew < ns * 0.85 ? ` (about ${r(ns)} by ${r(ew)} km here)` : ` (about ${r(ns)} km)`);
}
const meanLat = (idx: ArrayLike<number>) => {
  let t = 0;
  for (let k = 0; k < idx.length; k++) t += A.g!.lat[idx[k]];
  return idx.length ? t / idx.length : 0;
};
/** the map and the panel are stacked, the panel under the map, below this */
const STACKED = "(max-width: 900px), (max-height: 560px)";
const phone = () => matchMedia(STACKED).matches;
/** scroll the country view (it scrolls, not the window) so an element sits just under its sticky header */
function scrollPageTo(el: HTMLElement, smooth = false) {
  const sc = document.getElementById("country");
  if (!sc) return;
  const head = sc.querySelector(".cpTop")?.getBoundingClientRect().height ?? 0,
    top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - head - 8;
  sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}
/** bring the map up under the header, with any open row above it (coordinates, month controls, the hint) */
function showMapArea() {
  const first = ["aCoords", "aTime", "aHint"].map(id => document.getElementById(id)).find(e => !!e && !e.hidden && e.offsetHeight > 0);
  scrollPageTo(first ?? $("cMap"));
}
const viirsYear = () => A.d?.viirs_from[0] ?? 2012;
const ICON: Record<Tool | "coords" | "time" | "watch", string> = {
  rect: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="5.5" width="13" height="9"/></svg>`,
  circle: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/></svg>`,
  poly: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5c1.5-5 3.5-9.5 6-10.5 2.6-1 1.2 4.2 3.4 4.6 1.4.3 2.1-1.2 2.6-2.4"/></svg>`,
  coords: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14"/><circle cx="10" cy="10" r="3"/></svg>`,
  time: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="12"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/></svg>`,
  watch: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/></svg>`,
};

/* =====================================================================
   OPEN AND CLOSE, called by the country view
   ===================================================================== */
/** a country's record has arrived: put the tools on its map, and restore an area named in the address */
export function areasStart(d: CountrySummary) {
  if (A.k !== d.country) areasReset();
  A.k = d.country;
  A.d = d;
  const sh = shapeOf(d.country);
  A.lon0 = sh ? sh.c[0] : (d.bbox[0] + d.bbox[2]) / 2;
  buildBar();
  const h = parseHash();
  if (h && (h.area || h.pins.length)) {
    A.want = h.area;
    A.wantPins = h.pins;
    openTools();
    /* a shared link: go to the map, where the area is */
    requestAnimationFrame(() => document.getElementById("cMapTitle")?.scrollIntoView({ block: "start" }));
  }
}
/** the country view closed or moved to another country */
export function areasReset() {
  loading = false;
  stopPlay();
  disarm();
  for (const m of [...A.markers, ...A.pinMarks]) m.remove();
  A.popup?.remove();
  Object.assign(A, {
    k: null,
    d: null,
    g: null,
    F: null,
    err: "",
    open: false,
    cur: null,
    want: null,
    wantPins: [],
    wantBlock: null,
    pins: [],
    cal: "count",
    watchOn: false,
    time: { on: false, y: 2025, m: 7 },
    tool: null,
    map: null,
    markers: [],
    pinMarks: [],
    popup: null,
  });
  const bar = document.getElementById("aBar");
  if (bar) bar.innerHTML = "";
  const p = document.getElementById("aPanel");
  if (p) {
    p.hidden = true;
    p.innerHTML = "";
  }
  document.getElementById("aWork")?.classList.remove("on");
}

/* =====================================================================
   THE ADDRESS: #c/brazil/area=r:-10,-50,-5,-45/pins=A.c:-8,-47,120~C.p:...  (a pin's letter, then its shape)
   ===================================================================== */
function parseHash() {
  const parts = location.hash.split("/");
  if (parts[0] !== "#c" || !A.k || slugOf(safeDecode(parts[1] ?? "")) !== slugOf(A.k)) return null;
  let area: Shape | null = null,
    hasArea = false,
    hasPins = false;
  const pins: WantPin[] = [];
  for (const seg of parts.slice(2)) {
    const t = safeDecode(seg);
    if (t.startsWith("area=")) {
      hasArea = true;
      area = decode(t.slice(5));
    } else if (t.startsWith("pins=")) {
      hasPins = true;
      for (const s of t.slice(5).split("~")) {
        const lm = /^([A-D])\.(.+)$/.exec(s),
          x = decode(lm ? lm[2] : s),
          letter = lm && !pins.some(p => p.letter === lm[1]) ? lm[1] : null;
        if (x && pins.length < 4) pins.push({ s: x, letter });
      }
    }
  }
  return { area, pins, hasArea, hasPins };
}
function safeDecode(t: string) {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}
function hashFor() {
  if (!A.k) return "";
  let h = "#c/" + slugOf(A.k);
  if (A.cur?.shape) h += "/area=" + encode(A.cur.shape);
  const ps = A.pins.filter(p => p.shape);
  if (ps.length) h += "/pins=" + ps.map(p => `${p.letter}.${encode(p.shape!)}`).join("~");
  return h;
}
/** keep the address in step with the area, without a new history entry or a hashchange */
function writeHash() {
  const h = hashFor();
  if (h && location.hash !== h) history.replaceState(null, "", h);
}
/** a pasted link to another area of the same country */
addEventListener("hashchange", () => {
  if (!A.k || !A.d || !location.hash.startsWith("#c/")) return;
  const h = parseHash();
  if (!h || location.hash === hashFor()) return;
  /* no area and no pins in the address: back to the whole country */
  if (!h.hasArea && !h.hasPins) {
    if (A.g) {
      A.pins = [];
      setArea(null);
    }
    return;
  }
  /* nothing in it could be read: keep what is shown, and its address */
  if (!h.area && !h.pins.length) {
    writeHash();
    return;
  }
  /* a part that could not be read leaves that part as it is */
  A.want = h.area;
  A.wantPins = h.pins;
  openTools();
});

/* =====================================================================
   THE TOOLBAR above the map
   ===================================================================== */
function buildBar() {
  const bar = document.getElementById("aBar");
  if (!bar || bar.firstChild) return;
  bar.innerHTML =
    `<div class="aTools">` +
    `<div class="aGroup" role="group" aria-label="Pick an area"><span class="aLbl">Pick an area</span>` +
    (["rect", "circle", "poly"] as Tool[])
      .map(
        t =>
          `<button type="button" class="aBtn" data-tool="${t}" aria-pressed="false">${ICON[t]}${{ rect: "Rectangle", circle: "Circle", poly: "Pencil" }[t]}</button>`,
      )
      .join("") +
    `<button type="button" class="aBtn" id="aCoordBtn" aria-expanded="false">${ICON.coords}Coordinates</button></div>` +
    `<div class="aGroup" role="group" aria-label="Map views"><button type="button" class="aBtn" id="aTimeBtn" aria-pressed="false">${ICON.time}Month by month</button>` +
    `<button type="button" class="aBtn" id="aWatchBtn" aria-pressed="false">${ICON.watch}Where to watch</button></div></div>` +
    `<form class="aCoords" id="aCoords" hidden novalidate autocomplete="off">` +
    `<label class="aField">Shape <select id="aCShape"><option value="r">Box</option><option value="c">Circle</option></select></label>` +
    `<span class="aFields" id="aCR"><label class="aField">South <input id="aCs" type="number" step="any" placeholder="-10"></label><label class="aField">West <input id="aCw" type="number" step="any" placeholder="-50"></label><label class="aField">North <input id="aCn" type="number" step="any" placeholder="-5"></label><label class="aField">East <input id="aCe" type="number" step="any" placeholder="-45"></label></span>` +
    `<span class="aFields" id="aCC" hidden><label class="aField">Latitude <input id="aClat" type="number" step="any" placeholder="-8.5"></label><label class="aField">Longitude <input id="aClon" type="number" step="any" placeholder="-47"></label><label class="aField">Radius, km <input id="aCkm" type="number" step="any" min="5" max="3000" placeholder="100"></label></span>` +
    `<button type="submit" class="aBtn aGo">Show this area</button><span class="aMsg" id="aCMsg" role="status"></span></form>` +
    `<div class="aTime" id="aTime" hidden><span class="aLbl">Map shows</span><select id="aTM" aria-label="Month"></select><select id="aTY" aria-label="Year"></select>` +
    `<button type="button" class="aBtn" id="aPlay" aria-pressed="false">Play</button><button type="button" class="cpText aSmallText" id="aTOff">Back to the totals</button><div class="aTKey" id="aTKey"></div></div>` +
    `<p class="aHint" id="aHint" role="status"></p>`;
  bar.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => (b.onclick = () => arm(b.dataset.tool as Tool)));
  $("aCoordBtn").onclick = () => {
    const f = $("aCoords"),
      open = f.hidden;
    disarm();
    f.hidden = !open;
    $("aCoordBtn").setAttribute("aria-expanded", String(open));
    if (open) {
      openTools();
      prefillCoords();
      (($("aCShape") as HTMLSelectElement).value === "r" ? $("aCs") : $("aClat")).focus();
    }
  };
  $("aCShape").onchange = () => {
    const r = ($("aCShape") as HTMLSelectElement).value === "r";
    $("aCR").hidden = !r;
    $("aCC").hidden = r;
    $("aCMsg").textContent = "";
  };
  ($("aCoords") as HTMLFormElement).onsubmit = e => {
    e.preventDefault();
    coordsSubmit();
  };
  $("aTimeBtn").onclick = () => {
    openTools();
    if (A.time.on) timeOff();
    else timeOn(A.time.y, A.time.m);
  };
  $("aWatchBtn").onclick = () => {
    openTools();
    A.watchOn = !A.watchOn;
    syncBar();
    drawWatch();
    if (A.watchOn) showBlock("aWatch");
  };
  $("aTM").onchange = $("aTY").onchange = () => {
    stopPlay();
    timeOn(+($("aTY") as HTMLSelectElement).value, +($("aTM") as HTMLSelectElement).value);
  };
  $("aPlay").onclick = () => (playTimer ? stopPlay() : play());
  $("aTOff").onclick = timeOff;
  syncBar();
}
function syncBar() {
  document
    .querySelectorAll<HTMLButtonElement>("#aBar [data-tool]")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === A.tool)));
  const tb = document.getElementById("aTimeBtn"),
    wb = document.getElementById("aWatchBtn");
  tb?.setAttribute("aria-pressed", String(A.time.on));
  wb?.setAttribute("aria-pressed", String(A.watchOn));
  const t = document.getElementById("aTime");
  if (t) t.hidden = !A.time.on;
}
const hint = (t: string) => {
  const h = document.getElementById("aHint");
  if (h) h.textContent = t;
};

/* =====================================================================
   THE WORKBENCH: the map with the panel beside it (on narrow or short screens, the panel under the map)
   ===================================================================== */
let loading = false;
/** open the workbench, fetching the squares the first time; after a failure only Try again (retry) fetches again */
function openTools(retry = false) {
  if (!A.k) return;
  const k = A.k;
  if (!A.open) {
    A.open = true;
    buildPanel();
    $("aWork").classList.add("on");
    $("aPanel").hidden = false;
    /* the map's box grew */
    requestAnimationFrame(() => A.map?.resize());
    loadPlotLib().catch(() => undefined);
  }
  if (A.g) return applyWanted();
  if (loading || (A.err && !retry)) return;
  loading = true;
  A.err = "";
  stateMsg(`Fetching the month-by-month squares for ${theName(A.d!.name)} from Hugging Face…`, false);
  loadGrid(k).then(
    g => {
      loading = false;
      if (A.k !== k) return;
      A.g = g;
      A.F = frameOf(g);
      A.err = "";
      A.seasonY = A.F.cy;
      A.time = { on: A.time.on, y: A.F.cy > A.F.yb ? A.F.cy : A.F.yb, m: A.F.cy > A.F.yb ? A.F.cyLast : 11 };
      /* where to watch: the month after the last complete one */
      A.watchM = ((A.F.partial ? A.F.partial.m - 1 : A.F.cyLast) + 1) % 12;
      fillTimeSelects();
      applyWanted();
    },
    (e: unknown) => {
      loading = false;
      if (A.k !== k) return;
      A.err = e instanceof Error ? e.message : String(e);
      stateMsg(
        e instanceof NoCells
          ? `${A.err}. The rest of the page is unaffected.`
          : `The month-by-month squares did not arrive: ${A.err}. The rest of the page is unaffected.`,
        !(e instanceof NoCells),
      );
    },
  );
}
function applyWanted() {
  if (A.wantPins.length) {
    A.pins = [];
    const want = A.wantPins.slice(0, 4);
    /* the letters the address gives first, then the rest take the free ones */
    for (const w of want) if (w.letter) A.pins.push(asPin(makeArea(w.s), w.letter));
    for (const w of want) if (!w.letter) A.pins.push(asPin(makeArea(w.s)));
    A.pins.sort((x, z) => want.findIndex(w => w.s === x.shape) - want.findIndex(w => w.s === z.shape));
    A.wantPins = [];
  }
  const s = A.want;
  A.want = null;
  if (s || !A.cur) setArea(s, !!s);
  else render();
}
function stateMsg(t: string, retry: boolean) {
  if (!document.getElementById("aState")) return;
  $("aState").hidden = false;
  $("aMain").hidden = true;
  $("aStateMsg").textContent = t;
  $("aRetry").hidden = !retry;
}
function buildPanel() {
  const p = $("aPanel");
  if (p.firstChild) return;
  p.innerHTML =
    `<header class="aHead"><div class="aHeadT"><p class="cpPart">Selected area</p><h3 class="aName" id="aName">${esc(A.d ? A.d.name : "")}</h3></div>` +
    `<button type="button" class="aX" id="aClose" aria-label="Close the area tools">×</button></header>` +
    `<p class="aNote" id="aNote"></p>` +
    `<div class="aActs"><button type="button" class="aBtn" id="aPin">Pin to compare</button><button type="button" class="aBtn" id="aShare">Copy link</button><button type="button" class="aBtn" id="aCsv">CSV</button><button type="button" class="aBtn" id="aAsk">Ask the copilot</button><button type="button" class="cpText aSmallText" id="aWhole" hidden>Whole country</button></div>` +
    `<p class="aMsg" id="aMsg" role="status"></p>` +
    `<div class="aState" id="aState"><p id="aStateMsg"></p><button type="button" class="cpText" id="aRetry" hidden>Try again</button></div>` +
    `<div id="aMain" hidden>` +
    `<dl class="aKpis" id="aKpis"></dl>` +
    `<p class="aNone" id="aNone" hidden></p>` +
    `<div id="aFigs">` +
    `<section class="aBlock"><div class="aBH"><h4>Burning activity calendar</h4><div class="cpSeg aSeg" id="aCalSeg" role="group" aria-label="Calendar values"><button type="button" data-m="count">How much fire</button><button type="button" data-m="anom">More or less than usual</button></div></div>` +
    `<div class="aKey" id="aCalKey"></div><div class="cpPlot" id="aCal"></div><p class="aCap" id="aCalNote"></p></section>` +
    `<section class="aBlock"><div class="aBH"><h4 id="aSeasonT">This year against a usual one</h4><select id="aSeasonY" aria-label="Year to show"></select></div><div class="cpPlot" id="aSeason"></div><p class="aCap" id="aSeasonNote"></p></section>` +
    `<section class="aBlock"><div class="aBH"><h4 id="aTrendT">Hotspots per year</h4></div><div class="cpPlot" id="aTrend"></div><p class="aCap" id="aTrendNote"></p></section>` +
    `</div>` +
    `<section class="aBlock" id="aCmp" hidden><div class="aBH"><h4>Areas side by side</h4><button type="button" class="cpText aSmallText" id="aUnpin">Remove all</button></div>` +
    `<div class="cpScroll"><table class="aCmpT" id="aCmpT"></table></div><div class="aBH aSub"><span id="aCmpCT">A usual year in each</span><div class="cpSeg aSeg" id="aCmpSeg" role="group" aria-label="Compare by"><button type="button" data-s="n" aria-pressed="true">Hotspots</button><button type="button" data-s="p" aria-pressed="false">Share of the year</button></div></div><div class="cpPlot" id="aCmpC"></div><p class="aCap" id="aCmpNote"></p></section>` +
    `<section class="aBlock" id="aWatch"><div class="aBH"><h4>Where to watch in <select id="aWM" aria-label="Month ahead"></select></h4><label class="aChk"><input type="checkbox" id="aWOn"> On the map</label></div>` +
    `<p class="aCap aWSub" id="aWSub"></p><ol class="aWList" id="aWList"></ol><p class="aCap" id="aWFoot"></p></section>` +
    `</div>`;
  $("aClose").onclick = closeTools;
  $("aRetry").onclick = () => openTools(true);
  $("aWhole").onclick = () => setArea(null, true);
  $("aPin").onclick = pinCurrent;
  $("aShare").onclick = share;
  $("aCsv").onclick = csv;
  $("aAsk").onclick = () => window.dispatchEvent(new CustomEvent("ask-area"));
  $("aUnpin").onclick = () => {
    A.pins = [];
    writeHash();
    render();
  };
  p.querySelectorAll<HTMLButtonElement>("#aCalSeg button").forEach(
    b =>
      (b.onclick = () => {
        A.cal = b.dataset.m === "anom" ? "anom" : "count";
        drawCharts();
      }),
  );
  p.querySelectorAll<HTMLButtonElement>("#aCmpSeg button").forEach(
    b =>
      (b.onclick = () => {
        p.querySelectorAll("#aCmpSeg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        drawCompare();
      }),
  );
  $("aSeasonY").onchange = () => {
    A.seasonY = +($("aSeasonY") as HTMLSelectElement).value;
    drawCharts();
  };
  $("aWM").onchange = () => {
    A.watchM = +($("aWM") as HTMLSelectElement).value;
    A.watchOn = true;
    syncBar();
    drawWatch();
  };
  $("aWOn").onchange = () => {
    A.watchOn = ($("aWOn") as HTMLInputElement).checked;
    syncBar();
    drawWatch();
  };
}
/** bring one of the panel's sections into view: the panel scrolls beside the map, the page when it is under it */
function showBlock(id: string) {
  const p = document.getElementById("aPanel"),
    b = document.getElementById(id),
    main = document.getElementById("aMain");
  if (!p || !b) return;
  /* still loading: do it once the panel is drawn */
  if (!main || main.hidden) {
    A.wantBlock = id;
    return;
  }
  /* the charts above it are still to come and will push it down: wait for them */
  if (!window.Plot) {
    const k = A.k,
      again = () => requestAnimationFrame(() => A.k === k && showBlock(id));
    loadPlotLib().then(again, again);
    return;
  }
  if (phone()) return scrollPageTo(b, true);
  p.scrollTo({ top: p.scrollTop + b.getBoundingClientRect().top - p.getBoundingClientRect().top - 8, behavior: "smooth" });
}
function closeTools() {
  stopPlay();
  disarm();
  timeOff();
  A.watchOn = false;
  A.open = false;
  A.cur = null;
  A.pins = [];
  drawWatch();
  drawShapes();
  $("aPanel").hidden = true;
  $("aWork").classList.remove("on");
  ($("aCoords") as HTMLElement).hidden = true;
  syncBar();
  hint("");
  writeHash();
  requestAnimationFrame(() => A.map?.resize());
}

/* =====================================================================
   AREAS
   ===================================================================== */
function makeArea(shape: Shape | null): Area {
  const g = A.g!,
    F = A.F!,
    idx: number[] = [];
  if (!shape) for (let c = 0; c < g.n; c++) idx.push(c);
  else {
    const inside = tester(shape);
    for (let c = 0; c < g.n; c++) if (inside(g.lat[c], g.lon[c])) idx.push(c);
  }
  const S = seriesOf(g, idx);
  return { shape, idx: Int32Array.from(idx), S, st: stats(F, S) };
}
const LETTERS = "ABCD";
/** a pinned area keeps its letter (and colour) for good, in the address too: a new one takes the first free letter */
function asPin(a: Area, want?: string): Pin {
  const used = new Set(A.pins.map(p => p.letter)),
    letter = want && !used.has(want) ? want : ([...LETTERS].find(l => !used.has(l)) ?? "D");
  return { ...a, letter, colour: PIN_COLOURS[LETTERS.indexOf(letter)] };
}
const nameOfArea = (a: Area) => (a.shape ? describe(a.shape) : `All of ${theName(A.d!.name)}`);
function setArea(shape: Shape | null, fit = false) {
  /* what is counted is exactly what the link gives back: the shape as the address rounds it */
  if (shape) shape = decode(encode(shape)) ?? shape;
  if (!A.g) {
    A.want = shape;
    return openTools();
  }
  A.cur = makeArea(shape);
  writeHash();
  render();
  if (fit && shape) fitTo(shape);
  /* the panel is under the map: keep the new shape in view, clear of the header */
  if (phone() && shape) showMapArea();
}
function pinCurrent() {
  const a = A.cur;
  if (!a) return;
  const msg = $("aMsg");
  if (A.pins.some(p => p.shape && a.shape && encode(p.shape) === encode(a.shape)) || (!a.shape && A.pins.some(p => !p.shape))) {
    msg.textContent = "This area is already pinned.";
    return;
  }
  if (A.pins.length >= 4) {
    msg.textContent = "Four areas are pinned, the most this compares. Remove one first.";
    return;
  }
  A.pins.push(asPin(a));
  msg.textContent = `Pinned as ${A.pins[A.pins.length - 1].letter}. Draw another area to set it beside this one.`;
  writeHash();
  render();
}

/* =====================================================================
   THE PANEL
   ===================================================================== */
function render() {
  const a = A.cur,
    F = A.F;
  if (!a || !F || !document.getElementById("aMain")) return;
  $("aState").hidden = true;
  $("aMain").hidden = false;
  $("aName").textContent = nameOfArea(a);
  $("aWhole").hidden = !a.shape;
  $("aMsg").textContent = "";
  const n = a.idx.length,
    size = cellWords(n ? meanLat(a.idx) : a.shape ? (bbox(a.shape)[1] + bbox(a.shape)[3]) / 2 : 0);
  /* a big country's monthly squares can be coarser than the map's yearly ones */
  const coarser = A.d && A.g!.cell > A.d.cell ? ` These squares are coarser than the ${A.d.cell}° squares of the map above.` : "";
  $("aNote").textContent =
    (!A.g!.n
      ? `No square in ${theName(A.d!.name)} has fire on record, so there is nothing to count.`
      : a.shape
        ? n
          ? `Counted on ${n} square${n === 1 ? "" : "s"} of ${size} with fire on record, whose centre falls inside the shape${a.shape.t === "c" || a.shape.t === "p" ? `; the shape covers about ${roundArea(areaKm2(a.shape))} km²` : ""}.`
          : `No square with fire on record has its centre inside this shape. The squares are ${size}; draw a larger area.`
        : n
          ? `Counted on all ${n} squares of ${size} in ${theName(A.d!.name)} with fire on record. Draw on the map to look at one part.`
          : `No square in ${theName(A.d!.name)} has fire on record.`) + coarser;
  kpis(a, F);
  const none = a.st.total === 0;
  $("aNone").hidden = !none;
  $("aNone").textContent = none ? `No hotspots were counted in this area in any month from ${F.y0} to ${lastWords()}.` : "";
  $("aFigs").hidden = none;
  const yo: string[] = [];
  for (let y = F.y0 + Math.floor((F.nm - 1) / 12); y >= F.y0; y--) yo.push(`<option value="${y}">${y}</option>`);
  $("aSeasonY").innerHTML = yo.join("");
  ($("aSeasonY") as HTMLSelectElement).value = String(A.seasonY);
  drawCharts();
  drawCompare();
  drawWatch();
  drawShapes();
  if (A.time.on) drawTime();
  if (A.wantBlock) {
    const b = A.wantBlock;
    A.wantBlock = null;
    requestAnimationFrame(() => showBlock(b));
  }
}
const lastWords = () => {
  const p = A.F?.partial;
  return p ? `${p.day1} ${MON[p.m - 1]} ${p.y}` : `December ${A.F!.cy}`;
};
const monthsWords = (last: number) => (last === 0 ? "January" : `January–${MONL[last]}`);
function level(p: number | null) {
  if (p == null) return { t: "No usual level", c: "" };
  if (p >= 100) return { t: "Far above usual", c: "hi" };
  if (p >= 25) return { t: "Above usual", c: "hi" };
  if (p > -25) return { t: "About usual", c: "" };
  return { t: "Below usual", c: "lo" };
}
/** the trend in a few words: [figure, its class, the words for a title] */
function trendWords(t: Trend | null): { fig: string; c: string; title: string; cell: string } {
  if (!t) return { fig: "Too little fire", c: "", title: "", cell: "–" };
  if (!t.clear) return { fig: "No clear trend", c: "", title: "no clear trend", cell: "unclear" };
  const r = Math.round(t.pct);
  if (Math.abs(r) < 3) return { fig: "Steady", c: "", title: "steady", cell: "steady" };
  return {
    fig: `${r > 0 ? "Up" : "Down"} ${Math.abs(r)}%`,
    c: r > 0 ? "hi" : "lo",
    title: `${r > 0 ? "up" : "down"} ${Math.abs(r)}% per decade`,
    cell: `${r > 0 ? "+" : "−"}${Math.abs(r)}%`,
  };
}
function kpis(a: Area, F: Frame) {
  const st = a.st,
    vy = viirsYear(),
    item = (h: string, fig: string, note: string) => `<div><dt>${h}</dt><dd class="aFig">${fig}</dd><dd>${note}</dd></div>`,
    out: string[] = [];
  if (st.total === 0) {
    out.push(item(st.ytd ? `${st.ytd.y} so far` : "Latest year", "None", `No hotspots in this area from ${F.y0} to ${lastWords()}.`));
  } else if (st.ytd) {
    const y = st.ytd,
      p = y.usual > 0 ? ((y.cur - y.usual) / y.usual) * 100 : null,
      lv = level(p),
      fig =
        p == null
          ? y.cur > 0
            ? "Usually none"
            : "None"
          : `<span class="${lv.c}">${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p))}%</span><small>${lv.t}</small>`,
      past = y.n - 1,
      /* no rank for none at all, and say so when it ties */
      rk =
        y.cur < 0.05
          ? y.ties
            ? `; ${y.ties} of the ${past} complete years had none either`
            : ""
          : y.ties
            ? `; tied with ${y.ties} other year${y.ties === 1 ? "" : "s"} for the ${y.rank === 1 ? "" : ordinal(y.rank) + " "}most of ${y.n}`
            : y.rank === 1
              ? `; the most of ${y.n} years`
              : y.rank === y.n
                ? `; the fewest of ${y.n} years`
                : `; the ${ordinal(y.rank)} most of ${y.n} years`,
      pt = F.partial;
    out.push(
      item(
        `${y.y} so far`,
        fig,
        `${cap(nHot(y.cur))} in ${monthsWords(y.last)}, against a usual ${fmt(y.usual)} for those months (median of ${F.y0}–${F.yb})${rk}.` +
          (pt && st.part != null ? ` 1–${pt.day1} ${MONL[pt.m - 1]}: ${fmt(st.part)} so far, left out because the month is not over.` : ""),
      ),
    );
  } else {
    const last = st.years[st.years.length - 1],
      u = st.usualYear,
      p = last && u > 0 ? ((last.v - u) / u) * 100 : null,
      lv = level(p);
    out.push(
      item(
        last ? String(last.y) : "Latest year",
        p == null ? "n/a" : `<span class="${lv.c}">${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p))}%</span><small>${lv.t}</small>`,
        last ? `${cap(nHot(last.v))}, against a usual year of ${fmt(u)} (median of ${F.y0}–${F.yb}).` : "",
      ),
    );
  }
  out.push(
    item(
      "Usual peak month",
      st.total > 0 ? MONL[st.peak] : "None",
      st.total === 0
        ? "No fire on record here."
        : st.usual[st.peak] > 0
          ? `A usual ${MONL[st.peak]} has ${nHot(st.usual[st.peak])}; a usual year, ${fmt(st.usualYear)} (medians of ${F.y0}–${F.yb}).`
          : `Most years have no fire here; ${MONL[st.peak]} has had the most in all.`,
    ),
  );
  out.push(
    item(
      "Most active year",
      st.top ? String(st.top.y) : "None",
      st.top
        ? `${cap(nHot(st.top.v))}, ${times(st.top.v / st.mean)} the average year, among the complete years ${F.y0}–${F.yb}${st.top.y < vy ? "; converted from MODIS" : ""}.`
        : `No hotspots in ${F.y0}–${F.yb}.`,
    ),
  );
  const t = st.trend,
    tw = trendWords(t);
  out.push(
    item(
      "Long-term trend",
      t?.clear && tw.c ? `<span class="${tw.c}">${tw.fig}</span><small>per decade</small>` : tw.fig,
      !t
        ? `Fewer than ${TREND_MIN_MEAN} hotspots in an average year, or fewer than ${TREND_MIN_YEARS} years with fire: too little to read a trend.`
        : !t.clear
          ? `The yearly totals of ${F.y0}–${F.yb} rise and fall without a clear direction (Mann-Kendall test, p ≥ 0.05).`
          : `The usual change from one year to the next in ${F.y0}–${F.yb} (Sen's slope), over ten years; clear of the year-to-year noise (Mann-Kendall test, p < 0.05). Years before ${vy} are converted from MODIS.`,
    ),
  );
  $("aKpis").innerHTML = out.join("");
}

/* ---------- charts ---------- */
function drawCharts() {
  const a = A.cur,
    F = A.F;
  if (!a || !F || a.st.total === 0) return;
  document
    .querySelectorAll<HTMLButtonElement>("#aCalSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === A.cal)));
  const pt = F.partial,
    ptW = pt ? `${MONL[pt.m - 1]} ${pt.y}` : "";
  $("aCalNote").textContent =
    (A.cal === "count"
      ? "Click a month to show it on the map."
      : `Each month against a usual one: the median of the same month in ${F.y0}–${F.yb}. White is a usual month. Click a month to show it on the map.`) +
    (pt
      ? ` ${ptW} runs to the ${ordinal(pt.day1)}: it has a dashed edge${A.cal === "anom" ? " and is left out" : ""}.` +
        (pt.m < 12 ? ` Later months of ${pt.y} have not happened.` : "")
      : "");
  const sy = A.seasonY,
    top = a.st.top?.y;
  $("aSeasonT").textContent = sy === F.cy && F.cy > F.yb ? `${sy} so far against a usual year` : `${sy} against a usual year`;
  $("aSeasonNote").textContent =
    `Red: ${sy}. Dashed: a usual month (median of ${F.y0}–${F.yb}).` +
    (top !== undefined && top !== sy ? ` Black: ${top}, the most active year.` : "") +
    ` Pale grey: every other year.` +
    (pt && sy === pt.y ? ` ${MONL[pt.m - 1]} is left out because it is not over.` : "");
  const t = a.st.trend,
    tw = trendWords(t);
  $("aTrendT").textContent = tw.title ? `Hotspots per year: ${tw.title}` : "Hotspots per year";
  $("aTrendNote").textContent =
    `Paler bars, before ${viirsYear()}, are converted from MODIS. ` +
    (F.cy > F.yb ? `The dashed bar is ${F.cy} so far, to ${lastWords()}, and is not ranked. ` : "") +
    (t?.clear ? `The dashed line is the trend through ${F.y0}–${F.yb}, at a steady rate of change.` : "");
  if (!window.Plot || !window.d3) {
    const k = A.k;
    ["aCal", "aSeason", "aTrend"].forEach(id => ($(id).innerHTML = `<p class="aCap">Drawing…</p>`));
    loadPlotLib().then(
      () => A.k === k && drawCharts(),
      () =>
        ["aCal", "aSeason", "aTrend"].forEach(
          id =>
            ($(id).innerHTML =
              `<p class="aCap">The charts did not load (cdnjs or jsdelivr did not answer). The figures above are unaffected.</p>`),
        ),
    );
    return;
  }
  const cells = calendarCells(F, a.S, a.st),
    sc = calendar($("aCal"), cells, A.cal, A.time.on && A.time.m >= 0 ? { y: A.time.y, m: A.time.m } : null, c => pickTime(c.y, c.m));
  $("aCalKey").innerHTML =
    A.cal === "count"
      ? sc.max > 0
        ? stepped("Hotspots in a month", sc.colours, sc.breaks, sc.max) + `<span class="cpNone"><i></i>none</span>`
        : ""
      : `<div class="cpRamp"><span>¼ of usual</span><i style="background:linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)"></i><span>4× usual</span></div>`;
  season($("aSeason"), F, a.S, a.st, sy, m => pickTime(sy, m));
  trend($("aTrend"), F, a.S, a.st, viirsYear(), sy, y => pickTime(y, -1));
}
/** a month or year picked on a chart: show it on the map, and bring the map into view when it is above the panel */
function pickTime(y: number, m: number) {
  timeOn(y, m);
  if (phone()) showMapArea();
}
/** a stepped legend, as on the rest of the page */
function stepped(title: string, cols: string[], breaks: number[], max: number) {
  if (!breaks.length)
    return `<div><b>${title}</b><div class="cpKey"><div class="cpStep"><i style="background:${cols[0]}"></i><span>${short(max)}</span></div></div></div>`;
  return (
    `<div><b>${title}</b><div class="cpKey">` +
    cols
      .map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`)
      .join("") +
    `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${short(max)}</span></div></div></div>`
  );
}

/* ---------- areas side by side ---------- */
function drawCompare() {
  const F = A.F,
    box = document.getElementById("aCmp");
  if (!F || !box) return;
  box.hidden = !A.pins.length;
  $("aPin").textContent = A.pins.length ? "Pin this one too" : "Pin to compare";
  if (!A.pins.length) return;
  const cur = A.cur,
    curPinned = !!cur && A.pins.some(p => (p.shape && cur.shape ? encode(p.shape) === encode(cur.shape) : !p.shape && !cur.shape)),
    rows: { label: string; colour: string; dash: string; a: Area; pin: Pin | null }[] = A.pins.map(p => ({
      label: p.letter,
      colour: p.colour,
      dash: ["", "", "5,3", "2,2"][LETTERS.indexOf(p.letter)],
      a: p,
      pin: p,
    }));
  if (cur && !curPinned) rows.push({ label: "Now", colour: "#8a8478", dash: "1,3", a: cur, pin: null });
  const ytdH = F.cy > F.yb ? `${MON[0]}–${MON[F.cyLast]} ${F.cy}` : String(F.yb);
  /* two lines an area, so it fits the panel: its letter and name, then its figures */
  $("aCmpT").innerHTML =
    `<thead><tr><th>Squares</th><th>${ytdH}<small>vs usual</small></th><th>Peak</th><th>Top year</th><th>Trend<small>a decade</small></th></tr></thead>` +
    rows
      .map(r => {
        const st = r.a.st,
          y = st.ytd,
          p = y && y.usual > 0 ? ((y.cur - y.usual) / y.usual) * 100 : null,
          name = esc(nameOfArea(r.a));
        return (
          `<tbody><tr class="aCmpA"><td colspan="5"><div class="aCmpH"><span class="aCmpL"><span class="aSw" style="--c:${r.colour}"></span><b>${r.label}</b> <span class="aCmpN" title="${name}">${name}</span></span>` +
          (r.pin
            ? `<button type="button" class="cpText aSmallText" data-unpin="${r.pin.letter}" aria-label="Remove ${r.pin.letter}">Remove</button>`
            : "") +
          `</div></td></tr><tr><td>${r.a.idx.length}</td>` +
          `<td>${y ? `${fmt(y.cur)}<small>${p == null ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p))}%`}</small>` : "n/a"}</td>` +
          `<td>${st.total > 0 ? MON[st.peak] : "–"}</td><td>${st.top ? st.top.y : "–"}</td>` +
          `<td>${trendWords(st.trend).cell}</td></tr></tbody>`
        );
      })
      .join("");
  $("aCmpT")
    .querySelectorAll<HTMLButtonElement>("[data-unpin]")
    .forEach(
      b =>
        (b.onclick = () => {
          A.pins = A.pins.filter(p => p.letter !== b.dataset.unpin);
          writeHash();
          render();
        }),
    );
  $("aCmpNote").textContent =
    `Squares: how many ${A.g!.cell}° squares with fire on record each area counts. Trend: per decade, ${F.y0}–${F.yb}, shown only when it is clear. ` +
    `Share of the year: each month's part of the year's hotspots, the median over ${F.y0}–${F.yb}. ` +
    (cur && !curPinned ? `"Now" is the area selected at the moment, not pinned. ` : "") +
    `The CSV holds every area's months.`;
  drawCompareChart(rows);
}
function drawCompareChart(rows?: { label: string; colour: string; dash: string; a: Area }[]) {
  if (!rows) return drawCompare();
  if (!window.Plot) return;
  const share = document.querySelector("#aCmpSeg [aria-pressed=true]")?.getAttribute("data-s") === "p";
  $("aCmpCT").textContent = share ? "Each month's usual share of the year" : "A usual year in each area";
  compareChart(
    $("aCmpC"),
    rows.map(r => ({ label: r.label, usual: r.a.st.usual, share: r.a.st.share, colour: r.colour, dash: r.dash })),
    share,
  );
}

/* ---------- where to watch ---------- */
const sqName = (c: number) => `${latW(A.g!.lat[c], 2)}, ${lonW(A.g!.lon[c], 2)}`;
function drawWatch() {
  for (const m of A.markers) m.remove();
  A.markers = [];
  const map = A.map,
    a = A.cur,
    F = A.F,
    g = A.g;
  if (map?.getSource("a-watch")) map.getSource("a-watch").setData(EMPTY);
  if (!a || !F || !g || !document.getElementById("aWM")) {
    drawPins();
    return;
  }
  /* nothing to rank: no section at all */
  $("aWatch").hidden = !a.idx.length;
  if (!a.idx.length) {
    drawPins();
    return;
  }
  const m = A.watchM,
    nextY = (() => {
      /* the coming one: after the last data */
      const lastM = F.partial ? F.partial.m - 1 : F.cyLast;
      return m > lastM ? F.cy : F.cy + 1;
    })();
  const opts: string[] = [];
  const startM = ((F.partial ? F.partial.m - 1 : F.cyLast) + 1) % 12;
  for (let k = 0; k < 12; k++) {
    const mm = (startM + k) % 12;
    opts.push(`<option value="${mm}">${MONL[mm]}</option>`);
  }
  $("aWM").innerHTML = opts.join("");
  ($("aWM") as HTMLSelectElement).value = String(m);
  ($("aWOn") as HTMLInputElement).checked = A.watchOn;
  const years = watchYears(F, m),
    est: { c: number; e: Estimate }[] = [];
  for (let k = 0; k < a.idx.length; k++) {
    const c = a.idx[k],
      S = g.v.subarray(c * g.nm, (c + 1) * g.nm);
    est.push({ c, e: estimate(F, S, m, years) });
  }
  est.sort((x, z) => z.e.expected - x.e.expected);
  const total = est.reduce((s, r) => s + r.e.expected, 0),
    areaE = estimate(F, a.S, m, years);
  /* as in the HotSpotters outlook: High and Raised only for a square that expects at least one hotspot */
  let cum = 0;
  const ranked = est.map(r => {
    const w =
      total > 0 && r.e.expected >= 1 && cum < total * 0.5
        ? "high"
        : total > 0 && r.e.expected >= 1 && cum < total * 0.8
          ? "elevated"
          : "low";
    cum += r.e.expected;
    return { ...r, w };
  });
  const top = ranked.filter(r => r.e.expected >= 1).slice(0, 10),
    high = ranked.filter(r => r.w === "high"),
    nHigh = high.length,
    highPc = total > 0 ? Math.round((high.reduce((t, r) => t + r.e.expected, 0) / total) * 100) : 0,
    yw = `${years[0]}–${years[years.length - 1]}`;
  $("aWSub").textContent =
    areaE.expected >= 0.5
      ? `About ${nHot(areaE.expected)} expected in this area in ${MONL[m]} ${nextY}; ${areaE.vals.length >= 10 ? "six" : "most"} of the last ${areaE.vals.length === 10 ? "ten" : areaE.vals.length} ${MONL[m]}s had between ${fmt(areaE.lo)} and ${fmt(areaE.hi)}.` +
        (nHigh
          ? ` Square by square the estimates add up to about ${fmt(total)}; ${nHigh} of the ${a.idx.length} squares ${nHigh === 1 ? "holds" : "hold"} ${highPc}% of that.`
          : top.length
            ? ""
            : ` No single square expects one hotspot or more: the fire moves around from year to year.`)
      : `${MONL[m]} is usually quiet here: under one hotspot expected in ${MONL[m]} ${nextY}.`;
  $("aWList").innerHTML = top.length
    ? top
        .map(
          (r, i) =>
            `<li><button type="button" data-c="${r.c}"><span class="aWRank">${i + 1}</span><span class="aWPlace">${sqName(r.c)}<small>${r.e.active} of ${r.e.vals.length} ${MONL[m]}s had fire${r.e.recent > r.e.med * 1.25 && r.e.recent >= 1 ? "; more lately" : r.e.recent < r.e.med * 0.75 ? "; less lately" : ""}</small></span>` +
            `<span class="aWN" title="Six of the last ten ${MONL[m]}s had between ${fmt(r.e.lo)} and ${fmt(r.e.hi)}">~${fmt(r.e.expected)}<small>${fmt(r.e.lo)}–${fmt(r.e.hi)}</small></span><span class="aWLv ${r.w}">${r.w === "high" ? "High" : r.w === "elevated" ? "Raised" : "Low"}</span></button></li>`,
        )
        .join("")
    : "";
  $("aWList")
    .querySelectorAll<HTMLButtonElement>("[data-c]")
    .forEach(b => (b.onclick = () => flyToCell(+b.dataset.c!)));
  $("aWFoot").textContent =
    `An estimate from history only: for each square, 60% the median of the ${MONL[m]}s of ${yw} and 40% the average of the last three. ` +
    `It ignores weather, drought and fuel, so read it as where fire usually is in ${MONL[m]}, not a forecast. ` +
    `Each square is estimated on its own, and fire that moves around from year to year leaves most squares at zero, so the squares' estimates add up to less than the area's. ` +
    `Listed: squares that expect at least one hotspot. High: the top squares until they hold half of the squares' estimates; Raised: on to 80%.`;
  if (A.watchOn && map && top.length) {
    const ml = window.maplibregl;
    const feats = top.map(r => cellFeature(r.c, { r: 0 }));
    map.getSource("a-watch")?.setData({ type: "FeatureCollection", features: feats });
    top.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "aMark aMarkW";
      el.textContent = String(i + 1);
      el.title = `${i + 1}. ${sqName(r.c)}: about ${fmt(r.e.expected)} in ${MONL[m]}`;
      A.markers.push(new ml.Marker({ element: el }).setLngLat([near(g.lon[r.c], A.lon0), g.lat[r.c]]).addTo(map));
    });
  }
  drawPins();
}
function flyToCell(c: number) {
  const g = A.g!,
    map = A.map;
  if (!map) return;
  const x = near(g.lon[c], A.lon0),
    y = g.lat[c],
    h = g.cell * 2.5;
  map.fitBounds(
    [
      [x - h, y - h],
      [x + h, y + h],
    ],
    { padding: 30, duration: 700, maxZoom: 9 },
  );
  if (phone()) showMapArea();
}

/* =====================================================================
   SHARE AND CSV
   ===================================================================== */
async function share() {
  writeHash();
  const url = location.href.split("#")[0] + hashFor(),
    msg = $("aMsg");
  try {
    await navigator.clipboard.writeText(url);
    msg.textContent = "Link copied. It opens this country with this area" + (A.pins.length ? " and the pinned ones." : ".");
  } catch {
    msg.innerHTML = `Copy this link: <input class="aLink" readonly value="${esc(url)}">`;
    const i = msg.querySelector("input");
    i?.focus();
    i?.select();
  }
}
function csv() {
  const F = A.F,
    cur = A.cur;
  if (!F || !cur || !A.d) return;
  const areas: { label: string; a: Area }[] = A.pins.map(p => ({ label: p.letter, a: p as Area }));
  if (!A.pins.some(p => p === cur || (p.shape && cur.shape && encode(p.shape) === encode(cur.shape)) || (!p.shape && !cur.shape)))
    areas.unshift({ label: "selected", a: cur });
  /* the same words for the source as the country CSV: MODIS converted to VIIRS terms before VIIRS starts */
  const d = A.d,
    vi0 = (d.viirs_from[0] - F.y0) * 12 + d.viirs_from[1] - 1,
    aq0 = (d.aqua_from[0] - F.y0) * 12 + d.aqua_from[1] - 1,
    filled = new Set([...(d.y2026?.conv_months ?? []).map(c => c.i), ...(d.y2026?.hist_gaps ?? []).map(g => g.i)]),
    src = (i: number) =>
      filled.has(i) ? FILL_SRC : i >= vi0 ? "VIIRS observed" : i < aq0 ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted",
    rows = [`area,shape,squares,square_deg,year,month,month_status,harmonized_viirs_snpp_equivalent,source,usual_median_${F.y0}_${F.yb}`];
  for (const { label, a } of areas) {
    const sh = a.shape ? encode(a.shape) : "whole_country";
    for (let i = 0; i < F.nm; i++) {
      const y = F.y0 + Math.floor(i / 12),
        m = i % 12,
        part = F.partial && i === F.partial.i;
      rows.push(
        [
          label,
          `"${sh}"`,
          a.idx.length,
          A.g!.cell,
          y,
          m + 1,
          part ? `partial_to_day_${F.partial!.day1}` : "complete",
          a.S[i].toFixed(1),
          `"${src(i)}"`,
          /* a month not over has no like-for-like usual */
          part ? "" : a.st.usual[m].toFixed(1),
        ].join(","),
      );
    }
  }
  save(`burn-calendar_${A.d.country}_areas.csv`, rows.join("\n"), $("aMsg"));
}

/* =====================================================================
   COORDINATES TYPED IN
   ===================================================================== */
function prefillCoords() {
  const s = A.cur?.shape,
    set = (id: string, v: number) => (($(id) as HTMLInputElement).value = String(Number(v.toFixed(3))));
  if (s?.t === "r") {
    ($("aCShape") as HTMLSelectElement).value = "r";
    set("aCs", s.s);
    set("aCw", near(s.w, 0));
    set("aCn", s.n);
    set("aCe", near(s.w, 0) + (s.e - s.w));
  } else if (s?.t === "c") {
    ($("aCShape") as HTMLSelectElement).value = "c";
    set("aClat", s.lat);
    set("aClon", near(s.lon, 0));
    set("aCkm", s.km);
  }
  $("aCShape").onchange!(new Event("change"));
}
function coordsSubmit() {
  const v = (id: string) => {
      const t = ($(id) as HTMLInputElement).value.trim();
      return t === "" ? NaN : Number(t);
    },
    msg = $("aCMsg");
  let s: Shape | null = null;
  if (($("aCShape") as HTMLSelectElement).value === "r") {
    const so = v("aCs"),
      w = v("aCw"),
      n = v("aCn");
    let e = v("aCe");
    if (![so, w, n, e].every(Number.isFinite)) return void (msg.textContent = "Fill in all four edges, in degrees.");
    if (Math.abs(so) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180)
      return void (msg.textContent = "Latitudes run from -90 to 90 and longitudes from -180 to 180.");
    if (n <= so) return void (msg.textContent = "North must be above south.");
    /* a box across the antimeridian: east is the far side of 180 */
    if (e <= w) e += 360;
    /* West and East swapped would make a box most of the way round the world */
    if (e - w > 180)
      return void (msg.textContent =
        "That box is over 180° wide. West is the left edge: for a box across 180°, give West 170 and East -170, for example.");
    s = { t: "r", s: so, w, n, e };
  } else {
    const lat = v("aClat"),
      lon = v("aClon"),
      r = v("aCkm");
    if (![lat, lon, r].every(Number.isFinite)) return void (msg.textContent = "Fill in the centre and the radius.");
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return void (msg.textContent = "Latitudes run from -90 to 90 and longitudes from -180 to 180.");
    if (r < 5 || r > 3000) return void (msg.textContent = "Give a radius between 5 and 3,000 km.");
    s = { t: "c", lat, lon, km: r };
  }
  msg.textContent = "";
  setArea(s, true);
}

/* =====================================================================
   THE MAP: shapes, squares counted, the month-by-month layer, the watch list, and drawing
   ===================================================================== */
const EMPTY = { type: "FeatureCollection", features: [] };
function cellFeature(c: number, props: Record<string, number>) {
  const g = A.g!,
    w = near(g.lon[c], A.lon0) - g.cell / 2,
    s = g.s[c],
    e = w + g.cell,
    n = s + g.cell;
  return {
    type: "Feature",
    id: c,
    properties: { ...props, c },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}
const poly = (r: [number, number][], props: Record<string, unknown> = {}) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [r] },
});

onMapReady((map: any) => {
  if (!A.k) return;
  A.map = map;
  const under = map.getLayer("cells-hover") ? "cells-hover" : undefined;
  for (const id of ["a-time", "a-sel", "a-shape", "a-pins", "a-draft", "a-watch"]) map.addSource(id, { type: "geojson", data: EMPTY });
  map.addLayer(
    {
      id: "a-time",
      type: "fill",
      source: "a-time",
      layout: { visibility: "none" },
      filter: [">", ["get", "v"], 0],
      paint: { "fill-color": FIRE[3], "fill-opacity": 0.9, "fill-antialias": false },
    },
    under,
  );
  map.addLayer(
    {
      id: "a-time-edge",
      type: "line",
      source: "a-time",
      layout: { visibility: "none" },
      filter: [">", ["get", "v"], 0],
      paint: { "line-color": FIRE[3], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 7, 0.8, 9, 0] },
    },
    under,
  );
  map.addLayer({ id: "a-sel", type: "line", source: "a-sel", paint: { "line-color": "#1b1b1b", "line-width": 0.7, "line-opacity": 0.55 } });
  map.addLayer({ id: "a-shape-fill", type: "fill", source: "a-shape", paint: { "fill-color": "#1b1b1b", "fill-opacity": 0.05 } });
  map.addLayer({ id: "a-shape", type: "line", source: "a-shape", paint: { "line-color": "#1b1b1b", "line-width": 2 } });
  map.addLayer({
    id: "a-pins",
    type: "line",
    source: "a-pins",
    paint: { "line-color": ["get", "c"], "line-width": 2, "line-dasharray": [3, 2] },
  });
  map.addLayer({
    id: "a-draft",
    type: "line",
    source: "a-draft",
    paint: { "line-color": "#1b1b1b", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({ id: "a-watch", type: "line", source: "a-watch", paint: { "line-color": "#bd0026", "line-width": 2.5 } });
  const ml = window.maplibregl;
  A.popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 });
  map.on("mousemove", "a-time", (e: { features?: { properties: { v: number; c: number } }[]; lngLat: unknown }) => {
    const f = e.features && e.features[0];
    if (!f || A.tool) return;
    const c = f.properties.c;
    A.popup
      .setLngLat(e.lngLat)
      .setHTML(`<b>${nHot(f.properties.v)}</b><span>in ${timeWords()}</span><span class="pos">Square around ${esc(sqName(c))}</span>`)
      .addTo(map);
  });
  map.on("mouseleave", "a-time", () => A.popup.remove());
  wireDrawing(map);
  /* for tests and debugging in the console */
  (map.getContainer() as HTMLElement & { _areas?: unknown })._areas = A;
  drawShapes();
  drawWatch();
  if (A.time.on) timeOn(A.time.y, A.time.m);
  const s = A.cur?.shape;
  if (s && parseHash()?.area) fitTo(s);
});
function drawShapes() {
  const map = A.map;
  if (!map?.getSource("a-shape")) return;
  const s = A.cur?.shape;
  map.getSource("a-shape").setData(s ? { type: "FeatureCollection", features: [poly(ring(s, A.lon0))] } : EMPTY);
  map
    .getSource("a-sel")
    .setData(s && A.g && A.cur ? { type: "FeatureCollection", features: Array.from(A.cur.idx, c => cellFeature(c, {})) } : EMPTY);
  drawPins();
}
function drawPins() {
  const map = A.map;
  if (!map?.getSource("a-pins")) return;
  for (const m of A.pinMarks) m.remove();
  A.pinMarks = [];
  const ps = A.pins.filter(p => p.shape);
  map.getSource("a-pins").setData({ type: "FeatureCollection", features: ps.map(p => poly(ring(p.shape!, A.lon0), { c: p.colour })) });
  const ml = window.maplibregl;
  for (const p of ps) {
    const b = bbox(p.shape!),
      el = document.createElement("div");
    el.className = "aMark aMarkP";
    el.style.setProperty("--c", p.colour);
    el.textContent = p.letter;
    A.pinMarks.push(
      new ml.Marker({ element: el, anchor: "bottom-left" })
        .setLngLat([b[0] + near(midLon(p.shape!), A.lon0) - midLon(p.shape!), b[3]])
        .addTo(map),
    );
  }
}
function fitTo(s: Shape) {
  const map = A.map;
  if (!map) return;
  let b = bbox(s),
    off = near(midLon(s), A.lon0) - midLon(s);
  /* a circle round a pole spans the world: show the squares it counts instead */
  const cur = A.cur;
  if (b[2] - b[0] > 300 && cur?.shape === s && cur.idx.length && A.g) {
    const g = A.g,
      xs = Array.from(cur.idx, c => near(g.lon[c], A.lon0)),
      ys = Array.from(cur.idx, c => g.lat[c]);
    b = [
      Math.min(...xs) - g.cell / 2,
      Math.min(...ys) - g.cell / 2,
      Math.max(...xs) + g.cell / 2,
      Math.min(85, Math.max(...ys) + g.cell / 2),
    ];
    off = 0;
  }
  map.fitBounds(
    [
      [b[0] + off, b[1]],
      [b[2] + off, b[3]],
    ],
    { padding: phone() ? 24 : 48, duration: 600, maxZoom: 9 },
  );
}

/* ---------- the month-by-month layer ---------- */
let timeClasses: { key: string; breaks: number[] } | null = null;
const PROBS = [0.25, 0.45, 0.62, 0.76, 0.87, 0.95];
/** class edges from every square's monthly (or yearly) values in the country, so the colours hold still while it plays */
function classesFor(year: boolean) {
  const g = A.g!,
    key = `${g.country}|${year}`;
  if (timeClasses?.key === key) return timeClasses.breaks;
  let vals: Float32Array;
  if (!year) vals = g.v.filter(v => v > 0);
  else {
    const ny = Math.ceil(g.nm / 12),
      t = new Float32Array(g.n * ny);
    for (let c = 0; c < g.n; c++) for (let i = 0; i < g.nm; i++) t[c * ny + Math.floor(i / 12)] += g.v[c * g.nm + i];
    vals = t.filter(v => v > 0);
  }
  vals.sort();
  const out: number[] = [];
  if (vals.length) {
    const max = vals[vals.length - 1],
      min = vals[0];
    for (const q of PROBS) {
      const b = nice(vals[Math.floor(q * (vals.length - 1))]);
      if (b > (out.length ? out[out.length - 1] : min) && b < max) out.push(b);
    }
  }
  timeClasses = { key, breaks: out };
  return out;
}
const timeWords = () => {
  const F = A.F!,
    { y, m } = A.time;
  if (m < 0) return F.cy > F.yb && y === F.cy ? `${y}, to ${lastWords()}` : String(y);
  return F.partial && (y - F.y0) * 12 + m === F.partial.i ? `1–${F.partial.day1} ${MONL[m]} ${y} (not over)` : `${MONL[m]} ${y}`;
};
function fillTimeSelects() {
  const F = A.F!,
    yo: string[] = [];
  for (let y = F.y0 + Math.floor((F.nm - 1) / 12); y >= F.y0; y--) yo.push(`<option value="${y}">${y}</option>`);
  $("aTY").innerHTML = yo.join("");
  $("aTM").innerHTML = `<option value="-1">Whole year</option>` + MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
}
function timeOn(y: number, m: number) {
  const F = A.F;
  if (!F) {
    A.time = { on: true, y, m };
    syncBar();
    return;
  }
  /* no month after the last data */
  if (m >= 0 && idxOf(F, y, m) >= F.nm) m = (F.nm - 1) % 12;
  A.time = { on: true, y, m };
  syncBar();
  ($("aTY") as HTMLSelectElement).value = String(y);
  ($("aTM") as HTMLSelectElement).value = String(m);
  drawTime();
  if (A.cur && window.Plot && A.cur.st.total > 0) {
    /* the calendar outlines the month the map shows */
    const cells = calendarCells(F, A.cur.S, A.cur.st);
    calendar($("aCal"), cells, A.cal, m >= 0 ? { y, m } : null, c => pickTime(c.y, c.m));
  }
}
function drawTime() {
  const map = A.map,
    g = A.g,
    F = A.F;
  if (!g || !F) return;
  const { y, m } = A.time,
    ty = document.getElementById("aTY") as HTMLSelectElement | null,
    tm = document.getElementById("aTM") as HTMLSelectElement | null;
  /* the menus say what the map shows, also when their options were filled after the month was set */
  if (ty && ty.value !== String(y)) ty.value = String(y);
  if (tm && tm.value !== String(m)) tm.value = String(m);
  const breaks = classesFor(m < 0),
    cols = classColours(breaks),
    feats: unknown[] = [];
  let shown = 0;
  for (let c = 0; c < g.n; c++) {
    let v = 0;
    if (m >= 0) v = g.v[c * g.nm + idxOf(F, y, m)];
    else for (let i = idxOf(F, y, 0); i < Math.min(F.nm, idxOf(F, y, 12)); i++) v += g.v[c * g.nm + i];
    if (v > 0) {
      feats.push(cellFeature(c, { v }));
      shown++;
    }
  }
  $("aTKey").innerHTML =
    `<span class="aTWhen">${esc(timeWords())}: ${shown} square${shown === 1 ? "" : "s"} with fire</span>` +
    `<div class="cpKey aTSteps">${cols
      .map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`)
      .join("")}</div>`;
  if (!map?.getSource("a-time")) return;
  map.getSource("a-time").setData({ type: "FeatureCollection", features: feats });
  const expr: unknown[] = breaks.length ? ["step", ["get", "v"], cols[0]] : [cols[0]];
  if (breaks.length) breaks.forEach((b, i) => expr.push(b, cols[i + 1]));
  const paint = breaks.length ? expr : cols[0];
  map.setPaintProperty("a-time", "fill-color", paint);
  map.setPaintProperty("a-time-edge", "line-color", paint);
  for (const id of ["a-time", "a-time-edge"]) map.setLayoutProperty(id, "visibility", "visible");
  for (const id of ["cells", "cells-edge", "cells-hover"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
}
function timeOff() {
  stopPlay();
  A.time.on = false;
  syncBar();
  const map = A.map;
  if (map?.getLayer("a-time")) {
    for (const id of ["a-time", "a-time-edge"]) map.setLayoutProperty(id, "visibility", "none");
    for (const id of ["cells", "cells-edge", "cells-hover"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    A.popup?.remove();
  }
  if (A.cur && A.F && window.Plot && A.cur.st.total > 0)
    calendar($("aCal"), calendarCells(A.F, A.cur.S, A.cur.st), A.cal, null, c => pickTime(c.y, c.m));
}
function play() {
  const F = A.F;
  if (!F) return;
  if (!A.time.on) timeOn(A.time.y, A.time.m);
  const last = F.nm - 1,
    atEnd = A.time.m < 0 ? A.time.y >= F.y0 + Math.floor(last / 12) : idxOf(F, A.time.y, A.time.m) >= last;
  /* from the start when it is already at the end */
  if (atEnd) timeOn(F.y0, A.time.m < 0 ? -1 : 0);
  $("aPlay").textContent = "Pause";
  $("aPlay").setAttribute("aria-pressed", "true");
  playTimer = window.setInterval(
    () => {
      let { y, m } = A.time;
      if (m < 0) y++;
      else if (++m > 11) {
        m = 0;
        y++;
      }
      const i = m < 0 ? (y - F.y0) * 12 : idxOf(F, y, m);
      if (i > last) return stopPlay();
      timeOn(y, m);
    },
    A.time.m < 0 ? 900 : 550,
  );
}
function stopPlay() {
  if (playTimer) clearInterval(playTimer);
  playTimer = undefined;
  const b = document.getElementById("aPlay");
  if (b) {
    b.textContent = "Play";
    b.setAttribute("aria-pressed", "false");
  }
}

/* ---------- drawing ---------- */
/** the largest circle, as in the Coordinates form */
const MAX_KM = 3000;
const HINTS: Record<Tool, string> = {
  rect: "Drag on the map to draw a box. Esc to cancel.",
  circle: `Press on the centre and drag out to the radius, up to ${MAX_KM.toLocaleString("en-US")} km. Esc to cancel.`,
  poly: "Hold and draw around the area; let go to close the shape. Esc to cancel.",
};
function arm(t: Tool) {
  if (A.tool === t) return disarm();
  openTools();
  ($("aCoords") as HTMLElement).hidden = true;
  $("aCoordBtn").setAttribute("aria-expanded", "false");
  A.tool = t;
  syncBar();
  hint(A.map ? HINTS[t] : "The map is still loading; try again in a moment.");
  const map = A.map;
  if (!map) {
    A.tool = null;
    syncBar();
    return;
  }
  map.dragPan.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
  map.getCanvasContainer().classList.add("aDrawing");
  A.popup?.remove();
  hideCellPopup();
  /* the panel is under the map: bring the map up to draw on, with the hint above it */
  if (phone()) showMapArea();
}
function disarm() {
  if (!A.tool) return;
  A.tool = null;
  syncBar();
  hint("");
  const map = A.map;
  if (!map) return;
  map.dragPan.enable();
  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();
  map.getCanvasContainer().classList.remove("aDrawing");
  map.getSource("a-draft")?.setData(EMPTY);
}
addEventListener("keydown", e => {
  if (e.key === "Escape" && A.tool) disarm();
});
function wireDrawing(map: any) {
  const box = map.getCanvasContainer() as HTMLElement;
  let start: [number, number] | null = null,
    pts: [number, number][] = [],
    lastPx: [number, number] = [0, 0],
    id = -1,
    /* when the last drawing ended: the click that follows it is not for the map */
    endedAt = 0;
  const at = (e: PointerEvent): [number, number] => {
    const r = box.getBoundingClientRect(),
      p = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    return [p.lng, p.lat];
  };
  const draft = (s: Shape | null, line?: [number, number][]) => {
    const src = map.getSource("a-draft");
    if (!src) return;
    if (line) src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
    else src.setData(s ? poly(ring(s, A.lon0)) : EMPTY);
  };
  const shapeFrom = (a: [number, number], b: [number, number]): Shape | null => {
    if (A.tool === "rect")
      return { t: "r", s: Math.min(a[1], b[1]), n: Math.max(a[1], b[1]), w: Math.min(a[0], b[0]), e: Math.max(a[0], b[0]) };
    if (A.tool === "circle") return { t: "c", lat: a[1], lon: a[0], km: Math.min(MAX_KM, km(a[1], a[0], b[1], b[0])) };
    return null;
  };
  box.addEventListener(
    "pointerdown",
    e => {
      if (!A.tool || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      box.setPointerCapture(e.pointerId);
      id = e.pointerId;
      start = at(e);
      pts = [start];
      lastPx = [e.clientX, e.clientY];
    },
    true,
  );
  box.addEventListener(
    "pointermove",
    e => {
      if (!A.tool || !start || e.pointerId !== id) return;
      e.preventDefault();
      const p = at(e);
      if (A.tool === "poly") {
        if (Math.hypot(e.clientX - lastPx[0], e.clientY - lastPx[1]) < 4) return;
        lastPx = [e.clientX, e.clientY];
        pts.push(p);
        draft(null, pts);
      } else draft(shapeFrom(start, p));
    },
    true,
  );
  const end = (e: PointerEvent) => {
    if (!A.tool || !start || e.pointerId !== id) return;
    e.preventDefault();
    const p = at(e),
      tool = A.tool,
      a = start;
    start = null;
    id = -1;
    let s: Shape | null = null;
    if (tool === "poly") {
      pts.push(p);
      const b = pts.reduce(
        (r, q) => [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[0]), Math.max(r[3], q[1])],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      const simple = simplify(pts, Math.max(b[2] - b[0], b[3] - b[1]) / 200, 80);
      if (simple.length >= 3) s = { t: "p", pts: simple };
    } else s = shapeFrom(a, p);
    /* a click, or a shape too small to hold anything */
    const small = !s || (s.t === "c" ? s.km < 5 : areaKm2(s) < 25);
    if (small) {
      draft(null);
      hint(`That was too small to count. ${HINTS[tool]}`);
      return;
    }
    s = normalise(s!);
    endedAt = performance.now();
    disarm();
    draft(null);
    hideCellPopup();
    setArea(s);
    if (s.t === "c" && s.km >= MAX_KM) hint(`Circles stop at ${MAX_KM.toLocaleString("en-US")} km.`);
  };
  box.addEventListener("pointerup", end, true);
  /* the click after a drawing, or any click while a tool is on, would open the map's own square popup */
  box.addEventListener(
    "click",
    e => {
      if (A.tool || performance.now() - endedAt < 500) {
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    },
    true,
  );
  box.addEventListener(
    "pointercancel",
    e => {
      if (e.pointerId !== id) return;
      start = null;
      id = -1;
      draft(null);
    },
    true,
  );
}
/** move a drawn shape by whole turns so its middle lies between -180 and 180 */
function normalise(s: Shape): Shape {
  const off = near(midLon(s), 0) - midLon(s);
  if (!off) return s;
  if (s.t === "r") return { ...s, w: s.w + off, e: s.e + off };
  if (s.t === "c") return { ...s, lon: s.lon + off };
  return { t: "p", pts: s.pts.map(([x, y]) => [x + off, y] as [number, number]) };
}

/* charts are drawn to the panel's width; redraw them when it changes */
let rt: number | undefined,
  lastW = 0;
addEventListener("resize", () => {
  clearTimeout(rt);
  rt = window.setTimeout(() => {
    const p = document.getElementById("aPanel");
    if (!A.open || !p || p.hidden) return;
    const w = p.clientWidth;
    if (w === lastW) return;
    lastW = w;
    drawCharts();
    drawCompare();
  }, 150);
});

/** the fire copilot's months run from January 2000 to November 2026 (323), as HotSpotters counts them */
const COPILOT_MONTHS = 323;
/** the drawn area as the copilot's "selection": its name, bounds and monthly record in VIIRS terms (this site's
    harmonized cells), so questions about "here" are answered from these numbers. Null for the whole country. */
export function areaForCopilot(): { name: string; bbox: [number, number, number, number]; series: number[] } | null {
  const a = A.cur,
    F = A.F;
  if (!A.open || !a || !a.shape || !F || !A.d || !(a.st.total > 0)) return null;
  const off = (F.y0 - 2000) * 12,
    series = new Array<number>(COPILOT_MONTHS).fill(0);
  for (let i = 0; i < a.S.length; i++) if (i + off >= 0 && i + off < COPILOT_MONTHS) series[i + off] = Math.round(a.S[i] * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100,
    [w, so, e, n] = bbox(a.shape);
  return { name: `${describe(a.shape)} in ${theName(A.d.name)}`, bbox: [r2(w), r2(so), r2(e), r2(n)], series };
}
