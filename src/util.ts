/** the elements that are something more specific than a plain HTMLElement, by id */
interface ElementById {
  map: HTMLCanvasElement;
  globe: HTMLCanvasElement;
  calRamp: HTMLCanvasElement;
  cCalRamp: HTMLCanvasElement;
  cMapRamp: HTMLCanvasElement;
  cMap: HTMLCanvasElement;
  cFrom: HTMLSelectElement;
  cTo: HTMLSelectElement;
  cfM: HTMLSelectElement;
  cfY: HTMLSelectElement;
  heroFind: HTMLInputElement;
  yFrom: HTMLSelectElement;
  yTo: HTMLSelectElement;
  fM: HTMLSelectElement;
  fY: HTMLSelectElement;
  pal: HTMLSelectElement;
  rmMap: HTMLSelectElement;
  rmSheet: HTMLSelectElement;
  lat: HTMLInputElement;
  lon: HTMLInputElement;
  rad: HTMLInputElement;
  town: HTMLInputElement;
  stnChk: HTMLInputElement;
}
type Lookup = { <K extends keyof ElementById>(id: K): ElementById[K]; (id: string): HTMLElement };

/** element by id; every id used in the code exists in index.html */
export const $ = ((id: string) => document.getElementById(id)) as Lookup;
export const fmt = (v: number) =>
  v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? String(Math.round(v)) : v === 0 ? "0" : String(Math.round(v * 10) / 10);
export const short = (v: number) =>
  Math.abs(v) >= 1e6
    ? (v / 1e6).toFixed(1) + "M"
    : Math.abs(v) >= 1e4
      ? Math.round(v / 1e3) + "k"
      : Math.abs(v) >= 1e3
        ? (v / 1e3).toFixed(1).replace(".0", "") + "k"
        : Math.abs(v) >= 100
          ? String(Math.round(v))
          : String(Math.round(v * 10) / 10);
export const times = (x: number) => (x >= 10 ? Math.round(x) : x.toFixed(1)) + "×";
export const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
