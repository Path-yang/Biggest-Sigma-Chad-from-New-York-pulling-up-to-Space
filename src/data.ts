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
