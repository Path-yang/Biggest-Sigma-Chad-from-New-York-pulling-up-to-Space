import type { CountrySummary } from "./types";
import { MONL } from "./data";
import { $, fmt } from "./util";
import { HF_DATASET, HF_PAGE, fileUrl, isNums, isObj, loadChecked, stationsPath } from "./hf";
import { theName } from "./world";
import { cellCentre, drawMini, type MiniLayer, type MiniMark } from "./minimap";

/* =====================================================================
   "FIRE STATIONS" ON THE COUNTRY PAGE: stations/v2/<Country>.json (scripts/build_world_stations.py). How many fire
   stations OpenStreetMap maps in the country, and the places with regular fire but no station mapped within 15 km.
   OpenStreetMap is uneven: where the file rates the mapping patchy the gaps sit behind a button, and where it is
   thin they are not shown as findings at all. Wording follows the stations contract (v1 rules, v2 additions).
   ===================================================================== */
type Level = "fair" | "patchy" | "thin" | "unpopulated" | "no_data";
interface Completeness {
  stations: number;
  population: number | null;
  income_group: string | null;
  peers: number;
  per_million: number | null;
  peer_median_per_million: number | null;
  level: Level;
  thin: boolean;
}
export interface CountryStations {
  v: 2;
  country: string;
  name: string;
  attribution: string;
  source: string;
  cell: number;
  stations_total: number;
  stations_subset: boolean;
  /** lon, lat, name ("" = untagged), operator index (-1 = none) */
  stations: [number, number, string, number][];
  operators: string[];
  /** rows of eight per summary cell: c, s1, s2, s3, km1, km2, km3, burn_years (Suomi NPP, 2012-2025) */
  cell_rows: number[];
  /** cells that burned in 7+ of the 14 years first, then 4-6; within each, most fire a year first */
  gaps: number[];
  persistent: number[];
  persistent_why: number[];
  why_codes: Record<string, string>;
  fire_per_year: number[];
  completeness: Completeness;
  gap_note: string;
  method: string;
  fire: string;
}
const LEVELS = ["fair", "patchy", "thin", "unpopulated", "no_data"];
const numOrNull = (x: unknown) => x === null || typeof x === "number";
function isStations(x: unknown, k: string): x is CountryStations {
  if (!isObj(x) || x.v !== 2 || x.country !== k || typeof x.name !== "string") return false;
  const co = x.completeness;
  return (
    typeof x.cell === "number" &&
    typeof x.stations_total === "number" &&
    Array.isArray(x.stations) &&
    x.stations.every(s => Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "number" && typeof s[2] === "string") &&
    Array.isArray(x.operators) &&
    isNums(x.cell_rows) &&
    x.cell_rows.length % 8 === 0 &&
    isNums(x.gaps) &&
    isNums(x.persistent) &&
    isNums(x.persistent_why, x.persistent.length) &&
    isObj(x.why_codes) &&
    isNums(x.fire_per_year) &&
    isObj(co) &&
    typeof co.level === "string" &&
    LEVELS.includes(co.level) &&
    numOrNull(co.per_million) &&
    numOrNull(co.peer_median_per_million) &&
    typeof x.gap_note === "string" &&
    typeof x.method === "string" &&
    typeof x.source === "string"
  );
}

/* ---------- places where a gap needs a warning ---------- */
/** desert gaps here are not proven fire: drilling or well-test flares FIRMS did not type look like campaigns of fire */
const ARABIA = new Set(["Saudi_Arabia", "Yemen", "Oman", "United_Arab_Emirates", "Qatar", "Kuwait", "Bahrain"]);
const SAHARA = new Set(["Algeria", "Libya", "Egypt", "Mali", "Niger", "Chad", "Mauritania", "Sudan", "Tunisia", "Morocco"]);
const desert = (k: string, lat: number, lon: number) =>
  ARABIA.has(k) || (SAHARA.has(k) && lat >= 18 && lat < 34 && lon >= -17 && lon <= 34);
/** a recheck found day-only heat that looks like large solar plants among the gaps here (the UAE's first gap) */
const SOLAR = new Set(["United_Arab_Emirates", "Chile", "Israel"]);
/** wording rule 1 of v2: what a masked cell probably is, by its persistent_why code */
const WHY: Record<string, string> = {
  static: "likely a gas flare or industrial heat",
  flare_field: "likely a gas flare or industrial heat",
  night_all_season: "all-season night burning, likely flares",
  night_weak: "mostly weak night detections, likely a flare, kiln or mine",
};
const whyText = (S: CountryStations, code: number) =>
  WHY[S.why_codes[String(code)] ?? ""] ?? "a steady heat source, likely not vegetation fire";

/* ---------- colours: the page's fire ramp, with grey for what was left out ---------- */
const REG = "#feb24c";
const GAP = "#bd0026";
const GAP_MUTED = "#e2694f";
const STEADY = "#bdb6a8";

const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pc = (p: number) => (p > 0 && p < 0.01 ? "under 1%" : Math.round(p * 100) + "%");
const km = (v: number) => (v < 10 ? v.toFixed(1) : fmt(v)) + " km";
const deg = (v: number, p: string, n: string, dp: number) => `${Math.abs(v).toFixed(dp)}°${v < 0 ? n : p}`;
const perYear = (v: number) => (v < 0.1 ? "under 0.1 hotspots a year" : `about ${fmt(v)} hotspot${fmt(v) === "1" ? "" : "s"} a year`);
const NO_STATION = "no fire station mapped in OpenStreetMap within 15 km";
/** the file's note on how far to trust the gaps, without the sentence addressed to whoever builds the page */
const noteOf = (S: CountryStations) => S.gap_note.replace(/\s*(Show them as|Do not present)[\s\S]*$/, "");
/** "2026-09-21" inside the source text, as "21 September 2026" */
function snapshot(src: string) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(src);
  return m ? `${Number(m[3])} ${MONL[Number(m[2]) - 1]} ${m[1]}` : "";
}

/* ---------- the open country ---------- */
interface StView {
  k: string | null;
  d: CountrySummary | null;
  S: CountryStations | null;
  /** a patchy country's gaps, shown on request */
  reveal: boolean;
}
const V: StView = { k: null, d: null, S: null, reveal: false };

export function stOpen(k: string) {
  V.k = k;
  V.d = V.S = null;
  V.reveal = false;
  $("cStTitle").textContent = "Fire stations";
  $("cStSub").textContent = $("cStSrc").textContent = "";
  $("cStMain").hidden = true;
  state("Loading the fire stations…");
}
export function stClose() {
  V.k = null;
  V.d = V.S = null;
}
export function stStart(d: CountrySummary) {
  if (V.k !== d.country) return;
  V.d = d;
  load();
}
function load() {
  const k = V.k;
  if (!k) return;
  state("Loading the fire stations…");
  loadChecked(stationsPath(k), (x): x is CountryStations => isStations(x, k)).then(
    S => {
      if (V.k !== k) return;
      V.S = S;
      state("");
      render();
    },
    (e: unknown) => {
      if (V.k !== k) return;
      state(`The fire stations did not load${e instanceof Error ? ` (${e.message})` : ""}. The rest of this page is unaffected.`, true);
    },
  );
}
function state(msg: string, retry = false) {
  $("cStState").hidden = !msg;
  $("cStMsg").textContent = msg;
  $("cStRetry").hidden = !retry;
}

/* ---------- what the file says about each place ---------- */
interface Place {
  c: number;
  by: number;
  km1: number;
  s1: number;
  fpy: number;
}
interface Facts {
  n: number;
  burn: Place[];
  gaps: Place[];
  steady: Map<number, number>;
  /** gaps are findings here (fair), findings on request (patchy), or not shown (thin, no data, unpopulated) */
  show: "yes" | "ask" | "no";
}
function facts(S: CountryStations, d: CountrySummary): Facts {
  const n = Math.min(S.cell_rows.length / 8, d.cells.length / 2),
    steady = new Map<number, number>(),
    place = (c: number): Place => ({
      c,
      by: S.cell_rows[8 * c + 7],
      km1: S.cell_rows[8 * c + 4],
      s1: S.cell_rows[8 * c + 1],
      fpy: S.fire_per_year[c] ?? 0,
    });
  S.persistent.forEach((c, i) => steady.set(c, S.persistent_why[i]));
  const burn: Place[] = [];
  for (let c = 0; c < n; c++) if (S.cell_rows[8 * c + 7] >= 4 && !steady.has(c)) burn.push(place(c));
  const lv = S.completeness.level;
  return {
    n,
    burn,
    gaps: S.gaps.filter(c => c < n).map(place),
    steady,
    show: lv === "fair" ? "yes" : lv === "patchy" ? "ask" : "no",
  };
}
const posOf = (d: CountrySummary, c: number) => {
  const [lat, lon] = cellCentre(d, c),
    dp = d.cell === 0.25 ? 3 : 2;
  return { lat, lon, text: `${deg(lat, "N", "S", dp)}, ${deg(lon, "E", "W", dp)}` };
};
function stationName(S: CountryStations, i: number) {
  const s = S.stations[i];
  if (!s) return "";
  const op = s[3] >= 0 ? S.operators[s[3]] : "";
  return s[2] || (op ? `an unnamed station of ${op}` : "an unnamed station");
}
function nearest(S: CountryStations, p: Place) {
  if (p.km1 < 0 || p.s1 < 0) return "No fire station is mapped in OpenStreetMap anywhere in the country.";
  const nm = stationName(S, p.s1);
  return `Nearest mapped station: ${km(p.km1)}${nm ? `, <bdi>${esc(nm)}</bdi>` : ""}.`;
}

/* ---------- the words and figures ---------- */
function render() {
  const S = V.S!,
    d = V.d!,
    tn = theName(S.name),
    F = facts(S, d),
    lv = S.completeness.level,
    snap = snapshot(S.source);
  $("cStSrc").innerHTML =
    `Fire stations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors, ODbL</a>. ` +
    `Data: <a href="${esc(fileUrl(stationsPath(S.country)))}" target="_blank" rel="noopener">${esc(stationsPath(S.country))}</a> from the Hugging Face dataset ` +
    `<a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built by scripts/build_world_stations.py from the OpenStreetMap planet file of ${esc(snap || S.source)}. ` +
    `Fire: NASA FIRMS, ${esc(S.fire)}.`;
  const nb = F.burn.length,
    ng = F.gaps.length;
  $("cStTitle").textContent =
    lv === "unpopulated"
      ? `${fmt(S.stations_total)} fire station${S.stations_total === 1 ? "" : "s"} mapped in OpenStreetMap`
      : nb === 0
        ? `No place in ${tn} burned in 4 or more of the 14 years 2012–2025`
        : F.show === "no"
          ? `Too few fire stations are mapped in OpenStreetMap in ${tn} to judge where they are missing`
          : F.show === "ask"
            ? `OpenStreetMap's fire stations look patchy in ${tn}, so its gaps are uncertain`
            : ng === 0
              ? `Every place in ${tn} with regular fire has a fire station mapped in OpenStreetMap within 15 km`
              : `${fmt(ng)} place${ng === 1 ? "" : "s"} with regular fire ${ng === 1 ? "has" : "have"} ${NO_STATION}`;
  $("cStSub").textContent =
    `Fire stations tagged in OpenStreetMap${snap ? ` (as of ${snap})` : ""}, set against the places where NASA's VIIRS satellite saw fire in at least 4 of the 14 years 2012–2025. ` +
    `Distances are straight lines from the middle of each ${d.cell}° square, not drive times.` +
    (d.cell >= 0.5 ? ` Squares here are about ${Math.round(d.cell * 111)} km across, so the 15 km test is rough.` : "");
  const note = $("cStNote");
  note.hidden = F.show === "yes";
  note.textContent =
    noteOf(S) +
    (F.show === "no" && lv !== "unpopulated" ? " So this page does not list places without a station here." : "") +
    (F.show === "ask" ? " The places are hidden until you ask for them." : "");
  figures(S, d, F);
  $("cStMethod").textContent = S.method;
  $("cStMain").hidden = false;
  draw();
}

function figures(S: CountryStations, d: CountrySummary, F: Facts) {
  const co = S.completeness,
    item = (h: string, fig: string, small: string, p: string) =>
      `<div class="cpAns"><h2>${h}</h2><p class="cpFig">${fig}${small ? `<small>${small}</small>` : ""}</p><p>${p}</p></div>`,
    nb = F.burn.length,
    ng = F.gaps.length,
    kms = F.burn.map(p => (p.km1 < 0 ? Infinity : p.km1)).sort((a, b) => a - b),
    mid = kms.length ? kms[Math.floor((kms.length - 1) / 2)] : NaN;
  const t1 = item(
    "Fire stations mapped",
    fmt(S.stations_total),
    co.per_million != null ? `${fmt(co.per_million)} per million people` : "",
    co.peer_median_per_million != null
      ? `Countries in the same income group have a median of ${fmt(co.peer_median_per_million)} per million.`
      : "There is no population figure to compare with.",
  );
  const t2 = item(
    "Places with regular fire",
    fmt(nb),
    `square${nb === 1 ? "" : "s"} with fire in 4 or more of the 14 years`,
    `Each square is ${d.cell}°, about ${Math.round(d.cell * 111)} km across.` +
      (F.steady.size
        ? ` ${fmt(F.steady.size)} square${F.steady.size === 1 ? "" : "s"} of steady heat, likely industrial, ${F.steady.size === 1 ? "is" : "are"} left out.`
        : ""),
  );
  let t3: string;
  if (nb === 0) t3 = item("Gaps", "None", "", "No place burned often enough to count.");
  else if (F.show !== "no")
    t3 = item(
      "No station mapped within 15 km",
      F.show === "ask" && !V.reveal ? `<span class="stMuted">${fmt(ng)}</span>` : fmt(ng),
      `${pc(ng / nb)} of those places`,
      F.show === "ask"
        ? "Many of these may be stations that are missing from OpenStreetMap."
        : "A gap means none is mapped, not that none exists.",
    );
  else
    t3 = item(
      "Median distance to a mapped station",
      Number.isFinite(mid) ? km(mid) : "None mapped",
      "from places with regular fire",
      co.level === "unpopulated"
        ? "Few people live here."
        : "With this little mapped, the distance mostly measures the map, not the fire service.",
    );
  $("cStFigs").innerHTML = t1 + t2 + t3;
}

/* ---------- the map, the list and the notes ---------- */
function draw() {
  const S = V.S!,
    d = V.d!,
    F = facts(S, d),
    tn = theName(S.name),
    gapsOn = F.show === "yes" || (F.show === "ask" && V.reveal),
    gapSet = new Set(F.gaps.map(p => p.c)),
    byCell = new Map(F.burn.map(p => [p.c, p])),
    top = gapsOn ? F.gaps.slice(0, 10) : [],
    marks: MiniMark[] = top.map((p, i) => ({ c: p.c, label: String(i + 1), title: `Gap ${i + 1}: ${posOf(d, p.c).text}` })),
    layers: MiniLayer[] = [
      { fill: STEADY, cells: [...F.steady.keys()].filter(c => c < F.n) },
      { fill: REG, cells: F.burn.filter(p => !(gapsOn && gapSet.has(p.c))).map(p => p.c) },
      { fill: F.show === "yes" ? GAP : GAP_MUTED, cells: gapsOn ? F.gaps.map(p => p.c) : [] },
    ].map(l => ({ ...l, edge: F.n < 400 || l.fill !== REG }));
  const sw = (c: string, t: string, cls = "") => `<span class="cpNone"><i class="${cls}" style="background:${c}"></i>${t}</span>`;
  $("cStLegend").innerHTML =
    sw("#1b1b1b", "fire station mapped in OpenStreetMap", "stDot") +
    (F.burn.length ? sw(REG, gapsOn ? "regular fire, station within 15 km" : "regular fire (4 or more of 14 years)") : "") +
    (gapsOn && F.gaps.length ? sw(F.show === "yes" ? GAP : GAP_MUTED, `regular fire, ${NO_STATION}`) : "") +
    (F.steady.size ? sw(STEADY, "steady heat, likely industrial: left out") : "");
  const listed = S.stations.length,
    coarse = matchMedia("(pointer: coarse)").matches,
    idle =
      `${coarse ? "Tap" : "Point at"} a square for its numbers.` +
      (S.stations_subset ? ` The dots are the ${fmt(listed)} stations nearest to some square, of ${fmt(S.stations_total)} mapped.` : ""),
    box = $("cStMap");
  const aspect = drawMini(box, d, {
    layers,
    points: S.stations.map(s => [s[0], s[1]]),
    marks,
    label: `Map of ${tn}: fire stations mapped in OpenStreetMap and the squares with regular fire`,
    caption: $("cStPick"),
    idle,
    pick: c => {
      const pos = posOf(d, c),
        why = F.steady.get(c);
      if (why !== undefined) return `<b>${pos.text}</b>: steady heat, ${esc(whyText(S, why))}. Left out of the gaps.`;
      const p = byCell.get(c);
      if (!p) return null;
      const isGap = gapsOn && gapSet.has(c),
        flag =
          isGap && desert(S.country, pos.lat, pos.lon)
            ? " Unverified: in the desert, these detections may be gas flares or industrial heat."
            : "";
      return (
        `<b>${pos.text}</b>: fire in ${p.by} of the 14 years 2012–2025 (VIIRS), ${perYear(p.fpy)}. ${nearest(S, p)}` +
        (isGap ? ` That is beyond 15 km: ${NO_STATION}.` : "") +
        flag
      );
    },
  });
  box.closest(".cpOlGrid")?.classList.toggle("wide", aspect > 1.8);
  list(S, d, F, top, gapsOn);
  caveats(S, d, F, top, gapsOn);
}

function list(S: CountryStations, d: CountrySummary, F: Facts, top: Place[], gapsOn: boolean) {
  const show = $("cStShow");
  show.hidden = F.show !== "ask" || F.gaps.length === 0;
  show.textContent = V.reveal
    ? "Hide the uncertain gaps"
    : `Show the ${fmt(F.gaps.length)} uncertain gap${F.gaps.length === 1 ? "" : "s"} anyway`;
  /* the gap list */
  const gl = $("cStGapBox");
  gl.hidden = !gapsOn || !top.length;
  if (!gl.hidden) {
    $("cStListT").textContent = `Places with regular fire and ${NO_STATION}`;
    $("cStListS").textContent =
      top[0].by >= 7
        ? "Among places that burned in at least 7 of the 14 years, the most fire first."
        : "These burned in 4 to 6 of the 14 years; the most fire first.";
    let group2 = top[0].by < 7;
    $("cStList").innerHTML = top
      .map((p, i) => {
        const pos = posOf(d, p.c),
          head = !group2 && p.by < 7 ? ((group2 = true), `<li class="stGrp">Then places that burned in 4 to 6 of the 14 years</li>`) : "",
          flags =
            (desert(S.country, pos.lat, pos.lon)
              ? `<small class="stFlag">Unverified: in the desert, these detections may be gas flares or industrial heat.</small>`
              : "") +
            (S.country === "United_Arab_Emirates" && i === 0
              ? `<small class="stFlag">Possibly a large solar plant: a recheck found its heat mostly by day.</small>`
              : ""),
          osm = `https://www.openstreetmap.org/?mlat=${pos.lat.toFixed(3)}&mlon=${pos.lon.toFixed(3)}#map=11/${pos.lat.toFixed(3)}/${pos.lon.toFixed(3)}`;
        return (
          head +
          `<li><span class="stN${F.show === "yes" ? "" : " muted"}">${i + 1}</span><span class="stW"><b>${pos.text}</b>` +
          `<small>Burned in ${p.by} of the 14 years 2012–2025 (VIIRS) · ${perYear(p.fpy)}</small>` +
          `<small>${nearest(S, p)}</small>${flags}` +
          `<small><a href="${osm}" target="_blank" rel="noopener">Check the place on OpenStreetMap</a></small></span></li>`
        );
      })
      .join("");
    $("cStListNote").textContent =
      (F.gaps.length > top.length ? `The ${fmt(top.length)} at the top of ${fmt(F.gaps.length)}. ` : "") +
      (F.show === "yes" ? noteOf(S) : "");
  }
  /* how far regular fire is from a mapped station */
  const nb = F.burn.length,
    bands: [string, (v: number) => boolean][] = [
      ["Within 15 km", v => v >= 0 && v <= 15],
      ["15 to 50 km", v => v > 15 && v <= 50],
      ["50 to 100 km", v => v > 50 && v <= 100],
      ["Over 100 km", v => v > 100],
      ["No station mapped in the country", v => v < 0],
    ];
  $("cStDistBox").hidden = nb === 0;
  if (nb)
    $("cStDist").innerHTML =
      `<tr><th>Nearest mapped station</th><th>Places</th><th>Share</th></tr>` +
      bands
        .map(([label, f]) => {
          const k = F.burn.filter(p => f(p.km1)).length;
          return k || label !== "No station mapped in the country"
            ? `<tr><td>${label}</td><td>${fmt(k)}</td><td>${pc(k / nb)}</td></tr>`
            : "";
        })
        .join("");
  $("cStDistNote").textContent =
    F.show === "no" && S.completeness.level !== "unpopulated"
      ? "With so few stations mapped, these distances mostly show how much of the map is missing."
      : "Places with fire in at least 4 of the 14 years, steady heat left out.";
}

function caveats(S: CountryStations, d: CountrySummary, F: Facts, top: Place[], gapsOn: boolean) {
  const counts = new Map<string, number>();
  for (const code of F.steady.values()) {
    const t = whyText(S, code);
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const steady = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${fmt(n)} ${t}`),
    anyDesert =
      F.show !== "no" &&
      F.gaps.some(p => {
        const pos = posOf(d, p.c);
        return desert(S.country, pos.lat, pos.lon);
      });
  let t =
    `<b>Read with care.</b> A gap means ${NO_STATION}, not that no station exists: OpenStreetMap is never complete. ` +
    `Stations across a border are not counted, so near a border a distance can be too long. `;
  if (steady.length)
    t += `Squares whose heat looks steady rather than seasonal are left out (${steady.join("; ")}); the filter is careful but not perfect. `;
  if (anyDesert)
    t += `In the Arabian Peninsula and the Sahara the gaps are unverified: their detections may come from gas flares, drilling or industrial heat that FIRMS did not flag. `;
  if (SOLAR.has(S.country))
    t +=
      `Large solar plants can show up as daytime heat that the satellite reads as fire. A recheck found that pattern among the gaps here` +
      (S.country === "United_Arab_Emirates" ? ", including the first one listed" : "") +
      `, so treat a gap with daytime-only detections as unverified. `;
  if (top.length && d.cell >= 0.5)
    t += `A square here is up to ${Math.round(d.cell * 111)} km across, so a station near its edge can still be more than 15 km from its middle. `;
  $("cStCaveats").innerHTML = t.trim();
}

/** wire the section's controls; called once */
export function stEvents() {
  $("cStRetry").onclick = () => {
    if (V.k && V.d) load();
  };
  $("cStShow").onclick = () => {
    if (!V.S || !V.d) return;
    V.reveal = !V.reveal;
    figures(V.S, V.d, facts(V.S, V.d));
    draw();
  };
}
