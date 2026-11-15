// Runs the copilot's tools against the real data files on disk, with no network and no model.
import { readFile } from "node:fs/promises";
import { TOOLS } from "../src/tools.js";
import { measure, worldSeries, searchPlaces } from "../src/data.js";

const env = {
  ASSETS: { async fetch(req) { const p = new URL(req.url).pathname; try { return new Response(await readFile("public" + p)); } catch { return new Response("", { status: 404 }); } } },
  GEOCODER_URL: "https://nominatim.openstreetmap.org/search", GEOCODER_USER_AGENT: "BurnCalendar/0.1 (test)",
};
const mem = new Map();
function harness(ctx = {}) {
  const cards = [], actions = [];
  return { cards, actions, T: { env, ctx, store: { get: async k => mem.get(k), put: async (k, v) => void mem.set(k, v) }, measure: s => measure(env, s), world: () => worldSeries(env),
    population: async () => { try { return JSON.parse(await readFile("public/data/b/pop_usa.json", "utf8")); } catch { return null; } }, card: c => cards.push(c), action: a => actions.push(a) } };
}
async function run(name, args, ctx) {
  const h = harness(ctx), t0 = Date.now();
  let result;
  try { result = await TOOLS.find(t => t.name === name).run(args, h.T); } catch (e) { result = { error: e.message }; }
  const c = h.cards[0], a = h.actions[0];
  console.log(`\n== ${name} ${JSON.stringify(args)}  (${Date.now() - t0} ms)`);
  console.log(JSON.stringify(result).slice(0, 700));
  if (c) console.log("  card:", c.kind, "|", c.eyebrow, "|", c.title, "|", c.badge?.text || "", "|", c.big ? c.big.value + " " + c.big.caption : "", "| rows", (c.rows || []).map(r => r.k + ": " + r.v).join("; ").slice(0, 300));
  if (c?.rank) console.log("  rank:", c.rank.items.slice(0, 4).map(i => `${i.name} ${i.chip.text} ${i.value} [${(i.spark || []).join(",")}]`).join(" | "));
  if (a) console.log("  action:", a.type, a.toast, a.place ? `series ${a.place.series?.length} pack ${a.place.pack}` : "", a.items ? `${a.items.length} highlighted` : "");
  return result;
}
console.log((await searchPlaces(env, "Los Angeles County, California")).slice(0, 2).map(h => h.label + " " + h.score.toFixed(0)));
console.log((await searchPlaces(env, "Punjab")).slice(0, 3).map(h => h.label + " " + h.score.toFixed(0)));
await run("area_report", { place: "Los Angeles County, California", year: 2025, month: 12 });
await run("area_report", { place: "Los Angeles County, California", year: 2025, month: 1 });
await run("area_report", { place: "Punjab, India", year: 2024, month: 11 });
await run("area_history", { place: "Colorado" });
await run("area_report", { place: "Colorado", year: 2025 });
await run("compare", { places: ["Jalandhar", "West Bengal"] });
await run("compare", { place: "California", years: [2018, 2019] });
await run("outlook", { place: "California", month: 7, year: 2027 });
await run("outlook", { place: "India", month: 11, year: 2027 });
await run("area_report", { place: "selection" });
await run("area_report", { place: "view", year: 2024, month: 8 }, { view: { bbox: [-124, 36, -118, 42] } });
await run("area_report", { place: "Delhi", year: 2027, month: 3 });
await run("population_exposure", { place: "California", month: 8 });
