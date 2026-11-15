import type { Palette, RGB } from "./types";
import { S } from "./state";
import { $, css } from "./util";

/* ---------- colour ---------- */
export const RAMPS: Record<Palette, string[]> = {
  fire: ["#2e1b1f", "#571f20", "#771e1e", "#991d1c", "#bb201c", "#dc2a22", "#f53a2c", "#ff5238"],
  inferno: ["#2a0f52", "#55126c", "#7f1e6c", "#a92e5e", "#d04545", "#ee6a24", "#fb9d07", "#f6d443", "#fcffa4"],
  cividis: ["#1d3f7a", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"],
  viridis: ["#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
};
const hex3 = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function lerp(stops: string[], t: number): RGB {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)),
    f = t - i,
    a = hex3(stops[i]),
    b = hex3(stops[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
export const seq = (t: number) => lerp(RAMPS[S.pal], t);
export function div(t: number): RGB {
  const m = hex3(css("--mid")),
    e = hex3(css(t < 0 ? "--cool" : "--hot")),
    f = Math.min(1, Math.abs(t));
  return m.map((v, k) => Math.round(v + (e[k] - v) * f));
}
export const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const pop = (n: number) => {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};
export const colT = (lut: string[], t: number) => lut[Math.round(63 * (0.05 + 0.95 * (S.layer === "chance" ? t : Math.pow(t, 1.5))))];
let lutPal: Palette | null = null,
  lut: string[] = [];
export const LUT = () => {
  if (lutPal !== S.pal) {
    lut = Array.from({ length: 64 }, (_, i) => rgb(seq(i / 63)));
    lutPal = S.pal;
  }
  return lut;
};
export const inkOn = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#14110c" : "#fff");
export function paintRamp(id: "calRamp" | "cCalRamp" | "cMapRamp", fn: (t: number) => RGB) {
  const cv = $(id),
    c = cv.getContext("2d")!;
  for (let x = 0; x < cv.width; x++) {
    c.fillStyle = rgb(fn(x / (cv.width - 1)));
    c.fillRect(x, 0, 1, cv.height);
  }
}
