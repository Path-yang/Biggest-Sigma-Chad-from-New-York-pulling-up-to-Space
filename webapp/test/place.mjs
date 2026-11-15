import { readFile } from "node:fs/promises";
import { searchPlaces, measure, worldSeries, loadChildren } from "../src/data.js";
import { resolvePlace, seriesOf, seriesOfMany } from "../src/tools.js";
const env = { ASSETS: { async fetch(req) { try { return new Response(await readFile("public" + new URL(req.url).pathname)); } catch { return new Response("", { status: 404 }); } } } };
const mem = new Map(), T = { env, ctx: {}, store: { get: async k => mem.get(k), put: async (k, v) => void mem.set(k, v) }, measure: s => measure(env, s), world: () => worldSeries(env) };
const y = (s, yr) => { let t = 0; for (let m = 0; m < 12; m++) t += s[(yr - 2000) * 12 + m]; return Math.round(t); };
for (const q of process.argv.slice(2)) {
  console.log(q, "->", (await searchPlaces(env, q)).slice(0, 3).map(h => `${h.label} [${h.id}] ${h.score.toFixed(0)}`));
  const p = await resolvePlace(T, q); const s = await seriesOf(T, p);
  console.log("   resolved", p.label, p.id, "2024 total", y(s, 2024));
}
const kids = await loadChildren(env, "IND"), ss = await seriesOfMany(T, kids);
console.log(kids.map((k, i) => `${k.name}:${y(ss[i], 2024)}`).join(" | "));
const ind = await seriesOf(T, await resolvePlace(T, "India")); console.log("India 2024", y(ind, 2024), "sum of states", kids.reduce((t, k, i) => t + y(ss[i], 2024), 0));
