/* Shapes of the data in data.js and of the page's own state. */

export type StateCode = "NY" | "CA";
export type Palette = "fire" | "inferno" | "cividis" | "viridis";
export type Layer = "count" | "chance" | "outlook";
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
  /** the last day with data, "2026-11-14"; absent in a file that ends with a complete year */
  last_date?: string;
  /** the last month index with data; months after it have no data */
  last_i?: number;
  /** the partial last month: 1-based month m, covering days 1 to day_to */
  partial?: { i: number; y: number; m: number; day_to: number; days_in_month: number };
  /** [year, month] of the last MODIS month in the file; later MODIS columns are 0 because MODIS was not fetched */
  modis_through?: [number, number];
  viirs_2026?: { snpp_days: number; n20_days: number; n20_dates: string[]; note: string };
}
/** one month of 2026 in a state: Suomi NPP terms, with the days filled from NOAA-20 */
export interface StateMonth2026 {
  i: number;
  v: number;
  v_exact: number;
  lo: number;
  hi: number;
  snpp: number;
  n20_raw: number;
  n20_converted: number;
  days_snpp: number;
  days_n20: number;
  /** days both satellites missed the state's overpasses (12 Oct 2026): the mean of the days either side */
  days_interp?: number;
  interp?: number;
}
/** a past month (2018-2025) with Suomi NPP outage days, filled from NOAA-20 the way 2026 is */
export interface HistGap {
  i: number;
  days: number[];
  filled: number;
  lo: number;
  hi: number;
}
/** the same days of the partial month (1-14 November) in every Suomi NPP year, for the state and each county */
export interface StatePartial {
  i: number;
  y: number;
  m: number;
  day_from: number;
  day_to: number;
  years: number[];
  state: number[];
  state_median: number;
  state_2026: number;
  state_2026_lo: number;
  state_2026_hi: number;
  county: number[][];
  county_median: number[];
  county_2026: number[];
  /** the same, with past Suomi NPP outage days filled from NOAA-20 as 2026 is */
  state_filled?: number[];
  state_filled_median?: number;
  county_filled?: number[][];
  county_filled_median?: number[];
  filled_years?: number[];
  note: string;
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
  partial?: StatePartial;
  y2026?: {
    months: StateMonth2026[];
    /** the state's days from NOAA-20 and the days interpolated, "2026-03-09" */
    n20_dates?: string[];
    interp_dates?: string[];
    ratio_n20_to_snpp: { r_all: number; r: number[] };
    ratio_note: string;
  };
  /** flat rows of three: county or hexagon index, month index, change from filling past Suomi NPP outage days */
  gap_county_rows?: number[];
  gap_hex_rows?: number[];
  /** the state's past outage months, filled */
  hist_gaps?: (HistGap & { v: number; snpp_gap: number; n20_gap: number })[];
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
  /** where the chance of fire comes from: past odds, or the forecast for one year */
  odds: Odds;
  /** any fire, or large fires only (California) */
  fire: FireKind;
}
/** "past" is the historical share of years with fire; a year is the forecast for that year */
export type Odds = "past" | 2026 | 2027;
export type FireKind = "any" | "large";
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
  /** county index of each station by the hexagon it falls in, or -1 */
  c: Int16Array;
  /** county index of each station by the county outline that holds it; where no outline does (a station on the
   *  coast or a border), the hexagon's county, or -1 */
  cp: Int16Array;
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
  /** the partial last month: its count runs only to the last day with data */
  part?: boolean;
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
  /** a year only partly in the record (2026 to date): its total is "so far" */
  part?: boolean;
}
/** the current partial year against the same span of every past year */
export interface YearToDate {
  /** the span as words, "1 Jan–14 Nov" */
  span: string;
  /** whole months it covers (0..mEnd-1) and whether the partial month's days are in it */
  withPart: boolean;
  y: number;
  cur: number;
  lo: number;
  hi: number;
  /** past years and their counts for the same span */
  years: number[];
  past: number[];
  med: number;
  /** 1 = the most of all years (past and current) */
  rank: number;
  n: number;
}
/** the partial month against the same days of the month in past years */
export interface SameDays {
  /** "1–14 Nov" */
  span: string;
  cur: number;
  lo: number;
  hi: number;
  years: number[];
  past: number[];
  med: number;
}
/** what harmonization needs from a place: its exchange rates and range multipliers */
export interface Rates {
  r_ta: number[];
  r_t: number[];
  pi: [number, number][];
  zero_hi: number;
}
/** month indexes (from January of the first year) where VIIRS and Aqua start, and the range size bins */
export interface Epochs {
  vi0: number;
  aq0: number;
  bins: number[];
}
export interface SeriesAnalysis {
  ser: SeriesRow[];
  /** per calendar month over complete months only; sum is over complete years only */
  stats: MonthStat[];
  years: YearRow[];
  /** hotspots in the complete years */
  total: number;
  /** hotspots in everything shown, the partial year included: 0 means none at all */
  any: number;
  /** an average complete year */
  mean: number;
  order: { m: number; sum: number }[];
  /** complete years, most active first; the partial year is never ranked against them */
  ranked: YearRow[];
  /** the partial year, when it is among the chosen years */
  partYear: YearRow | null;
}
export interface Analysis extends SeriesAnalysis {
  st: StateCode;
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
  /** set when the tested month is partial: it was compared with the same days of past years */
  same?: SameDays;
  /** the tested month is partial and no same-days history exists for this area */
  noSame?: boolean;
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

/* ---------- world.js: country outlines for the globe ---------- */
export interface WorldCountry {
  /** the FIRMS country name, as in the data files */
  k: string;
  /** display name */
  n: string;
  /** label point inside the country: lon, lat */
  c: [number, number];
  /** bounding box: west, south, east, north */
  b: [number, number, number, number];
  /** outer rings, flat lon, lat pairs, closed */
  r: Ring[];
}
export interface World {
  countries: WorldCountry[];
}

/* ---------- country summaries fetched from Hugging Face (summary/v2/<Country>.json) ---------- */
export interface CountryVal {
  /** VIIRS-per-MODIS ratio of raw totals on the overlap; null where MODIS saw nothing */
  raw_factor: number | null;
  annual_med_err: number | null;
  annual_max_err: number | null;
  monthly_wape: number | null;
  loyo: { y: number; obs: number; pred: number; modis: number }[];
}
export interface SensorSeries {
  /** MODIS Terra */
  T: number[];
  /** MODIS Aqua */
  A: number[];
  /** VIIRS Suomi NPP */
  V: number[];
  /** VIIRS NOAA-20, not used in the harmonized record */
  N20: number[];
}
/** summary v3: what 2026 is made of, and the like-for-like comparisons of the partial month and year */
export interface CountryStats {
  min: number;
  q25: number;
  median: number;
  q75: number;
  max: number;
}
export interface Country2026 {
  /** Suomi NPP observed on its complete days, Jan..Nov 2026 */
  v_obs: number[];
  /** NOAA-20 converted to Suomi NPP terms, on the days Suomi NPP missed */
  v_conv: number[];
  v_lo: number[];
  v_hi: number[];
  /** months with converted days; m is 1-based */
  conv_months: {
    i: number;
    m: number;
    days: number[];
    /** days both satellites missed this country's overpasses (12 Oct 2026): the mean of the days either side */
    interp_days?: number[];
    v_interp?: number;
    n_days: number;
    n20: number;
    rate: number;
    v_conv: number;
    v_obs: number;
    v: number;
    v_lo: number;
    v_hi: number;
  }[];
  /** the partial month's days (1-14 November) in every Suomi NPP year, gap-filled like 2026 */
  same_days: {
    m: number;
    day0: number;
    day1: number;
    years: [number, number];
    V: number[];
    V_stats: CountryStats;
    cur: number;
    cur_lo: number;
    cur_hi: number;
    rank: number;
  };
  /** 1 January to the last day, every Suomi NPP year */
  ytd: {
    to: string;
    years: [number, number];
    V: number[];
    V_stats: CountryStats;
    cur: number;
    cur_lo: number;
    cur_hi: number;
    rank: number;
    note?: string;
  };
  /** the 2026 method rerun on 2025 against the published 2025: % difference */
  join_check_2025: { V_pct: number; N20_pct: number; warn: boolean };
  /** past months with Suomi NPP outage days, filled from NOAA-20 the way 2026 is (v2's value kept in monthly) */
  hist_gaps?: (HistGap & { v2: number; n20_conv: number })[];
  mask_note: string;
}
export interface CountrySummary extends Rates {
  v: 2 | 3;
  country: string;
  name: string;
  y0: number;
  y1: number;
  viirs_from: [number, number];
  aqua_from: [number, number];
  bins: number[];
  filter: string;
  /** filtered detections per month, index (year - y0) * 12 + month */
  monthly: SensorSeries;
  r_ta_lo: number[];
  r_ta_hi: number[];
  r_all: number;
  rate_note: string;
  val: CountryVal;
  bbox: [number, number, number, number];
  /** grid cell size in degrees */
  cell: number;
  /** flat pairs: floor(lat / cell), floor(lon / cell) */
  cells: number[];
  /** flat rows of five: cell index, year index, harmonized count, raw MODIS Terra+Aqua, raw Suomi NPP */
  cell_rows: number[];
  totals: { T: number; A: number; V: number; N20: number };
  source: { dataset: string; firms_updated: string; files: number; y2026?: string };
  /** v3: the last complete day, the months with data, and the partial last month (1-based m) */
  last_date?: string;
  n_months?: number;
  partial?: { y: number; m: number; i: number; day0: number; day1: number; days_in_month: number };
  sensor_last?: { T: string; A: string; V: string; N20: string };
  y2026?: Country2026;
}
export interface CountryIndexEntry {
  country: string;
  name: string;
  file: string;
  bytes: number;
  bbox: [number, number, number, number];
  total: number;
  /** v3: the 2001-2025 part of total, and 2026 to date */
  total_2001_2025?: number;
  total_2026?: number;
}

/* ---------- response.js: drive times from fire and EMS stations (OpenStreetMap roads) ---------- */
export interface ResponseScore {
  n: number;
  med_abs_pct: number;
  p90_abs_pct: number;
  bias_pct: number;
  mae_min: number;
}
/** a rule for estimating drive minutes between two points from their straight-line distance */
export interface ResponseCal {
  /** lower edges of the distance bands, km; the last band is open */
  bands_km: number[];
  /** effective straight-line speed per band, km/h */
  kmh: number[];
  kmh_raw: (number | null)[];
  kmh_p10_p90: ([number, number] | null)[];
  detour: (number | null)[];
  detour_p10_p90: ([number, number] | null)[];
  n_pairs: number[];
  n_route_km: number[];
  /** one speed for every distance: the baseline the bands were tested against */
  one_kmh: number;
  local_extra_min_p10_p50_p90: number[];
  /** no estimate is faster than the straight line at this speed */
  floor_kmh: number;
  n_source_hexes: number;
  test: Record<"one_speed" | "bands" | "bands_plus_local", ResponseScore> & {
    by_band: { band: number; one_speed: number; bands: number; bands_plus_local: number; n: number }[];
  };
}
export interface ResponseState {
  n: number;
  ns: number;
  /** top[3k + j]: station index of the j-th fastest station to hexagon k; -1 for none */
  top: number[];
  /** drive minutes x10 for the same slots; -1 for none */
  min10: number[];
  /** road km x10 for the same slots; -1 for none */
  km10: number[];
  /** straight-line km x10 from each hexagon centre to the nearest station */
  crow10: number[];
  crow_s: number[];
  /** metres from each hexagon centre to its road; over 10000 means no road and no times */
  snap_m: number[];
  s_snap_m: number[];
  /** local extra minutes x10 for the calibration; -9999 when no station can reach the hexagon */
  e10: number[];
  /** per 2 km hexagon: fastest station and its minutes x10; -1 for none */
  fine: { n: number; s: number[]; min10: number[] };
  cal: ResponseCal;
}
export interface ResponseData {
  v: number;
  built: string;
  method: string;
  source: string;
  credit: string;
  speeds_kmh: Record<string, number>;
  cap_kmh: number;
  access_kmh: number;
  snap_max_km: number;
  fields: Record<string, string>;
  osm: Record<StateCode, { file: string; md5: string; timestamp: string; graph: { vertices: number; edges: number } }>;
  NY: ResponseState;
  CA: ResponseState;
}
/** the fire response tool that is switched on in the state view */
export type Tool = "near" | "gap" | "plan";
/** what the reader has chosen in the fire response tools */
export interface ResponseUi {
  tool: Tool | null;
  /** a spot clicked with "Closest stations" on: lon, lat and the hexagon it falls in */
  pin: { lon: number; lat: number; k: number } | null;
  /** the chance of fire a place needs in the chosen month to be flagged as a gap */
  gapMin: number;
  /** number of extra crews, and the drive-time limit in minutes */
  planN: number;
  planT: number;
  /** a station picked from the staff-up list, shown with its first-due area; -1 for none */
  focusStn: number;
}

/* ---------- forecast.js: fire chance for 2026 and 2027 (scripts/build_forecast.py) ---------- */
/** one reliability bin: forecasts in [lo, hi), their average and how often fire happened */
export interface RelBin {
  bin: [number, number];
  n: number;
  mean_p: number | null;
  observed: number | null;
}
export interface FcMetrics {
  n: number;
  events: number;
  base_rate: number;
  mean_p: number;
  brier: number;
  logloss: number;
  auc: number | null;
  reliability?: RelBin[];
}
export interface FcBacktest {
  targets: [number, number];
  settings_chosen_on: string;
  model: FcMetrics;
  history_alone: FcMetrics;
  brier_skill_vs_history: number;
  auc_gain_vs_history: number;
  years_model_better_brier: string;
  per_year: {
    year: number;
    events: number;
    brier_model: number;
    brier_history: number;
    auc_model: number | null;
    auc_history: number | null;
  }[];
  horizon2: { model: FcMetrics; history_alone: FcMetrics; brier_skill_vs_history: number };
  final_settings_label: string;
  text: string;
}
/** month-major permille arrays: unit u in month t is at [t * n + u], t = (year - 2026) * 12 + month */
export interface FcLayer {
  p: number[];
  county: number[] | null;
}
/** the large-fire backtest, one horizon */
export interface LargeMetrics {
  brier: number;
  log_loss: number;
  auc: number;
  share_of_events_in_top_risk: { top_1pct: number; top_5pct: number; top_10pct: number };
  expected_vs_observed_by_year: Record<string, [number, number]>;
}
export interface LargeBacktest {
  test_years: [number, number];
  unit_months: number;
  events: number;
  model: LargeMetrics;
  history_alone: LargeMetrics;
  state_seasonal_average: LargeMetrics;
  brier_skill_vs_history_alone: number;
  brier_skill_vs_state_seasonal_average: number;
  reliability_model: { pred_range: [number, number]; n: number; mean_pred: number; observed: number }[];
  reliability_history_alone: { pred_range: [number, number]; n: number; mean_pred: number; observed: number }[];
}
export interface LargeLayer extends FcLayer {
  event: string;
  method: string;
  is_forecast: string;
  backtest: {
    design: string;
    hex: Record<"horizon_1y" | "horizon_2y", LargeBacktest>;
    county: Record<"horizon_1y" | "horizon_2y", LargeBacktest>;
  };
  /** large-fire history from the fire perimeter maps */
  past: { years: [number, number]; pairs: number[]; county_rows: number[] };
  definition: string;
  limits: string[];
  large_fires: number;
  hex_months: number;
  hexagons_ever_marked: number;
  firms_inside: { viirs: number; modis: number };
  source: string;
  source_url: string;
  source_page: string;
  credit: string;
  retrieved: string;
}
export interface Forecast {
  v: number;
  years: [number, number];
  event: string;
  method: string;
  backtest: Record<StateCode, { hex: FcBacktest; county: FcBacktest; county_below_its_likeliest_hex: string }>;
  NY: { n_hex: number; n_county: number; any: FcLayer; large: null };
  CA: { n_hex: number; n_county: number; any: FcLayer; large: LargeLayer | null };
}

/* ---------- outlook.js: the 14-day county outlook (scripts/build_outlook.py), computed live from Open-Meteo weather ---------- */
export interface OutlookScore {
  brier: number;
  logloss: number;
  auc: number;
  /** Brier skill against the usual odds: 0.019 = 1.9% better */
  bss: number;
  bss_by_year: Record<string, number>;
}
export interface OutlookState {
  /** same order as BURN_DATA.states[st].counties */
  fips: string[];
  names: string[];
  /** [lat, lon] weather point per county */
  pts: [number, number][];
  /** usual chance x 10000, flat: base[ci * 365 + day of year] */
  base: number[];
  /** [intercept, clim, rain14, dry14, et14, rain30, def30] */
  coef: number[];
  /** [intercept, clim]: the model's chance with no weather input */
  norm_coef: number[];
  climatology: { years: [number, number]; half_width_days: number; pseudo_samples: number };
  metrics: {
    backtest: Record<string, OutlookScore>;
    /** [mean chance given, share that happened, cases] */
    reliability: [number, number, number][];
    rows: number;
    events: number;
    years: number[];
    truth_check: { hotspots: number; data_js_viirs: number; abs_month_diff: number; static_cells: number };
  };
}
export interface OutlookExample {
  st: StateCode;
  ci: number;
  name: string;
  today: string;
  time0: string;
  precipitation_sum: (number | null)[];
  et0_fao_evapotranspiration: (number | null)[];
  expect: { doy: number; base: number; x: number[]; z: number; p: number; ratio: number; norm: number; wx_ratio: number };
}
export interface OutlookData {
  v: number;
  built: string;
  event: string;
  /** days ahead, starting today */
  horizon: number;
  /** past days of weather used */
  prior: number;
  /** a day with less rain than this (mm) is dry */
  dry_mm: number;
  api: { url: string; params: Record<string, string | number>; fallback_models: string };
  features: { id: string; label: string }[];
  method: string;
  states: Record<StateCode, OutlookState>;
  examples: OutlookExample[];
}
/** one county's outlook for the 14 days from today */
export interface CountyOutlook {
  /** chance of at least one hotspot, 0..1 */
  p: number;
  /** the usual chance for this county and these dates, 0..1 */
  base: number;
  /** p / base */
  ratio: number;
  /** the model's chance with no weather input */
  norm: number;
  /** p / norm: the weather's part of the change */
  wx_ratio: number;
  /** the county's local date the 14 days start on */
  today: string;
}
