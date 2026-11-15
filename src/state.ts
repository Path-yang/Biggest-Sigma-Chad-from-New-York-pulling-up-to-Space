import type { AppState, ResponseUi } from "./types";
import { Y0, Y1 } from "./data";

/** everything the reader has chosen; render() redraws the page from it */
export const S: AppState = {
  st: null,
  sel: { type: "state" },
  yFrom: Y0,
  yTo: Y1,
  focus: [2024, 10],
  mode: "count",
  pal: "fire",
  stn: true,
  show: { t: "all" },
  draw: false,
  sheet: null,
  layer: "count",
  rm: new Date().getMonth(),
  odds: "past",
  fire: "any",
};

/** the fire response tools: which one is on and its settings */
export const RT: ResponseUi = { tool: null, pin: null, gapMin: 0.25, planN: 5, planT: 15, focusStn: -1 };
