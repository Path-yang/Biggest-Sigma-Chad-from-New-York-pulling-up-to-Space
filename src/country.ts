import type { CalendarMode, CountrySummary, Epochs, Ring, SensorSeries, SeriesAnalysis } from "./types";
import { MON, MONL } from "./data";
import { $, fmt, short } from "./util";
import { LUT, div, paintRamp, seq } from "./color";
import { analyseSeries, harmWith, leadText, verdict } from "./model";
import { bars, calendarInto, lines } from "./charts";
import { hideTip, showTip } from "./tooltip";
import { save } from "./downloads";
import { HF_DATASET, HF_PAGE, fileUrl, loadSummary, summaryPath } from "./hf";
import { WORLD, countryAt, cutEdge, nameOf, near, shapeOf } from "./world";

/* =====================================================================
   COUNTRY VIEW: one country's summary, fetched from Hugging Face when the reader opens it
   ===================================================================== */
interface CountryView {
  /** FIRMS name of the open country, or null when the view is closed */
  k: string | null;
  d: CountrySummary | null;
  R: SeriesAnalysis | null;
  yFrom: number;
  yTo: number;
  /** [year, month] tested for "was it unusual?" */
  focus: number[];
  mode: CalendarMode;
}
const CV: CountryView = { k: null, d: null, R: null, yFrom: 2001, yTo: 2025, focus: [2025, 0], mode: "count" };
/** first year each sensor's record covers in the dataset; Aqua's comes from the file */
const SENSOR_FROM = { T: 2000, V: 2012, N20: 2018 };
const SENSORS: { s: keyof SensorSeries; name: string; c: string; dash?: string }[] = [
  { s: "T", name: "Terra", c: "#6fa8ff" },
  { s: "A", name: "Aqua", c: "#a9c7f5" },
  { s: "V", name: "Suomi NPP", c: "#ff8a3d" },
  { s: "N20", name: "NOAA-20", c: "#bcc5d3", dash: "5 4" },
];
const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const pc = (x: number | null) => (x == null ? "n/a" : Math.round(x * 100) + "%");
/** "1 hotspot", "2 hotspots", "0.4 hotspots" */
const nHot = (n: number) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
const epochs = (d: CountrySummary): Epochs => ({
  vi0: (d.viirs_from[0] - d.y0) * 12 + d.viirs_from[1] - 1,
  aq0: (d.aqua_from[0] - d.y0) * 12 + d.aqua_from[1] - 1,
  bins: d.bins,
});

export const countryOpen = () => CV.k !== null;
export function openCountry(k: string) {
  if (CV.k === k && CV.d) return;
  CV.k = k;
  CV.d = CV.R = null;
  const el = $("country");
  el.hidden = false;
  el.scrollTop = 0;
  $("cName").textContent = nameOf(k);
  $("cCrumb").textContent = "Country";
  requestAnimationFrame(() => el.classList.add("in"));
  load();
}
export function closeCountry() {
  if (CV.k === null) return;
  CV.k = null;
  hideTip();
  const el = $("country");
  el.classList.remove("in");
  el.hidden = true;
}
/** a country address that matched nothing */
export function countryMissing(slug: string) {
  CV.k = "";
  CV.d = CV.R = null;
  const el = $("country");
  el.hidden = false;
  el.classList.add("in");
  $("cName").textContent = "Not found";
  $("cCrumb").textContent = "Country";
  $("cBody").hidden = $("cCtl").hidden = true;
  $("cStatus").hidden = false;
  $("cBar").parentElement!.hidden = $("cRetry").hidden = true;
  $("cMsg").textContent = `There is no country at "#c/${slug}". Go back to the globe, or search for a country there.`;
}

function load() {
  const k = CV.k!,
    name = nameOf(k);
  $("cBody").hidden = $("cCtl").hidden = true;
  $("cStatus").hidden = false;
  $("cRetry").hidden = true;
  $("cBar").parentElement!.hidden = false;
  $("cBar").style.width = "0";
  $("cMsg").textContent = `Loading ${name} from Hugging Face…`;
  loadSummary(k, (got, total) => {
    if (CV.k !== k) return;
    const mb = (n: number) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
    if (total && got <= total) {
      $("cBar").style.width = (got / total) * 100 + "%";
      $("cMsg").textContent = `Loading ${name} from Hugging Face… ${mb(got)} of ${mb(total)}`;
    } else $("cMsg").textContent = `Loading ${name} from Hugging Face… ${mb(got)}`;
  })
    .then(d => {
      if (CV.k !== k) return;
      CV.d = d;
      start(d);
    })
    .catch((e: unknown) => {
      if (CV.k !== k) return;
      $("cBar").parentElement!.hidden = true;
      $("cMsg").textContent = `Could not load ${name} from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("cRetry").hidden = false;
    });
}
function start(d: CountrySummary) {
  const yo: string[] = [];
  for (let y = d.y0; y <= d.y1; y++) yo.push(`<option>${y}</option>`);
  $("cFrom").innerHTML = $("cTo").innerHTML = $("cfY").innerHTML = yo.join("");
  CV.yFrom = d.y0;
  CV.yTo = d.y1;
  $("cFrom").value = String(d.y0);
  $("cTo").value = String(d.y1);
  /* test the busiest month of the latest year by default */
  const last = (d.y1 - d.y0) * 12,
    ep = epochs(d),
    hs = MON.map((_, m) => harmWith(d, ep, last + m, d.monthly.T[last + m], d.monthly.A[last + m], d.monthly.V[last + m]).h);
  CV.focus = [d.y1, hs.indexOf(Math.max(...hs))];
  if (Math.max(...hs) === 0)
    for (let i = last + 11; i >= 0; i--)
      if (harmWith(d, ep, i, d.monthly.T[i], d.monthly.A[i], d.monthly.V[i]).h > 0) {
        CV.focus = [d.y0 + Math.floor(i / 12), i % 12];
        break;
      }
  $("cStatus").hidden = true;
  $("cBody").hidden = $("cCtl").hidden = false;
  $("cName").textContent = d.name;
  renderCountry();
}

function renderCountry() {
  const d = CV.d;
  if (!d) return;
  const ep = epochs(d),
    R = analyseSeries({
      T: d.monthly.T,
      A: d.monthly.A,
      V: d.monthly.V,
      y0: d.y0,
      yFrom: CV.yFrom,
      yTo: CV.yTo,
      vi0: ep.vi0,
      harm: (i, t, a, v) => harmWith(d, ep, i, t, a, v),
    }),
    name = d.name;
  CV.R = R;
  $("cCrumb").textContent = `Country · ${CV.yFrom}–${CV.yTo}`;
  $("cLead").textContent =
    (R.total === 0 ? `No vegetation fire hotspots were counted in ${name} in these years.` : leadText(R)) +
    (CV.yFrom < d.viirs_from[0] && d.val.monthly_wape != null && d.val.monthly_wape > 1
      ? ` Years before ${d.viirs_from[0]} are rough here: tested on years VIIRS saw, converted months were off by ${pc(d.val.monthly_wape)} on average.`
      : "");
  answers(R);
  drawMap();
  const N20 = d.monthly.N20,
    pickFocus = (y: number, m: number) => {
      CV.focus = [y, m];
      renderCountry();
    };
  calendarInto($("cCal"), R, {
    mode: CV.mode,
    focus: true,
    focusYM: CV.focus,
    vi0: ep.vi0,
    more: r => `Raw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])} (not used)`,
    click: r => pickFocus(r.y, r.m),
  });
  document
    .querySelectorAll<HTMLButtonElement>("#cModeSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === CV.mode)));
  $("cCalNote").textContent =
    CV.mode === "count"
      ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual."
      : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.";
  paintRamp("cCalRamp", CV.mode === "count" ? seq : t => div(t * 2 - 1));
  $("cCalLo").textContent = CV.mode === "count" ? "fewer" : "⅛× normal";
  $("cCalHi").textContent = CV.mode === "count" ? "more (log scale)" : "8× normal";
  const ys = R.years,
    xs = ys.map(y => y.y),
    top: number[] = [];
  ys.map((y, i) => [y.h, i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .forEach(a => {
      if (a[0] > 0 && !top.some(i => Math.abs(i - a[1]) < 2)) top.push(a[1]);
    });
  bars(
    $("cYears"),
    xs,
    ys.map(y => y.h),
    {
      aria: "Hotspots per year",
      step: Math.ceil(xs.length / 9),
      sel: xs.indexOf(CV.focus[0]),
      avg: R.mean,
      top,
      hatch: i => xs[i] < 2012,
      lo: ys.map(y => y.lo),
      hi: ys.map(y => y.hi),
      whisk: i => xs[i] < 2012,
      tip: i =>
        `${xs[i]}: ${nHot(ys[i].h)}\n${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` +
        (xs[i] < 2012 ? `\nConverted from MODIS, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "\nSeen by VIIRS"),
      click: i => pickFocus(xs[i], CV.focus[1]),
    },
  );
  bars(
    $("cMonths"),
    MON,
    R.stats.map(z => z.med),
    {
      aria: "Typical hotspots by calendar month",
      sel: CV.focus[1],
      lo: R.stats.map(z => z.q1),
      hi: R.stats.map(z => z.q3),
      whisk: () => true,
      tip: m =>
        `${MONL[m]}\nTypical: ${nHot(R.stats[m].med)}\nHalf of years fall between ${fmt(R.stats[m].q1)} and ${fmt(R.stats[m].q3)}`,
      click: m => pickFocus(CV.focus[0], m),
    },
  );
  const bandN = xs.filter(y => y <= 2012).length;
  lines(
    $("cSeam"),
    xs,
    [
      { v: ys.map(y => y.naive), c: "#6fa8ff" },
      { v: ys.map(y => y.h), c: "#ff8a3d" },
    ],
    {
      W: 660,
      vline: xs.indexOf(2012),
      band: { lo: ys.map(y => y.lo), hi: ys.map(y => y.hi), n: bandN, c: "rgba(255,138,61,.22)" },
      aria: "Raw joined counts against the harmonized record",
      tip: i =>
        `${xs[i]}\nHarmonized: ${fmt(ys[i].h)}` +
        (xs[i] <= 2012 ? `, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "") +
        `\nRaw counts: ${fmt(ys[i].naive)}`,
    },
  );
  const avg = (a: number, b: number, k: "naive" | "h") => {
    const r = ys.filter(y => y.y >= a && y.y <= b);
    return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
  };
  const n0 = avg(2007, 2011, "naive"),
    n1 = avg(2012, 2016, "naive"),
    h0 = avg(2007, 2011, "h"),
    h1 = avg(2012, 2016, "h");
  $("cSeamNote").textContent =
    n0 == null || h0 == null || n1 == null || h1 == null
      ? "The blue line jumps in 2012 only because the sensor changed. Choose years from 2007 to 2016 or wider to measure the step."
      : n0 === 0 || h0 === 0
        ? "MODIS counted no hotspots here in 2007–2011, so the step at 2012 cannot be measured."
        : `Raw counts make 2012–2016 look ${(n1 / n0).toFixed(1)}× busier than 2007–2011. In the harmonized record the step is ${(h1 / h0).toFixed(1)}×.`;
  sensors(d, R);
  method(d);
}

function answers(R: SeriesAnalysis) {
  if (R.total === 0) {
    $("ca1").textContent = $("ca2").textContent = "None";
    $("ca1n").textContent = $("ca2n").textContent = "";
  } else {
    /* only months and years with hotspots; a place with fires in one month gets one */
    const top = R.order.slice(0, 3).filter(o => o.sum > 0),
      worst = R.ranked.slice(0, 3).filter(y => y.h > 0),
      quiet = R.order.filter(o => o.sum === 0),
      share = Math.round((top.reduce((a, o) => a + o.sum, 0) / R.total) * 100);
    $("ca1").textContent = top.map(o => MON[o.m]).join(", ");
    $("ca1n").textContent =
      (top.length === 1 ? `Every hotspot fell in ${MONL[top[0].m]}.` : `${top.length === 2 ? "These two months" : "These three months"} hold ${share}% of all hotspots.`) +
      (quiet.length > 1
        ? ` ${quiet.length} months had none in these years.`
        : ` ${MONL[R.order[11].m]} is the quietest${quiet.length ? ", with none" : ""}.`);
    $("ca2").textContent = worst.map(y => y.y).join(", ");
    $("ca2n").textContent =
      worst.map(y => `${y.y}: ${fmt(y.h)}${y.y < 2012 ? " (converted)" : ""}`).join(" · ") + `. An average year has ${fmt(R.mean)}.`;
  }
  const v = verdict(R, CV.focus),
    vi0 = epochs(CV.d!).vi0;
  $("cfM").value = String(CV.focus[1]);
  $("cfY").value = String(CV.focus[0]);
  if (!v) {
    $("ca3").textContent = "Outside the chosen years";
    $("ca3n").textContent = "";
  } else if (R.ser.every(r => r.m !== v.fm || r.h === 0)) {
    $("ca3").textContent = "No hotspots";
    $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
  } else {
    $("ca3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
    $("ca3n").textContent =
      `${nHot(v.f.h)} against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` +
      (v.f.i < vi0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
  }
}

function sensors(d: CountrySummary, R: SeriesAnalysis) {
  const from = { ...SENSOR_FROM, A: d.aqua_from[0] },
    xs = R.years.map(y => y.y),
    per = SENSORS.map(z => ({
      ...z,
      v: xs.map(y => {
        if (y < from[z.s]) return NaN;
        const i = (y - d.y0) * 12;
        return d.monthly[z.s].slice(i, i + 12).reduce((a, b) => a + b, 0);
      }),
    }));
  $("cRawKey").innerHTML = per
    .map(
      z =>
        `<span><i style="background:${z.dash ? `repeating-linear-gradient(90deg,${z.c} 0 5px,transparent 5px 9px)` : z.c};height:3px"></i>${z.name}${z.s === "N20" ? " (not used in the harmonized record)" : ""}</span>`,
    )
    .join("");
  lines($("cRaw"), xs, per, {
    W: 560,
    h: 250,
    labels: true,
    every: 9,
    aria: "Raw detections per year from each satellite",
    tip: i =>
      `${xs[i]}\n` +
      per.map(z => `${z.name}: ${Number.isFinite(z.v[i]) ? fmt(z.v[i]) : "not flying"}${z.s === "N20" ? " (not used)" : ""}`).join("\n"),
  });
}

function method(d: CountrySummary) {
  const val = d.val;
  $("cTiles").innerHTML =
    `<div class="tile"><b>${val.raw_factor == null ? "n/a" : val.raw_factor.toFixed(1) + "×"}</b><span>more hotspots from VIIRS than MODIS for the same fires in ${esc(d.name)}, 2012–2025</span></div>` +
    `<div class="tile"><b>${pc(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div>` +
    `<div class="tile"><b>${pc(val.annual_max_err)}</b><span>error in the worst tested year</span></div>` +
    `<div class="tile"><b>${pc(val.monthly_wape)}</b><span>typical error of a converted month, weighted by size</span></div>`;
  $("cRateNote").textContent = d.rate_note;
  $("cFilter").textContent = d.filter;
  $("cCell").textContent = `${d.cell}°`;
  const row = (label: string, a: number[]) => `<tr><td>${label}</td>${a.map(r => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
  $("cRates").innerHTML =
    `<tr><th>Rate</th>${MON.map(m => `<th>${m}</th>`).join("")}</tr>` +
    row("Terra+Aqua", d.r_ta) +
    row("  90% low", d.r_ta_lo) +
    row("  90% high", d.r_ta_hi) +
    row("Terra only", d.r_t);
  $("cLoyo").innerHTML =
    `<tr><th>Held-out year</th><th>Seen by VIIRS</th><th>Predicted from MODIS</th><th>Raw MODIS</th><th>Error</th></tr>` +
    val.loyo
      .map(
        r =>
          `<tr><td>${Number(r.y)}</td><td>${fmt(r.obs)}</td><td>${fmt(r.pred)}</td><td>${fmt(r.modis)}</td><td>${r.obs > 0 ? (r.pred >= r.obs ? "+" : "") + Math.round((r.pred / r.obs - 1) * 100) + "%" : "n/a"}</td></tr>`,
      )
      .join("");
  const path = summaryPath(d.country),
    url = fileUrl(path);
  $("cSrc").innerHTML =
    `Data: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(path)}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, ` +
    `built from ${d.source.files} FIRMS files (latest FIRMS update ${esc(d.source.firms_updated.slice(0, 10))}). ` +
    `We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">https://earthdata.nasa.gov/firms</a>), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (<a href="https://earthdata.nasa.gov/lance" target="_blank" rel="noopener">https://earthdata.nasa.gov/lance</a>) and NASA's Earth Science Data and Information System (ESDIS). ` +
    `Outlines: Natural Earth.`;
}

function csv() {
  const d = CV.d,
    R = CV.R;
  if (!d || !R) return;
  const N20 = d.monthly.N20,
    rows = [
      "year,month,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs_not_used",
    ];
  R.ser.forEach(r =>
    rows.push([r.y, r.m + 1, r.h.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2), `"${r.src}"`, r.T, r.A, r.V, N20[r.i]].join(",")),
  );
  save(`burn-calendar_${d.country}_${CV.yFrom}-${CV.yTo}.csv`, rows.join("\n"), $("cDlMsg"));
}

/* ---------- the map: the country's outline and its grid cells, coloured by hotspots over the chosen years ---------- */
interface MapFrame {
  W: number;
  H: number;
  /** centre of the view, longitude unwrapped around lon0 */
  cx: number;
  cy: number;
  lon0: number;
  /** east-west shrink so shapes keep their proportions */
  k: number;
  s: number;
  base: HTMLCanvasElement;
  cellAt: Map<string, number>;
  la: Int32Array;
  lo: Int32Array;
  tot: Float64Array;
  modis: Float64Array;
  viirs: Float64Array;
  hover: number;
}
let MF: MapFrame | null = null;
/** the [lat_index, lon_index] of every cell. Files built before the fix of 14 November 2026 wrote a cell west of
    Greenwich as lat - 1, lon + 100000; undo that if it ever arrives. Correct files pass unchanged. */
function cellIndexes(d: CountrySummary) {
  const n = d.cells.length / 2,
    la = new Int32Array(n),
    lo = new Int32Array(n),
    lim = 180 / d.cell + 1;
  for (let c = 0; c < n; c++) {
    la[c] = d.cells[2 * c];
    lo[c] = d.cells[2 * c + 1];
    if (lo[c] > lim) {
      lo[c] -= 100000;
      la[c] += 1;
    }
  }
  return { la, lo };
}
/** the ring moved by whole turns so that its first point lies within 180 degrees of lon0 */
function shiftRing(r: Ring, lon0: number): Ring {
  const off = near(r[0], lon0) - r[0];
  return off ? r.map((v, i) => (i % 2 ? v : v + off)) : r;
}
function drawMap() {
  const d = CV.d,
    cv = $("cMap"),
    W = cv.parentElement!.clientWidth;
  if (!d || !W) return;
  const shape = shapeOf(d.country),
    lon0 = shape ? shape.c[0] : (d.bbox[0] + d.bbox[2]) / 2,
    own = shape ? shape.r.map(r => shiftRing(r, lon0)) : [],
    cell = d.cell,
    nc = d.cells.length / 2,
    { la: cla, lo: clo } = cellIndexes(d),
    tot = new Float64Array(nc),
    modis = new Float64Array(nc),
    viirs = new Float64Array(nc),
    cellAt = new Map<string, number>();
  for (let p = 0; p < d.cell_rows.length; p += 5) {
    const y = d.y0 + d.cell_rows[p + 1];
    if (y < CV.yFrom || y > CV.yTo) continue;
    const c = d.cell_rows[p];
    tot[c] += d.cell_rows[p + 2];
    modis[c] += d.cell_rows[p + 3];
    viirs[c] += d.cell_rows[p + 4];
  }
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const grow = (lon: number, lat: number) => {
    if (lon < x0) x0 = lon;
    if (lon > x1) x1 = lon;
    if (lat < y0) y0 = lat;
    if (lat > y1) y1 = lat;
  };
  for (const r of own) for (let i = 0; i < r.length; i += 2) grow(r[i], r[i + 1]);
  const cellLon = new Float64Array(nc);
  for (let c = 0; c < nc; c++) {
    const la = cla[c] * cell,
      lo = clo[c] * cell;
    cellAt.set(cla[c] + "," + clo[c], c);
    cellLon[c] = near(lo + cell / 2, lon0) - cell / 2;
    grow(cellLon[c], la);
    grow(cellLon[c] + cell, la + cell);
  }
  if (!isFinite(x0)) {
    grow(near(d.bbox[0], lon0), d.bbox[1]);
    grow(near(d.bbox[2], lon0), d.bbox[3]);
  }
  /* at least half a degree each way, so a tiny country keeps some surroundings */
  const span = Math.max(0.5, x1 - x0),
    spanY = Math.max(0.5, y1 - y0),
    k = Math.max(0.2, Math.cos((((y0 + y1) / 2) * Math.PI) / 180)),
    pad = 14,
    H = Math.round(Math.max(240, Math.min(560, innerHeight * 0.7, (W * spanY) / (span * k)))),
    s = Math.min((W - 2 * pad) / (span * k), (H - 2 * pad) / spanY),
    cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    dpr = Math.min(2, devicePixelRatio || 1);
  cv.style.height = H + "px";
  cv.width = W * dpr;
  cv.height = H * dpr;
  const base = document.createElement("canvas");
  base.width = cv.width;
  base.height = cv.height;
  const c = base.getContext("2d")!,
    X = (lon: number) => W / 2 + (lon - cx) * k * s,
    Y = (lat: number) => H / 2 - (lat - cy) * s,
    ring = (r: Ring) => {
      c.moveTo(X(r[0]), Y(r[1]));
      for (let i = 2; i < r.length; i += 2) c.lineTo(X(r[i]), Y(r[i + 1]));
      c.closePath();
    },
    /* the border of a ring (r, moved by whole turns from orig), leaving out cut edges as the globe does */
    border = (k: string, r: Ring, orig: Ring) => {
      for (let i = 0; i + 3 < r.length; i += 2) {
        if (cutEdge(k, orig[i], orig[i + 1], orig[i + 2], orig[i + 3])) continue;
        c.moveTo(X(r[i]), Y(r[i + 1]));
        c.lineTo(X(r[i + 2]), Y(r[i + 3]));
      }
    };
  c.scale(dpr, dpr);
  c.fillStyle = "#05080f";
  c.fillRect(0, 0, W, H);
  /* neighbours, faint */
  const vw = W / (2 * k * s),
    vh = H / (2 * s);
  const near3: [string, Ring, Ring][] = [];
  for (const o of WORLD) {
    if (o.k === d.country) continue;
    const b = o.b;
    if (b[1] > cy + vh || b[3] < cy - vh) continue;
    for (const r of o.r) {
      const rr = shiftRing(r, lon0);
      let a = Infinity,
        z = -Infinity;
      for (let i = 0; i < rr.length; i += 2) {
        if (rr[i] < a) a = rr[i];
        if (rr[i] > z) z = rr[i];
      }
      if (z >= cx - vw && a <= cx + vw) near3.push([o.k, rr, r]);
    }
  }
  c.beginPath();
  near3.forEach(n => ring(n[1]));
  c.fillStyle = "#0f1522";
  c.fill();
  c.beginPath();
  near3.forEach(n => border(...n));
  c.strokeStyle = "rgba(255,255,255,.12)";
  c.lineWidth = 1;
  c.stroke();
  c.beginPath();
  own.forEach(ring);
  c.fillStyle = "#1b2334";
  c.fill();
  let mx = 0;
  for (let j = 0; j < nc; j++) if (tot[j] > mx) mx = tot[j];
  const lmax = Math.log1p(mx),
    lut = LUT(),
    side = Math.max(1.5, cell * s);
  for (let j = 0; j < nc; j++) {
    if (tot[j] <= 0) continue;
    c.fillStyle = lut[Math.round(63 * (0.06 + (0.94 * Math.log1p(tot[j])) / lmax))];
    /* a hair of overlap, so neighbouring squares show no seams */
    c.fillRect(X(cellLon[j]), Y(cla[j] * cell + cell), Math.max(side, cell * k * s) + 0.5, side + 0.5);
  }
  c.beginPath();
  own.forEach((r, i) => border(d.country, r, shape!.r[i]));
  c.strokeStyle = "rgba(241,244,249,.65)";
  c.lineWidth = 1.2;
  c.stroke();
  MF = { W, H, cx, cy, lon0, k, s, base, cellAt, la: cla, lo: clo, tot, modis, viirs, hover: -1 };
  blit();
  paintRamp("cMapRamp", seq);
  $("cMapHi").textContent = mx > 0 ? `${short(mx)} per square (log scale)` : "";
  $("cMapNote").textContent = nc
    ? `Each square is ${cell}° across, about ${Math.round(cell * 111)} km north to south. Colour shows the hotspots counted in it over ${CV.yFrom}–${CV.yTo}, in VIIRS terms, on a log scale. Hover or tap a square for its numbers.`
    : `No hotspots were counted anywhere in ${d.name}, so the map has no squares.`;
}
function blit() {
  const f = MF,
    d = CV.d;
  if (!f || !d) return;
  const cv = $("cMap"),
    c = cv.getContext("2d")!,
    dpr = cv.width / f.W;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(f.base, 0, 0);
  if (f.hover < 0) return;
  const cell = d.cell,
    la = f.la[f.hover] * cell,
    lo = near(f.lo[f.hover] * cell + cell / 2, f.lon0) - cell / 2,
    x = f.W / 2 + (lo - f.cx) * f.k * f.s,
    y = f.H / 2 - (la + cell - f.cy) * f.s,
    side = Math.max(1.5, cell * f.s);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = "#fff";
  c.lineWidth = 2;
  c.strokeRect(x - 1, y - 1, Math.max(side, cell * f.k * f.s) + 2, side + 2);
}
function mapHover(e: PointerEvent) {
  const f = MF,
    d = CV.d;
  if (!f || !d) return;
  const r = $("cMap").getBoundingClientRect(),
    lonU = f.cx + (e.clientX - r.left - f.W / 2) / (f.k * f.s),
    lat = f.cy - (e.clientY - r.top - f.H / 2) / f.s,
    lon = near(lonU, 0),
    key = Math.floor(lat / d.cell) + "," + Math.floor(lon / d.cell),
    j = f.cellAt.get(key) ?? -1,
    hit = j >= 0 && f.tot[j] + f.modis[j] + f.viirs[j] > 0 ? j : -1;
  if (hit !== f.hover) {
    f.hover = hit;
    blit();
  }
  if (hit >= 0) {
    const la = f.la[hit] * d.cell,
      lo = f.lo[hit] * d.cell,
      deg = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v < 0 ? n : p}`;
    showTip(
      e,
      `${deg(la, "N", "S")} to ${deg(la + d.cell, "N", "S")}, ${deg(lo, "E", "W")} to ${deg(lo + d.cell, "E", "W")}\n` +
        `${CV.yFrom}–${CV.yTo}: ${nHot(f.tot[hit])} in VIIRS terms\nRaw: ${fmt(f.modis[hit])} MODIS (Terra+Aqua), ${fmt(f.viirs[hit])} Suomi NPP`,
    );
    return;
  }
  const o = countryAt(lon, lat);
  if (o && o.k !== d.country) showTip(e, o.n);
  else hideTip();
}

/** wire the country view's controls; called once */
export function countryEvents() {
  $("cBack").onclick = () => {
    location.hash = "";
  };
  $("cRetry").onclick = () => {
    if (CV.k) load();
  };
  $("cFrom").onchange = $("cTo").onchange = e => {
    let a = +$("cFrom").value,
      b = +$("cTo").value;
    if (a > b) {
      if (e.target === $("cFrom")) b = a;
      else a = b;
    }
    CV.yFrom = a;
    CV.yTo = b;
    $("cFrom").value = String(a);
    $("cTo").value = String(b);
    renderCountry();
  };
  $("cfM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("cfM").onchange = $("cfY").onchange = () => {
    CV.focus = [+$("cfY").value, +$("cfM").value];
    renderCountry();
  };
  document.querySelectorAll<HTMLButtonElement>("#cModeSeg button").forEach(
    b =>
      (b.onclick = () => {
        CV.mode = b.dataset.mode === "anom" ? "anom" : "count";
        renderCountry();
      }),
  );
  $("cDl").onclick = csv;
  const cv = $("cMap");
  cv.onpointermove = cv.onpointerdown = mapHover;
  cv.onpointerleave = () => {
    if (MF) MF.hover = -1;
    blit();
    hideTip();
  };
  let rt: number | undefined;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (CV.d && !$("country").hidden) drawMap();
    }, 120);
  });
}
