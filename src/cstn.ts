import type { CountrySummary } from "./types";
import { MONL } from "./data";
import { $, fmt } from "./util";
import { HF_DATASET, HF_PAGE, STATIONS_FALLBACK_DIR, fileUrl, isNums, isObj, loadChecked, stationsPath } from "./hf";
import { theName } from "./world";
import { DENSE, cellCentre, drawMini, type MiniLayer, type MiniMark } from "./minimap";

/* =====================================================================
   "FIRE STATIONS" ON THE COUNTRY PAGE: stations/v3/<Country>.json (scripts/build_world_stations.py), or v2 when v3
   does not arrive. How many fire stations OpenStreetMap maps and Overture Maps lists in the country (v2: OpenStreetMap
   alone), and the places with regular fire but no station mapped within 15 km. Both maps are uneven: where the file
   rates the mapping patchy the gaps sit behind a button, and where it is thin they are not shown as findings at all.
   Wording follows the stations contract (v1 rules, v2 and v3 additions).
   ===================================================================== */
type Level = "fair" | "patchy" | "thin" | "unpopulated" | "no_data";
/** v3: OpenStreetMap only, OpenStreetMap and also listed in Overture (the OSM record kept), Overture only */
type Source = "osm" | "both" | "overture";
const SOURCES: readonly unknown[] = ["osm", "both", "overture"];
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
  v: 2 | 3;
  country: string;
  name: string;
  attribution: string;
  source: string;
  cell: number;
  stations_total: number;
  stations_subset: boolean;
  /** lon, lat, name ("" = untagged), operator index (-1 = none), and in v3 where the station comes from */
  stations: [number, number, string, number, Source?][];
  /** v3: stations by source, over all of them, not just the listed ones */
  station_sources?: Record<Source, number>;
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
export function isStations(x: unknown, k: string): x is CountryStations {
  if (!isObj(x) || (x.v !== 2 && x.v !== 3) || x.country !== k || typeof x.name !== "string") return false;
  const co = x.completeness,
    ss = x.station_sources;
  /* v3 says where each station comes from, and the counts by source add up to the total */
  if (
    x.v === 3 &&
    !(
      typeof x.attribution === "string" &&
      isObj(ss) &&
      SOURCES.every(s => typeof ss[s as string] === "number") &&
      (ss.osm as number) + (ss.both as number) + (ss.overture as number) === x.stations_total &&
      Array.isArray(x.stations) &&
      x.stations.every(s => Array.isArray(s) && SOURCES.includes(s[4]))
    )
  )
    return false;
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
/** the desert's northern edge: Libya's and Egypt's farmed coast lies north of 31°N, the Atlas holds it near 34°N elsewhere */
const SAHARA_NORTH: Record<string, number> = { Libya: 31, Egypt: 31 };
const desert = (k: string, lat: number, lon: number) =>
  ARABIA.has(k) || (SAHARA.has(k) && lat >= 18 && lat < (SAHARA_NORTH[k] ?? 34) && lon >= -17 && lon <= 34);
const DESERT_FLAG = "Unverified: in the desert, these detections may be gas flares or industrial heat that FIRMS did not flag.";
/** a recheck found day-only heat that looks like large solar plants here */
const SOLAR = new Set(["United_Arab_Emirates", "Chile", "Israel"]);
/** the squares where almost none of the detections were at night (recheck-v2 scan): [lat, lon] of the middle */
const SOLAR_CELLS: [number, number][] = [
  [24.75, 55.35],
  [24.75, 55.45],
  [24.75, 55.55],
  [24.65, 55.45],
  [-25.55, -70.15],
];
const solarCell = (lat: number, lon: number) => SOLAR_CELLS.some(([a, b]) => Math.abs(a - lat) < 0.01 && Math.abs(b - lon) < 0.01);
const SOLAR_FLAG = "Possibly a solar plant or other daytime industrial heat: almost none of its detections are at night.";
/** wording rule 1 of v2: what a masked cell probably is, by its persistent_why code; one square, and a count of them */
const WHY: Record<string, [string, string]> = {
  static: ["likely a gas flare or industrial heat", "likely gas flares or industrial heat"],
  flare_field: ["likely a gas flare or industrial heat", "likely gas flares or industrial heat"],
  night_all_season: ["all-season night burning, likely flares", "with all-season night burning, likely flares"],
  night_weak: ["mostly weak night detections, likely a flare, kiln or mine", "with mostly weak night detections, likely flares, kilns or mines"],
};
const whyOf = (S: CountryStations, code: number) =>
  WHY[S.why_codes[String(code)] ?? ""] ?? ["a steady heat source, likely not vegetation fire", "other steady heat, likely not vegetation fire"];

/* ---------- colours: the page's fire ramp, with grey for what was left out ---------- */
const REG = "#feb24c";
const GAP = "#bd0026";
const GAP_MUTED = "#e2694f";
const STEADY = "#bdb6a8";
/** with fewer fire squares than this, each too small to see, the map is left out */
const MIN_MAP_SQUARES = 5;

const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pc = (p: number) => (p > 0 && p < 0.01 ? "under 1%" : Math.round(p * 100) + "%");
const km = (v: number) => (v < 10 ? v.toFixed(1) : fmt(v)) + " km";
const deg = (v: number, p: string, n: string, dp: number) => `${Math.abs(v).toFixed(dp)}°${v < 0 ? n : p}`;
const perYear = (v: number) => (v < 0.1 ? "under 0.1 hotspots a year" : `about ${fmt(v)} hotspot${fmt(v) === "1" ? "" : "s"} a year`);
/* ---------- naming the sources: v3 counts OpenStreetMap and Overture Maps together, v2 OpenStreetMap alone ---------- */
/** the colour of a station only Overture Maps lists: the country page's blue, apart from the fire ramp */
const OVERTURE = "#2166ac";
const maps = (S: CountryStations) => (S.v === 3 ? "OpenStreetMap or Overture Maps" : "OpenStreetMap");
/** stations contract v3, rule 1: never "OpenStreetMap" alone for the count */
const mappedIn = (S: CountryStations) => (S.v === 3 ? "mapped in OpenStreetMap or listed in Overture Maps" : "mapped in OpenStreetMap");
const noStation = (S: CountryStations) => `no fire station mapped in ${maps(S)} within 15 km`;
/** stations contract v3, rule 2: where one station comes from */
const FROM: Record<Source, string> = {
  osm: "OpenStreetMap",
  both: "OpenStreetMap and Overture",
  overture: "Overture Maps, from business listings; may be wrong or out of date",
};
/** stations contract v3, rule 5: "fair" here rests on this many stations above the line, some of them Overture listings */
const FRAGILE: Record<string, number> = { Kuwait: 1, Qatar: 1, Guatemala: 2, Jamaica: 2 };
const fragile = (S: CountryStations) => (S.v === 3 && S.completeness.level === "fair" ? FRAGILE[S.country] : undefined);
const FRAGILE_NOTE = (n: number) =>
  `Stations here only just reach this page's bar for listing gaps (by ${n === 1 ? "one station" : n === 2 ? "two stations" : `${n} stations`}), ` +
  "and some Overture Maps listings may be wrong, so the gaps are drawn in muted colours, as places to check rather than findings.";
/** stations contract v3: Italy falls from fair to patchy only because Overture lifts the median of the other rich
    countries; its OpenStreetMap stations are unchanged, so the page treats it as v2 did */
const AS_V2: Record<string, Level> = { Italy: "fair" };
const asV2 = (S: CountryStations) => (S.v === 3 && S.completeness.level === "patchy" ? AS_V2[S.country] : undefined);
const AS_V2_NOTE = (tn: string) =>
  `The file rates the stations in ${tn} as patchy only because Overture Maps adds many listings in other rich countries, ` +
  "which raises their median per person. The OpenStreetMap stations here are unchanged and were rated fair before, so the gaps are still listed.";
/** v3 counts listings as well as mapped stations (contract v3, rule 1) */
const mapped = (S: CountryStations) => (S.v === 3 ? "mapped or listed" : "mapped");
/** a place whose stations within 15 km are all Overture-only listings: "only" when the file names every station
    within 15 km (fewer than its three nearest), "three" when its three nearest are all that close and all Overture */
function onlyListed(S: CountryStations, c: number): "only" | "three" | "" {
  if (S.v !== 3) return "";
  const near: number[] = [];
  for (let j = 1; j <= 3; j++) {
    const s = S.cell_rows[8 * c + j],
      k = S.cell_rows[8 * c + 3 + j];
    if (s >= 0 && k >= 0 && k <= 15) near.push(s);
  }
  if (!near.length || !near.every(s => S.stations[s]?.[4] === "overture")) return "";
  return near.length < 3 ? "only" : "three";
}
const ONLY_LISTED = {
  only: "Only Overture Maps lists a station this close; none is mapped in OpenStreetMap within 15 km.",
  three: "Its three nearest stations are all Overture Maps listings.",
};
const listedOverture = (S: CountryStations) => S.stations.filter(s => s[4] === "overture");
/** the count split by source: "33,615 stations: 30,100 from OpenStreetMap, 3,515 more from Overture Maps." */
function split(S: CountryStations) {
  const ss = S.station_sources;
  if (!ss) return "";
  const n = S.stations_total,
    osm = ss.osm + ss.both,
    ov = ss.overture,
    st = `${fmt(n)} station${n === 1 ? "" : "s"}`;
  if (!n) return "None in OpenStreetMap or Overture Maps.";
  if (!ov) return `${st}, ${n === 1 ? "" : "all "}from OpenStreetMap; Overture Maps adds none.`;
  if (!osm) return `${st}, ${n === 1 ? "" : "all "}from Overture Maps; none in OpenStreetMap.`;
  return `${st}: ${fmt(osm)} from OpenStreetMap, ${fmt(ov)} more from Overture Maps.`;
}
/** the file's attribution, word for word, with its two credits linked */
const credit = (S: CountryStations) =>
  esc(S.attribution)
    .replace(
      "© OpenStreetMap contributors, ODbL",
      `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors, ODbL</a>`,
    )
    .replace(
      "Overture Maps Foundation, overturemaps.org",
      `<a href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps Foundation, overturemaps.org</a>`,
    );
/** a square's size: cells are square in degrees, so only the north-south size is fixed */
const across = (d: CountrySummary) => `about ${Math.round(d.cell * 111)} km north to south`;
/** the file's note on how far to trust the gaps, without the sentence addressed to whoever builds the page */
const noteOf = (S: CountryStations) =>
  asV2(S)
    ? "Neither OpenStreetMap nor Overture Maps is complete: a gap means no station is mapped or listed within 15 km, not that none exists."
    : S.gap_note.replace(/\s*(Show them as|Do not present)[\s\S]*$/, "");
/** "2026-09-21" inside the source text, as "21 September 2026" */
function snapshot(src: string) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(src);
  return m ? `${Number(m[3])} ${MONL[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** the licence texts that sit with the v3 files (contract v3, Attribution) */
const LICENCES = [
  ["LICENSE-CDLA-Permissive-2.0.txt", "CDLA Permissive 2.0"],
  ["LICENSE-Apache-2.0.txt", "Apache 2.0"],
  ["NOTICE-Foursquare.txt", "Foursquare notice"],
];
/** "Overture Maps Places release 2026-10-21.0" inside the source text, as "October 2026" */
function release(src: string) {
  const m = /Overture Maps Places release (\d{4})-(\d{2})/.exec(src);
  return m ? `${MONL[Number(m[2]) - 1]} ${m[1]}` : "";
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
  [
    "cStFigs", "cStLegend", "cStMap", "cStPick", "cStList", "cStDist", "cStCaveats", "cStNote", "cStListT", "cStListS",
    "cStListNote", "cStDistNote", "cStMethod",
  ].forEach(id => ($(id).innerHTML = ""));
  state(k ? "Loading the fire stations…" : "");
}
/** the page closed or the address matched nothing: forget the country and empty the section */
export function stClose() {
  stOpen("");
  V.k = null;
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
  stLoad(k).then(
      S => {
        if (V.k !== k || !V.d) return;
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
  gapSet: Set<number>;
  /** masked squares that burned in 4 or more years: the ones the mask kept out of the gaps */
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
  S.persistent.forEach((c, i) => {
    if (c < n && S.cell_rows[8 * c + 7] >= 4) steady.set(c, S.persistent_why[i]);
  });
  const all = new Set(S.persistent),
    burn: Place[] = [];
  for (let c = 0; c < n; c++) if (S.cell_rows[8 * c + 7] >= 4 && !all.has(c)) burn.push(place(c));
  const lv = asV2(S) ?? S.completeness.level,
    gaps = S.gaps.filter(c => c < n).map(place);
  return {
    n,
    burn,
    gaps,
    gapSet: new Set(gaps.map(p => p.c)),
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
/** the nearest station; a gap's distance is over 15 km even where the file rounds it to 15.0 */
function nearest(S: CountryStations, p: Place, isGap: boolean) {
  if (p.km1 < 0 || p.s1 < 0) return `No fire station is ${mappedIn(S)} anywhere in the country.`;
  /* a name that ends in a full stop would end the sentence twice */
  const nm = stationName(S, p.s1).replace(/\.+$/, ""),
    src = S.stations[p.s1]?.[4];
  return (
    `Nearest ${S.v === 3 ? "" : "mapped "}station: ${isGap && p.km1 < 15.5 ? "just over 15 km" : km(p.km1)}${nm ? `, <bdi>${esc(nm)}</bdi>` : ""}` +
    (src ? ` (${FROM[src]})` : "") +
    "."
  );
}
const anyDesert = (S: CountryStations, d: CountrySummary, ps: Place[]) =>
  ps.some(p => {
    const pos = posOf(d, p.c);
    return desert(S.country, pos.lat, pos.lon);
  });

/* ---------- the words and figures ---------- */
function render() {
  const S = V.S!,
    d = V.d!,
    tn = theName(S.name),
    F = facts(S, d),
    lv = S.completeness.level,
    snap = snapshot(S.source);
  const dir = `stations/v${S.v}`,
    path = stationsPath(S.country, dir),
    rel = release(S.source);
  $("cStSrc").innerHTML =
    (S.v === 3
      ? `Fire stations: ${credit(S)}. `
      : `Fire stations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors, ODbL</a>. `) +
    `Data: <a href="${esc(fileUrl(path))}" target="_blank" rel="noopener">${esc(path)}</a> from the Hugging Face dataset ` +
    `<a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>` +
    (S.v === 3
      ? ` (licence texts in the same folder: ${LICENCES.map(([f, t]) => `<a href="${esc(fileUrl(`${dir}/${f}`))}" target="_blank" rel="noopener">${t}</a>`).join(", ")})`
      : "") +
    `, built by scripts/build_world_stations.py from the OpenStreetMap planet file of ${esc(snap || S.source)}` +
    (S.v === 3 ? ` and Overture Maps Places${rel ? ` (${rel} release)` : ""}` : "") +
    `. Fire: NASA FIRMS, ${esc(S.fire)}.`;
  const nb = F.burn.length,
    ng = F.gaps.length;
  $("cStTitle").textContent =
    lv === "unpopulated"
      ? `${fmt(S.stations_total)} fire station${S.stations_total === 1 ? "" : "s"} ${mappedIn(S)}`
      : nb === 0
        ? `No place in ${tn} burned in 4 or more of the 14 years 2012–2025`
        : F.show === "no"
          ? `Too few fire stations are ${mappedIn(S)} in ${tn} to judge where they are missing`
          : F.show === "ask"
            ? S.v === 3
              ? `The fire stations in OpenStreetMap and Overture Maps look patchy in ${tn}, so the gaps are uncertain`
              : `OpenStreetMap's fire stations look patchy in ${tn}, so its gaps are uncertain`
            : ng === 0
              ? `Every place in ${tn} with regular fire has a fire station mapped in ${maps(S)} within 15 km`
              : `${fmt(ng)} place${ng === 1 ? "" : "s"} with regular fire ${ng === 1 ? "has" : "have"} ${noStation(S)}` +
                (anyDesert(S, d, F.gaps.slice(0, 10)) ? ", though in the desert some may be industrial heat" : "");
  $("cStSub").textContent =
    `Fire stations tagged in OpenStreetMap${snap ? ` (as of ${snap})` : ""}` +
    (S.v === 3 ? ` or listed in Overture Maps${rel ? ` (${rel} release)` : ""}, a station in both counted once` : "") +
    `, set against the places where NASA's VIIRS satellite saw fire in at least 4 of the 14 years 2012–2025. ` +
    `Distances are straight lines from the middle of each ${d.cell}° square, not drive times.` +
    (d.cell >= 0.5 ? ` Squares here are ${across(d)}, so the 15 km test is rough.` : "") +
    (S.v === 2 ? " The Overture Maps listings did not load, so these are OpenStreetMap's stations alone." : "");
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
    mid = kms.length ? kms[Math.floor((kms.length - 1) / 2)] : NaN,
    ns = F.steady.size;
  const t1 = item(
    `Fire stations ${mapped(S)}`,
    fmt(S.stations_total),
    co.per_million != null ? `${fmt(co.per_million)} per million people` : "",
    (S.v === 3 ? `${split(S)} ` : "") +
      (co.peer_median_per_million != null
        ? `Countries in the same income group have a median of ${fmt(co.peer_median_per_million)} per million.`
        : "There is no population figure to compare with."),
  );
  const t2 = item(
    "Places with regular fire",
    fmt(nb),
    `square${nb === 1 ? "" : "s"} with fire in 4 or more of the 14 years`,
    `Each square is ${d.cell}°, ${across(d)}.` +
      (ns ? ` ${fmt(ns)} more ${ns === 1 ? "square" : "squares"} whose heat looks like flares or industry ${ns === 1 ? "is" : "are"} left out.` : ""),
  );
  let t3: string;
  if (nb === 0) t3 = item("Gaps", "None", "", "No place burned often enough to count.");
  else if (F.show === "yes")
    t3 = item(
      `No fire station mapped in ${maps(S)} within 15 km`,
      fmt(ng),
      `${pc(ng / nb)} of those places`,
      `A gap means none is ${mapped(S)}, not that none exists.`,
    );
  else
    t3 = item(
      `Median distance to a ${mapped(S)} station`,
      Number.isFinite(mid) ? km(mid) : `None ${mapped(S)}`,
      "from places with regular fire",
      co.level === "unpopulated"
        ? "Few people live here."
        : F.show === "ask"
          ? S.v === 3
            ? "Many of these places may have a station that neither map shows, so the distance partly measures the maps."
            : "Many of these places may have a station that OpenStreetMap is missing, so the distance partly measures the map."
          : `With this little ${mapped(S)}, the distance mostly measures the ${S.v === 3 ? "maps" : "map"}, not the fire service.`,
    );
  $("cStFigs").innerHTML = t1 + t2 + t3;
}

/* ---------- the map, the list and the notes ---------- */
function draw() {
  const S = V.S!,
    d = V.d!,
    F = facts(S, d),
    tn = theName(S.name),
    lv = S.completeness.level,
    gapsOn = F.show === "yes" || (F.show === "ask" && V.reveal),
    /* gaps in full colour only where they are findings: not where they are asked for, nor where "fair" is fragile */
    strong = F.show === "yes" && !fragile(S),
    byCell = new Map(F.burn.map(p => [p.c, p])),
    top = gapsOn ? F.gaps.slice(0, 10) : [],
    marks: MiniMark[] = top.map((p, i) => {
      const pos = posOf(d, p.c);
      return { c: p.c, label: String(i + 1), title: `Gap ${i + 1}: ${pos.text}`, muted: !strong, keep: solarCell(pos.lat, pos.lon) };
    }),
    /* fire squares all drawn alike, at their true size where there are many (no layer outlined over another), and
       over the station dots where those are dense */
    layers: MiniLayer[] = [
      { fill: STEADY, cells: [...F.steady.keys()] },
      { fill: REG, cells: F.burn.filter(p => !(gapsOn && F.gapSet.has(p.c))).map(p => p.c), over: true },
      { fill: strong ? GAP : GAP_MUTED, cells: gapsOn ? F.gaps.map(p => p.c) : [], over: true },
    ].map(l => ({ ...l, edge: F.n < 400 }));
  const note = $("cStNote"),
    fr = fragile(S);
  note.hidden = F.show === "yes" && !fr && !asV2(S);
  note.textContent =
    F.show === "yes"
      ? fr
        ? FRAGILE_NOTE(fr)
        : asV2(S)
          ? AS_V2_NOTE(tn)
          : ""
      : noteOf(S) +
        (F.show === "no" && lv !== "unpopulated" ? " So this page does not list places without a station here." : "") +
        (F.show === "ask" && !V.reveal ? " The places are hidden until you ask for them." : "") +
        (F.show === "ask" && V.reveal ? " They are shown below in muted colours, as places to check, not findings." : "");
  /* nothing burned regularly and nothing was masked: a map of the outline alone says nothing */
  let empty = F.burn.length === 0 && F.steady.size === 0;
  const box = $("cStMap"),
    fig = box.closest<HTMLElement>(".cpOlFig")!,
    grid = box.closest<HTMLElement>(".cpOlGrid")!;
  /* stations only Overture lists are drawn in their own colour, under OpenStreetMap's */
  const ovPts = listedOverture(S).map(s => [s[0], s[1]]),
    osmPts = S.stations.filter(s => s[4] !== "overture").map(s => [s[0], s[1]]);
  const sw = (c: string, t: string, cls = "") => `<span class="cpNone"><i class="${cls}" style="background:${c}"></i>${t}</span>`,
    /* where stations are dense the map draws them as small see-through dots, so the key does too */
    dense = osmPts.length + ovPts.length > DENSE;
  $("cStLegend").innerHTML =
    (osmPts.length ? sw("#1b1b1b", "fire station mapped in OpenStreetMap", dense ? "stSmall" : "stDot") : "") +
    (ovPts.length
      ? dense
        ? sw(OVERTURE, "listed only in Overture Maps: may be wrong or closed", "stSmall")
        : sw("#fffefa", "listed only in Overture Maps: may be wrong or closed", "stRing")
      : "") +
    (F.burn.length ? sw(REG, gapsOn ? `regular fire, station ${mapped(S)} within 15 km` : "regular fire (4 or more of 14 years)") : "") +
    (gapsOn && F.gaps.length ? sw(strong ? GAP : GAP_MUTED, `regular fire, ${noStation(S)}`) : "") +
    (F.steady.size ? sw(STEADY, "heat that looks like flares or industry: left out") : "");
  let folded: string[] = [],
    cut: string[] = [];
  /* shown before drawing, so the map is sized to its box */
  fig.hidden = $("cStLegend").hidden = empty;
  if (!empty) {
    const listed = S.stations.length,
      coarse = matchMedia("(pointer: coarse)").matches,
      idle =
        `${coarse ? "Tap" : "Point at"} a square for its numbers.` +
        (S.stations_subset ? ` The dots are the ${fmt(listed)} stations nearest to some square, of ${fmt(S.stations_total)} ${mapped(S)}.` : ""),
      paint = () =>
        drawMini(box, d, {
          layers,
          points: osmPts,
          others: ovPts.length ? { points: ovPts, color: OVERTURE } : undefined,
          marks,
          label: `Map of ${tn}: fire stations ${mappedIn(S)} and the squares with regular fire`,
          caption: $("cStPick"),
          idle,
          pick: c => {
            const pos = posOf(d, c),
              why = F.steady.get(c);
            if (why !== undefined) return `<b>${pos.text}</b>: ${esc(whyOf(S, why)[0])}. Left out of the gaps.`;
            const p = byCell.get(c);
            if (!p) return null;
            const isGap = gapsOn && F.gapSet.has(c),
              flag =
                (isGap && desert(S.country, pos.lat, pos.lon) ? ` ${DESERT_FLAG}` : "") +
                (solarCell(pos.lat, pos.lon) ? ` ${SOLAR_FLAG}` : "");
            const only = F.gapSet.has(c) ? "" : onlyListed(S, c);
            return (
              `<b>${pos.text}</b>: fire in ${p.by} of the 14 years 2012–2025 (VIIRS), ${perYear(p.fpy)}. ${nearest(S, p, F.gapSet.has(c))}` +
              (isGap ? ` That is beyond 15 km: ${noStation(S)}.` : "") +
              (only ? ` ${ONLY_LISTED[only]}` : "") +
              flag
            );
          },
        });
    /* a wide country gets the whole row; the markers are spaced for the width the map ends up with */
    let r = paint();
    const wide = r.aspect > 1.8;
    if (grid.classList.contains("wide") !== wide) {
      grid.classList.toggle("wide", wide);
      r = paint();
    }
    folded = r.folded;
    cut = r.cut;
    /* a few squares far too small to see on a big outline: the map would look empty */
    empty = F.burn.length + F.steady.size < MIN_MAP_SQUARES && r.cellPx < 2;
  }
  fig.hidden = $("cStLegend").hidden = empty;
  if (empty) {
    box.innerHTML = $("cStPick").innerHTML = $("cStLegend").innerHTML = "";
    grid.classList.add("wide");
    folded = cut = [];
  }
  list(S, d, F, top, gapsOn, strong, folded, cut, empty);
  caveats(S, d, F, top, gapsOn);
}

const words = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
function list(
  S: CountryStations,
  d: CountrySummary,
  F: Facts,
  top: Place[],
  gapsOn: boolean,
  strong: boolean,
  folded: string[],
  cut: string[],
  noMap: boolean,
) {
  const show = $("cStShow");
  show.hidden = F.show !== "ask" || F.gaps.length === 0;
  show.textContent = V.reveal
    ? "Hide the uncertain gaps"
    : `Show the ${fmt(F.gaps.length)} uncertain gap${F.gaps.length === 1 ? "" : "s"} anyway`;
  /* the gap list */
  const gl = $("cStGapBox");
  gl.hidden = !gapsOn || !top.length;
  if (!gl.hidden) {
    const dz = top.map(p => {
        const pos = posOf(d, p.c);
        return desert(S.country, pos.lat, pos.lon);
      }),
      allDesert = dz.every(Boolean);
    $("cStListT").textContent = `Places with regular fire and ${noStation(S)}`;
    $("cStListS").innerHTML =
      (top[0].by >= 7
        ? "Among places that burned in at least 7 of the 14 years, the most fire first."
        : "These burned in 4 to 6 of the 14 years; the most fire first.") +
      (allDesert
        ? ` <span class="stFlag">${DESERT_FLAG}</span>`
        : dz.some(Boolean)
          ? ` <span class="stFlag">Places marked “in the desert” are unverified: their detections may be gas flares or industrial heat that FIRMS did not flag.</span>`
          : "");
    let group2 = top[0].by < 7;
    $("cStList").innerHTML = top
      .map((p, i) => {
        const pos = posOf(d, p.c),
          head = !group2 && p.by < 7 ? ((group2 = true), `<li class="stGrp">Then places that burned in 4 to 6 of the 14 years</li>`) : "",
          flags =
            (dz[i] && !allDesert ? `<small class="stFlag">In the desert: unverified</small>` : "") +
            (solarCell(pos.lat, pos.lon) ? `<small class="stFlag">${SOLAR_FLAG}</small>` : ""),
          osm = `https://www.openstreetmap.org/?mlat=${pos.lat.toFixed(3)}&mlon=${pos.lon.toFixed(3)}#map=11/${pos.lat.toFixed(3)}/${pos.lon.toFixed(3)}`;
        return (
          head +
          `<li><span class="stN${strong ? "" : " muted"}">${i + 1}</span><span class="stW"><b>${pos.text}</b>` +
          `<small>Burned in ${p.by} of the 14 years 2012–2025 (VIIRS) · ${perYear(p.fpy)}</small>` +
          `<small>${nearest(S, p, true)}</small>${flags}` +
          `<small><a href="${osm}" target="_blank" rel="noopener">Check the place on OpenStreetMap</a></small></span></li>`
        );
      })
      .join("");
    $("cStListNote").textContent =
      (F.gaps.length > top.length ? `The ${fmt(top.length)} at the top of ${fmt(F.gaps.length)}. ` : "") +
      (noMap
        ? ""
        : (folded.length
            ? `On the map, ${folded.length === 1 ? "number" : "numbers"} ${words(folded)} ${folded.length === 1 ? "sits" : "sit"} under a nearby mark, counted in its “+n”. `
            : "") +
          (cut.length ? `${cut.length === 1 ? "Number" : "Numbers"} ${words(cut)} ${cut.length === 1 ? "is" : "are"} not marked on a narrow screen. ` : "")) +
      (F.show === "yes" ? noteOf(S) : "");
  }
  /* how far regular fire is from a mapped station; the gaps are the places beyond 15 km, even where the file rounds
     the distance to 15.0, so the table adds up to the gap count */
  const nb = F.burn.length,
    beyond = (p: Place) => F.gapSet.has(p.c) || p.km1 > 15,
    none = `No station ${mapped(S)} in the country`,
    within = (p: Place) => p.km1 >= 0 && !beyond(p),
    bands: [string, (p: Place) => boolean][] = [
      ["Within 15 km", within],
      ["15 to 50 km", p => p.km1 >= 0 && beyond(p) && p.km1 <= 50],
      ["50 to 100 km", p => p.km1 > 50 && p.km1 <= 100],
      ["Over 100 km", p => p.km1 > 100],
      [none, p => p.km1 < 0],
    ];
  $("cStDistBox").hidden = nb === 0;
  $("cStDist").innerHTML = nb
    ? `<tr><th>Nearest ${mapped(S)} station</th><th>Places</th><th>Share</th></tr>` +
      bands
        .map(([label, f]) => {
          const k = F.burn.filter(f).length;
          return k || label !== none ? `<tr><td>${label}</td><td>${fmt(k)}</td><td>${pc(k / nb)}</td></tr>` : "";
        })
        .join("")
    : "";
  /* places counted within 15 km only thanks to an Overture listing ("three": maybe an OpenStreetMap station fourth) */
  const ol = { only: 0, three: 0, "": 0 };
  for (const p of F.burn) if (within(p)) ol[onlyListed(S, p.c)]++;
  $("cStDistNote").textContent =
    (F.show === "no" && S.completeness.level !== "unpopulated"
      ? `With so few stations ${mapped(S)}, these distances mostly show how much of the ${S.v === 3 ? "maps are" : "map is"} missing.`
      : "Places with fire in at least 4 of the 14 years; heat that looks like flares or industry is left out.") +
    (ol.only
      ? ` For ${ol.three ? "at least " : ""}${fmt(ol.only)} of the places within 15 km, the only stations that close are Overture Maps listings.`
      : "");
}

function caveats(S: CountryStations, d: CountrySummary, F: Facts, top: Place[], gapsOn: boolean) {
  const counts = new Map<string, number>();
  for (const code of F.steady.values()) {
    const t = whyOf(S, code)[1];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const steady = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${fmt(n)} ${t}`),
    deserts = F.show !== "no" && anyDesert(S, d, F.gaps),
    solarShown = gapsOn && top.some(p => {
      const pos = posOf(d, p.c);
      return solarCell(pos.lat, pos.lon);
    });
  let t =
    `<b>Read with care.</b> A gap means ${noStation(S)}, not that no station exists: ` +
    (S.v === 3 ? "neither OpenStreetMap nor Overture Maps is complete. " : "OpenStreetMap is never complete. ") +
    (S.station_sources?.overture ? "Overture Maps' places come partly from business listings, so some may be wrong or closed. " : "") +
    `Stations across a border are not counted, so near a border a distance can be too long. `;
  if (steady.length)
    t += `Squares whose heat looks like flares or industry are left out (${steady.join("; ")}); the filter can also catch some real burning. `;
  if (deserts)
    t += `In the Arabian Peninsula and the Sahara the gaps are unverified: their detections may come from gas flares, drilling or industrial heat that FIRMS did not flag. `;
  if (SOLAR.has(S.country))
    t += solarShown
      ? `Large solar plants can show up as daytime heat that the satellite reads as fire. The listed places where a recheck found almost no detections at night are marked. `
      : `Some of the regular-fire squares here may be large solar plants, which show up as daytime heat. `;
  if (top.length && d.cell >= 0.5)
    t += `A square here is ${across(d)}, so a station near its edge can still be more than 15 km from its middle. `;
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

/* ---------- a few words for the country view's side card (src/glance.ts) ---------- */
/** OpenStreetMap and Overture Maps (v3); if that file fails or stalls, OpenStreetMap alone (v2). The page and the side
    card share the files (loadChecked keeps them). */
export function stLoad(k: string) {
  const ok = (x: unknown): x is CountryStations => isStations(x, k);
  return loadChecked(stationsPath(k), ok, 20000).catch(() => loadChecked(stationsPath(k, STATIONS_FALLBACK_DIR), ok));
}
/** stations mapped, and the places with regular fire and none within 15 km where the mapping is good enough to say */
export function stGlance(S: CountryStations, d: CountrySummary) {
  const F = facts(S, d),
    nb = F.burn.length,
    ng = F.gaps.length,
    lv = S.completeness.level,
    tn = theName(S.name);
  return {
    stations: fmt(S.stations_total),
    label: `Fire stations ${mapped(S)}`,
    title: `Fire stations ${mappedIn(S)}. ${S.v === 3 ? S.attribution : "© OpenStreetMap contributors, ODbL"}`,
    gaps:
      nb === 0
        ? "No regular fire"
        : F.show === "yes"
          ? `${fmt(ng)} of ${fmt(nb)} places`
          : F.show === "ask"
            ? S.v === 3
              ? "Maps patchy"
              : "Map patchy"
            : lv === "unpopulated"
              ? "Few people live here"
              : S.v === 3
                ? "Maps too thin"
                : "Map too thin",
    gapsTitle:
      nb === 0
        ? "No place burned in 4 or more of the 14 years."
        : F.show === "yes"
          ? `Places with fire in 4 or more of 2012–2025 and ${noStation(S)}. A gap means none is ${mapped(S)}, not that none exists.` +
            (fragile(S) ? " Stations here only just reach the bar for listing gaps, so treat them as places to check." : "") +
            (anyDesert(S, d, F.gaps.slice(0, 10)) ? " In the desert some may be industrial heat." : "")
          : F.show === "ask"
            ? (S.v === 3
                ? `The fire stations in OpenStreetMap and Overture Maps look patchy in ${tn}, so the gaps are uncertain`
                : `OpenStreetMap's fire stations look patchy in ${tn}, so its gaps are uncertain`) + "; the full record lists them on request."
            : lv === "unpopulated"
              ? "Few people live here, so the full record does not look for gaps."
              : `Too few fire stations are ${mappedIn(S)} in ${tn} to judge where they are missing.`,
    facts: F,
  };
}
/** one square: years with fire, nearest mapped station (in the full page's words), whether it counts as a gap, and
    the full page's caveat or flag for it */
export function stCell(S: CountryStations, d: CountrySummary, c: number, F = facts(S, d)) {
  if (c >= F.n) return null;
  const km1 = S.cell_rows[8 * c + 4],
    s1 = S.cell_rows[8 * c + 1],
    gap = F.show === "yes" && F.gapSet.has(c),
    has = km1 >= 0 && s1 >= 0,
    pos = posOf(d, c),
    lv = S.completeness.level,
    src = has ? S.stations[s1]?.[4] : undefined,
    only = has && !F.gapSet.has(c) && !F.steady.has(c) ? onlyListed(S, c) : "";
  return {
    burnYears: S.cell_rows[8 * c + 7],
    km: has ? (gap && km1 < 15.5 ? "just over 15 km" : km(km1)) : null,
    /* the name, and where the station comes from (contract v3, rule 2) */
    station: has ? stationName(S, s1) + (src ? ` (${FROM[src]})` : "") : "",
    label: `Nearest ${mapped(S)} fire station`,
    /* the sentence after the name for a gap */
    gapText: `${noStation(S)[0].toUpperCase()}${noStation(S).slice(1)}; that does not mean none exists.`,
    gap,
    steady: F.steady.has(c),
    note: !has
      ? ""
      : F.show === "ask"
        ? S.v === 3
          ? "The stations in OpenStreetMap and Overture Maps look patchy here, so this distance partly measures the maps."
          : "OpenStreetMap's stations look patchy here, so this distance partly measures the map."
        : F.show === "no" && lv !== "unpopulated"
          ? `With this little ${mapped(S)}, the distance mostly measures the ${S.v === 3 ? "maps" : "map"}, not the fire service.`
          : only
            ? ONLY_LISTED[only]
            : "",
    flag: gap && desert(S.country, pos.lat, pos.lon) ? DESERT_FLAG : solarCell(pos.lat, pos.lon) ? SOLAR_FLAG : "",
  };
}
