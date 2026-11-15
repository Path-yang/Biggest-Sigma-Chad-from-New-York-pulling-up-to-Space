import type { BurnData, Preset, StateCode } from "./types";

export const D: BurnData = window.BURN_DATA;
export const Y0 = D.meta.y0,
  Y1 = D.meta.y1,
  NYR = Y1 - Y0 + 1,
  NM = NYR * 12;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const STS: StateCode[] = ["NY", "CA"],
  NAME: Record<StateCode, string> = { NY: "New York", CA: "California" },
  SLUG: Record<StateCode, string> = { NY: "new-york", CA: "california" };
export const LAND_KM2: Record<StateCode, number> = { NY: 122057, CA: 403466 },
  STC: Record<StateCode, string> = { NY: "#6fa8ff", CA: "#ff8a3d" };
/* ---------- how far the record runs: the last year is partial (2026 to 14 November) ---------- */
/** the last month index with data; months after it have no data, which is not the same as no fire */
export const LAST_I = D.meta.last_i ?? NM - 1;
/** months with data, from January of Y0 */
export const NMD = LAST_I + 1;
/** the partial last month, with 0-based month m and the last day it covers; null when the last month is complete */
export const PART = D.meta.partial
  ? { i: D.meta.partial.i, y: D.meta.partial.y, m: D.meta.partial.m - 1, day: D.meta.partial.day_to, days: D.meta.partial.days_in_month }
  : null;
/** the last complete month and the last complete year */
export const FULL_I = PART ? PART.i - 1 : LAST_I;
export const FULL_Y1 = Y0 + Math.floor((FULL_I + 1) / 12) - 1;
/** the last day with data, "2026-11-14", and the same as words: "14 Nov 2026" */
export const LAST_DATE = D.meta.last_date ?? `${Y1}-12-31`;
const lastDay = LAST_DATE.split("-").map(Number);
export const LAST_WORDS = `${lastDay[2]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][lastDay[1] - 1]} ${lastDay[0]}`;
/** the month the "was it unusual?" test starts on: the latest complete month */
export const FOCUS0 = [Y0 + Math.floor(FULL_I / 12), FULL_I % 12];
/** "2001–2025", or "2001–14 Nov 2026" when the last year is partial */
export const span = (a: number, b: number) =>
  b > FULL_Y1 ? (a === b ? `${b} to ${LAST_WORDS.replace(/ \d+$/, "")}` : `${a}–${LAST_WORDS}`) : a === b ? String(a) : `${a}–${b}`;
/** true when year y is only partly in the record */
export const isPartYear = (y: number) => y > FULL_Y1;
/** the explicit rule for the two VIIRS satellites, written on both kinds of page */
export const SAT_RULE =
  "Suomi NPP only from 2012; NOAA-20 is not added (that would count the same fires twice). It stands in, converted to Suomi NPP terms, only on days Suomi NPP missed: every day from 2 November 2026, when Suomi NPP stopped, its outage days in March to October 2026 and in 2018–2025, and 2026 days on which its partial data missed this place's overpasses. On 12 October 2026 both satellites missed many places; there the day is the mean of the days either side.";
/** the source of a VIIRS month with days from NOAA-20 */
export const FILL_SRC = "VIIRS Suomi NPP + NOAA-20 on days Suomi NPP missed, converted";
/** "10–12 Mar", "9, 11 Mar" */
const dayRun = (days: number[], m: number) =>
  (days.length > 1 && days[days.length - 1] - days[0] === days.length - 1 ? `${days[0]}–${days[days.length - 1]}` : days.join(", ")) +
  ` ${MON[m]}`;
/** the days of month i in state st that come from NOAA-20 (2026, and past Suomi NPP outages filled the same way), and
 * the days estimated from the days either side because both satellites missed the state (2026) */
export function fillDays(i: number, st: StateCode): { n20: number[]; interp: number[] } {
  const s = D.states[st],
    y = Y0 + Math.floor(i / 12),
    pre = `${y}-${String((i % 12) + 1).padStart(2, "0")}-`,
    pick = (a: string[] | undefined) => (a ?? []).filter(d => d.startsWith(pre)).map(d => +d.slice(8));
  if (y >= 2026)
    return { n20: pick(s.y2026?.n20_dates ?? D.meta.viirs_2026?.n20_dates), interp: pick(s.y2026?.interp_dates) };
  const g = s.hist_gaps?.find(x => x.i === i);
  return { n20: g ? g.days : [], interp: [] };
}
/** "3 days (10–12 Mar)" of month i that came from NOAA-20 in state st, or "" */
export function n20Days(i: number, st: StateCode) {
  const d = fillDays(i, st).n20;
  return d.length ? `${d.length} ${d.length === 1 ? "day" : "days"} (${dayRun(d, i % 12)})` : "";
}
/** where a VIIRS month's count comes from when it is not all Suomi NPP: a phrase, or "" */
export function fillNote(i: number, st: StateCode) {
  const f = fillDays(i, st),
    a = n20Days(i, st),
    past = Y0 + Math.floor(i / 12) < 2026;
  return [
    a && `${a} from NOAA-20 converted to Suomi NPP terms${past ? " (Suomi NPP outage)" : ""}`,
    f.interp.length ? `${dayRun(f.interp, i % 12)} estimated from the days either side (both satellites missed this area)` : "",
  ]
    .filter(Boolean)
    .join("; ");
}
export const VI0 = (D.meta.viirs_from[0] - Y0) * 12 + D.meta.viirs_from[1] - 1;
export const AQ0 = (D.meta.aqua_from[0] - Y0) * 12 + D.meta.aqua_from[1] - 1;
export const PRESET: Record<StateCode, Preset> = {
  NY: { name: "Try the Jennings Creek fire area, November 2024", lat: 41.2, lon: -74.35, rad: 20, focus: [2024, 10] },
  CA: { name: "Try Paradise and the Camp Fire, November 2018", lat: 39.76, lon: -121.62, rad: 25, focus: [2018, 10] },
};
/** names written on the land and water around each state: [name, lat, lon] */
export const NBR: Record<StateCode, [string, number, number][]> = {
  NY: [
    ["Pennsylvania", 41.45, -77.3],
    ["Vermont", 44.0, -72.75],
    ["Massachusetts", 42.35, -72.55],
    ["Connecticut", 41.55, -72.75],
    ["New Jersey", 40.85, -74.85],
    ["Ontario", 44.8, -76.7],
    ["Quebec", 45.5, -73.9],
    ["Lake Ontario", 43.62, -77.6],
    ["Atlantic Ocean", 40.5, -72.0],
  ],
  CA: [
    ["Oregon", 42.45, -118.3],
    ["Nevada", 39.3, -117.3],
    ["Arizona", 34.3, -113.5],
    ["Mexico", 32.3, -115.6],
    ["Pacific Ocean", 35.4, -124.3],
  ],
};
