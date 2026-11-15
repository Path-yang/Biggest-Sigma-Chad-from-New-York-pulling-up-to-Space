import type { Bounds, HexState, Ring, View, ViewTarget } from "./types";
import { D, MON, MONL, NBR, NM, Y0 } from "./data";
import { S } from "./state";
import { $, ease, fmt, reduced, short } from "./util";
import { LUT, colT, pop } from "./color";
import { hexKey, hexState, notFireName, riskYears, selMask } from "./model";
import { hideTip, showTip } from "./tooltip";
import { render } from "./render";
import { drawResponse, respClick, respTip } from "./respui";
import type { Chance } from "./forecast";
import { chanceNow, isFc, monthWhen, pctP } from "./forecast";
import { olFill, olLegend, olTip } from "./olui";
import { olRun } from "./outlook";

/* =====================================================================
   MAP: hexagons on a canvas with a pan/zoom view.
   Zoom levels: state (13 km hexagons) -> town (2 km hexagons, roads, street map where it can load)
   ===================================================================== */
export const V: View = {
  cx: 0,
  cy: 0,
  s: 1,
  W: 0,
  H: 0,
  fit: 1,
  anim: null,
  hover: -1,
  hoverF: -1,
  drag: null,
  vals: null,
  max: 1,
  chN: 1,
  fineOn: false,
  selC: null,
  mask: null,
  dpr: 1,
};
/** the chance-of-fire layer on screen, with its colour scale */
let CH: Chance | null = null;
/** 0..1 on the colour scale for a chance */
const chT = (v: number) => (CH ? Math.min(1, Math.pow(v / CH.max, CH.pow)) : v);
/** 2 km detail exists only for past hotspots and past odds of any fire */
const fineFits = () => S.layer === "count" || (S.layer === "chance" && S.odds === "past" && S.fire === "any");
const sx = (X: number) => V.W / 2 + (X - V.cx) * V.s,
  sy = (Y: number) => V.H / 2 - (Y - V.cy) * V.s;
const ix = (x: number) => V.cx + (x - V.W / 2) / V.s,
  iy = (y: number) => V.cy - (y - V.H / 2) / V.s;
export function mapSize() {
  const cv = $("map"),
    dpr = Math.min(2, devicePixelRatio || 1);
  V.W = cv.clientWidth;
  V.H = cv.clientHeight;
  cv.width = V.W * dpr;
  cv.height = V.H * dpr;
  V.dpr = dpr;
}
const inset = () => (V.W > 900 ? 388 : 0);
/** map point (X, Y) is in the part of the map the card does not cover */
export const onScreen = (X: number, Y: number) => {
  const x = sx(X),
    y = sy(Y);
  return x > 0 && x < V.W - inset() && y > 0 && y < V.H;
};
export function fitView(b: Bounds): ViewTarget {
  const pad = 70,
    s = Math.min((V.W - inset() - 2 * pad) / (b.x1 - b.x0), (V.H - 216) / (b.y1 - b.y0));
  return { cx: (b.x0 + b.x1) / 2 + inset() / 2 / s, cy: (b.y0 + b.y1) / 2 - 30 / s, s };
}
export function flyTo(t: ViewTarget, ms?: number) {
  if (reduced || !ms) {
    Object.assign(V, t);
    mapDraw();
    return;
  }
  const a = { cx: V.cx, cy: V.cy, s: V.s },
    t0 = performance.now();
  V.anim = t0;
  const step = (now: number) => {
    if (V.anim !== t0) return;
    const u = Math.min(1, (now - t0) / ms),
      e = ease(u);
    V.cx = a.cx + (t.cx - a.cx) * e;
    V.cy = a.cy + (t.cy - a.cy) * e;
    V.s = Math.exp(Math.log(a.s) + (Math.log(t.s) - Math.log(a.s)) * e);
    mapDraw();
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export const centerOn = (lon: number, lat: number, s: number, ms?: number) =>
  flyTo({ cx: lon * hexState(S.st!).K + inset() / 2 / s, cy: lat, s }, ms || 1300);
/* the selection as a mask, plus its centre and reach so everything else can fade with distance */
export function selFocus() {
  const hx = hexState(S.st!),
    m = (V.mask = selMask());
  V.selC = null;
  if (S.sel.type === "state") return;
  let ax = 0,
    ay = 0,
    n = 0;
  for (let k = 0; k < hx.n; k++)
    if (m[k]) {
      ax += hx.X[k];
      ay += hx.Y[k];
      n++;
    }
  if (!n) return;
  ax /= n;
  ay /= n;
  let r = 0;
  for (let k = 0; k < hx.n; k++) if (m[k]) r = Math.max(r, Math.hypot(hx.X[k] - ax, hx.Y[k] - ay));
  V.selC = { x: ax, y: ay, r };
}
export function selBounds(): Bounds {
  const hx = hexState(S.st!);
  if (S.sel.type === "state") return hx;
  const m = selMask();
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9;
  for (let k = 0; k < hx.n; k++)
    if (m[k]) {
      x0 = Math.min(x0, hx.X[k]);
      x1 = Math.max(x1, hx.X[k]);
      y0 = Math.min(y0, hx.Y[k]);
      y1 = Math.max(y1, hx.Y[k]);
    }
  if (x0 > x1) return hx;
  const p = hx.R * 7;
  return { x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p };
}
export const showLabel = () => {
  const sh = S.show;
  return sh.t === "all"
    ? `All hotspots, ${S.yFrom} to ${S.yTo}`
    : sh.t === "year"
      ? `Hotspots in ${sh.y}`
      : sh.t === "cmonth"
        ? `A typical ${MONL[sh.m]}`
        : `${MONL[sh.m]} ${sh.y}`;
};
export function mapValues() {
  const hx = hexState(S.st!),
    v = new Float32Array(hx.n),
    sh = S.show,
    i0 = (S.yFrom - Y0) * 12,
    i1 = (S.yTo - Y0 + 1) * 12;
  let max = 0;
  if (S.layer === "outlook") {
    /* counties are filled from the outlook in mapDraw; the hexagons stay empty */
    max = 1;
  } else if (S.layer === "chance") {
    CH = chanceNow(S.st!);
    V.chN = CH.years ? CH.years[1] - CH.years[0] + 1 : 0;
    max = 1;
    v.set(CH.v);
  } else {
    for (let k = 0; k < hx.n; k++) {
      const b = k * NM;
      let a = 0;
      if (sh.t === "all") for (let i = i0; i < i1; i++) a += hx.H[b + i];
      else if (sh.t === "year") for (let i = (sh.y - Y0) * 12, e = i + 12; i < e; i++) a += hx.H[b + i];
      else if (sh.t === "cmonth") {
        for (let i = i0 + sh.m; i < i1; i += 12) a += hx.H[b + i];
        a /= S.yTo - S.yFrom + 1;
      } else a = hx.H[b + (sh.y - Y0) * 12 + sh.m];
      v[k] = a;
      if (a > max) max = a;
    }
    if (sh.t === "year") {
      max = 0;
      for (let k = 0; k < hx.n; k++)
        for (let y = S.yFrom; y <= S.yTo; y++) {
          let a = 0;
          const b = k * NM + (y - Y0) * 12;
          for (let i = 0; i < 12; i++) a += hx.H[b + i];
          if (a > max) max = a;
        }
    }
  }
  V.vals = v;
  V.max = Math.max(1, max);
  legend();
}
/** the chance at point t of the colour scale, for the legend */
const chLabel = (t: number, top: boolean) => {
  if (!CH) return Math.round(t * 100) + "%";
  const v = CH.max * Math.pow(t, 1 / CH.pow),
    s = v >= 0.02 ? Math.round(v * 100) + "%" : (v * 100).toFixed(1) + "%";
  return s + (top && CH.max < 1 ? "+" : "");
};
function legend() {
  if (S.layer === "outlook") {
    olLegend();
    return;
  }
  const ch = S.layer === "chance",
    f = V.fineOn,
    sh = S.show,
    [a, b] = CH && CH.years ? CH.years : riskYears(),
    big = S.fire === "large",
    lut = LUT(),
    mx = f ? hexState(S.st!).f.max : V.max;
  $("legTitle").textContent = f
    ? ch
      ? "How often each 2 km hexagon has burned since 2012"
      : "Hotspots per 2 km hexagon since 2012"
    : ch
      ? isFc()
        ? `Forecast for ${monthWhen()}: chance of ${big ? "a large fire (1,000+ acres) starting and reaching the hexagon" : "at least one hotspot"}`
        : big
          ? `Large fires in ${MONL[S.rm]}: share of years ${a} to ${b} when one (1,000+ acres) started and reached the hexagon`
          : `Chance of fire in ${MONL[S.rm]}: share of years ${a} to ${b} with a hotspot`
      : sh.t === "cmonth"
        ? `Average hotspots per hexagon in ${MONL[sh.m]}`
        : `Hotspots per hexagon, ${sh.t === "year" ? sh.y : sh.t === "ym" ? MON[sh.m] + " " + sh.y : S.yFrom + " to " + S.yTo}`;
  let g = "";
  [0, 0.25, 0.5, 0.75, 1].forEach((t, i) => {
    const r = 5.5 + 7.5 * t,
      x = 24 + i * 49,
      pts: string[] = [];
    for (let q = 0; q < 6; q++) {
      const an = (Math.PI / 180) * (30 + 60 * q);
      pts.push((x + r * Math.cos(an)).toFixed(1) + "," + (15 - r * Math.sin(an)).toFixed(1));
    }
    g += `<polygon points="${pts.join(" ")}" fill="${colT(lut, t)}"/><text x="${x}" y="42" text-anchor="middle">${ch ? (i ? chLabel(t, i === 4) : "rare") : short(Math.max(1, Math.round(Math.expm1(t * Math.log1p(mx)))))}</text>`;
  });
  $("legSw").innerHTML = `<svg viewBox="0 0 244 46" role="img" aria-label="Larger, stronger-coloured hexagons mean more fire">${g}</svg>`;
  $("legCap").textContent =
    (S.pal === "fire" ? "Bigger and redder" : "Bigger and brighter") +
    (ch ? (big ? " means large fires more often." : " means fire more often.") : " means more fire.") +
    (ch && isFc() ? " From fire history alone, not weather." : "") +
    (ch && big ? " Fire perimeters: CAL FIRE." : "") +
    (V.early ? " 2 km detail starts in 2012." : "");
}
/* street map tiles: only load where the page is allowed to fetch them (not inside the Claude preview) */
const TILES: { ok: boolean | null; cache: Map<string, HTMLImageElement> } = { ok: null, cache: new Map() };
const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
let drawQueued = false;
const queueDraw = () => {
  if (!drawQueued) {
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      mapDraw();
    });
  }
};
export function tileProbe() {
  const im = new Image();
  im.onload = () => {
    TILES.ok = true;
    queueDraw();
  };
  im.onerror = () => {
    TILES.ok = false;
  };
  im.src = tileUrl(3, 1, 2);
}
function drawTiles(c: CanvasRenderingContext2D, hx: HexState, zf: number) {
  const z = Math.max(0, Math.min(18, Math.round(zf))),
    n = Math.pow(2, z),
    lon0 = ix(0) / hx.K,
    lon1 = ix(V.W) / hx.K,
    lat1 = iy(0),
    lat0 = iy(V.H);
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n),
    ty = (lat: number) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
  const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    x0 = tx(lon0),
    x1 = tx(lon1),
    y0 = ty(lat1),
    y1 = ty(lat0);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return false;
  const dark = "filter" in c;
  c.globalAlpha = Math.min(1, (zf - 8.8) / 0.8) * (dark ? 1 : 0.45);
  if (dark) c.filter = "invert(1) hue-rotate(180deg) brightness(1.15) contrast(.95) saturate(.45)";
  let any = false;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const k = z + "/" + x + "/" + y;
      let t = TILES.cache.get(k);
      if (!t) {
        t = new Image();
        t.onload = queueDraw;
        t.src = tileUrl(z, x, y);
        TILES.cache.set(k, t);
        if (TILES.cache.size > 500) TILES.cache.delete(TILES.cache.keys().next().value!);
      }
      if (t.complete && t.naturalWidth) {
        const xa = sx(((x / n) * 360 - 180) * hx.K),
          xb = sx((((x + 1) / n) * 360 - 180) * hx.K),
          ya = sy(latOf(y)),
          yb = sy(latOf(y + 1));
        c.drawImage(t, xa, ya, xb - xa + 0.6, yb - ya + 0.6);
        any = true;
      }
    }
  c.globalAlpha = 1;
  if (dark) c.filter = "none";
  return any;
}
/* land around the state: hexagons that fade and blur with distance, so the state stays the subject */
let ctxCan: HTMLCanvasElement | null = null;
function drawContext(c: CanvasRenderingContext2D, hx: HexState, rr: number, ox: number[], oy: number[], dim: number) {
  const canBlur = "filter" in c;
  if (!ctxCan) ctxCan = document.createElement("canvas");
  if (ctxCan.width !== c.canvas.width || ctxCan.height !== c.canvas.height) {
    ctxCan.width = c.canvas.width;
    ctxCan.height = c.canvas.height;
  }
  const o = ctxCan.getContext("2d")!;
  for (const [b0, b1, blur] of [
    [0, 4, 0.5],
    [5, 9, 2.5],
    [10, 15, 6],
  ]) {
    o.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    o.clearRect(0, 0, V.W, V.H);
    o.fillStyle = "#212c42";
    for (let b = b0; b <= b1; b++) {
      o.globalAlpha = 0.95 * Math.pow(1 - b / 16, 1.6) * dim;
      o.beginPath();
      for (let j = 0; j < hx.cn; j++)
        if (hx.cB[j] === b) {
          const x = sx(hx.cX[j]),
            y = sy(hx.cY[j]);
          if (x < -rr || y < -rr || x > V.W + rr || y > V.H + rr) continue;
          o.moveTo(x + ox[0], y - oy[0]);
          for (let a = 1; a < 6; a++) o.lineTo(x + ox[a], y - oy[a]);
          o.closePath();
        }
      o.fill();
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (canBlur) c.filter = `blur(${blur * V.dpr}px)`;
    c.drawImage(ctxCan, 0, 0);
    c.restore();
  }
}
/* town and city names: most populous first, skipping any that would overlap one already drawn */
function drawLabels(c: CanvasRenderingContext2D, hx: HexState) {
  const zr = V.s / V.fit,
    K = Math.min(hx.towns.length, Math.round(80 * Math.pow(zr, 1.6))),
    pad = Math.max(5, 15 - 2.5 * zr),
    cap = Math.round(12 + 5 * zr),
    boxes: number[][] = [];
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  for (let i = 0; i < K && boxes.length < cap; i++) {
    const t = hx.towns[i],
      x = sx(t.X),
      y = sy(t.Y);
    if (x < 4 || y < 12 || x > V.W - 30 || y > V.H - 12) continue;
    const big = t.pop >= 100000,
      w = (big ? 7.6 : 6.6) * t.n.length,
      hit = (b: number[]) => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    let b = [x - 6 - pad, y - 9 - pad, x + 9 + w + pad, y + 9 + pad],
      left = false; /* name to the right of its dot, or to the left if that is taken */
    if (hit(b)) {
      b = [x - 9 - w - pad, y - 9 - pad, x + 6 + pad, y + 9 + pad];
      left = true;
      if (hit(b) || b[0] < 4) continue;
    }
    boxes.push(b);
    c.font = (big ? "600 14px" : "500 12.5px") + " 'Instrument Sans',sans-serif";
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(x, y, big ? 3 : 2.3, 0, 7);
    c.fill();
    c.textAlign = left ? "right" : "left";
    const tx = left ? x - 7 : x + 7;
    c.strokeStyle = "rgba(0,0,0,.92)";
    c.lineWidth = 3.5;
    c.strokeText(t.n, tx, y);
    c.fillStyle = "#f1f4f9";
    c.fillText(t.n, tx, y);
  }
}
export function mapDraw() {
  if (!S.st || !V.mask) return;
  const hx = hexState(S.st),
    cv = $("map"),
    c = cv.getContext("2d")!,
    mask = V.mask,
    lmax = Math.log1p(V.max),
    ch = S.layer === "chance",
    lut = LUT(),
    sh = S.show;
  c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  c.clearRect(0, 0, V.W, V.H);
  /* 2 km hexagons only exist from 2012, so an earlier year keeps the large hexagons on screen */
  const R = hx.R * V.s,
    rr = R * (R > 5 ? 0.93 : 1),
    early = !ch && (sh.t === "year" || sh.t === "ym") && sh.y < 2012,
    fineT = early || !fineFits() ? 0 : Math.max(0, Math.min(1, (R - 20) / 16)),
    zf = Math.log2((360 * hx.K * V.s) / 256);
  const corners = (r: number) => {
    const ox: number[] = [],
      oy: number[] = [];
    for (let a = 0; a < 6; a++) {
      const t = (Math.PI / 180) * (30 + 60 * a);
      ox.push(r * Math.cos(t));
      oy.push(r * Math.sin(t));
    }
    return [ox, oy];
  };
  const hexPath = (x: number, y: number, ox: number[], oy: number[], k: number) => {
    c.beginPath();
    c.moveTo(x + ox[0] * k, y - oy[0] * k);
    for (let a = 1; a < 6; a++) c.lineTo(x + ox[a] * k, y - oy[a] * k);
    c.closePath();
  };
  const [ox, oy] = corners(rr),
    fOn = fineT > 0.5;
  if (fOn !== V.fineOn || early !== V.early) {
    V.fineOn = fOn;
    V.early = early;
    legend();
  }
  const tiles = TILES.ok && zf >= 8.8 ? drawTiles(c, hx, zf) : false;
  $("attrib").hidden = !tiles;
  if (R < 70) drawContext(c, hx, rr, ox, oy, (S.sel.type === "state" ? 1 : 0.6) * (tiles ? 0.35 : 1));
  /* once the outlook is in, its counties are the map; the empty hexagons only show while it loads or if it failed */
  const olReady = S.layer === "outlook" && olRun(S.st)?.status === "ok";
  if (fineT < 1 && !olReady) {
    const sc = V.selC,
      base = (1 - fineT) * (tiles ? 0.62 : 1);
    for (let k = 0; k < hx.n; k++) {
      const x = sx(hx.X[k]),
        y = sy(hx.Y[k]);
      if (x < -rr || y < -rr || x > V.W + rr || y > V.H + rr) continue;
      const v = V.vals![k];
      let a = 1;
      if (sc && !mask[k]) {
        const d = Math.max(0, Math.hypot(hx.X[k] - sc.x, hx.Y[k] - sc.y) - sc.r);
        a = Math.max(0.08, 0.4 * Math.exp(-d / (hx.R * 8)));
      }
      c.globalAlpha = a * base * (tiles ? 0.45 : 1);
      c.fillStyle = "#141a27";
      hexPath(x, y, ox, oy, 1);
      c.fill();
      if (v > 0) {
        const t = ch ? chT(v) : Math.log1p(v) / lmax;
        c.globalAlpha = a * base;
        c.fillStyle = colT(lut, t);
        hexPath(x, y, ox, oy, 0.46 + 0.54 * t);
        c.fill();
      }
    }
  }
  if (fineT > 0) {
    const f = hx.f,
      fr = f.R * V.s * 0.94,
      [fx, fy] = corners(fr),
      lm = Math.log1p(f.max),
      yb = !ch && (sh.t === "year" || sh.t === "ym") ? 1 << (sh.y - 2012) : 0,
      mb = !ch && (sh.t === "cmonth" || sh.t === "ym") ? 1 << sh.m : 0;
    c.globalAlpha = fineT * (tiles ? 0.5 : 0.94);
    for (let j = 0; j < f.n; j++) {
      if ((yb && !(f.ym[j] & yb)) || (mb && !(f.mm[j] & mb))) continue;
      const x = sx(f.X[j]),
        y = sy(f.Y[j]);
      if (x < -fr || y < -fr || x > V.W + fr || y > V.H + fr) continue;
      const t = ch ? pop(f.ym[j]) / 14 : Math.log1p(f.c[j]) / lm;
      c.fillStyle = colT(lut, t);
      hexPath(x, y, fx, fy, 0.5 + 0.5 * t);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  const path = (r: Ring[]) => {
    c.beginPath();
    for (const g of r) {
      for (let i = 0; i < g.length; i += 2) i ? c.lineTo(sx(g[i] * hx.K), sy(g[i + 1])) : c.moveTo(sx(g[i] * hx.K), sy(g[i + 1]));
      c.closePath();
    }
  };
  if (S.layer === "outlook") {
    /* the 14-day outlook: each county filled by its chance against the usual */
    const ciOf = new Map(D.states[S.st].counties.map((cty, i) => [cty.fips, i])),
      sl = S.sel,
      on = sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -1;
    for (const g of hx.geo) {
      const ci = ciOf.get(g.f),
        f = ci === undefined ? null : olFill(S.st, ci);
      if (!f) continue;
      c.globalAlpha = f.a * (tiles ? 0.55 : 1) * (on < 0 || on === ci ? 1 : 0.45);
      c.fillStyle = f.c;
      path(g.r);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  c.strokeStyle = "rgba(255,255,255," + (V.s > V.fit * 1.6 ? 0.24 : 0.09) + ")";
  c.lineWidth = 1;
  for (const g of hx.geo) {
    path(g.r);
    c.stroke();
  }
  if (R < 40) {
    c.strokeStyle = "rgba(255,255,255,.07)";
    path(D.globe.us);
    c.stroke();
  }
  c.strokeStyle = "rgba(255,255,255,.5)";
  c.lineWidth = 1.3;
  path(D.globe.plate[S.st]);
  c.stroke();
  if (!tiles && R >= 9) {
    c.lineJoin = "round";
    for (const pass of [2, 1]) {
      c.beginPath();
      for (const rd of hx.roads) {
        if (rd[0] !== pass) continue;
        const p = rd[1];
        for (let i = 0; i < p.length; i += 2) i ? c.lineTo(sx(p[i] * hx.K), sy(p[i + 1])) : c.moveTo(sx(p[i] * hx.K), sy(p[i + 1]));
      }
      c.strokeStyle = pass === 1 ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.3)";
      c.lineWidth = pass === 1 ? 1.8 : 1;
      c.stroke();
    }
  }
  c.strokeStyle = "#fff";
  c.lineWidth = 2;
  const sel = S.sel;
  if (sel.type === "county") {
    path(hx.geoByFips[D.states[S.st].counties[sel.ci].fips].r);
    c.stroke();
  }
  if (sel.type === "hex") {
    const [hx1, hy1] = corners(R);
    hexPath(sx(hx.X[sel.k]), sy(hx.Y[sel.k]), hx1, hy1, 1);
    c.stroke();
  }
  const box = V.drag && V.drag.box ? V.drag.box : sel.type === "box" ? sel : null;
  if (box) c.strokeRect(sx(box.w * hx.K), sy(box.n), sx(box.e * hx.K) - sx(box.w * hx.K), sy(box.s) - sy(box.n));
  if (sel.type === "circle") {
    c.beginPath();
    c.ellipse(
      sx(sel.lon * hx.K),
      sy(sel.lat),
      (sel.rad / (111.32 * Math.cos((sel.lat * Math.PI) / 180))) * hx.K * V.s,
      (sel.rad / 110.57) * V.s,
      0,
      0,
      7,
    );
    c.stroke();
  }
  c.lineWidth = 1.5;
  if (V.fineOn && V.hoverF >= 0) {
    const [fx, fy] = corners(hx.f.R * V.s * 0.94);
    hexPath(sx(hx.f.X[V.hoverF]), sy(hx.f.Y[V.hoverF]), fx, fy, 1);
    c.stroke();
  } else if (!V.fineOn && V.hover >= 0) {
    hexPath(sx(hx.X[V.hover]), sy(hx.Y[V.hover]), ox, oy, 1);
    c.stroke();
  }
  if (S.stn && R >= 14) {
    const st = hx.stn,
      z = R >= 60 ? 4.5 : 3;
    c.fillStyle = "#7fd8ff";
    c.strokeStyle = "#04121c";
    c.lineWidth = 1;
    const only =
      V.fineOn || R >= 40
        ? -1
        : sel.type === "county"
          ? sel.ci
          : sel.type === "hex"
            ? hx.c[sel.k]
            : -2; /* at county zoom, only the selected county's stations */
    for (let i = 0; i < st.n; i++) {
      if (only !== -1 && st.c[i] !== only) continue;
      const x = sx(st.X[i]),
        y = sy(st.Y[i]);
      if (x < -5 || y < -5 || x > V.W + 5 || y > V.H + 5) continue;
      c.beginPath();
      c.rect(x - z, y - z, 2 * z, 2 * z);
      c.fill();
      c.stroke();
    }
  }
  c.textBaseline = "middle";
  c.textAlign = "center";
  c.font = "500 11px 'JetBrains Mono',monospace";
  c.fillStyle = "rgba(255,255,255,.42)";
  if (R < 40) for (const [n, la, lo] of NBR[S.st]) c.fillText(n.toUpperCase().split("").join("\u200a"), sx(lo * hx.K), sy(la));
  drawLabels(c, hx);
  drawResponse(c, sx, sy, R);
}
/** what the chance layer says about hexagon k, for its tooltip */
function chanceTip(k: number) {
  const big = S.fire === "large",
    past = (c: Chance) =>
      c.years
        ? `${big ? "a large fire started and reached here" : "fire detected here"} in ${Math.round(c.v[k] * (c.years[1] - c.years[0] + 1))} of ${c.years[1] - c.years[0] + 1} ${MONL[S.rm]}s, ${c.years[0]}–${c.years[1]}`
        : "";
  if (!CH) return "";
  if (!isFc()) return `${past(CH).replace(/^./, c => c.toUpperCase())} (${pctP(CH.v[k], true)})`;
  return (
    `Forecast for ${monthWhen()}: ${pctP(CH.v[k])} chance of ${big ? "a large fire reaching here" : "at least one hotspot"}\n` +
    `Past: ${past(chanceNow(S.st!, S.rm, "past", S.fire))}`
  );
}
/** a line for hexagons whose hotspots are mostly not fire */
const notFireTip = (k: number) => {
  const n = k >= 0 ? notFireName(S.st!, k) : "";
  return n ? `\nMost hotspots here are heat from ${n}, not fire; the chance of fire and the tools leave it out` : "";
};
const hexAt = (px: number, py: number) => {
  const hx = hexState(S.st!),
    k = hx.key.get(hexKey(ix(px), iy(py), hx.R));
  return k === undefined ? -1 : k;
};
const fineAt = (px: number, py: number) => {
  const f = hexState(S.st!).f,
    k = f.key.get(hexKey(ix(px), iy(py), f.R));
  return k === undefined ? -1 : k;
};
export function mapEvents() {
  const cv = $("map"),
    loc = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    },
    zmax = () => V.fit * 320;
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId);
    const p = loc(e);
    V.anim = null;
    V.drag = { p0: p, c0: [V.cx, V.cy], moved: false, ll: [ix(p[0]) / hexState(S.st!).K, iy(p[1])] };
  };
  cv.onpointermove = e => {
    const p = loc(e),
      d = V.drag,
      hx = hexState(S.st!);
    if (d) {
      if (Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) > 5) d.moved = true;
      if (!d.moved) return;
      hideTip();
      if (S.draw) {
        const lo = ix(p[0]) / hx.K,
          la = iy(p[1]);
        d.box = { w: Math.min(lo, d.ll[0]), e: Math.max(lo, d.ll[0]), s: Math.min(la, d.ll[1]), n: Math.max(la, d.ll[1]) };
      } else {
        V.cx = d.c0[0] - (p[0] - d.p0[0]) / V.s;
        V.cy = d.c0[1] + (p[1] - d.p0[1]) / V.s;
      }
      mapDraw();
      return;
    }
    const k = hexAt(p[0], p[1]),
      j = V.fineOn ? fineAt(p[0], p[1]) : -1,
      county = k >= 0 ? D.states[S.st!].counties[hx.c[k]].name + " County" : "";
    if (k !== V.hover || j !== V.hoverF) {
      V.hover = k;
      V.hoverF = j;
      mapDraw();
    }
    if (S.stn && hx.R * V.s >= 14) {
      const st = hx.stn,
        sl = S.sel,
        only = V.fineOn || hx.R * V.s >= 40 ? -1 : sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -2;
      let b = -1,
        bd = 81;
      for (let i = 0; i < st.n; i++) {
        if (only !== -1 && st.c[i] !== only) continue;
        const dx = sx(st.X[i]) - p[0],
          dy = sy(st.Y[i]) - p[1],
          q = dx * dx + dy * dy;
        if (q < bd) {
          bd = q;
          b = i;
        }
      }
      if (b >= 0) {
        showTip(e, `${st.names[b][0]}\nFire or EMS station${st.names[b][1] ? " · " + st.names[b][1] : ""}`);
        return;
      }
    }
    if (V.fineOn) {
      const f = hx.f;
      if (j >= 0)
        showTip(
          e,
          `${county ? county + "\n" : ""}${fmt(f.c[j])} hotspots in this 2 km hexagon since 2012\nBurned in ${pop(f.ym[j])} of 14 years, last in ${2012 + 31 - Math.clz32(f.ym[j])}\nMonths with fire: ${MON.filter((_, m) => (f.mm[j] >> m) & 1).join(", ")}${notFireTip(k)}${respTip(k) || "\nClick to zoom in"}`,
        );
      else if (k >= 0) showTip(e, `${county}\nNo hotspots detected here since 2012${respTip(k)}`);
      else hideTip();
    } else if (k >= 0)
      showTip(
        e,
        (S.layer === "outlook"
          ? `${county}\n${olTip(hx.c[k])}`
          : S.layer === "chance"
            ? `${county}\n${chanceTip(k)}`
            : `${county}\n${fmt(V.vals![k])} hotspots in this hexagon\n${showLabel()}`) +
          notFireTip(k) +
          (respTip(k) || "\nClick to zoom in"),
      );
    else hideTip();
  };
  cv.onpointerleave = () => {
    hideTip();
    if (V.hover >= 0 || V.hoverF >= 0) {
      V.hover = V.hoverF = -1;
      mapDraw();
    }
  };
  /* drill down: state -> county -> hexagon -> street level */
  cv.onpointerup = e => {
    const d = V.drag;
    V.drag = null;
    if (!d) return;
    if (d.box) {
      S.sel = Object.assign({ type: "box" as const }, d.box);
      setDraw(false);
      zoomSel();
      render();
      return;
    }
    if (d.moved) return;
    const p = loc(e),
      k = hexAt(p[0], p[1]);
    if (respClick(ix(p[0]) / hexState(S.st!).K, iy(p[1]), k)) return;
    if (k < 0) return;
    const hx = hexState(S.st!),
      ci = hx.c[k],
      s = S.sel;
    if (V.fineOn) {
      S.sel = { type: "hex", k };
      render();
      const z = Math.min(zmax(), V.s * 2.2);
      flyTo({ cx: ix(p[0]) + inset() / 2 / z, cy: iy(p[1]), s: z }, 700);
    } else if ((s.type === "county" && s.ci === ci) || s.type === "hex") {
      S.sel = { type: "hex", k };
      render();
      centerOn(hx.X[k] / hx.K, hx.Y[k], 150 / hx.R, 900);
    } else setCounty(ci);
  };
  cv.addEventListener(
    "wheel",
    e => {
      e.preventDefault();
      const p = loc(e),
        X = ix(p[0]),
        Y = iy(p[1]),
        f = Math.exp(-e.deltaY * 0.0015);
      V.anim = null;
      V.s = Math.max(V.fit * 0.6, Math.min(zmax(), V.s * f));
      V.cx = X - (p[0] - V.W / 2) / V.s;
      V.cy = Y + (p[1] - V.H / 2) / V.s;
      mapDraw();
    },
    { passive: false },
  );
  $("zin").onclick = () => flyTo({ cx: V.cx, cy: V.cy, s: Math.min(zmax(), V.s * 2) }, 300);
  $("zout").onclick = () => flyTo({ cx: V.cx, cy: V.cy, s: Math.max(V.fit * 0.6, V.s / 2) }, 300);
}
export function zoomSel() {
  const f = fitView(selBounds());
  if (S.sel.type === "state") V.fit = f.s;
  else f.s = Math.min(f.s, V.fit * 4.5);
  flyTo(f, 750);
}
export function setDraw(on: boolean) {
  S.draw = on;
  $("drawBtn").setAttribute("aria-pressed", String(on));
  $("drawBtn").classList.toggle("on", on);
  $("drawBtn").textContent = on ? "Drag a box on the map" : "Draw an area";
  $("map").style.cursor = on ? "crosshair" : "pointer";
}
export function setCounty(ci: number | null) {
  S.sel = ci == null ? { type: "state" } : { type: "county", ci };
  zoomSel();
  render();
}
