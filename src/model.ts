import type {
  Analysis,
  Epochs,
  Harmonized,
  HexState,
  MonthStat,
  Rates,
  SameDays,
  Sel,
  SeriesAnalysis,
  SeriesRow,
  StateCode,
  Town,
  Verdict,
  YearRow,
  YearToDate,
} from "./types";
import { AQ0, D, FILL_SRC, FULL_Y1, MON, MONL, NAME, NM, NMD, PART, VI0, Y0, fillDays } from "./data";
import { S } from "./state";
import { fmt, times } from "./util";

/* ---------- harmonization (same rule as the pipeline) ---------- */
/** the month indexes and size bins of the state data */
export const STATE_EPOCHS: Epochs = { vi0: VI0, aq0: AQ0, bins: D.meta.bins };
/** one month in VIIRS terms: observed from vi0 on, otherwise MODIS times the place's exchange rate, with a 90% range */
export function harmWith(s: Rates, e: Epochs, i: number, T: number, A: number, V: number): Harmonized {
  const m = i % 12;
  if (i >= e.vi0) return { h: V, lo: V, hi: V, src: "VIIRS observed" };
  const terraOnly = i < e.aq0,
    h = terraOnly ? T * s.r_t[m] : (T + A) * s.r_ta[m],
    src = terraOnly ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted";
  if (h === 0) return { h: 0, lo: 0, hi: s.zero_hi, src };
  let b = 0;
  while (b < e.bins.length && h > e.bins[b]) b++;
  return { h, lo: h * s.pi[b][0], hi: h * s.pi[b][1], src };
}
export const harm = (st: StateCode, i: number, T: number, A: number, V: number): Harmonized =>
  harmWith(D.states[st], STATE_EPOCHS, i, T, A, V);
const HX: Partial<Record<StateCode, HexState>> = {};
/** the lookup tables for one state, built on first use; the object is filled in step by step */
export function hexState(st: StateCode): HexState {
  if (HX[st]) return HX[st];
  const s = D.states[st],
    n = s.hexes.length / 3,
    R = s.hex_r,
    K = s.hex_k,
    S3 = Math.sqrt(3);
  const o = {
    n,
    R,
    K,
    q: new Int32Array(n),
    r: new Int32Array(n),
    c: new Int32Array(n),
    X: new Float64Array(n),
    Y: new Float64Array(n),
    H: new Float32Array(n * NM),
    key: new Map(),
  } as HexState;
  for (let k = 0; k < n; k++) {
    const q = s.hexes[3 * k],
      r = s.hexes[3 * k + 1];
    o.q[k] = q;
    o.r[k] = r;
    o.c[k] = s.hexes[3 * k + 2];
    o.X[k] = R * S3 * (q + r / 2);
    o.Y[k] = R * 1.5 * r;
    o.key.set(q + "," + r, k);
  }
  const rows = s.hex_rows;
  for (let p = 0; p < rows.length; p += 5) o.H[rows[p] * NM + rows[p + 1]] = harm(st, rows[p + 1], rows[p + 2], rows[p + 3], rows[p + 4]).h;
  /* past Suomi NPP outage days, filled from NOAA-20 as 2026 is */
  const g = s.gap_hex_rows ?? [];
  for (let p = 0; p < g.length; p += 3) o.H[g[p] * NM + g[p + 1]] = Math.max(0, o.H[g[p] * NM + g[p + 1]] + g[p + 2]);
  o.x0 = Math.min(...o.X) - R;
  o.x1 = Math.max(...o.X) + R;
  o.y0 = Math.min(...o.Y) - R;
  o.y1 = Math.max(...o.Y) + R;
  o.geo = D.geo[st];
  o.geoByFips = {};
  o.geo.forEach(g => (o.geoByFips[g.f] = g));
  /* extra layers: surrounding land, 2 km hexagons, roads */
  const dt = D.detail[st],
    cn = dt.ctx.length / 3;
  o.cn = cn;
  o.cX = new Float32Array(cn);
  o.cY = new Float32Array(cn);
  o.cB = new Uint8Array(cn);
  for (let j = 0; j < cn; j++) {
    const q = dt.ctx[3 * j],
      r = dt.ctx[3 * j + 1];
    o.cX[j] = R * S3 * (q + r / 2);
    o.cY[j] = R * 1.5 * r;
    o.cB[j] = dt.ctx[3 * j + 2];
  }
  const fr = dt.fine_r,
    fn = dt.fine.length / 5,
    f = (o.f = {
      R: fr,
      n: fn,
      X: new Float32Array(fn),
      Y: new Float32Array(fn),
      c: new Uint32Array(fn),
      ym: new Uint16Array(fn),
      mm: new Uint16Array(fn),
      key: new Map(),
      max: 1,
    });
  for (let j = 0; j < fn; j++) {
    const q = dt.fine[5 * j],
      r = dt.fine[5 * j + 1];
    f.X[j] = fr * S3 * (q + r / 2);
    f.Y[j] = fr * 1.5 * r;
    f.c[j] = dt.fine[5 * j + 2];
    f.ym[j] = dt.fine[5 * j + 3];
    f.mm[j] = dt.fine[5 * j + 4];
    f.key.set(q + "," + r, j);
    if (f.c[j] > f.max) f.max = f.c[j];
  }
  o.roads = dt.roads;
  const pl = D.places[st];
  o.towns = pl.towns.map(t => ({ n: t[0], lat: t[1], lon: t[2], pop: t[3], X: t[2] * K, Y: t[1] }));
  const sn = pl.stn.length,
    stn = (o.stn = { n: sn, X: new Float32Array(sn), Y: new Float32Array(sn), c: new Int16Array(sn), names: pl.stn });
  for (let i = 0; i < sn; i++) {
    stn.X[i] = pl.stn_xy[2 * i] * K;
    stn.Y[i] = pl.stn_xy[2 * i + 1];
    const k = o.key.get(hexKey(stn.X[i], stn.Y[i], R));
    stn.c[i] = k === undefined ? -1 : o.c[k];
  }
  return (HX[st] = o);
}
export function maskFor(st: StateCode, sel: Sel) {
  const hx = hexState(st),
    m = new Uint8Array(hx.n);
  for (let k = 0; k < hx.n; k++) {
    const lon = hx.X[k] / hx.K,
      lat = hx.Y[k];
    if (sel.type === "state") m[k] = 1;
    else if (sel.type === "county") m[k] = hx.c[k] === sel.ci ? 1 : 0;
    else if (sel.type === "hex") m[k] = k === sel.k ? 1 : 0;
    else if (sel.type === "box") m[k] = lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n ? 1 : 0;
    else {
      const dx = (lon - sel.lon) * 111.32 * Math.cos((sel.lat * Math.PI) / 180),
        dy = (lat - sel.lat) * 110.57;
      m[k] = dx * dx + dy * dy <= sel.rad * sel.rad ? 1 : 0;
    }
  }
  return m;
}
export const selMask = () => maskFor(S.st!, S.sel);
export function analyseFor(st: StateCode, sel: Sel): Analysis {
  const s = D.states[st],
    T = new Float64Array(NM),
    A = new Float64Array(NM),
    V = new Float64Array(NM);
  const byCounty = sel.type === "state" || sel.type === "county",
    rows = byCounty ? s.county_rows : s.hex_rows,
    mask = byCounty ? null : maskFor(st, sel);
  for (let p = 0; p < rows.length; p += 5) {
    const k = rows[p];
    if (byCounty ? sel.type === "state" || k === sel.ci : mask![k]) {
      const i = rows[p + 1];
      T[i] += rows[p + 2];
      A[i] += rows[p + 3];
      V[i] += rows[p + 4];
    }
  }
  /* days Suomi NPP missed: in 2026 the rows already hold NOAA-20 converted for them; for past outages (2018-2025) the
     change from filling them the same way is kept apart, so the raw Suomi NPP count stays as observed */
  const G = new Float64Array(NM),
    grows = (byCounty ? s.gap_county_rows : s.gap_hex_rows) ?? [];
  for (let p = 0; p < grows.length; p += 3) {
    const k = grows[p];
    if (byCounty ? sel.type === "state" || k === sel.ci : mask![k]) G[grows[p + 1]] += grows[p + 2];
  }
  const gaps = new Map((s.hist_gaps ?? []).map(g => [g.i, g])),
    m26 = new Map((s.y2026?.months ?? []).map(m => [m.i, m]));
  const filled = (i: number, t: number, a: number, v: number) => {
    const x = harm(st, i, t, a, v);
    if (i < VI0) return x;
    const f = fillDays(i, st);
    if (!f.n20.length && !f.interp.length) return x;
    const h = Math.max(0, v + G[i]);
    let lo = h,
      hi = h;
    /* ranges from the conversion are known for the whole state */
    const g = gaps.get(i),
      m = m26.get(i);
    if (sel.type === "state" && g) {
      lo = h - (g.filled - g.lo);
      hi = h + (g.hi - g.filled);
    } else if (sel.type === "state" && m) {
      lo = Math.min(h, m.lo);
      hi = Math.max(h, m.hi);
    }
    return { h, lo, hi, src: FILL_SRC };
  };
  const R = analyseSeries({
    T,
    A,
    V,
    y0: Y0,
    yFrom: S.yFrom,
    yTo: S.yTo,
    vi0: VI0,
    nm: NMD,
    partI: PART ? PART.i : -1,
    partMed: sameDaysFor(st, sel)?.med ?? null,
    harm: filled,
  });
  return { st, ...R };
}
/* ---------- the partial last month and year (2026 to 14 November) ---------- */
/** "1–14 Nov" */
export const partSpan = (m: number, day: number) => `1–${day} ${MON[m]}`;
const median = (a: number[]) => {
  const z = a.slice().sort((x, y) => x - y),
    h = (z.length - 1) / 2;
  return z.length ? (z[Math.floor(h)] + z[Math.ceil(h)]) / 2 : 0;
};
/** the partial month against the same days in the Suomi NPP years, for the whole state or one county (the only areas
 * data.js holds daily history for); null for other areas */
export function sameDaysFor(st: StateCode, sel: Sel): SameDays | null {
  const p = D.states[st].partial;
  if (!p || !PART || (sel.type !== "state" && sel.type !== "county")) return null;
  const span = partSpan(p.m - 1, p.day_to);
  /* past years with Suomi NPP outage days in the span are filled from NOAA-20, as 2026 is */
  if (sel.type === "state") {
    const past = p.state_filled ?? p.state;
    return { span, cur: p.state_2026, lo: p.state_2026_lo, hi: p.state_2026_hi, years: p.years, past, med: p.state_filled_median ?? median(past) };
  }
  const past = p.county_filled?.[sel.ci] ?? p.county[sel.ci],
    cur = p.county_2026[sel.ci];
  return past ? { span, cur, lo: cur, hi: cur, years: p.years, past, med: median(past) } : null;
}
/** the partial year against the same span of every past year from 2012 (the Suomi NPP years): whole months up to the
 * partial one, plus the partial month's days where the area has them for past years (pastPart) */
export function yearToDate(
  R: SeriesAnalysis,
  pastPart: ((y: number) => number | undefined) | null,
  range?: { lo: number; hi: number } | null,
): YearToDate | null {
  const pr = R.ser.find(r => r.part);
  if (!pr) return null;
  const withPart = !!pastPart,
    py = pr.y,
    pm = pr.m,
    years: number[] = [],
    past: number[] = [];
  const sumOf = (y: number) => {
    let a = 0;
    for (const r of R.ser) if (r.y === y && r.m < pm) a += r.h;
    return a;
  };
  for (const yr of R.years) {
    if (yr.y >= py || yr.y < 2012) continue;
    const extra = withPart ? pastPart!(yr.y) : 0;
    if (extra === undefined) continue;
    years.push(yr.y);
    past.push(sumOf(yr.y) + extra);
  }
  if (years.length < 3) return null;
  const cur = sumOf(py) + (withPart ? pr.h : 0),
    day = PART ? PART.day : 0,
    span = withPart ? `1 Jan–${day} ${MON[pm]}` : pm > 1 ? `Jan–${MON[pm - 1]}` : "January";
  return {
    span,
    withPart,
    y: py,
    cur,
    lo: range ? range.lo : cur,
    hi: range ? range.hi : cur,
    years,
    past,
    med: median(past),
    rank: past.filter(v => v > cur).length + 1,
    n: past.length + 1,
  };
}
/** the year-to-date comparison for an area of a state: with the partial month's days for the state and its counties */
export function ytdFor(R: SeriesAnalysis, st: StateCode, sel: Sel): YearToDate | null {
  const s = D.states[st],
    p = s.partial,
    sd = sameDaysFor(st, sel);
  if (!p || !sd) return yearToDate(R, null);
  let range: { lo: number; hi: number } | null = null;
  if (sel.type === "state" && s.y2026) {
    const ms = s.y2026.months;
    range = { lo: ms.reduce((a, x) => a + x.lo, 0), hi: ms.reduce((a, x) => a + x.hi, 0) };
  }
  return yearToDate(
    R,
    y => {
      const k = sd.years.indexOf(y);
      return k < 0 ? undefined : sd.past[k];
    },
    range,
  );
}
/** "the 3rd most of 15 years", "the most of 15", "the fewest of 15" */
export function rankWords(rank: number, n: number) {
  const ord = (k: number) => k + (k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th");
  return rank === 1 ? `the most of ${n} years` : rank === n ? `the fewest of ${n} years` : `the ${ord(rank)} most of ${n} years`;
}
/** one sentence on the partial year, compared like for like */
export const ytdSentence = (t: YearToDate) =>
  `${t.y} so far (${t.span}): ${fmt(t.cur)} ${fmt(t.cur) === "1" ? "hotspot" : "hotspots"}${t.hi - t.lo >= 1 ? `, likely ${fmt(t.lo)} to ${fmt(t.hi)}` : ""}, ${rankWords(t.rank, t.n)} for the same dates (typical ${fmt(t.med)}).`;
/** monthly counts of one place, as arrays indexed by month from January of y0 */
export interface SeriesInput {
  T: ArrayLike<number>;
  A: ArrayLike<number>;
  V: ArrayLike<number>;
  y0: number;
  yFrom: number;
  yTo: number;
  vi0: number;
  /** months with data from January of y0; later months are left out, not counted as zero */
  nm?: number;
  /** index of the partial last month, or -1 */
  partI?: number;
  /** the normal for the partial month's days (the median of the same days in past years), when known */
  partMed?: number | null;
  harm: (i: number, T: number, A: number, V: number) => Harmonized;
}
/** the harmonized series of one place over the chosen years, with its monthly and yearly summaries */
export function analyseSeries(o: SeriesInput): SeriesAnalysis {
  const { T, A, V } = o,
    partI = o.partI ?? -1,
    nm = o.nm ?? Infinity,
    /* the first month that is not complete: the partial one, else the end of the data */
    fullEnd = partI >= 0 ? partI : nm;
  const ser: SeriesRow[] = [];
  for (let i = (o.yFrom - o.y0) * 12, end = Math.min((o.yTo - o.y0 + 1) * 12, nm); i < end; i++) {
    const r = Object.assign(
      { i, y: o.y0 + Math.floor(i / 12), m: i % 12, T: T[i], A: A[i], V: V[i] },
      o.harm(i, T[i], A[i], V[i]),
    ) as SeriesRow;
    if (i >= fullEnd) r.part = true;
    ser.push(r);
  }
  const fullYear = (y: number) => (y - o.y0 + 1) * 12 <= fullEnd,
    /* with only the partial year chosen, it stands in for the complete ones */
    useAll = !ser.some(r => fullYear(r.y)),
    counted = (y: number) => useAll || fullYear(y);
  const quant = (a: number[], q: number) => {
    const z = a.slice().sort((x, y) => x - y),
      p = (z.length - 1) * q,
      f = Math.floor(p);
    return z[f] + (z[Math.min(z.length - 1, f + 1)] - z[f]) * (p - f);
  };
  const stats: MonthStat[] = MON.map((_, m) => {
    const a = ser.filter(r => r.m === m && !r.part).map(r => r.h),
      s = ser.filter(r => r.m === m && counted(r.y)).reduce((x, r) => x + r.h, 0);
    return a.length ? { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), sum: s } : { med: NaN, q1: NaN, q3: NaN, sum: s };
  });
  ser.forEach(r => {
    r.med = r.part ? (o.partMed ?? NaN) : stats[r.m].med;
    r.ratio = Number.isFinite(r.med) ? (r.h + 1) / (r.med + 1) : NaN;
  });
  const years: YearRow[] = [];
  for (let y = o.yFrom; y <= o.yTo; y++) {
    const rr = ser.filter(r => r.y === y),
      sum = (k: "h" | "lo" | "hi") => rr.reduce((a, r) => a + r[k], 0);
    if (!rr.length) continue;
    const row: YearRow = {
      y,
      h: sum("h"),
      lo: sum("lo"),
      hi: sum("hi"),
      naive: rr.reduce((a, r) => a + (r.i >= o.vi0 ? r.V : r.T + r.A), 0),
    };
    if (!fullYear(y)) row.part = true;
    years.push(row);
  }
  const counts = years.filter(y => counted(y.y)),
    total = stats.reduce((a, z) => a + z.sum, 0),
    order = stats.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum),
    ranked = counts.slice().sort((a, b) => b.h - a.h);
  return {
    ser,
    stats,
    years,
    total,
    any: ser.reduce((a, r) => a + r.h, 0),
    mean: counts.length ? total / counts.length : 0,
    order,
    ranked,
    partYear: years.find(y => y.part) ?? null,
  };
}
export function verdict(R: SeriesAnalysis, focus: number[] = S.focus, sd: SameDays | null = null): Verdict | null {
  const [fy, fm] = focus,
    f = R.ser.find(r => r.y === fy && r.m === fm);
  if (!f) return null;
  /* a partial month is compared only with the same days of past years, never with whole months */
  if (f.part && !sd) return { f, fm, fy, label: "Not over yet", cls: "", rank: 0, n: 0, med: NaN, mult: "", noSame: true };
  const cur = f.part ? sd!.cur : f.h,
    same = f.part ? [...sd!.past, cur] : R.ser.filter(r => r.m === fm && !r.part).map(r => r.h),
    n = same.length,
    rank = same.filter(v => v > cur).length + 1,
    /* mid-rank: years that tie with it count half below, so a quiet zero among many zeros reads as typical */
    pct = ((same.filter(v => v < cur).length + (same.filter(v => v === cur).length - 1) / 2) / Math.max(1, n - 1)) * 100,
    med = f.part ? sd!.med : R.stats[fm].med;
  let label = "Typical",
    cls = "";
  if (!(cur === 0 && med === 0)) {
    if (pct >= 90) {
      label = "Unusually high";
      cls = "hi";
    } else if (pct >= 75) {
      label = "Above normal";
      cls = "hi";
    } else if (pct <= 10) {
      label = "Unusually low";
      cls = "lo";
    } else if (pct <= 25) {
      label = "Below normal";
      cls = "lo";
    }
  }
  return {
    f,
    fm,
    fy,
    label,
    cls,
    rank,
    n,
    med,
    mult:
      med > 0 && cur > 0
        ? times(cur / med) + (f.part ? ` a normal ${sd!.span}` : " a normal " + MON[fm])
        : cur === 0
          ? "No hotspots" + (f.part ? ` in ${sd!.span}` : "")
          : fmt(cur) + (fmt(cur) === "1" ? " hotspot" : " hotspots") + (f.part ? ` in ${sd!.span}` : ""),
    same: f.part ? sd! : undefined,
  };
}
/* how often has it burned in a given calendar month? Uses the VIIRS years, which see small fires too, and complete
   years only, so every calendar month is measured over the same years (2026 is still under way) */
export const riskYears = () => {
  const a = Math.max(S.yFrom, 2012),
    b = Math.min(S.yTo, FULL_Y1);
  return a <= b ? [a, b] : [Math.min(S.yFrom, FULL_Y1), Math.min(S.yTo, FULL_Y1)];
};
export function riskFor(R: Analysis, m: number) {
  const [a, b] = riskYears(),
    rows = R.ser.filter(r => r.m === m && r.y >= a && r.y <= b),
    hit = rows.filter(r => r.h > 0),
    z = hit.map(r => r.h).sort((x, y) => x - y);
  return {
    n: rows.length,
    k: hit.length,
    p: rows.length ? hit.length / rows.length : 0,
    typical: z.length ? z[Math.floor((z.length - 1) / 2)] : 0,
    worst: hit.reduce<{ h: number; y: number | null }>((w, r) => (r.h > w.h ? r : w), { h: 0, y: null }),
    last: hit.length ? hit[hit.length - 1].y : null,
    a,
    b,
  };
}
/** counties ranked by how often fire comes to them in calendar month m over the chance-of-fire years: the sum of their
 * hexagons' shares of years with a hotspot, which is the number of their hexagons that burn in an average year. Unlike a
 * hotspot count, one huge fire in one year cannot put a county first. Also their average hotspots and fire years. */
export function countyRisk(st: StateCode, m: number) {
  const s = D.states[st],
    [a, b] = riskYears(),
    ny = b - a + 1,
    nc = s.counties.length,
    M = new Float64Array(nc * ny),
    hx = hexState(st),
    nf = notFire(st),
    fire = new Float64Array(nc),
    rows = s.county_rows;
  let fireAll = 0;
  for (let k = 0; k < hx.n; k++) {
    if (nf[k]) continue;
    let c = 0;
    for (let y = a; y <= b; y++) if (hx.H[k * NM + (y - Y0) * 12 + m] > 0) c++;
    fire[hx.c[k]] += c / ny;
    fireAll += c / ny;
  }
  for (let p = 0; p < rows.length; p += 5) {
    const i = rows[p + 1];
    if (i % 12 !== m) continue;
    const y = Y0 + Math.floor(i / 12);
    if (y < a || y > b) continue;
    M[rows[p] * ny + (y - a)] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
  }
  let all = 0;
  for (let q = 0; q < M.length; q++) all += M[q];
  return s.counties
    .map((c, ci) => {
      const v = Array.from(M.subarray(ci * ny, (ci + 1) * ny)),
        k = v.filter(x => x > 0).length,
        sum = v.reduce((x, y) => x + y, 0);
      return {
        ci,
        name: c.name,
        k,
        n: ny,
        p: k / ny,
        mean: sum / ny,
        hotShare: all ? sum / all : 0,
        e: fire[ci],
        share: fireAll ? fire[ci] / fireAll : 0,
      };
    })
    .sort((x, y) => y.e - x.e || y.p - x.p);
}
export const leadText = (R: SeriesAnalysis, ytd: YearToDate | null = null) =>
  R.any === 0
    ? "No fire hotspots were detected here in these years. Try a larger area."
    : R.total === 0
      ? `No fire hotspots were detected here in the complete years chosen.${ytd ? " " + ytdSentence(ytd) : ""}`
      : `Fire activity here peaks in ${MONL[R.order[0].m]}. ${R.ranked[0].y} was the most active ${R.ranked[0].part ? "year so far" : "complete year on record"}, ${times(R.ranked[0].h / R.mean).replace("×", "")} times an average year.` +
        (ytd ? " " + ytdSentence(ytd) : "");
const kmBetween = (lon1: number, lat1: number, lon2: number, lat2: number) =>
  Math.hypot((lon1 - lon2) * 111.32 * Math.cos((lat1 * Math.PI) / 180), (lat1 - lat2) * 110.57);
function nearestTown(st: StateCode, lon: number, lat: number) {
  let best: Town | null = null,
    bd = 1e9;
  for (const t of hexState(st).towns) {
    const d = kmBetween(lon, lat, t.lon, t.lat);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}
/** the name of the town nearest the centre of hexagon k */
export function hexTown(st: StateCode, k: number) {
  const hx = hexState(st);
  return nearestTown(st, hx.X[k] / hx.K, hx.Y[k])!.n;
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** where hexagon k is, for lists: "Near Antwerp" when its centre is close to the town, else "8 km NE of Antwerp" */
export function hexPlace(st: StateCode, k: number) {
  const hx = hexState(st),
    lon = hx.X[k] / hx.K,
    lat = hx.Y[k],
    t = nearestTown(st, lon, lat)!,
    d = kmBetween(lon, lat, t.lon, t.lat);
  if (d < 3) return "Near " + t.n;
  const dx = (lon - t.lon) * Math.cos((lat * Math.PI) / 180),
    dy = lat - t.lat,
    dir = COMPASS[Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) / 45) % 8];
  return `${Math.round(d)} km ${dir} of ${t.n}`;
}
/** the hexagon holding point (lon, lat); -1 outside the state's hexagons */
export function hexAtLonLat(st: StateCode, lon: number, lat: number) {
  const hx = hexState(st),
    k = hx.key.get(hexKey(lon * hx.K, lat, hx.R));
  return k === undefined ? -1 : k;
}
/** Heat sources that are not fire and that the industrial mask in data.js misses (it drops 500 m spots seen in 5 or
 * more years mostly at night; these are seen by day). Their hexagons count as having no fire in the chance of fire,
 * the response tools and the forecast (NOT_FIRE in scripts/build_forecast.py; keep the two in step). The past
 * hotspot counts still include them. */
export const NOT_FIRE: Record<StateCode, { name: string; pts: [number, number][] }[]> = {
  NY: [],
  CA: [
    {
      /* the three solar towers, [lat, lon]; VIIRS flags them by day in most months since late 2013 */
      name: "the Ivanpah solar power plant",
      pts: [
        [35.534, -115.452],
        [35.557, -115.47],
        [35.575, -115.484],
      ],
    },
  ],
};
const notFireCache: Partial<Record<StateCode, Uint8Array>> = {};
/** 1 for a hexagon whose hotspots are not fire (see NOT_FIRE) */
export function notFire(st: StateCode): Uint8Array {
  let m = notFireCache[st];
  if (!m) {
    m = new Uint8Array(hexState(st).n);
    for (const src of NOT_FIRE[st])
      for (const [lat, lon] of src.pts) {
        const k = hexAtLonLat(st, lon, lat);
        if (k >= 0) m[k] = 1;
      }
    notFireCache[st] = m;
  }
  return m;
}
/** a sentence for an area that holds a NOT_FIRE hexagon, whose hotspots the area's own counts still include */
export function notFireNote(st: StateCode, mask: Uint8Array) {
  const nf = notFire(st),
    names = new Set<string>();
  for (let k = 0; k < nf.length; k++) if (nf[k] && mask[k]) names.add(notFireName(st, k));
  return names.size ? ` These counts include heat from ${[...names].join(" and ")}, which is not fire.` : "";
}
/** what makes hexagon k's hotspots, when it is not fire */
export const notFireName = (st: StateCode, k: number) =>
  notFire(st)[k] ? NOT_FIRE[st].find(src => src.pts.some(([lat, lon]) => hexAtLonLat(st, lon, lat) === k))?.name || "" : "";
export function stationsFor(st: StateCode, sel: Sel) {
  const hx = hexState(st),
    sn = hx.stn;
  let n = 0,
    near = 1e9,
    c: number[] | null = null,
    rad: number | null = null;
  if (sel.type === "hex") {
    c = [hx.X[sel.k] / hx.K, hx.Y[sel.k]];
    rad = 15;
  } else if (sel.type === "circle") {
    c = [sel.lon, sel.lat];
    rad = sel.rad;
  }
  for (let i = 0; i < sn.n; i++) {
    const lon = sn.X[i] / hx.K,
      lat = sn.Y[i];
    if (c) {
      const d = kmBetween(c[0], c[1], lon, lat);
      if (d <= rad!) n++;
      if (d < near) near = d;
    } else if (
      sel.type === "state" ||
      (sel.type === "county" && sn.c[i] === sel.ci) ||
      (sel.type === "box" && lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n)
    )
      n++;
  }
  return { n, near: c ? near : null, rad };
}
export const placeName = () => {
  const s = S.sel,
    hx = hexState(S.st!);
  return s.type === "state"
    ? NAME[S.st!]
    : s.type === "hex"
      ? "Near " + nearestTown(S.st!, hx.X[s.k] / hx.K, hx.Y[s.k])!.n
      : s.type === "county"
        ? D.states[S.st!].counties[s.ci].name + " County"
        : s.type === "box"
          ? "Your drawn area"
          : s.label
            ? `Around ${s.label}`
            : `${s.rad} km around ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
};
/** the axial "q,r" key of the hexagon of size R that contains map point (X, Y) */
export function hexKey(X: number, Y: number, R: number) {
  const q = ((Math.sqrt(3) / 3) * X - Y / 3) / R,
    r = ((2 / 3) * Y) / R,
    s = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return rq + "," + rr;
}
