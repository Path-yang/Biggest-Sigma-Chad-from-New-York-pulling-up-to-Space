import type { StateCode } from "./types";
import { D } from "./data";

/* =====================================================================
   POPULATION: the US Census Bureau's estimate of the people living in each
   county (pop.js, built by scripts/build_population.py). It counts everyone
   in the county, not the people near any fire. pop.js loads with the other
   state extras; until it arrives, or if it fails, nothing here shows.
   ===================================================================== */
export type Population = {
  v: number;
  vintage: number;
  /** the estimate's reference date, "2025-07-01" */
  date: string;
  /** that date in words, "July 2025" */
  label: string;
  source: string;
  url: string;
  sha256: string;
  states: Record<StateCode, { fips: string; name: string; total: number; counties: Record<string, number> }>;
};

const P = () => window.POPULATION?.states ?? null;
/** "Census estimate, July 2025", or with `short` "Census, July 2025" */
export const popWhen = (short = false) => (window.POPULATION ? `Census${short ? "" : " estimate"}, ${window.POPULATION.label}` : "");
/** people living in a county (index into data.js counties), or null when unknown */
export function popCounty(st: StateCode, ci: number): number | null {
  const fips = D.states[st].counties[ci]?.fips;
  return fips ? (P()?.[st]?.counties[fips] ?? null) : null;
}
/** people living in the state, or null when unknown */
export const popState = (st: StateCode): number | null => P()?.[st]?.total ?? null;
/** a population to three significant figures, or in full under 10,000: "9.69 million", "947,000", "5,006" */
export function fmtPop(n: number) {
  if (n < 1e4) return n.toLocaleString("en-US");
  const r = Number(n.toPrecision(3));
  return r >= 1e6 ? Number((r / 1e6).toPrecision(3)) + " million" : r.toLocaleString("en-US");
}
/** a population as a phrase: "9.69 million people" */
export const peoplePop = (n: number) => fmtPop(n) + (n === 1 ? " person" : " people");
/** " · 9.69 million residents" for a county's row in a list; "" before pop.js arrives */
export function popSuffix(st: StateCode, ci: number) {
  const p = popCounty(st, ci);
  return p == null ? "" : ` · ${fmtPop(p)} ${p === 1 ? "resident" : "residents"}`;
}
/** the full figure for a tooltip: "9,694,934 people (US Census Bureau estimate for 1 July 2025)" */
export const exactPop = (n: number) =>
  `${n.toLocaleString("en-US")} people (US Census Bureau estimate for 1 ${window.POPULATION?.label ?? ""})`;

/** the distinct counties among `cis` and the people living in them; null when pop.js is not here */
export function popOf(st: StateCode, cis: Iterable<number>): { counties: number[]; people: number } | null {
  if (!P()) return null;
  const seen = [...new Set(cis)].filter(ci => ci >= 0);
  let people = 0;
  for (const ci of seen) {
    const p = popCounty(st, ci);
    if (p == null) return null;
    people += p;
  }
  return { counties: seen, people };
}
/** county names in a list: "Los Angeles, Riverside and Kern" (past `max` + 1 names, the first `max`, then "and 3 more") */
export function countyNames(st: StateCode, cis: number[], max = 4) {
  const names = cis.map(ci => D.states[st].counties[ci].name);
  if (names.length > max + 1) return names.slice(0, max).join(", ") + ` and ${names.length - max} more`;
  return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : (names[0] ?? "");
}
/** two sentences: "These 8 stations stand in 4 counties (Los Angeles, …), which are home to 13.1 million people in all
 *  (Census estimate, July 2025). That counts everyone living in those counties, not the people these stations serve."
 *  `notWho` says whom the count is not ("not the people these stations serve"). Empty when pop.js is not here. */
export function popSentence(
  st: StateCode,
  cis: Iterable<number>,
  lead: (nCounties: number, names: string) => string,
  notWho = "not only the people near fire",
) {
  const p = popOf(st, cis);
  if (!p || !p.counties.length) return "";
  const n = p.counties.length;
  return (
    `${lead(n, countyNames(st, p.counties))} ${n === 1 ? "is" : "are"} home to ${peoplePop(p.people)}${n === 1 ? "" : " in all"} (${popWhen()}). ` +
    `That counts everyone living in ${n === 1 ? "the county" : "those counties"}, ${notWho}.`
  );
}
