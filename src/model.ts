import type {
  Analysis,
  Epochs,
  Harmonized,
  HexState,
  MonthStat,
  Rates,
  Sel,
  SeriesAnalysis,
  SeriesRow,
  StateCode,
  Town,
  Verdict,
  YearRow,
} from "./types";
import { AQ0, D, MON, MONL, NAME, NM, VI0, Y0 } from "./data";
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
  const R = analyseSeries({ T, A, V, y0: Y0, yFrom: S.yFrom, yTo: S.yTo, vi0: VI0, harm: (i, t, a, v) => harm(st, i, t, a, v) });
  return { st, ...R };
}
/** monthly counts of one place, as arrays indexed by month from January of y0 */
export interface SeriesInput {
  T: ArrayLike<number>;
  A: ArrayLike<number>;
  V: ArrayLike<number>;
  y0: number;
  yFrom: number;
  yTo: number;
  vi0: number;
  harm: (i: number, T: number, A: number, V: number) => Harmonized;
}
/** the harmonized series of one place over the chosen years, with its monthly and yearly summaries */
export function analyseSeries(o: SeriesInput): SeriesAnalysis {
  const { T, A, V } = o;
  const ser: SeriesRow[] = [];
  for (let i = (o.yFrom - o.y0) * 12; i < (o.yTo - o.y0 + 1) * 12; i++)
    ser.push(
      Object.assign({ i, y: o.y0 + Math.floor(i / 12), m: i % 12, T: T[i], A: A[i], V: V[i] }, o.harm(i, T[i], A[i], V[i])) as SeriesRow,
    );
  const quant = (a: number[], q: number) => {
    const z = a.slice().sort((x, y) => x - y),
      p = (z.length - 1) * q,
      f = Math.floor(p);
    return z[f] + (z[Math.min(z.length - 1, f + 1)] - z[f]) * (p - f);
  };
  const stats: MonthStat[] = MON.map((_, m) => {
    const a = ser.filter(r => r.m === m).map(r => r.h);
    return { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), sum: a.reduce((x, y) => x + y, 0) };
  });
  ser.forEach(r => {
    r.med = stats[r.m].med;
    r.ratio = (r.h + 1) / (r.med + 1);
  });
  const years: YearRow[] = [];
  for (let y = o.yFrom; y <= o.yTo; y++) {
    const rr = ser.filter(r => r.y === y),
      sum = (k: "h" | "lo" | "hi") => rr.reduce((a, r) => a + r[k], 0);
    years.push({ y, h: sum("h"), lo: sum("lo"), hi: sum("hi"), naive: rr.reduce((a, r) => a + (r.i >= o.vi0 ? r.V : r.T + r.A), 0) });
  }
  const total = stats.reduce((a, z) => a + z.sum, 0),
    order = stats.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum),
    ranked = years.slice().sort((a, b) => b.h - a.h);
  return { ser, stats, years, total, mean: total / years.length, order, ranked };
}
export function verdict(R: SeriesAnalysis, focus: number[] = S.focus): Verdict | null {
  const [fy, fm] = focus,
    f = R.ser.find(r => r.y === fy && r.m === fm);
  if (!f) return null;
  const same = R.ser.filter(r => r.m === fm).map(r => r.h),
    n = same.length,
    rank = same.filter(v => v > f.h).length + 1,
    pct = (same.filter(v => v < f.h).length / Math.max(1, n - 1)) * 100,
    med = R.stats[fm].med;
  let label = "Typical",
    cls = "";
  if (!(f.h === 0 && med === 0)) {
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
  return { f, fm, fy, label, cls, rank, n, med, mult: med > 0 ? times(f.h / med) + " a normal " + MON[fm] : fmt(f.h) + (fmt(f.h) === "1" ? " hotspot" : " hotspots") };
}
/* how often has it burned in a given calendar month? Uses the VIIRS years, which see small fires too */
export const riskYears = () => {
  const a = Math.max(S.yFrom, 2012);
  return a <= S.yTo ? [a, S.yTo] : [S.yFrom, S.yTo];
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
export function countyRisk(st: StateCode, m: number) {
  const s = D.states[st],
    [a, b] = riskYears(),
    ny = b - a + 1,
    nc = s.counties.length,
    M = new Float64Array(nc * ny),
    rows = s.county_rows;
  for (let p = 0; p < rows.length; p += 5) {
    const i = rows[p + 1];
    if (i % 12 !== m) continue;
    const y = Y0 + Math.floor(i / 12);
    if (y < a || y > b) continue;
    M[rows[p] * ny + (y - a)] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
  }
  return s.counties
    .map((c, ci) => {
      const v = Array.from(M.subarray(ci * ny, (ci + 1) * ny)).sort((x, y) => x - y),
        k = v.filter(x => x > 0).length;
      return { ci, name: c.name, k, n: ny, p: k / ny, med: (v[Math.floor((ny - 1) / 2)] + v[Math.ceil((ny - 1) / 2)]) / 2 };
    })
    .sort((x, y) => y.med - x.med || y.p - x.p);
}
export const leadText = (R: SeriesAnalysis) =>
  R.total === 0
    ? "No fire hotspots were detected here in these years. Try a larger area."
    : `Fire activity here peaks in ${MONL[R.order[0].m]}. ${R.ranked[0].y} was the most active year on record, ${times(R.ranked[0].h / R.mean).replace("×", "")} times an average year.`;
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
