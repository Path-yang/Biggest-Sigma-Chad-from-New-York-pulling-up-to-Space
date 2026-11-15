/* Open-ended questions: the model writes a short program, and it runs in a Dynamic Worker,
   a fresh sandbox with no network access whose only capability is the read-only FireApi below. */
import { WorkerEntrypoint } from "cloudflare:workers";
import { N, MI_FIRST, MI_LAST, LEVEL_NAME, loadRegion, loadChildren, measure, worldSeries, countryList, countryTotals, placesIn } from "./data.js";
import { resolvePlace, seriesOf, seriesOfMany } from "./tools.js";

const shared = new Map();          // places found by name during this isolate's life (for OpenStreetMap ids)
const r1 = x => Math.round(x * 10) / 10;

/** The only thing sandboxed code can reach: look up places and read their monthly fire record. */
export class FireApi extends WorkerEntrypoint {
  #T() {
    const env = this.env;
    return { env, ctx: (this.ctx.props && this.ctx.props.ctx) || {}, store: { get: async k => shared.get(k), put: async (k, v) => void shared.set(k, v) },
      measure: s => measure(env, s), world: () => worldSeries(env) };
  }
  async place(name) {
    const p = await resolvePlace(this.#T(), name);
    return { id: p.id, name: p.name, label: p.label, kind: p.level >= 0 && p.level <= 2 ? LEVEL_NAME[p.level] : "area" };
  }
  async subregions(id) {
    const kids = await loadChildren(this.env, String(id));
    return kids.map(k => ({ id: k.id, name: k.name }));
  }
  async placesIn(place, kind) {
    const p = await resolvePlace(this.#T(), place == null ? "view" : String(place));
    if (!p.b) throw new Error("That area has no known extent. Use \"view\" or a named place.");
    const level = /countr/i.test(kind) ? 0 : /state|provinc/i.test(kind) ? 1 : 2;
    return (await placesIn(this.env, p.b, level, 200)).map(d => ({ id: d.id, name: d.name, label: d.label }));
  }
  async countries(opts) {
    const year = opts && Number(opts.year), month = opts && opts.month ? Number(opts.month) : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2026) throw new Error("countries() needs a year between 2000 and 2026.");
    const layer = month ? `m/${(year - 2000) * 12 + month - 1}` : `y/${year}`;
    if (month && ((year - 2000) * 12 + month - 1 < MI_FIRST || (year - 2000) * 12 + month - 1 > MI_LAST)) throw new Error("That month is outside Nov 2000 to Oct 2026.");
    const [list, totals] = await Promise.all([countryList(this.env), countryTotals(this.env, layer)]);
    return list.map((c, i) => ({ id: c.id, name: c.name, hotspots: Math.round(totals[i]) })).sort((x, y) => y.hotspots - x.hotspots);
  }
  async monthly(ids) {
    const T = this.#T(), many = Array.isArray(ids), list = (many ? ids : [ids]).slice(0, 250).map(String);
    const places = await Promise.all(list.map(id => resolvePlace(T, id)));
    // Hosted places of the same level (countries, states or districts) are measured together in one pass over the
    // tiles they share. Levels are kept apart so a small state is not measured on a whole country's coarse cells.
    const series = new Array(places.length), groups = new Map();
    places.forEach((p, i) => { const key = p.pack ? "L" + p.level : "solo" + i; (groups.get(key) || groups.set(key, []).get(key)).push(i); });
    await Promise.all([...groups.values()].map(async idxs => {
      const got = idxs.length > 1 ? await seriesOfMany(T, idxs.map(i => places[i])) : [await seriesOf(T, places[idxs[0]])];
      idxs.forEach((i, j) => { series[i] = got[j]; });
    }));
    const out = series.map(s => Array.from(s, r1));
    return many ? out : out[0];
  }
}

const PRELUDE = `
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FIRST = 10, LAST = 321;                                  // Nov 2000 .. Oct 2026
const idx = (year, month) => (year - 2000) * 12 + (month - 1);
const at = (s, year, month) => { const i = idx(year, month); return i < FIRST || i > LAST ? null : s[i]; };
const yearTotal = (s, year) => { let t = 0; for (let m = 1; m <= 12; m++) t += at(s, year, m) || 0; return t; };
const median = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); if (!v.length) return 0; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
const usual = (s, month) => { const v = []; for (let y = 2000; y <= 2026; y++) { const x = at(s, y, month); if (x != null) v.push(x); } return median(v); };
const usualYear = s => { const v = []; for (let y = 2001; y <= 2025; y++) v.push(yearTotal(s, y)); return median(v); };
`;

/** Run model-written code in a fresh Dynamic Worker. Returns whatever the code returns (JSON). */
export async function runAnalysis(env, exportsOf, ctx, code) {
  const src = `import { WorkerEntrypoint } from "cloudflare:workers";
${PRELUDE}
export default class extends WorkerEntrypoint {
  async run() {
    const fire = this.env.FIRE;
    return await (async () => {
${code}
    })();
  }
}`;
  const worker = env.LOADER.load({
    compatibilityDate: "2025-09-01",
    mainModule: "main.js",
    modules: { "main.js": src },
    env: { FIRE: exportsOf.FireApi({ props: { ctx: { selection: ctx.selection || null, view: ctx.view || null } } }) },
    globalOutbound: null,                                       // no internet from inside the sandbox
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("The analysis took longer than 25 seconds.")), 25000));
  const out = await Promise.race([worker.getEntrypoint().run(), timeout]);
  return JSON.parse(JSON.stringify(out === undefined ? null : out));
}
export { N };
