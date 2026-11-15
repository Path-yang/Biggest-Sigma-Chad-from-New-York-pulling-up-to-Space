/* =====================================================================
   THE DAILY SNAPSHOT: fetches Open-Meteo's forecast for every region in world_outlook.js once, works out each
   region's outlook with the page's own code (src/wol.ts), and writes world_outlook_today.json. The globe colours
   countries from it, and country pages read it before fetching anything themselves.

   Run by .github/workflows/world-outlook-today.yml twice a day, or by hand: npm run outlook-today
   About 2,100 Open-Meteo calls in 9 requests of up to 250 points, spaced so they stay under the free limit of
   600 calls a minute. If any request still fails, nothing is written and the old file stays.

   Options: --only <FIRMS country key>  fetch just that country's regions (for testing; the file then covers
            only that country)   --out <path>
   ===================================================================== */
import { readFileSync, writeFileSync } from "node:fs";
import {
  type RegionOutlook,
  type Snapshot,
  type WorldOutlook,
  addDays,
  countryRegions,
  modelId,
  regionOutlook,
  snapCountry,
} from "../src/wol";

const UA = "burn-calendar-outlook/1.0";
const GAP_MS = 32000;
const TIMEOUT_MS = 120000;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise(ok => setTimeout(ok, ms));

function loadModel(): WorldOutlook {
  const t = readFileSync("world_outlook.js", "utf8");
  const a = t.indexOf("{"),
    b = t.lastIndexOf("}");
  return JSON.parse(t.slice(a, b + 1)) as WorldOutlook;
}

interface Daily {
  time?: unknown[];
  temperature_2m_max?: unknown[];
  dew_point_2m_mean?: unknown[];
  precipitation_sum?: unknown[];
}
const nums = (a: unknown): (number | null)[] | null =>
  Array.isArray(a) ? a.map(v => (typeof v === "number" && Number.isFinite(v) ? v : null)) : null;

async function fetchBatch(O: WorldOutlook, ris: number[]): Promise<Daily[]> {
  const q = new URLSearchParams({
    latitude: ris.map(r => O.regions.lat[r].toFixed(2)).join(","),
    longitude: ris.map(r => O.regions.lon[r].toFixed(2)).join(","),
  });
  for (const [k, v] of Object.entries(O.api.params)) q.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    const ac = new AbortController(),
      t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${O.api.url}?${q}`, { headers: { "User-Agent": UA }, signal: ac.signal });
      if (r.ok) {
        const j: unknown = await r.json();
        const list = (Array.isArray(j) ? j : [j]) as { daily?: Daily }[];
        if (list.length !== ris.length) throw new Error(`asked for ${ris.length} points, got ${list.length}`);
        return list.map(o => (o && o.daily) || {});
      }
      throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      if (attempt >= 4) throw e;
      const wait = 65000 * attempt;
      console.warn(`  batch of ${ris.length} failed (${e instanceof Error ? e.message : e}); trying again in ${wait / 1000} s`);
      await sleep(wait);
    } finally {
      clearTimeout(t);
    }
  }
}

function work(O: WorldOutlook, ri: number, d: Daily): RegionOutlook | null {
  const tmax = nums(d.temperature_2m_max),
    tdew = nums(d.dew_point_2m_mean),
    prec = nums(d.precipitation_sum),
    today = Array.isArray(d.time) ? d.time[O.prior] : null;
  if (!tmax || !tdew || !prec || typeof today !== "string") return null;
  return regionOutlook(O, ri, today, tmax, tdew, prec);
}

async function main() {
  const O = loadModel(),
    only = arg("--only"),
    out = arg("--out") || "world_outlook_today.json",
    keys = only ? [only] : Object.keys(O.countries).concat(Object.keys(O.no_region));
  if (only && !O.countries[only]) throw new Error(`no regions for ${only}`);
  const want = only ? countryRegions(O, only).used.map(r => r.ri) : O.regions.lat.map((_, i) => i);
  const size = O.api.max_points_per_get,
    rows = new Map<number, RegionOutlook | null>();
  for (let i = 0; i < want.length; i += size) {
    if (i) await sleep(GAP_MS);
    const ris = want.slice(i, i + size),
      got = await fetchBatch(O, ris);
    ris.forEach((ri, j) => rows.set(ri, work(O, ri, got[j])));
    console.log(`  regions ${i + 1}-${i + ris.length} of ${want.length}`);
  }
  const tally = new Map<string, number>();
  rows.forEach(r => r && tally.set(r.today, (tally.get(r.today) || 0) + 1));
  if (!tally.size) throw new Error("no usable forecast came back");
  const today = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0],
    dayNo = (iso: string) => Date.parse(iso + "T00:00:00Z") / 86400000,
    variants = O.metrics.variants,
    pick = (re: RegExp) => Object.entries(variants).find(([k]) => re.test(k))?.[1].bss ?? NaN;
  const S: Snapshot = {
    v: 1,
    model: modelId(O),
    at: new Date().toISOString(),
    today,
    end: addDays(today, O.horizon - 1),
    r: O.regions.lat.map((_, ri) => {
      const r = rows.get(ri);
      return r ? [Math.round(r.p * 1e4) / 1e4, Math.round(r.zMax * 100) / 100, dayNo(r.today) - dayNo(today)] : null;
    }),
    c: Object.fromEntries(keys.map(k => [k, snapCountry(O, k, ri => rows.get(ri) || null)])),
    skill: { observed: pick(/^trained for the full source gap, tested on observed/), live: pick(/^trained for the full source gap, tested with it/) },
  };
  const missing = want.filter(ri => !rows.get(ri)).length;
  writeFileSync(out, JSON.stringify(S) + "\n");
  const n = (s: number) => Object.values(S.c).filter(c => c[0] === s).length;
  console.log(
    `wrote ${out}: ${want.length - missing} of ${want.length} regions, first day ${today}; ` +
      `countries with an outlook ${n(0)}, no skill ${n(1)}, too little history ${n(2)}, too much missing or far outside the usual range ${n(3)}`,
  );
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
