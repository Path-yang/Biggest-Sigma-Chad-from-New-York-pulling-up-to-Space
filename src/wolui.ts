import { MONL } from "./data";
import { $ } from "./util";
import { cutEdge, near, nameOf, shapeOf, theName } from "./world";
import {
  type CountryRegion,
  type RegionOutlook,
  type WorldOutlook,
  cellBounds,
  countryRegions,
  halfMonth,
  loadWorldOutlook,
  wolLoad,
  wolRun,
} from "./wol";

/* =====================================================================
   "NEXT 14 DAYS" ON THE COUNTRY PAGE: a headline, three figures, a small map of the country's regions coloured by
   how much the forecast weather moves the chance of a busier fortnight than usual, a ranked list, and how it was
   tested. "Normal" is the model's own chance with average weather, so the colour is the weather's effect alone.
   ===================================================================== */
/** a change of at least this much (in chance) marks a region as above or below normal */
const REGION_STEP = 0.05;
/** and this much, weighted over the country, the country as a whole */
const COUNTRY_STEP = 0.03;
/** class edges of the change, in chance, and the colours between them (the calendar's "versus normal" ramp) */
const EDGES = [-0.15, -0.08, -0.03, 0.03, 0.08, 0.15];
const RAMP = ["#2166ac", "#67a9cf", "#d1e5f0", "#f4f2ec", "#fddbc7", "#ef8a62", "#b2182b"];
const MINOR = "#e4e0d7";
/** a forecast this many standard deviations from a region's usual weather happened in about 1% of the training
    fortnights (NASA POWER, 2012-2025). Live, it more often means Open-Meteo and POWER disagree (their offsets were
    learned in August and September only), so such regions are shown but left out of the headline and the list. */
const ODD_Z = 3.5;
const ODD = "#c9c2b4";
/** the backtest's top bin came true less often than predicted, so the page does not show more than this */
const P_CAP = 0.85;

const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const colour = (d: number) => RAMP[EDGES.filter(e => d >= e).length];
const pct = (p: number) => (p > P_CAP ? "over 85%" : p < 0.02 ? "under 2%" : Math.round(p * 100) + "%");
const pts = (d: number) => {
  const r = Math.round(d * 100);
  return r === 0 ? "no change" : `${r > 0 ? "+" : "−"}${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"}`;
};
const signed = (x: number, dp = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(dp)}%`;
const deg = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(1)}°${v < 0 ? n : p}`;
/** "15–28 November 2026", "29 November – 12 December 2026" */
function span(a: string, b: string) {
  const [y0, m0, d0] = a.split("-").map(Number),
    [y1, m1, d1] = b.split("-").map(Number);
  if (y0 !== y1) return `${d0} ${MONL[m0 - 1]} ${y0} – ${d1} ${MONL[m1 - 1]} ${y1}`;
  if (m0 !== m1) return `${d0} ${MONL[m0 - 1]} – ${d1} ${MONL[m1 - 1]} ${y1}`;
  return `${d0}–${d1} ${MONL[m1 - 1]} ${y1}`;
}
const halfName = (hm: number) => `the ${hm % 2 ? "second" : "first"} half of ${MONL[hm >> 1]}`;
const ZONE_NAME: Record<string, string> = {
  tropics: "the tropics",
  subtropics: "the subtropics",
  temperate: "temperate latitudes",
  boreal: "the far north and south",
};

/* ---------- where the country's regions lie ---------- */
interface Placed extends CountryRegion {
  /** the square, unwrapped around the country's label point: west, south, east, north */
  box: [number, number, number, number];
  /** centre in a flat frame where one unit is about one degree of latitude */
  x: number;
  y: number;
  r: RegionOutlook | null;
  minor: boolean;
  /** the backtest did not beat the usual odds in this region */
  noSkill: boolean;
  /** forecast weather far outside the region's usual range: shown, but left out of the summaries */
  odd: boolean;
}
interface Layout {
  lon0: number;
  kx: number;
  cells: Placed[];
}
function place(O: WorldOutlook, k: string): Layout {
  const { used, minor } = countryRegions(O, k),
    all = [...used.map(r => ({ ...r, minor: false })), ...minor.map(r => ({ ...r, minor: true }))],
    shape = shapeOf(k),
    b0 = cellBounds(O.regions.band[all[0].ri], O.regions.col[all[0].ri]),
    lon0 = shape ? shape.c[0] : (b0[0] + b0[2]) / 2,
    boxes = all.map(r => {
      const b = cellBounds(O.regions.band[r.ri], O.regions.col[r.ri]),
        w = b[2] - b[0],
        c = near((b[0] + b[2]) / 2, lon0);
      return [c - w / 2, b[1], c + w / 2, b[3]] as [number, number, number, number];
    }),
    latMid = boxes.reduce((a, b) => a + (b[1] + b[3]) / 2, 0) / boxes.length,
    kx = Math.max(0.2, Math.cos((latMid * Math.PI) / 180)),
    run = wolRun(k);
  return {
    lon0,
    kx,
    cells: all.map((r, i) => ({
      ...r,
      box: boxes[i],
      x: ((boxes[i][0] + boxes[i][2]) / 2) * kx,
      y: (boxes[i][1] + boxes[i][3]) / 2,
      r: (!r.minor && run?.rows.get(r.ri)) || null,
      noSkill: (O.regions.bss[r.ri] ?? 1) <= 0,
      odd: !r.minor && (run?.rows.get(r.ri)?.zMax ?? 0) > ODD_Z,
    })),
  };
}
/** "north", "south-west", "centre": where a set of regions sits against the whole country */
function compass(cells: Placed[], sub: Placed[]): string {
  /* weights are shares of the country's fire, nudged so a region holding under 0.05% still has a place */
  const wt = (c: Placed) => c.share + 1e-6,
    mean = (cs: Placed[]) => {
      const s = cs.reduce((a, c) => a + wt(c), 0);
      return [cs.reduce((a, c) => a + c.x * wt(c), 0) / s, cs.reduce((a, c) => a + c.y * wt(c), 0) / s];
    };
  const [x0, y0] = mean(cells),
    [x1, y1] = mean(sub),
    s = cells.reduce((a, c) => a + c.share, 0) || 1,
    spread = Math.sqrt(cells.reduce((a, c) => a + c.share * ((c.x - x0) ** 2 + (c.y - y0) ** 2), 0) / s),
    dx = x1 - x0,
    dy = y1 - y0;
  if (spread < 0.5) return "centre";
  if (Math.hypot(dx, dy) < 0.35 * spread) {
    /* near the middle on average: either really in the middle, or spread all over */
    const s1 = sub.reduce((a, c) => a + c.share, 0) || 1,
      subSpread = Math.sqrt(sub.reduce((a, c) => a + c.share * ((c.x - x1) ** 2 + (c.y - y1) ** 2), 0) / s1);
    return sub.length > 1 && subSpread > 0.6 * spread ? "scattered" : "centre";
  }
  const a = (Math.atan2(dy, dx) * 180) / Math.PI,
    i = Math.round(((90 - a + 360) % 360) / 45) % 8;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i];
}
/** where one region sits against the country's fire-weighted centre, for the list and the map's notes */
const whereIn = (cells: Placed[], c: Placed) =>
  compass(
    cells.filter(z => !z.minor),
    [c],
  );
/** "Kenya's", "the United States'" */
const poss = (t: string) => (/s$/.test(t) ? `${t}'` : `${t}'s`);
/** what "busier than usual" means in a region at this time of year */
const busier = (thr: number) =>
  thr === 0 ? "at least one hotspot" : `more than ${thr.toLocaleString("en-US")} hotspot${thr === 1 ? "" : "s"}`;

/* ---------- the open country ---------- */
let openK: string | null = null;
export function olOpen(k: string) {
  openK = k;
  $("cOl").hidden = false;
  state(`Loading the outlook for ${theName(nameOf(k))}…`);
  $("cOlMain").hidden = true;
  $("cOlTitle").textContent = "Next 14 days";
  $("cOlKick").textContent = "Next 14 days";
  $("cOlSub").textContent = $("cOlHow").innerHTML = $("cOlSrc").textContent = "";
  $("cOlFigs").innerHTML = $("cOlMap").innerHTML = $("cOlList").innerHTML = $("cOlLegend").innerHTML = "";
  start(k);
}
export function olClose() {
  openK = null;
}
function start(k: string) {
  loadWorldOutlook().then(
    O => {
      if (openK !== k) return;
      const name = nameOf(k),
        m = O.metrics.by_country[k];
      if (!O.countries[k] || !m) return noRegions(O, k, name);
      if (m[0] <= 0) return noSkill(O, k, name);
      wolLoad(O, k, () => openK === k && draw(O, k));
    },
    () => {
      if (openK !== k) return;
      state("The outlook's data file did not load.", true);
    },
  );
}
function state(msg: string, retry = false) {
  $("cOlState").hidden = !msg;
  $("cOlMsg").textContent = msg;
  $("cOlRetry").hidden = !retry;
}
export function olEventsWorld() {
  $("cOlRetry").onclick = () => {
    if (!openK) return;
    state("Trying again…");
    start(openK);
  };
}

/* ---------- the three cases without a map ---------- */
function noRegions(O: WorldOutlook, k: string, name: string) {
  const n = O.no_region[k];
  $("cOlTitle").textContent = "Too little fire history for an outlook";
  $("cOlSub").textContent = n
    ? `NASA's VIIRS satellite counted only ${n.toLocaleString("en-US")} fire hotspot${n === 1 ? "" : "s"} in ${theName(name)} from 2012 to 2025. ` +
      `That is too few to say what a usual fortnight looks like, so there is no 14-day outlook here.`
    : `NASA's VIIRS satellite counted no fire hotspots in ${theName(name)} from 2012 to 2025, so there is nothing to forecast here.`;
  state("");
  $("cOlHow").innerHTML = "";
  $("cOlSrc").textContent =
    `The 14-day outlook covers the ${Object.keys(O.countries).length} countries and territories with enough fire history.`;
}
function noSkill(O: WorldOutlook, k: string, name: string) {
  const m = O.metrics.by_country[k];
  $("cOlTitle").textContent = `No 14-day outlook we can stand behind for ${theName(name)}`;
  $("cOlSub").textContent =
    `In past years this outlook did not beat the usual odds in ${theName(name)} (Brier skill ${signed(m[0])}), even when it was given the weather that actually happened. ` +
    `Treat the next two weeks as usual for the time of year. We do not fetch a forecast for it.`;
  state("");
  how(O, k, name);
}

/* ---------- the outlook ---------- */
function draw(O: WorldOutlook, k: string) {
  const run = wolRun(k),
    name = nameOf(k),
    tn = theName(name),
    n = countryRegions(O, k).used.length;
  if (!run) return;
  if (run.status === "loading") {
    $("cOlMain").hidden = true;
    state(`Fetching the weather forecast for ${poss(tn)} ${n} region${n === 1 ? "" : "s"} from Open-Meteo…`);
    return;
  }
  if (run.status === "error") {
    $("cOlMain").hidden = true;
    $("cOlTitle").textContent = "Next 14 days";
    $("cOlSub").textContent = "";
    state(`${run.err} The rest of this page is unaffected.`, true);
    how(O, k, name);
    return;
  }
  /* part of the forecast missing: the rest is shown, with a note and Retry */
  state(run.err ? `${run.err} ${run.missing} region${run.missing === 1 ? " has" : "s have"} no outlook and show white.` : "", !!run.err);
  const L = place(O, k),
    live = L.cells.filter(c => c.r && !c.odd),
    odd = L.cells.filter(c => c.r && c.odd),
    allShare = L.cells.filter(c => c.r).reduce((a, c) => a + c.share, 0) || 1,
    oddShare = odd.reduce((a, c) => a + c.share, 0) / allShare,
    sw = live.reduce((a, c) => a + c.share, 0) || 1,
    P = live.reduce((a, c) => a + c.share * c.r!.p, 0) / sw,
    N = live.reduce((a, c) => a + c.share * c.r!.norm, 0) / sw,
    D = P - N,
    up = live.filter(c => c.r!.p - c.r!.norm >= REGION_STEP),
    down = live.filter(c => c.r!.p - c.r!.norm <= -REGION_STEP),
    upShare = up.reduce((a, c) => a + c.share, 0) / sw,
    downShare = down.reduce((a, c) => a + c.share, 0) / sw,
    many = live.length > 2,
    /* " in the north", " in scattered regions", " across most of the country" */
    where = (sub: Placed[], share: number) => {
      if (!many) return "";
      if (share >= 0.6) return " across most of the country";
      const w = compass(live, sub);
      return w === "scattered" ? " in scattered regions" : w === "centre" ? " in the centre of the country" : ` in the ${w}`;
    };
  /* the headline */
  const lead = "Fire risk over the next two weeks is";
  let head: string;
  if (!live.length) head = `No reliable outlook for ${tn} today: the forecast weather is far outside the usual range for the date`;
  else if (D >= COUNTRY_STEP) head = `${lead} above normal${where(up.length ? up : live, up.length ? upShare : 1)}`;
  else if (D <= -COUNTRY_STEP) head = `${lead} below normal${where(down.length ? down : live, down.length ? downShare : 1)}`;
  else if (upShare >= 0.1 && downShare >= 0.1 && many)
    head = `${lead} close to normal overall: above normal${where(up, upShare)}, below${where(down, downShare)}`;
  else if (upShare >= 0.1 && many) head = `${lead} close to normal overall, but above normal${where(up, upShare)}`;
  else if (downShare >= 0.1 && many) head = `${lead} close to normal overall, but below normal${where(down, downShare)}`;
  else head = `${lead} close to normal`;
  const hm = halfMonth(run.today);
  $("cOlKick").textContent = `Next 14 days · ${span(run.today, run.end)}`;
  $("cOlTitle").textContent = head;
  $("cOlSub").textContent =
    `The chance that each region sees more satellite fire detections over ${span(run.today, run.end)} than in a usual fortnight for ${halfName(hm)}, ` +
    `against its chance with average weather. Weather: Open-Meteo forecast; trained on NASA POWER.` +
    (odd.length && oddShare >= 0.25
      ? ` Read with care: in ${odd.length} of ${odd.length + live.length} regions, holding ${Math.round(oddShare * 100)}% of the fire, the forecast weather is far outside anything seen at this time of year, more likely a disagreement between the two weather sources than real weather. They are shown in grey and left out of the summaries.`
      : "");
  /* three figures */
  const m = O.metrics.by_country[k],
    verdict = D >= COUNTRY_STEP ? ["hi", "Above normal"] : D <= -COUNTRY_STEP ? ["lo", "Below normal"] : ["", "Near normal"];
  $("cOlFigs").innerHTML =
    `<div class="cpAns"><h2>The whole country</h2><p class="cpFig"><span class="${verdict[0]}">${verdict[1]}</span>` +
    `<small>${pct(P)} chance of a busier fortnight than usual, against ${pct(N)} with average weather</small></p>` +
    `<p>Averaged over ${many ? `its ${live.length} regions` : live.length === 2 ? "its two regions" : "its one region"}, each weighted by its share of ${esc(poss(tn))} fire.` +
    (odd.length
      ? ` ${odd.length === 1 ? "One region is" : `${odd.length} regions are`} left out: ${odd.length === 1 ? "its" : "their"} forecast weather is far outside the usual range.`
      : "") +
    `</p></div>` +
    `<div class="cpAns"><h2>Regions above normal</h2><p class="cpFig">${up.length} of ${live.length}</p>` +
    `<p>The weather raises the chance by 5 points or more in ${up.length === 1 ? "one region" : `${up.length} regions`}, and lowers it as much in ${down.length === 1 ? "one" : down.length}. A region is about 280 km across.</p></div>` +
    `<div class="cpAns"><h2>Track record</h2><p class="cpFig">${signed(m[0])}<small>against the usual odds</small></p>` +
    `<p>Brier skill in ${esc(tn)}, tested on 2012–2025 with the weather that actually happened. With a real forecast, expect less.</p></div>`;
  legend(L);
  drawMap(L, k, run.missing);
  list(O, L, tn);
  /* with every region left out there is nothing to sum up or rank, only the map */
  $("cOlFigs").hidden = $("cOlList").parentElement!.hidden = !live.length;
  $("cOlMain").hidden = false;
  how(O, k, name, run.at);
}

function legend(L: Layout) {
  const steps =
    RAMP.map(
      (c, i) =>
        `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : (EDGES[i - 1] > 0 ? "+" : "") + Math.round(EDGES[i - 1] * 100)}</span></div>`,
    ).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span></span></div>`;
  const hatch = L.cells.some(c => c.noSkill),
    minor = L.cells.some(c => c.minor),
    odd = L.cells.some(c => c.odd);
  $("cOlLegend").innerHTML =
    `<div><b>Change from the weather, percentage points</b><div class="cpKey">${steps}</div></div>` +
    (hatch ? `<span class="cpNone"><i class="cpHatch"></i>no skill here in past tests</span>` : "") +
    (odd ? `<span class="cpNone"><i style="background:${ODD}"></i>weather far outside its usual range, left out</span>` : "") +
    (minor ? `<span class="cpNone"><i style="background:${MINOR}"></i>little fire, not forecast</span>` : "");
}

/* ---------- the map: the country's outline and its regions, drawn flat ---------- */
function drawMap(L: Layout, k: string, missing: number) {
  const S = 10,
    X = (lon: number) => (lon - L.lon0) * L.kx * S,
    Y = (lat: number) => -lat * S;
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const c of L.cells) {
    x0 = Math.min(x0, X(c.box[0]));
    x1 = Math.max(x1, X(c.box[2]));
    y0 = Math.min(y0, Y(c.box[3]));
    y1 = Math.max(y1, Y(c.box[1]));
  }
  const pad = 0.08 * Math.max(x1 - x0, y1 - y0) + 4;
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  /* a wide country (Russia, Canada) gets the whole width, with the list under it */
  $("cOlMap")
    .closest(".cpOlGrid")
    ?.classList.toggle("wide", (x1 - x0) / (y1 - y0) > 1.8);
  /* the outline: land as one filled path, borders as lines without the antimeridian cuts */
  const shape = shapeOf(k);
  let land = "",
    lines = "";
  if (shape)
    for (const r of shape.r) {
      const off = near(r[0], L.lon0) - r[0];
      land += "M";
      for (let i = 0; i < r.length; i += 2) land += `${X(r[i] + off).toFixed(1)},${Y(r[i + 1]).toFixed(1)} `;
      land += "Z";
      for (let i = 0; i + 3 < r.length; i += 2) {
        if (cutEdge(k, r[i], r[i + 1], r[i + 2], r[i + 3])) continue;
        lines += `M${X(r[i] + off).toFixed(1)},${Y(r[i + 1]).toFixed(1)}L${X(r[i + 2] + off).toFixed(1)},${Y(r[i + 3]).toFixed(1)}`;
      }
    }
  const cells = L.cells
    .map((c, i) => {
      const fill = c.minor ? MINOR : c.odd ? ODD : c.r ? colour(c.r.p - c.r.norm) : "#fff";
      const rect = `x="${X(c.box[0]).toFixed(1)}" y="${Y(c.box[3]).toFixed(1)}" width="${(X(c.box[2]) - X(c.box[0])).toFixed(1)}" height="${(Y(c.box[1]) - Y(c.box[3])).toFixed(1)}"`;
      return (
        `<rect ${rect} fill="${fill}" class="olCell" data-i="${i}"/>` +
        (c.noSkill && c.r ? `<rect ${rect} fill="url(#olHatch)" pointer-events="none"/>` : "")
      );
    })
    .join("");
  $("cOlMap").innerHTML =
    `<svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}" role="img" aria-label="Map of ${esc(poss(theName(nameOf(k))))} regions, coloured by how much the forecast weather changes the chance of a busier fortnight than usual">` +
    `<defs><pattern id="olHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#55524c" stroke-width="1.2" vector-effect="non-scaling-stroke"/></pattern></defs>` +
    `<path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/>` +
    `<g stroke="#fffefa" stroke-width="1" vector-effect="non-scaling-stroke">${cells}</g>` +
    `<path d="${lines}" fill="none" stroke="#1b1b1b" stroke-opacity=".75" stroke-width="1.1" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
    `</svg>`;
  const pick = $("cOlPick"),
    idle =
      (coarseP() ? "Tap" : "Point at") +
      " a square for its numbers." +
      (missing ? ` ${missing} region${missing === 1 ? "" : "s"} had gaps in the forecast and show white.` : "");
  pick.textContent = idle;
  const svg = $("cOlMap").querySelector("svg")!;
  let on: SVGRectElement | null = null;
  const show = (e: Event) => {
    const t = e.target as Element;
    if (!(t instanceof SVGRectElement) || !t.classList.contains("olCell")) return;
    if (on) on.classList.remove("on");
    on = t;
    t.classList.add("on");
    pick.innerHTML = cellText(L, L.cells[Number(t.dataset.i)]);
  };
  svg.onpointerover = show;
  svg.onclick = show;
  svg.onpointerleave = () => {
    if (coarseP()) return;
    if (on) on.classList.remove("on");
    on = null;
    pick.textContent = idle;
  };
}
const coarseP = () => matchMedia("(pointer: coarse)").matches;
function cellText(L: Layout, c: Placed) {
  const b = c.box,
    pos = `${deg(b[1], "N", "S")}–${deg(b[3], "N", "S")}, ${deg(near(b[0], 0), "E", "W")}–${deg(near(b[2], 0), "E", "W")}`,
    sh = c.share >= 0.01 ? `${Math.round(c.share * 100)}%` : c.share >= 0.001 ? `${(c.share * 100).toFixed(1)}%` : "under 0.1%";
  if (c.minor) return `<b>${cap(whereIn(L.cells, c))}, ${pos}</b>: ${sh} of the country's fire, too little to forecast here.`;
  if (!c.r) return `<b>${cap(whereIn(L.cells, c))}, ${pos}</b>: no outlook, the forecast had gaps.`;
  const r = c.r;
  return (
    `<b>${cap(whereIn(L.cells, c))}, ${pos}</b>: ${pct(r.p)} chance of ${busier(r.thr)} in 14 days, ` +
    `against ${pct(r.norm)} with average weather (${pts(r.p - r.norm)}). ${sh} of the country's fire.` +
    (c.noSkill ? " In past tests the outlook did not beat the usual odds in this region." : "") +
    (c.odd
      ? ` Left out: the forecast weather here is ${c.r.zMax.toFixed(1)} standard deviations from the usual for the date, which happened in about 1 in 100 past fortnights; more likely the two weather sources disagree.`
      : "")
  );
}

/* ---------- the ranked list ---------- */
function list(O: WorldOutlook, L: Layout, tn: string) {
  const live = L.cells.filter(c => c.r && !c.odd),
    big = live.filter(c => c.share >= 0.01),
    pool = big.length >= 3 ? big : live,
    by = (c: Placed) => c.r!.p - c.r!.norm,
    rising = pool.some(c => by(c) >= 0.03) || !pool.some(c => by(c) <= -0.03),
    rows = pool
      .slice()
      .sort((a, b) => (rising ? by(b) - by(a) : by(a) - by(b)))
      .slice(0, 5);
  $("cOlListT").textContent = rising ? "Where the weather raises the odds most" : "Where the weather lowers the odds most";
  $("cOlList").innerHTML = rows
    .map(c => {
      const r = c.r!,
        d = by(c);
      return (
        `<li><span class="olW"><b>${cap(whereIn(L.cells, c))}${c.noSkill ? " †" : ""}</b>` +
        `<small>near ${deg(O.regions.lat[c.ri], "N", "S")}, ${deg(O.regions.lon[c.ri], "E", "W")} · ${Math.round(c.share * 100) || "<1"}% of ${esc(poss(tn))} fire</small>` +
        `<small>busier than usual: ${busier(r.thr)} in 14 days</small></span>` +
        `<span class="olN">${pct(r.p)}<small>vs ${pct(r.norm)}</small></span><span class="olD" style="--c:${colour(d)}">${pts(d)}</span></li>`
      );
    })
    .join("");
  $("cOlListNote").textContent =
    (big.length >= 3 ? "Regions holding at least 1% of the country's fire. " : "") +
    (rows.some(c => c.noSkill) ? "† In past tests the outlook did not beat the usual odds in this region." : "");
}

/* ---------- how it was made, with this country's numbers ---------- */
function how(O: WorldOutlook, k: string, name: string, at = 0) {
  const tn = theName(name),
    m = O.metrics.by_country[k],
    regs = O.countries[k] || [],
    /* the climate zone holding most of the country's fire */
    zw = new Map<number, number>();
  regs.forEach(([ri, s]) => zw.set(O.regions.zone[ri], (zw.get(O.regions.zone[ri]) || 0) + s + 0.001));
  const zi = [...zw.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    zone = zi == null ? null : O.zones[zi],
    zm = zone ? O.metrics.by_zone[zone] : null,
    all = O.metrics.variants,
    shipped = Object.entries(all).find(([key]) => /^shipped: observed next 14/.test(key))?.[1],
    blurred = Object.entries(all).find(([key]) => /blurred/.test(key))?.[1];
  const skill = !!m && m[0] > 0,
    test =
      m && zm && zone
        ? !skill
          ? `Tested year by year on 2012–2025, each year predicted by a model fitted on the others, it did not beat the usual odds in ${esc(tn)} ` +
            `(Brier skill ${signed(m[0])}; AUC ${m[2].toFixed(2)} → ${m[1].toFixed(2)}), though it did by ${signed(zm.model.bss)} across ${ZONE_NAME[zone] || zone} as a whole. `
          : `Tested year by year on 2012–2025, each year predicted by a model fitted on the others, it beat the usual odds by ${signed(m[0])} in ${esc(tn)} ` +
            `and by ${signed(zm.model.bss)} across ${ZONE_NAME[zone] || zone} (Brier skill; AUC ${m[2].toFixed(2)} → ${m[1].toFixed(2)} in ${esc(tn)}). `
        : "";
  $("cOlHow").innerHTML =
    `<b>How this works.</b> For each region about 280 km across, a statistical model starts from how often this half of the month has been busier than usual ` +
    `(VIIRS hotspots, 2012–2025) and moves that chance with the forecast heat, air dryness and rain of the next 14 days and the rain of the past 30. ` +
    test +
    (!skill
      ? `<b>Those tests used the weather that actually happened (NASA POWER), not a forecast,</b> so a real forecast would not do better here.`
      : `<b>Those tests used the weather that actually happened (NASA POWER), not a forecast,</b> so they are a best case: with Open-Meteo's forecast, a different source, ` +
        `expect a few percent better than the usual odds (the gap between the two sources alone cut the worldwide score from ${shipped ? signed(shipped.bss) : "+8.9%"} to ${blurred ? signed(blurred.bss) : "+5.2%"} in a simulation).`);
  $("cOlSrc").textContent =
    (at
      ? `Forecast fetched ${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. `
      : "") +
    `Weather: Open-Meteo forecast; trained on NASA POWER (MERRA-2). Fire history: NASA FIRMS, VIIRS on Suomi NPP. ` +
    `Each region's weather is read at one point, the centre of its busiest patch, and regions cross borders. Hotspots are detections, not fires, and many are farm or managed burns.`;
}
