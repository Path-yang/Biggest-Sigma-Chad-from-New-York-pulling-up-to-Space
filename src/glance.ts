import type { CountrySummary, SeriesAnalysis, YearToDate } from "./types";
import type { Box, MapMark, MapView } from "./cmap";
import type { CountryForecast } from "./cfore";
import type { CountryStations } from "./cstn";
import { MON, MONL, NAME, SLUG } from "./data";
import { $, fmt, short } from "./util";
import { analyseSeries, rankWords } from "./model";
import { loadSummary } from "./hf";
import { loadMapLib } from "./libs";
import { cellIndexes, centreLon, classBreaks, classColours, mapData } from "./cmap";
import { VOLCANIC, epochs, harmFilled, monthRun, nMonths, partOf, sameDays, ytdOf } from "./country";
import { fcCell, fcCellOk, fcGlance, fcLoad, fcPc } from "./cfore";
import { stCell, stGlance, stLoad } from "./cstn";
import { lonSpan, near, nameOf, shapeOf, slugOf, theName } from "./world";
import type { Province, ProvinceFile } from "./prov";
import { busiestMonth, frameOf, levels, loadProvinces, outlineCredit, outlineName, provinceOfMark, searchProvinces, shapeNear, soFar, worstYear } from "./prov";
import { FINE_CELL, fineCell, fineFeatures, fineStop, fineValues, wantFine } from "./fine";

/* =====================================================================
   COUNTRY VIEW (#g/<slug>): the middle step between the globe and the full record. A dark full-screen map of one
   country's fire squares, a year slider, and a side card with the short answers; clicking a square shows its own
   numbers in the card, and "Open the full record" goes on to the report page (#c/<slug>). The copilot can frame a
   province or district here. Laid out like the New York and California view.
   ===================================================================== */
const STYLE = "https://tiles.openfreemap.org/styles/dark";
const FALLBACK = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#05070c" } }] };
/** dark ground, so the ramp runs the other way to the paper map: quiet squares deep red, busy ones bright ember */
const RAMP = ["#5c1420", "#8e1c1f", "#c2301b", "#e8531b", "#fd8d3c", "#feb24c", "#ffe08a"];
/** outline colours for the copilot's places on the dark map */
const TONES = ["#6fa8ff", "#c9a3ff", "#7fd1ae", "#ffd166"];
const DROP = /^(highway_name|road_oneway|aeroway|railway)/;
const LATIN = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const deg = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v < 0 ? n : p}`;
const row = (dt: string, dd: string, title = "") => `<div${title ? ` title="${esc(title)}"` : ""}><dt>${dt}</dt><dd>${dd}</dd></div>`;
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
/** the card is a bottom sheet on phones and on tablets held upright (the same test as the CSS in index.html) */
const SHEET_Q = "(max-width: 760px), (max-width: 900px) and (orientation: portrait)";
const isSheet = () => matchMedia(SHEET_Q).matches;
/** years before VIIRS come from the older MODIS satellite, converted: marked "*" as on the full page */
const EST = "* estimated from the older satellite";

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
interface Glance {
  k: string | null;
  d: CountrySummary | null;
  R: SeriesAnalysis | null;
  F: CountryForecast | null;
  S: CountryStations | null;
  fcMsg: string;
  stMsg: string;
  /** one year on the map, or null for every year */
  year: number | null;
  /** the clicked square (summary cell index), or -1 */
  sel: number;
  /** the copilot's places on the map */
  marks: MapMark[];
  // MapLibre's Map; typed loosely because the library's types are not installed
  map: any;
  ready: boolean;
  /** summary cell index by "lat_index|lon_index" */
  byKey: Map<string, number> | null;
  lon0: number;
  /** the colour classes for a single year, from every square's count in every year, so a colour means the same
      count whichever year the slider is on */
  yearScale: { breaks: number[]; max: number; min: number } | null;
  /** the states and provinces (provinces/v1), once here */
  P: ProvinceFile | null;
  pMsg: string;
  pMode: "all" | "ytd" | "watch";
  pSel: Province | null;
  pAll: boolean;
  /** the 5.5 km squares are drawn over the coarse ones */
  fineOn: boolean;
  /** the picked 5.5 km square, or null */
  fineSel: { la: number; lo: number } | null;
}
const G: Glance = {
  k: null,
  d: null,
  R: null,
  F: null,
  S: null,
  fcMsg: "",
  stMsg: "",
  year: null,
  sel: -1,
  marks: [],
  map: null,
  ready: false,
  byKey: null,
  lon0: 0,
  yearScale: null,
  P: null,
  pMsg: "",
  pMode: "all",
  pSel: null,
  pAll: false,
  fineOn: false,
  fineSel: null,
};
/** bumped whenever the view opens or closes: a map whose libraries arrive after that is not started */
let mapSeq = 0;

/* ---------- open and close ---------- */
export const glanceKey = () => G.k || null;
export function openGlance(k: string) {
  const el = $("glance");
  if (G.k === k) {
    el.hidden = false;
    G.map?.resize();
    return;
  }
  closeGlance();
  mapSeq++;
  G.k = k;
  G.year = null;
  G.sel = -1;
  G.marks = [];
  G.P = null;
  G.pSel = null;
  G.pAll = false;
  G.fineOn = false;
  G.fineSel = null;
  hovered = null;
  G.lon0 = shapeOf(k)?.c[0] ?? 0;
  el.hidden = false;
  $("gName").textContent = nameOf(k);
  $("gCrumb").textContent = "Country";
  $("gLead").textContent = `Fetching ${theName(nameOf(k))}'s record from Hugging Face…`;
  $("gRows").innerHTML = "";
  $("gPick").hidden = $("gNote").hidden = true;
  $("gBar").hidden = true;
  $("gRetry").hidden = true;
  $("gStates").hidden = k !== "United_States";
  $("gHint").textContent = "";
  $("gCard").scrollTop = 0;
  ($("gProvQ") as HTMLInputElement).value = "";
  requestAnimationFrame(() => el.classList.add("in"));
  trackSheet();
  startMap(k);
  load(k);
  loadProv(k);
}
export function closeGlance() {
  if (G.k === null) return;
  fineStop();
  mapSeq++;
  G.k = null;
  G.d = G.R = G.F = G.S = null;
  G.P = null;
  G.pSel = null;
  G.byKey = null;
  G.yearScale = null;
  G.ready = false;
  try {
    G.map?.remove();
  } catch {
    /* already gone */
  }
  G.map = null;
  $("gMap").innerHTML = "";
  const el = $("glance");
  el.classList.remove("in");
  el.hidden = true;
}

function load(k: string) {
  $("gRetry").hidden = true;
  loadSummary(k, (got, total) => {
    if (G.k !== k || G.d) return;
    const mb = (n: number) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
    $("gLead").textContent =
      `Fetching ${theName(nameOf(k))}'s record from Hugging Face… ${mb(got)}${total && got <= total ? ` of ${mb(total)}` : ""}`;
  })
    .then(d => {
      if (G.k !== k) return;
      G.d = d;
      G.byKey = new Map();
      const { la, lo } = cellIndexes(d);
      for (let c = 0; c < la.length; c++) G.byKey.set(la[c] + "|" + lo[c], c);
      G.lon0 = centreLon(d, lo);
      const one: number[] = [];
      for (let r = 2; r < d.cell_rows.length; r += 5) one.push(d.cell_rows[r]);
      G.yearScale = classBreaks(one);
      G.R = analyse(d);
      $("gName").textContent = d.name;
      setupYears(d);
      renderCard();
      drawCells(true);
      drawProv();
      extras(k);
    })
    .catch((e: unknown) => {
      if (G.k !== k) return;
      $("gLead").textContent = `${nameOf(k)}'s record did not arrive from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("gRetry").hidden = false;
    });
}
/** the forecast and the fire stations, after the summary, as on the full page */
function extras(k: string) {
  G.fcMsg = G.stMsg = "Loading…";
  fcLoad(k).then(
    F => {
      if (G.k !== k) return;
      G.F = F;
      renderCard();
    },
    () => {
      if (G.k !== k) return;
      G.fcMsg = "Did not load";
      renderCard();
    },
  );
  stLoad(k).then(
    S => {
      if (G.k !== k) return;
      G.S = S;
      renderCard();
    },
    () => {
      if (G.k !== k) return;
      G.stMsg = "Did not load";
      renderCard();
    },
  );
}
function analyse(d: CountrySummary) {
  const ep = epochs(d);
  return analyseSeries({
    T: d.monthly.T,
    A: d.monthly.A,
    V: d.monthly.V,
    y0: d.y0,
    yFrom: d.y0,
    yTo: d.y1,
    vi0: ep.vi0,
    nm: nMonths(d),
    partI: partOf(d)?.i ?? -1,
    partMed: sameDays(d)?.med ?? null,
    harm: harmFilled(d, ep),
  });
}

/* ---------- the card ---------- */
/** "2001–2025", or "2001–14 Nov 2026" */
function spanWords(d: CountrySummary) {
  const p = partOf(d);
  return p ? `${d.y0}–${p.day} ${MON[p.m]} ${p.y}` : `${d.y0}–${d.y1}`;
}
const yearWords = (d: CountrySummary, y: number | null) => {
  if (y == null) return spanWords(d);
  const p = partOf(d);
  return p && y === p.y ? `${y} to ${p.day} ${MON[p.m]}` : String(y);
};
/** 2026 so far against the same dates of past years, by rank as on the full page. "Busier" or "quieter" only when
    the rank is in the top or bottom third and the likely range clears the typical year. */
function soFarWords(t: YearToDate, unsure: boolean) {
  if (t.cur === 0 && t.med === 0) return `None so far in ${t.y}, as in a typical year to the same date.`;
  const busier = !unsure && t.rank <= t.n / 3 && t.lo > t.med,
    quieter = !unsure && t.rank > (2 * t.n) / 3 && t.hi < t.med;
  return (
    `${t.y} so far: ${nHot(t.cur)}, ${rankWords(t.rank, t.n)} for the same dates (typical ${fmt(t.med)})` +
    (busier ? ", busier than typical." : quieter ? ", quieter than typical." : ".")
  );
}
function renderCard() {
  const d = G.d,
    R = G.R;
  if (!d || !R) return;
  const name = theName(d.name),
    t2 = R.partYear ? ytdOf(d) : null,
    est = (y: number) => y < d.viirs_from[0];
  $("gCrumb").textContent = `Country · ${spanWords(d)}`;
  const top = R.order.slice(0, 3).filter(o => o.sum > 0),
    w = R.ranked[0];
  let lead: string;
  const jc = d.y2026?.join_check_2025;
  if (R.any === 0) lead = `No vegetation fire hotspots were counted in ${name}, ${spanWords(d)}.`;
  else {
    lead =
      R.total === 0
        ? `No vegetation fire hotspots were counted in ${name} in the complete years.`
        : `${cap(name)} burns most in ${MONL[R.order[0].m]}; its worst complete year was ${w.y}.`;
    /* where 2026's method is off against the archive, no "busier" or "quieter": only the rank and the warning */
    if (t2) lead += " " + soFarWords(t2, !!jc?.warn);
    /* the full page's warnings, word for word */
    if (t2 && jc?.warn)
      lead += ` Read ${t2.y} here with care: run on 2025, the method used for ${t2.y} came out ${Math.abs(jc.V_pct).toFixed(0)}% ${jc.V_pct > 0 ? "higher" : "lower"} than the archive.`;
    if (VOLCANIC.has(d.country))
      lead += " Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.";
  }
  $("gLead").textContent = lead;
  const rows: string[] = [];
  rows.push(row("Busiest months", top.length ? monthRun(top.map(o => o.m)) : "None"));
  rows.push(
    row(
      `Worst complete year${w && w.h > 0 && est(w.y) ? ` <small>${EST}</small>` : ""}`,
      w && w.h > 0 ? `${w.y}${est(w.y) ? "*" : ""} · ${short(w.h)}` : "None",
      w ? `${fmt(w.h)} hotspots in ${w.y}${est(w.y) ? ", estimated from the older MODIS satellite" : ""}` : "",
    ),
  );
  if (t2)
    rows.push(
      row(
        `${t2.y} so far <small>${t2.span}</small>`,
        `${short(t2.cur)} <small>typical ${short(t2.med)}</small>`,
        `${nHot(t2.cur)}${t2.hi - t2.lo >= 1 ? `, likely ${fmt(t2.lo)} to ${fmt(t2.hi)}` : ""}, ${rankWords(t2.rank, t2.n)} for the same dates`,
      ),
    );
  if (G.F) {
    const f = fcGlance(G.F, d);
    if (!f) rows.push(row("Forecast for 2026", "Nothing to forecast", "No fire on record from 2001 to 2025"));
    else {
      if (f.soFar) rows.push(row(f.soFar.label, f.soFar.value, f.soFar.title));
      rows.push(row(f.chance.label, f.chance.value, f.chance.title));
      if (f.vs) rows.push(row(`2026 against the forecast${f.vs.note ? ` <small>${f.vs.note}</small>` : ""}`, f.vs.value, f.vs.title));
    }
  } else rows.push(row("Forecast for 2026", G.fcMsg || "Loading…"));
  if (G.S) {
    const s = stGlance(G.S, d);
    rows.push(row("Fire stations mapped", s.stations, "Fire stations in OpenStreetMap"));
    rows.push(row("No station within 15 km", s.gaps, s.gapsTitle));
  } else rows.push(row("Fire stations", G.stMsg || "Loading…"));
  $("gRows").innerHTML = rows.join("");
  $("gHint").textContent =
    (matchMedia("(pointer: coarse)").matches ? "Tap" : "Click") + " a square for its numbers. Move the slider to see one year.";
  pickCard();
  noteCard();
}
/** the clicked square's numbers */
function pickCard() {
  const d = G.d,
    c = G.sel;
  if (d && G.fineSel) return fineCard(d, G.fineSel);
  if (!d || c < 0) {
    $("gPick").hidden = true;
    return;
  }
  const { la, lo } = cellIndexes(d),
    s = la[c] * d.cell,
    w = lo[c] * d.cell,
    p = partOf(d),
    full = p ? p.y - 1 : d.y1;
  let all = 0,
    inYear = 0,
    best = -1,
    bestN = 0,
    burned = 0,
    n26 = 0;
  for (let r = 0; r < d.cell_rows.length; r += 5) {
    if (d.cell_rows[r] !== c) continue;
    const y = d.y0 + d.cell_rows[r + 1],
      n = d.cell_rows[r + 2];
    all += n;
    if (G.year === y) inYear += n;
    if (y === 2026) n26 += n;
    if (y <= full) {
      if (n > 0) burned++;
      if (n > bestN) {
        bestN = n;
        best = y;
      }
    }
  }
  const rows: string[] = [];
  if (G.year != null) rows.push(row(`Hotspots, ${yearWords(d, G.year)}`, fmt(inYear)));
  rows.push(row(`Hotspots, ${spanWords(d)}`, fmt(all)));
  const est = best > 0 && best < d.viirs_from[0];
  if (best > 0) rows.push(row(`Worst year here${est ? ` <small>${EST}</small>` : ""}`, `${best}${est ? "*" : ""} · ${fmt(bestN)}`));
  rows.push(row("Years with fire", `${burned} of ${full - d.y0 + 1}`, `Complete years ${d.y0}–${full}`));
  /* the square's forecast only where the full page shows its map: enough squares, and not worse than a coin toss */
  const fc = G.F && fcCellOk(G.F, d, c) ? fcCell(G.F, c) : null,
    has26 = !!p && p.y === 2026;
  if (fc) {
    if (has26 && n26 > 0)
      rows.push(
        row(
          "2026 so far",
          `${nHot(n26)} <small>forecast gave it ${fcPc(fc.p)}</small>`,
          `Made before 2026 from 2001–2025, the forecast gave this square a ${fcPc(fc.p)} chance of a hotspot in 2026; fire came in ${fcPc(fc.share)} of 2001–2025.`,
        ),
      );
    else
      rows.push(
        row(
          `Forecast chance of fire in 2026 <small>made before 2026${has26 ? "; none so far" : ""}</small>`,
          fcPc(fc.p),
          `Fire came in ${fcPc(fc.share)} of 2001–2025.`,
        ),
      );
  }
  const st = G.S ? stCell(G.S, d, c) : null;
  if (st)
    rows.push(
      row(
        "Nearest mapped fire station",
        st.km ? `${st.km}${st.gap ? ' <span class="gGap">gap</span>' : ""}` : "None mapped",
        st.station
          ? `Nearest: ${st.station}${st.gap ? ". No station is mapped in OpenStreetMap within 15 km; that does not mean none exists." : ""}`
          : "",
      ),
    );
  const notes = [st?.note, st?.flag].filter(Boolean).join(" ");
  $("gPick").innerHTML =
    `<div class="gPickHead"><p class="eyebrow">Square you picked</p><button class="link" type="button" id="gPickX">Clear</button></div>` +
    `<h3>${deg(s + d.cell / 2, "N", "S")}, ${deg(w + d.cell / 2, "E", "W")}</h3>` +
    `<p class="hint">A ${d.cell}° square, about ${Math.round(d.cell * 111)} km across.${st?.steady ? " Its heat looks like flares or industry, not fire." : ""}</p>` +
    `<dl class="mini">${rows.join("")}</dl>` +
    (notes ? `<p class="hint">${esc(notes)}</p>` : "");
  $("gPick").hidden = false;
  $("gPickX").onclick = () => pick(-1);
}
/** what the copilot put on the map, with the hotspots of the squares inside its frame */
function noteCard() {
  const d = G.d,
    box = $("gNote");
  if (!G.marks.length) {
    box.hidden = true;
    return;
  }
  /* a solid swatch for a drawn outline, a dashed one for a frame, as on the map */
  const names = G.marks.map(
    (m, i) => `<span class="gTone${m.geometry ? " solid" : ""}" style="--t:${TONES[i % TONES.length]}"></span><b>${esc(m.name)}</b>`,
  );
  let sum = "";
  const one = G.marks.length === 1 ? G.marks[0] : null,
    b = one ? one.box : null;
  if (d && one && b) {
    const nb = boxNear(b),
      off = nb[0] - b[0],
      /* with an outline, count the squares whose middle is inside it, not every square in its box */
      rings = one.geometry ? ringsOf(one.geometry.coordinates) : [],
      { la, lo } = cellIndexes(d);
    let n = 0,
      k = 0;
    const inside = new Uint8Array(la.length);
    for (let c = 0; c < la.length; c++) {
      const y = (la[c] + 0.5) * d.cell,
        x = near((lo[c] + 0.5) * d.cell, G.lon0);
      if (x >= nb[0] && x <= nb[2] && y >= nb[1] && y <= nb[3] && (!rings.length || inRings(rings, x - off, y))) {
        inside[c] = 1;
        k++;
      }
    }
    for (let r = 0; r < d.cell_rows.length; r += 5) {
      if (!inside[d.cell_rows[r]]) continue;
      if (G.year != null && d.y0 + d.cell_rows[r + 1] !== G.year) continue;
      n += d.cell_rows[r + 2];
    }
    if (k)
      sum = `<p class="hint">${rings.length ? `Squares whose middle is in ${esc(one.name)}` : "Squares inside the frame"}: ${nHot(n)}, ${yearWords(d, G.year)}.</p>`;
  }
  /* a province from provinces/v1: its own count, and a way to its numbers */
  const pv = one ? resolved.get(one) : undefined;
  if (d && pv && G.P) {
    const v = G.year == null ? pv.total : (pv.per_year[G.year - G.P.y0] ?? 0);
    sum =
      `<p class="hint">${esc(pv.name)}: ${nHot(v)}, ${yearWords(d, G.year)}. Outline from ${outlineName(G.P)}.</p>` +
      `<button class="link" type="button" id="gNoteP">Show its numbers</button>`;
  }
  box.innerHTML =
    `<div class="gPickHead"><p class="eyebrow">From the copilot</p><button class="link" type="button" id="gNoteX">Clear</button></div>` +
    `<p class="gNames">${names.join(", ")}</p>${sum}`;
  box.hidden = false;
  $("gNoteX").onclick = () => glanceMarks([]);
  const np = document.getElementById("gNoteP");
  if (np && pv) np.onclick = () => selectProv(pv, false);
}

/* ---------- the year slider ---------- */
function setupYears(d: CountrySummary) {
  const r = $("gYear") as HTMLInputElement;
  r.min = String(d.y0);
  r.max = String(d.y1);
  r.value = String(d.y1);
  $("gBar").hidden = false;
  yearLabel();
}
function yearLabel() {
  const d = G.d;
  if (!d) return;
  $("gYearLabel").textContent = G.year == null ? `All years · ${spanWords(d)}` : yearWords(d, G.year);
  $("gAll").hidden = G.year == null;
  $("gBar").classList.toggle("all", G.year == null);
  ($("gYear") as HTMLInputElement).setAttribute("aria-valuetext", G.year == null ? "All years" : String(G.year));
}
function setYear(y: number | null) {
  if (y === G.year) return;
  G.year = y;
  yearLabel();
  drawCells(false);
  pickCard();
  noteCard();
  provCard();
  updateFine();
}

/* ---------- the map ---------- */
// the style JSON is loosely typed because MapLibre's types are not installed
function tidy(st: any) {
  st.layers = st.layers
    .filter((l: any) => !DROP.test(l.id))
    .map((l: any) => {
      if (l.layout && l.layout["text-field"] && /name/.test(JSON.stringify(l.layout["text-field"])))
        l.layout = { ...l.layout, "text-field": LATIN };
      /* place names in white over the bright squares, as on the New York and California map */
      if (l.type === "symbol" && /^place/.test(l.id))
        l.paint = { ...l.paint, "text-color": "#e4e9f1", "text-halo-color": "rgba(5,7,12,.88)", "text-halo-width": 1.4 };
      /* the dark style names icons its sprite does not have; the labels read fine without them */
      if (l.layout && l.layout["icon-image"]) {
        const { "icon-image": _icon, ...rest } = l.layout;
        l.layout = rest;
      }
      return l;
    });
  return st;
}
let styleP: Promise<unknown> | null = null;
function getStyle(): Promise<unknown> {
  if (!styleP)
    styleP = Promise.race([
      fetch(STYLE).then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000)),
    ]).then(tidy, () => {
      styleP = null;
      return FALLBACK;
    });
  return styleP;
}
/** the opening frame before the squares arrive: the outline's box, centred on the label point across the antimeridian */
function shapeBox(k: string): Box {
  const s = shapeOf(k);
  if (!s) return [-170, -60, 170, 75];
  const span = lonSpan(s);
  if (s.b[2] - s.b[0] <= span + 1) return s.b;
  return [s.c[0] - span / 2, s.b[1], s.c[0] + span / 2, s.b[3]];
}
/** room the card, the year bar, the back button and the copilot's button take from the map */
function padding() {
  /* the copilot's button rides on the sheet through --gSheet, which the observer sets only after this layout */
  syncSheet();
  const host = $("gMap"),
    W = host.clientWidth,
    H = host.clientHeight,
    card = $("gCard").getBoundingClientRect(),
    bar = $("gBar").hidden ? null : $("gBar").getBoundingClientRect(),
    launch = document.querySelector<HTMLElement>(".askLaunch"),
    /* (a fixed element has no offsetParent: a hidden launcher shows as an empty box instead) */
    lr = launch && !launch.hidden ? launch.getBoundingClientRect() : null;
  const p = isSheet()
    ? {
        top: Math.max(112, bar ? bar.bottom + 12 : 0),
        left: 16,
        right: 16,
        /* above the sheet, and above the copilot's button that sits on it */
        bottom: Math.min(H * 0.6, Math.max(0, H - Math.min(card.top, lr && lr.height ? lr.top : H))) + 12,
      }
    : { top: 76, left: 64, right: Math.max(16, W - card.left + 16), bottom: bar && bar.height ? Math.max(24, H - bar.top + 12) : 24 };
  /* never ask for more room than the map has */
  if (p.left + p.right > W - 80) p.left = p.right = 16;
  if (p.top + p.bottom > H - 80) p.bottom = Math.max(16, H - 80 - p.top);
  return p;
}
function startMap(k: string) {
  const seq = mapSeq;
  Promise.all([loadMapLib(), getStyle()]).then(
    ([, style]) => {
      /* the reader left and came back while the libraries loaded: only the newest opening starts a map */
      if (G.k !== k || seq !== mapSeq || G.map) return;
      const ml = window.maplibregl,
        host = $("gMap"),
        b = shapeBox(k);
      let map: any;
      try {
        map = new ml.Map({
          container: host,
          style,
          bounds: [b.slice(0, 2), b.slice(2)],
          fitBoundsOptions: { padding: padding() },
          maxZoom: 10,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
          fadeDuration: 0,
        });
      } catch {
        $("gMap").innerHTML = `<p class="gMapMsg">This browser could not start the map (WebGL is off). The card still has the numbers.</p>`;
        return;
      }
      G.map = map;
      (host as HTMLElement & { _map?: unknown })._map = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      let swapped = style === FALLBACK;
      map.on("error", () => {
        setTimeout(() => {
          if (swapped || G.ready || G.map !== map) return;
          swapped = true;
          map.setStyle(FALLBACK);
        }, 4000);
      });
      map.on("style.load", () => {
        if (G.map !== map || G.ready) return;
        layers(map);
      });
    },
    () => {
      if (G.k === k && seq === mapSeq)
        $("gMap").innerHTML = `<p class="gMapMsg">The map did not load (cdnjs did not answer). The card still has the numbers.</p>`;
    },
  );
}
const EMPTY = { type: "FeatureCollection", features: [] as Feature[] };
function layers(map: any) {
  const under = map.getLayer("boundary_state") ? "boundary_state" : undefined,
    labels = map.getLayer("place_other") ? "place_other" : undefined;
  map.addSource("cells", { type: "geojson", data: EMPTY, tolerance: 0, buffer: 2, generateId: true });
  map.addSource("outline", { type: "geojson", data: EMPTY });
  map.addSource("sel", { type: "geojson", data: EMPTY });
  map.addSource("ask", { type: "geojson", data: EMPTY });
  map.addSource("prov", { type: "geojson", data: EMPTY, tolerance: 0.2 });
  map.addSource("fine", { type: "geojson", data: EMPTY, tolerance: 0, buffer: 2 });
  map.addLayer(
    { id: "cells", type: "fill", source: "cells", paint: { "fill-color": RAMP[3], "fill-opacity": 0.92, "fill-antialias": false } },
    under,
  );
  map.addLayer(
    {
      id: "cells-edge",
      type: "line",
      source: "cells",
      /* a hairline that closes the seams between squares without bleeding into the next one */
      paint: { "line-color": RAMP[3], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 7, 0.5, 9, 0] },
    },
    under,
  );
  /* the 5.5 km squares over the coarse ones, which fade while these show */
  map.addLayer(
    { id: "fine", type: "fill", source: "fine", paint: { "fill-color": RAMP[3], "fill-opacity": 0.95, "fill-antialias": false } },
    under,
  );
  /* the provinces: an invisible fill to find the one under the pointer, a faint line, bright on hover or pick */
  map.addLayer(
    {
      id: "prov-fill",
      type: "fill",
      source: "prov",
      paint: {
        "fill-color": "#dfe6f2",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "sel"], false],
          0.07,
          ["boolean", ["feature-state", "hover"], false],
          0.05,
          0,
        ],
      },
    },
    labels,
  );
  map.addLayer(
    {
      id: "prov-line",
      type: "line",
      source: "prov",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#ffffff", "#c9d3e3"],
        "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.4, ["boolean", ["feature-state", "hover"], false], 1.6, 0.7],
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "sel"], false],
          1,
          ["boolean", ["feature-state", "hover"], false],
          0.85,
          0.3,
        ],
      },
    },
    labels,
  );
  map.addLayer(
    {
      id: "cells-hover",
      type: "line",
      source: "cells",
      paint: { "line-color": "#fff", "line-width": 1.2, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0] },
    },
    labels,
  );
  map.addLayer(
    { id: "outline", type: "line", source: "outline", paint: { "line-color": "#dfe6f2", "line-width": 1.1, "line-opacity": 0.7 } },
    labels,
  );
  map.addLayer(
    {
      id: "sel",
      type: "line",
      source: "sel",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#fff", "line-width": 2.5 },
    },
    labels,
  );
  /* a ring round the picked square, so a small square is easy to find at country zoom */
  map.addLayer(
    {
      id: "sel-ring",
      type: "circle",
      source: "sel",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    },
    labels,
  );
  const isFrame = (v: number) => ["==", ["get", "frame"], v];
  map.addLayer(
    { id: "ask-fill", type: "fill", source: "ask", filter: isFrame(0), paint: { "fill-color": ["get", "tone"], "fill-opacity": 0.12 } },
    labels,
  );
  map.addLayer(
    { id: "ask-line", type: "line", source: "ask", filter: isFrame(0), paint: { "line-color": ["get", "tone"], "line-width": 2.4 } },
    labels,
  );
  map.addLayer(
    {
      id: "ask-frame",
      type: "line",
      source: "ask",
      filter: isFrame(1),
      paint: { "line-color": ["get", "tone"], "line-width": 2.2, "line-dasharray": [3, 2] },
    },
    labels,
  );
  G.ready = true;
  const host = map.getContainer() as HTMLElement,
    fold = () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  fold();
  map.once("idle", fold);
  let hover: number | null = null;
  const clear = () => {
    if (hover != null) map.setFeatureState({ source: "cells", id: hover }, { hover: false });
    hover = null;
  };
  map.on("mousemove", "cells", (e: { features?: { id: number }[] }) => {
    const f = e.features && e.features[0];
    if (!f || f.id === hover) return;
    clear();
    hover = f.id;
    map.setFeatureState({ source: "cells", id: f.id }, { hover: true });
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "cells", () => {
    clear();
    map.getCanvas().style.cursor = "";
  });
  let provHover: number | null = null;
  map.on("mousemove", (e: { point: unknown }) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ["prov-fill"] })[0],
      id = f ? (f.id as number) : null;
    if (id === provHover) return;
    hoverProv(id);
    provHover = id;
  });
  map.on("mouseout", () => {
    hoverProv(null);
    provHover = null;
  });
  map.on("click", (e: { point: unknown }) => {
    if (!G.d) return;
    /* a 5.5 km square when they show, else a coarse square, else the province under the click */
    const ff = G.fineOn ? map.queryRenderedFeatures(e.point, { layers: ["fine"] })[0] : null;
    if (ff) {
      const q = ff.properties as { la: number; lo: number },
        same = G.fineSel && G.fineSel.la === q.la && G.fineSel.lo === q.lo;
      return pickFine(same ? null : { la: q.la, lo: q.lo });
    }
    const f = G.fineOn ? null : map.queryRenderedFeatures(e.point, { layers: ["cells"] })[0];
    if (f && G.byKey) {
      const p = f.properties as { s: number; w: number },
        c = G.byKey.get(Math.round(p.s / G.d.cell) + "|" + Math.round(p.w / G.d.cell));
      if (c != null) return pick(c === G.sel ? -1 : c);
    }
    const pf = map.queryRenderedFeatures(e.point, { layers: ["prov-fill"] })[0],
      pv = pf && G.P ? G.P.provinces[pf.id as number] : null;
    if (pv) selectProv(pv === G.pSel ? null : pv, false);
  });
  map.on("moveend", updateFine);
  drawCells(true);
  drawMarks();
  drawProv();
}
/** the squares for the chosen years; `frame` fits the map to the fire the first time */
function drawCells(frame: boolean) {
  const d = G.d;
  if (!d) return;
  const data = mapData(d, G.year ?? d.y0, G.year ?? d.y1),
    /* one year: the same classes for every year; all years: their own */
    sc = G.year != null && G.yearScale ? G.yearScale : data,
    cols = classColours(sc.breaks, RAMP);
  if (!G.fineOn) legend(sc.breaks, sc.max, cols, data.n);
  if (!G.ready || !G.map) return;
  const map = G.map,
    fill = sc.breaks.length ? ["step", ["get", "n"], cols[0], ...sc.breaks.flatMap((b, i) => [b, cols[i + 1]])] : cols[0];
  map.getSource("cells").setData(data.cells);
  map.getSource("outline").setData(data.outline);
  map.setPaintProperty("cells", "fill-color", fill);
  map.setPaintProperty("cells-edge", "line-color", fill);
  if (frame && !G.marks.length) {
    const b = G.year == null ? data.bounds : mapData(d, d.y0, d.y1).bounds;
    map.fitBounds([b.slice(0, 2), b.slice(2)], { padding: padding(), duration: 700 });
  }
}
/** a stepped key like the full page's: one swatch per class, the class edges written under the joins */
function legend(breaks: number[], max: number, cols: string[], n: number, title = "") {
  if (!n) {
    $("gLeg").innerHTML = `<span class="gLegT">No hotspots ${G.year == null ? "in these years" : "this year"}</span>`;
    return;
  }
  const steps = breaks.length
    ? cols
        .map((c, i) => `<span class="gStep"><i style="background:${c}"></i><small>${i ? short(breaks[i - 1]) : ""}</small></span>`)
        .join("") + `<span class="gStep gEnd"><i></i><small>${short(max)}</small></span>`
    : `<span class="gStep"><i style="background:${cols[0]}"></i><small>${short(max)}</small></span>`;
  $("gLeg").innerHTML =
    `<span class="gLegT">${title || (G.year == null ? "Hotspots per square, all years" : "Hotspots per square in a year, same scale for every year")}</span>` +
    `<span class="gKey">${steps}</span>`;
}
function pick(c: number) {
  G.sel = c;
  G.fineSel = null;
  pickCard();
  if (c >= 0) $("gPick").scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!G.ready || !G.map || !G.d) return;
  const d = G.d,
    feats: Feature[] = [];
  if (c >= 0) {
    const { la, lo } = cellIndexes(d),
      s = la[c] * d.cell,
      w = near(lo[c] * d.cell + d.cell / 2, G.lon0) - d.cell / 2,
      e = w + d.cell,
      n = s + d.cell;
    feats.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      },
    });
    feats.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [w + d.cell / 2, s + d.cell / 2] } });
  }
  G.map.getSource("sel").setData({ type: "FeatureCollection", features: feats });
}

/* ---------- what the fire copilot (copilot.ts) reads from and draws on this map ---------- */
const r2 = (x: number) => Math.round(x * 100) / 100;
const boxNear = (b: Box): Box => {
  const off = near((b[0] + b[2]) / 2, G.lon0) - (b[0] + b[2]) / 2;
  return [b[0] + off, b[1], b[2] + off, b[3]];
};
function shiftCoords(c: unknown, off: number): unknown {
  if (!Array.isArray(c)) return c;
  if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0] + off, c[1], ...c.slice(2)];
  return c.map(x => shiftCoords(x, off));
}
/** every ring of a Polygon or MultiPolygon's coordinates */
function ringsOf(c: unknown, out: number[][][] = []): number[][][] {
  if (!Array.isArray(c) || !c.length) return out;
  if (Array.isArray(c[0]) && typeof c[0][0] === "number") out.push(c as number[][]);
  else for (const x of c) ringsOf(x, out);
  return out;
}
/** even-odd over all the rings, so holes and separate parts both count right */
function inRings(rings: number[][][], x: number, y: number) {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i],
        [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
/** the FIRMS name of the country on this map, once the map and its squares are ready */
export const glanceCountry = () => (G.k && G.ready && G.d ? G.k : null);
export function glanceView(): MapView | null {
  if (!glanceCountry()) return null;
  const m = G.map,
    c = m.getCenter(),
    b = m.getBounds(),
    shift = near(c.lng, 0) - c.lng;
  return {
    lat: r2(c.lat),
    lon: r2(c.lng + shift),
    zoom: r2(m.getZoom()),
    bbox: [
      r2(Math.max(-180, b.getWest() + shift)),
      r2(Math.max(-85, b.getSouth())),
      r2(Math.min(180, b.getEast() + shift)),
      r2(Math.min(85, b.getNorth())),
    ],
  };
}
/** frame a box, clear of the card and of anything else floating over the map (`pad`, the copilot window) */
export function glanceFocus(b: Box, pad: { right: number; bottom: number }, maxZoom = 9) {
  if (!glanceCountry()) return false;
  const nb = boxNear(b),
    p = padding(),
    host = $("gMap"),
    W = host.clientWidth,
    H = host.clientHeight;
  /* a window over most of the map (the copilot on a phone) is closed before the map is seen: leave it out */
  if (pad.right < W / 2) p.right = Math.max(p.right, pad.right + 24);
  if (pad.bottom < H / 2) p.bottom = Math.max(p.bottom, pad.bottom + 24);
  if (p.left + p.right > W - 60) p.left = p.right = 12;
  if (p.top + p.bottom > H - 60) {
    p.top = 12;
    p.bottom = Math.max(12, H - 72);
  }
  G.map.fitBounds([nb.slice(0, 2), nb.slice(2)], { padding: p, duration: 900, maxZoom });
  return true;
}
/** draw the copilot's places (an empty list clears them) and name them in the card */
export function glanceMarks(marks: MapMark[]) {
  if (!G.k) return false;
  G.marks = marks;
  resolveMarks();
  noteCard();
  if (!G.ready) return false;
  drawMarks();
  if (marks.length) $("gNote").scrollIntoView({ block: "nearest" });
  return true;
}
function drawMarks() {
  if (!G.ready || !G.map) return;
  const off = (b: Box) => near((b[0] + b[2]) / 2, G.lon0) - (b[0] + b[2]) / 2;
  const features = G.marks.flatMap((mk, i): Feature[] => {
    const tone = TONES[i % TONES.length];
    if (mk.geometry)
      return [
        {
          type: "Feature",
          properties: { name: mk.name, tone, frame: 0 },
          geometry: {
            type: mk.geometry.type,
            coordinates: mk.box ? shiftCoords(mk.geometry.coordinates, off(mk.box)) : mk.geometry.coordinates,
          },
        },
      ];
    if (!mk.box) return [];
    const [w, s, e, n] = boxNear(mk.box);
    return [
      {
        type: "Feature",
        properties: { name: mk.name, tone, frame: 1 },
        geometry: {
          type: "LineString",
          coordinates: [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        },
      },
    ];
  });
  try {
    G.map.getSource("ask").setData({ type: "FeatureCollection", features });
  } catch {
    /* a malformed shape from the agent: draw nothing rather than break the map */
    G.map.getSource("ask").setData(EMPTY);
  }
}

/* ---------- states and provinces (prov.ts): a ranked list in the card, outlines on the map ---------- */
const TOP = 8;
/** whole numbers up to 10,000, then 12k or 1.2M */
const num = (v: number) => (Math.abs(v) >= 1e4 ? short(v) : fmt(v));
function loadProv(k: string) {
  G.pMsg = "Loading…";
  provCard();
  loadProvinces(k).then(
    P => {
      if (G.k !== k) return;
      G.P = P;
      provCard();
      drawProv();
      resolveMarks();
    },
    () => {
      if (G.k !== k) return;
      G.pMsg = "Did not load";
      provCard();
    },
  );
}
/** what a province is ranked by in the list, in the mode chosen */
function provValue(p: Province) {
  const P = G.P!;
  if (G.pMode === "ytd") return soFar(P, p).cur;
  if (G.pMode === "watch") return p.watch[frameOf(P).next];
  return G.year == null ? p.total : (p.per_year[G.year - P.y0] ?? 0);
}
const LEVEL_WORD = { high: "High", elevated: "Elevated", low: "Low" };
/** who drew the outlines (geoBoundaries asks for credit), and a line when the units are out of date */
function provSource(P: ProvinceFile | null) {
  const old = $("gProvOld"),
    note = P?.boundaries?.outdated ? P.boundaries.note : null;
  old.textContent = note ?? "";
  old.hidden = !note;
  $("gProvSrc").textContent = P ? `${outlineCredit(P)} Usual is the median of the same months, ${P.y0}–${frameOf(P).yb}.` : "";
}
function provCard() {
  const box = $("gProv"),
    P = G.P;
  if (!P) {
    box.hidden = !G.k;
    $("gProvBody").innerHTML =
      `<p class="hint">${G.pMsg === "Did not load" ? "The states and provinces did not load from Hugging Face." : "Loading the states and provinces…"}</p>`;
    $("gProvSel").hidden = true;
    provSource(null);
    return;
  }
  box.hidden = false;
  provSource(P);
  const fr = frameOf(P),
    many = P.provinces.length > 1 && P.provinces.some(p => p.total > 0);
  ($("gProvTools") as HTMLElement).hidden = !many;
  if (!many) {
    const n = P.provinces.length;
    $("gProvBody").innerHTML = `<p class="hint">${
      P.provinces.some(p => p.total > 0)
        ? `${outlineName(P)} has one division here, ${esc(P.provinces[0].name)}, so there is nothing to rank.`
        : `No hotspots were counted in any of its ${n === 1 ? "one division" : `${n} divisions`}, ${P.y0} to ${lastWords(P)}.`
    }</p>`;
    provSelCard();
    return;
  }
  document.querySelectorAll<HTMLButtonElement>("#gProvMode button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.m === G.pMode));
    if (b.dataset.m === "ytd") b.textContent = `${fr.cy} so far`;
  });
  const nextName = MONL[fr.next],
    wy = P.watch_years[fr.next];
  $("gProvWhat").textContent =
    G.pMode === "ytd"
      ? `${fr.cy}, January to ${MONL[fr.cm - 1]}, against the usual for those months (median of ${P.y0}–${fr.yb}).${P.partial ? ` ${MONL[P.partial.m - 1]} so far is not in it.` : ""}`
      : G.pMode === "watch"
        ? `Where to watch in ${nextName}: hotspots to expect, from ${nextName} in ${wy ? `${wy[0]}–${wy[1]}` : "the last ten years"} (a weighted median).`
        : G.year == null
          ? `Hotspots, ${P.y0} to ${lastWords(P)}.`
          : `Hotspots in ${yearWords(G.d ?? ({ y0: P.y0, y1: fr.cy } as CountrySummary), G.year)} (the year on the slider).`;
  const q = ($("gProvQ") as HTMLInputElement).value.trim();
  let list: Province[];
  if (q) list = searchProvinces(P, q, TOP);
  else {
    list = [...P.provinces].sort((a, b) => provValue(b) - provValue(a) || a.name.localeCompare(b.name));
    if (!G.pAll) list = list.slice(0, TOP);
  }
  const lv = G.pMode === "watch" ? levels(P.provinces, fr.next) : null,
    top = Math.max(...P.provinces.map(provValue), 0);
  const rows = list.map(p => {
    const v = provValue(p),
      i = P.provinces.indexOf(p),
      extra =
        G.pMode === "ytd"
          ? ` <small>usual ${num(soFar(P, p).usual)}</small>`
          : lv
            ? ` <small class="gLv ${lv.get(p)}">${LEVEL_WORD[lv.get(p) ?? "low"]}</small>`
            : "";
    return (
      `<li><button type="button" class="gProvRow${p === G.pSel ? " on" : ""}" data-i="${i}">` +
      `<span class="gProvN">${esc(p.name)}</span><span class="gProvV">${G.pMode === "watch" ? "about " : ""}${num(v)}${extra}</span>` +
      `<i style="width:${top > 0 ? Math.max(0, Math.min(100, (100 * v) / top)).toFixed(1) : 0}%"></i></button></li>`
    );
  });
  const allBtn =
    !q && many && P.provinces.length > TOP
      ? `<button class="link" type="button" id="gProvAll">${G.pAll ? "Show the top " + TOP : `Show all ${P.provinces.length}`}</button>`
      : "";
  $("gProvBody").innerHTML =
    (rows.length ? `<ol class="gProvList">${rows.join("")}</ol>` : `<p class="hint">${q ? "No state or province by that name." : ""}</p>`) +
    allBtn;
  $("gProvBody")
    .querySelectorAll<HTMLButtonElement>(".gProvRow")
    .forEach(b => {
      const p = P.provinces[+b.dataset.i!];
      b.onclick = () => selectProv(p === G.pSel ? null : p, true);
      b.onmouseenter = () => hoverProv(+b.dataset.i!);
      b.onmouseleave = () => hoverProv(null);
    });
  const ab = document.getElementById("gProvAll");
  if (ab)
    ab.onclick = () => {
      G.pAll = !G.pAll;
      provCard();
    };
  provSelCard();
}
const lastWords = (P: ProvinceFile) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(P.last_date);
  return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : P.last_date;
};
/** the picked province's own numbers */
function provSelCard() {
  const P = G.P,
    p = G.pSel,
    box = $("gProvSel");
  if (!P || !p) {
    box.hidden = true;
    return;
  }
  const fr = frameOf(P),
    sf = soFar(P, p),
    bm = busiestMonth(P, p),
    wy = worstYear(P, p),
    est = (y: number) => y < (G.d ? G.d.viirs_from[0] : 2012),
    nov = P.partial ? (p.monthly[P.partial.i] ?? 0) : null,
    nx = fr.next,
    lv = levels(P.provinces, nx).get(p) ?? "low";
  const rows: string[] = [];
  rows.push(
    row(
      `${sf.y} so far <small>January to ${MONL[sf.months - 1]}</small>`,
      `${num(sf.cur)} <small>usual ${num(sf.usual)}</small>`,
      `${nHot(sf.cur)}; usual is the median of the same months in ${P.y0}–${fr.yb}`,
    ),
  );
  if (nov != null && P.partial)
    rows.push(
      row(
        `${MONL[P.partial.m - 1]} ${P.partial.y} <small>${P.partial.day0}–${P.partial.day1} ${MON[P.partial.m - 1]}, not complete</small>`,
        `${num(nov)} <small>usual whole month ${num(p.usual[P.partial.m - 1])}</small>`,
      ),
    );
  rows.push(row("Busiest month", bm.sum > 0 ? MONL[bm.m] : "None", `Most hotspots over ${P.y0}–${fr.yb}`));
  rows.push(
    row(
      `Worst complete year${wy.y > 0 && est(wy.y) ? ` <small>${EST}</small>` : ""}`,
      wy.y > 0 ? `${wy.y}${est(wy.y) ? "*" : ""} · ${num(wy.v)}` : "None",
    ),
  );
  rows.push(
    row(
      `Where to watch in ${MONL[nx]}`,
      `about ${num(p.watch[nx])} <small class="gLv ${lv}">${LEVEL_WORD[lv]}</small>`,
      `Weighted median of ${MONL[nx]} in recent years; the level compares it with the other provinces`,
    ),
  );
  rows.push(row(`Hotspots, ${P.y0}–${lastWords(P)}`, num(p.total), nHot(p.total)));
  const kind = [p.type, p.region]
    .filter(Boolean)
    .map(t => esc(String(t)))
    .join(" · ");
  box.innerHTML =
    `<div class="gPickHead"><p class="eyebrow">${kind || "Province"}</p><button class="link" type="button" id="gProvX">Clear</button></div>` +
    `<h3>${esc(p.name)}</h3>` +
    `<dl class="mini">${rows.join("")}</dl>` +
    `<p class="hint">About ${fmt(p.area_km2)} km². Each 5.5 km square counts for the province that holds its middle. Outline: ${outlineName(P)}.</p>`;
  box.hidden = false;
  $("gProvX").onclick = () => selectProv(null, false);
}
/** pick a province: outline it, show its numbers, and (from the list) fit the map to it */
function selectProv(p: Province | null, fit: boolean) {
  const P = G.P;
  if (G.map && G.ready && P) {
    if (G.pSel) G.map.setFeatureState({ source: "prov", id: P.provinces.indexOf(G.pSel) }, { sel: false });
    if (p) G.map.setFeatureState({ source: "prov", id: P.provinces.indexOf(p) }, { sel: true });
  }
  G.pSel = p;
  provCard();
  if (p) $("gProvSel").scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (p && fit && G.map && G.ready) {
    const b = shapeNear(p, G.lon0).box;
    G.map.fitBounds([b.slice(0, 2), b.slice(2)], { padding: padding(), duration: 800, maxZoom: 9 });
  }
}
let hovered: number | null = null;
function hoverProv(i: number | null) {
  if (!G.map || !G.ready) return;
  if (hovered != null) G.map.setFeatureState({ source: "prov", id: hovered }, { hover: false });
  hovered = i;
  if (i != null) G.map.setFeatureState({ source: "prov", id: i }, { hover: true });
}
function drawProv() {
  if (!G.ready || !G.map || !G.P) return;
  const features = G.P.provinces.map((p, i) => ({
    type: "Feature",
    id: i,
    properties: { name: p.name },
    geometry: shapeNear(p, G.lon0).geometry,
  }));
  G.map.getSource("prov").setData({ type: "FeatureCollection", features });
  if (G.pSel) G.map.setFeatureState({ source: "prov", id: G.P.provinces.indexOf(G.pSel) }, { sel: true });
}
/** the copilot named a province or district: draw its outline from provinces/v1 (the one the card counts with)
    instead of a dashed box or the agent's own shape, when the name matches one near the place */
const resolved = new WeakMap<MapMark, Province>();
function resolveMarks() {
  const P = G.P;
  if (!P || !G.marks.length) return;
  let changed = false;
  G.marks = G.marks.map(mk => {
    if (!mk.box || resolved.has(mk)) return mk;
    const hit = provinceOfMark(P, mk.name, mk.box, G.lon0);
    if (!hit) return mk;
    changed = true;
    const out = { ...mk, geometry: hit.geometry, box: hit.box };
    resolved.set(out, hit.p);
    return out;
  });
  if (!changed) return;
  noteCard();
  drawMarks();
}

/* ---------- squares of about 5.5 km (fine.ts), once zoomed in ---------- */
const FINE_Z = 6.5;
let fineTimer = 0;
function viewBox(): Box {
  const b = G.map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}
function updateFine() {
  if (!G.map || !G.ready || !G.d || !G.k) return;
  if (G.map.getZoom() < FINE_Z) {
    fineStop();
    if (G.fineOn) fineOff();
    return;
  }
  const k = G.k;
  wantFine(k, viewBox(), G.lon0, () => {
    if (G.k !== k) return;
    clearTimeout(fineTimer);
    fineTimer = window.setTimeout(drawFine, 150);
  }).catch(() => {});
  drawFine();
}
function fineOff() {
  fineStop();
  G.fineOn = false;
  if (G.fineSel) {
    G.fineSel = null;
    pickCard();
    G.map.getSource("sel").setData(EMPTY);
  }
  G.map.getSource("fine").setData(EMPTY);
  G.map.setPaintProperty("cells", "fill-opacity", 0.92);
  G.map.setPaintProperty("cells-edge", "line-opacity", 1);
  drawCells(false);
}
/** the 5.5 km classes, from the first 2,000 or more squares to arrive and then kept, so a colour means the same count while the
    reader pans; one year uses every square's every year, so the scale is the same for each year */
const fineScales = new Map<string, { breaks: number[]; max: number }>();
function fineScale() {
  const key = `${G.k}|${G.year == null ? "all" : "year"}`;
  let b = fineScales.get(key);
  if (!b) {
    const vals = fineValues(G.k!, G.year != null);
    if (!vals.length) return { breaks: [], max: 0 };
    b = classBreaks(vals);
    /* keep the classes only once enough squares are here, so one small edge file does not set them for the visit */
    if (vals.length >= 2000) fineScales.set(key, b);
  }
  return b;
}
function drawFine() {
  if (!G.map || !G.ready || !G.d || !G.k || G.map.getZoom() < FINE_Z) return;
  const data = fineFeatures(G.k, viewBox(), G.lon0, G.year);
  if (!data.features.length && !G.fineOn) return;
  const { breaks, max } = fineScale(),
    cols = classColours(breaks, RAMP),
    fill = breaks.length ? ["step", ["get", "n"], cols[0], ...breaks.flatMap((b, i) => [b, cols[i + 1]])] : cols[0];
  G.map.getSource("fine").setData(data);
  G.map.setPaintProperty("fine", "fill-color", fill);
  if (!G.fineOn) {
    G.fineOn = true;
    G.map.setPaintProperty("cells", "fill-opacity", 0.14);
    G.map.setPaintProperty("cells-edge", "line-opacity", 0);
  }
  legend(
    breaks,
    Math.max(max, data.max),
    cols,
    data.features.length || 1,
    `Squares of about 5.5 km: hotspots per square, ${G.year == null ? "all years" : yearWords(G.d, G.year)}`,
  );
}
function pickFine(q: { la: number; lo: number } | null) {
  G.fineSel = q;
  G.sel = -1;
  pickCard();
  if (q) $("gPick").scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!G.map || !G.ready) return;
  const feats: Feature[] = [];
  if (q) {
    const c = FINE_CELL,
      s = q.la * c,
      w = near(q.lo * c + c / 2, G.lon0) - c / 2;
    feats.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [w, s],
          [w + c, s],
          [w + c, s + c],
          [w, s + c],
          [w, s],
        ],
      },
    });
    feats.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [w + c / 2, s + c / 2] } });
  }
  G.map.getSource("sel").setData({ type: "FeatureCollection", features: feats });
}
function fineCard(d: CountrySummary, q: { la: number; lo: number }) {
  const v = G.k ? fineCell(G.k, q.la, q.lo) : null;
  if (!v) {
    $("gPick").hidden = true;
    return;
  }
  const p = partOf(d),
    full = p ? p.y - 1 : d.y1,
    rows: string[] = [];
  let best = -1,
    bestN = 0,
    burned = 0;
  v.years.forEach((n, i) => {
    const y = v.y0 + i;
    if (y > full) return;
    if (n > 0) burned++;
    if (n > bestN) {
      bestN = n;
      best = y;
    }
  });
  if (G.year != null) rows.push(row(`Hotspots, ${yearWords(d, G.year)}`, fmt(v.years[G.year - v.y0] ?? 0)));
  rows.push(row(`Hotspots, ${spanWords(d)}`, fmt(v.total)));
  const est = best > 0 && best < d.viirs_from[0];
  if (best > 0) rows.push(row(`Worst year here${est ? ` <small>${EST}</small>` : ""}`, `${best}${est ? "*" : ""} · ${fmt(bestN)}`));
  rows.push(row("Years with fire", `${burned} of ${full - v.y0 + 1}`, `Complete years ${v.y0}–${full}`));
  const c = FINE_CELL;
  $("gPick").innerHTML =
    `<div class="gPickHead"><p class="eyebrow">Square you picked</p><button class="link" type="button" id="gPickX">Clear</button></div>` +
    `<h3>${deg((q.la + 0.5) * c, "N", "S")}, ${deg(near((q.lo + 0.5) * c, 0), "E", "W")}</h3>` +
    `<p class="hint">A ${c}° square, about 5.5 km across.</p>` +
    `<dl class="mini">${rows.join("")}</dl>`;
  $("gPick").hidden = false;
  $("gPickX").onclick = () => pickFine(null);
}

/* ---------- phones: the card is a bottom sheet; the copilot's button sits above it ---------- */
let sheetObs: ResizeObserver | null = null;
function syncSheet() {
  const r = $("gCard").getBoundingClientRect();
  document.body.style.setProperty("--gSheet", isSheet() && !$("glance").hidden ? Math.round(innerHeight - r.top) + "px" : "0px");
}
function trackSheet() {
  if (sheetObs || typeof ResizeObserver === "undefined") return;
  sheetObs = new ResizeObserver(syncSheet);
  sheetObs.observe($("gCard"));
  addEventListener("resize", syncSheet);
  syncSheet();
}

/** the address before this one, so the way back up is the browser's Back when that is where the reader came from */
let prevHash: string | null = null;
export function glanceEvents() {
  addEventListener("hashchange", e => {
    try {
      prevHash = new URL(e.oldURL).hash;
    } catch {
      prevHash = null;
    }
  });
  /* "up" to the page the reader just came from is Back, so Back afterwards does not return them here */
  const up = (to: string) => {
    if (prevHash === to) history.back();
    else location.hash = to;
  };
  $("gBack").onclick = () => up("");
  $("gOpen").onclick = () => {
    if (G.k) location.hash = "#c/" + slugOf(G.k);
  };
  $("gRetry").onclick = () => {
    if (G.k) load(G.k);
  };
  $("gAll").onclick = () => setYear(null);
  document.querySelectorAll<HTMLButtonElement>("#gProvMode button").forEach(b => {
    b.onclick = () => {
      G.pMode = b.dataset.m as Glance["pMode"];
      provCard();
    };
  });
  const pq = $("gProvQ") as HTMLInputElement;
  pq.oninput = () => provCard();
  pq.onkeydown = e => {
    if (e.key !== "Enter" || !G.P) return;
    const first = searchProvinces(G.P, pq.value, 1)[0];
    if (first) selectProv(first, true);
  };
  const r = $("gYear") as HTMLInputElement;
  let raf = 0;
  r.oninput = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setYear(+r.value));
  };
  /* in "All years" the handle rests on the last year: a click or a key on it picks that year, which input never says */
  r.addEventListener("pointerup", () => {
    if (G.year == null) setYear(+r.value);
  });
  r.addEventListener("keydown", e => {
    if (G.year == null && ["Enter", " ", "ArrowRight", "ArrowUp", "End"].includes(e.key) && r.value === r.max) setYear(+r.value);
  });
  document.querySelectorAll<HTMLButtonElement>("#gStates button").forEach(b => {
    const st = b.dataset.st as keyof typeof SLUG;
    b.textContent = NAME[st];
    b.onclick = () => {
      location.hash = SLUG[st];
    };
  });
  /* the full record's way back up to this view */
  const cUp = document.getElementById("cUp");
  if (cUp)
    cUp.onclick = () => {
      const m = /^#c\/(.+)$/.exec(location.hash);
      if (m) up("#g/" + m[1]);
    };
  addEventListener("resize", () => G.map?.resize());
}
