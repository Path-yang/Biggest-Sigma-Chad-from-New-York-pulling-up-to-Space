/* Shapes of the data in data.js and of the page's own state. */

export type StateCode = "NY" | "CA";
export type Palette = "fire" | "inferno" | "cividis" | "viridis";
export type Layer = "count" | "chance";
export type CalendarMode = "count" | "anom";
export type SheetTab = "area" | "compare";
/** red, green, blue, each 0 to 255 */
export type RGB = number[];
/** an outline as a flat list: lon, lat, lon, lat, ... */
export type Ring = number[];

/* ---------- data.js ---------- */
export interface Meta {
  y0: number;
  y1: number;
  /** [year, month] of the first month VIIRS is used as observed */
  viirs_from: [number, number];
  /** [year, month] of the first month Aqua flew alongside Terra */
  aqua_from: [number, number];
  /** upper edges of the size bins that pick a range multiplier from StateData.pi */
  bins: number[];
}
export interface County {
  fips: string;
  name: string;
}
export interface SensorCounts {
  terra: number;
  aqua: number;
  snpp: number;
}
export interface StateData {
  /** VIIRS-per-MODIS exchange rate for each calendar month, Terra and Aqua together */
  r_ta: number[];
  /** the same with Terra alone, for the months before Aqua flew */
  r_t: number[];
  r_ta_lo: number[];
  r_ta_hi: number[];
  r_all: number;
  /** 90% range multipliers [low, high], one pair per size bin */
  pi: [number, number][];
  /** top of the range for a converted month that came out as zero */
  zero_hi: number;
  val: { raw_factor: number; annual_med_err: number; annual_max_err: number; [key: string]: unknown };
  mask: { static_sites: number; removed: SensorCounts; kept: SensorCounts };
  counties: County[];
  /** flat rows of five: county index, month index, Terra, Aqua, VIIRS */
  county_rows: number[];
  /** flat rows of three: axial q, axial r, county index */
  hexes: number[];
  /** flat rows of five: hexagon index, month index, Terra, Aqua, VIIRS */
  hex_rows: number[];
  /** hexagon size in degrees of latitude */
  hex_r: number;
  /** longitude is multiplied by this to give map x, so shapes keep their proportions */
  hex_k: number;
  calib_n: { modis: number; viirs: number };
}
export interface CountyGeo {
  f: string;
  n: string;
  r: Ring[];
}
/** [class, line]: class 1 is drawn heavier than class 2 */
export type Road = [number, Ring];
export interface Detail {
  /** flat rows of five: axial q, axial r, hotspot count, bit mask of years from 2012, bit mask of months */
  fine: number[];
  fine_r: number;
  /** flat rows of three: axial q, axial r, distance band from the state */
  ctx: number[];
  ctx_d: number;
  roads: Road[];
}
export interface Places {
  /** [name, lat, lon, population], most populous first */
  towns: [string, number, number, number][];
  /** flat pairs: lon, lat */
  stn_xy: number[];
  /** [station name, town] */
  stn: [string, string][];
}
export interface BurnData {
  meta: Meta;
  states: Record<StateCode, StateData>;
  geo: Record<StateCode, CountyGeo[]>;
  globe: { land: Ring[]; us: Ring[]; plate: Record<StateCode, Ring[]> };
  tex: { earth: string };
  detail: Record<StateCode, Detail>;
  places: Record<StateCode, Places>;
}

/* ---------- what the reader has chosen ---------- */
export interface Box {
  w: number;
  e: number;
  s: number;
  n: number;
}
export type Sel =
  | { type: "state" }
  | { type: "county"; ci: number }
  | { type: "hex"; k: number }
  | ({ type: "box" } & Box)
  | { type: "circle"; lat: number; lon: number; rad: number; label?: string };
/** which slice of time the map shows: everything, one year, one calendar month, or one month of one year */
export type Show =
  | { t: "all"; y?: undefined; m?: undefined }
  | { t: "year"; y: number; m?: undefined }
  | { t: "cmonth"; m: number; y?: undefined }
  | { t: "ym"; y: number; m: number };
export interface AppState {
  st: StateCode | null;
  sel: Sel;
  yFrom: number;
  yTo: number;
  /** [year, month] being tested for "was it unusual?" */
  focus: number[];
  mode: CalendarMode;
  pal: Palette;
  stn: boolean;
  show: Show;
  draw: boolean;
  sheet: SheetTab | null;
  layer: Layer;
  /** calendar month for "chance of fire" */
  rm: number;
}
export interface Preset {
  name: string;
  lat: number;
  lon: number;
  rad: number;
  focus: number[];
}

/* ---------- derived per-state lookup tables ---------- */
export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface FineHexes {
  R: number;
  n: number;
  X: Float32Array;
  Y: Float32Array;
  c: Uint32Array;
  ym: Uint16Array;
  mm: Uint16Array;
  key: Map<string, number>;
  max: number;
}
export interface Town {
  n: string;
  lat: number;
  lon: number;
  pop: number;
  X: number;
  Y: number;
}
export interface Stations {
  n: number;
  X: Float32Array;
  Y: Float32Array;
  /** county index of each station, or -1 */
  c: Int16Array;
  names: [string, string][];
}
export interface HexState extends Bounds {
  n: number;
  R: number;
  K: number;
  q: Int32Array;
  r: Int32Array;
  /** county index of each hexagon */
  c: Int32Array;
  X: Float64Array;
  Y: Float64Array;
  /** harmonized hotspots, hexagon by month: H[k * NM + i] */
  H: Float32Array;
  key: Map<string, number>;
  geo: CountyGeo[];
  geoByFips: Record<string, CountyGeo>;
  cn: number;
  cX: Float32Array;
  cY: Float32Array;
  cB: Uint8Array;
  f: FineHexes;
  roads: Road[];
  towns: Town[];
  stn: Stations;
}

/* ---------- analysis results ---------- */
export interface Harmonized {
  h: number;
  lo: number;
  hi: number;
  src: string;
}
export interface SeriesRow extends Harmonized {
  i: number;
  y: number;
  m: number;
  T: number;
  A: number;
  V: number;
  med: number;
  ratio: number;
}
export interface MonthStat {
  med: number;
  q1: number;
  q3: number;
  sum: number;
}
export interface YearRow {
  y: number;
  h: number;
  lo: number;
  hi: number;
  naive: number;
}
export interface Analysis {
  st: StateCode;
  ser: SeriesRow[];
  stats: MonthStat[];
  years: YearRow[];
  total: number;
  mean: number;
  order: { m: number; sum: number }[];
  ranked: YearRow[];
}
export interface Verdict {
  f: SeriesRow;
  fm: number;
  fy: number;
  label: string;
  cls: string;
  rank: number;
  n: number;
  med: number;
  mult: string;
}

/* ---------- map view ---------- */
export interface ViewTarget {
  cx: number;
  cy: number;
  s: number;
}
export interface Drag {
  p0: number[];
  c0: number[];
  moved: boolean;
  ll: number[];
  box?: Box;
}
export interface View extends ViewTarget {
  W: number;
  H: number;
  fit: number;
  anim: number | null;
  hover: number;
  hoverF: number;
  drag: Drag | null;
  vals: Float32Array | null;
  max: number;
  chN: number;
  fineOn: boolean;
  selC: { x: number; y: number; r: number } | null;
  mask: Uint8Array | null;
  dpr: number;
  early?: boolean;
}
