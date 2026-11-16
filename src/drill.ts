import type { StateCode } from "./types";
import { D } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { setCounty } from "./map";

/* =====================================================================
   DRILL INTO A COUNTY: the copilot names a county in New York or California; once the state view is on screen,
   select that county there exactly as a click on it would (zoom, outline, side card).
   ===================================================================== */
const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^st\.? /, "saint ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** the index of a county of a state by its name ("Los Angeles", "Kings"), or -1 */
export function countyIndex(st: StateCode, name: string) {
  const f = fold(name.replace(/\s+County$/i, ""));
  return f ? D.states[st].counties.findIndex(c => fold(c.name) === f) : -1;
}
let job = 0;
/** select the county once the state view of `st` is open at address `hash`. Returns the county's name as the state
    view writes it ("St. Lawrence"), or "" when the state has no such county. Gives up if the reader goes elsewhere
    first, or after 15 seconds. */
export function stateCounty(st: StateCode, name: string, hash: string) {
  const ci = countyIndex(st, name);
  if (ci < 0) return "";
  const mine = ++job,
    until = Date.now() + 15000;
  const tick = () => {
    if (mine !== job || location.hash !== hash || Date.now() > until) return;
    if (S.st === st && !$("app").hidden && $("app").classList.contains("in")) {
      /* after the view's own opening zoom has started, so this one replaces it */
      setTimeout(() => {
        if (mine === job && location.hash === hash && S.st === st) setCounty(ci);
      }, 250);
      return;
    }
    setTimeout(tick, 150);
  };
  tick();
  return D.states[st].counties[ci].name;
}
