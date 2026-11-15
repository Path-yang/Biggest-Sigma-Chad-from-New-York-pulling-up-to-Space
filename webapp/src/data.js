/* Data layer for the copilot: place lookup and run-time fire measurement.
   Everything is read from the site's own static files (env.ASSETS) when a question is asked. */

const ORIGIN = "https://assets.local/data/";
const cache = new Map();          // path -> Promise, least recently used first
const CACHE_MAX = 260;

function remember(key, make) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const v = make().catch(err => { cache.delete(key); throw err; });
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return v;
}
async function fetchAsset(env, path) {
  const res = await env.ASSETS.fetch(new Request(ORIGIN + path));
  if (!res.ok) return null;
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}
const assetJson = (env, path) => remember(path, async () => { const b = await fetchAsset(env, path); return b ? JSON.parse(new TextDecoder().decode(b)) : null; });
const assetBin = (env, path) => remember(path, async () => { const b = await fetchAsset(env, path); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null; });

/* ------------------------------------------------------------------ places */
export const LEVEL_NAME = ["country", "state or province", "district or county", "place"];
const GENERIC = new Set(["county", "district", "province", "state", "region", "parish", "oblast", "prefecture", "municipality",
  "department", "governorate", "territory", "division", "of", "the", "city", "borough"]);
const ALIAS = { usa: "united states", us: "united states", america: "united states", "united states of america": "united states",
  uk: "united kingdom", britain: "united kingdom", "great britain": "united kingdom", uae: "united arab emirates",
  drc: "congo dem rep of the", "dr congo": "congo dem rep of the", "democratic republic of the congo": "congo dem rep of the",
  "republic of the congo": "congo rep of the", "south korea": "korea south", "north korea": "korea north",
  "russian federation": "russia", la: "los angeles", nyc: "new york", "ivory coast": "cote d ivoire", burma: "myanmar" };

export function norm(s) {
  const t = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return ALIAS[t] || t;
}
function core(s) {
  const words = norm(s).split(" "), kept = words.filter(w => !GENERIC.has(w));
  const out = (kept.length ? kept : words).join(" ");
  return ALIAS[out] || out;
}

/** The searchable list of every country, state and district. */
function placeIndex(env) {
  return remember("#placeIndex", async () => {
    const rows = await assetJson(env, "b/index.json");
    if (!rows) throw new Error("Place index is missing");
    const byId = new Map(), names = new Array(rows.length);
    rows.forEach((r, i) => { byId.set(r[0], i); names[i] = core(r[1]); });
    return { rows, byId, names };
  });
}
const parentId = id => id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null;
function describe(ix, i) {
  const [id, name, level, w, s, e, n] = ix.rows[i], chain = [];
  for (let p = parentId(id); p; p = parentId(p)) { const j = ix.byId.get(p); if (j != null) chain.push(ix.rows[j][1]); }
  return { id, name, level, b: [w, s, e, n], within: chain, label: [name, ...chain].join(", ") };
}

/** Rank places by how well they match a name. `within` narrows by state or country; `level` is 0, 1 or 2. */
export async function searchPlaces(env, query, { within, level } = {}) {
  const ix = await placeIndex(env);
  const parts = String(query || "").split(",").map(s => s.trim()).filter(Boolean);
  const q = core(parts[0] || ""), ctx = parts.slice(1).concat(within ? String(within).split(",") : []).map(core).filter(Boolean);
  if (!q) return [];
  const wantsLevel = /\b(county|district|parish)\b/i.test(parts[0] || "") ? 2 : /\b(state|province|oblast|prefecture)\b/i.test(parts[0] || "") ? 1 : level;
  const qt = q.split(" "), hits = [];
  for (let i = 0; i < ix.names.length; i++) {
    const nm = ix.names[i];
    let score = nm === q ? 100 : (nm.startsWith(q + " ") || q.startsWith(nm + " ")) ? 62 : 0;
    if (!score && qt.length > 1 && qt.every(t => nm.includes(t))) score = 55;
    if (!score) continue;
    const d = describe(ix, i), chain = d.within.map(core).concat(d.id.slice(0, 3).toLowerCase());
    for (const c of ctx) score += chain.some(x => x === c || x.includes(c) || c.includes(x)) ? 30 : -45;
    if (wantsLevel != null) score += d.level === wantsLevel ? 18 : -8;
    const area = Math.max(1e-4, (d.b[2] - d.b[0]) * (d.b[3] - d.b[1]));
    score += (2 - d.level) * 4 + Math.min(6, Math.log10(area) + 3);
    hits.push({ ...d, score });
  }
  if (!hits.length && q.length >= 4) {                           // nothing matched: allow one or two typos
    const max = q.length < 7 ? 1 : 2;
    for (let i = 0; i < ix.names.length; i++) {
      const nm = ix.names[i];
      if (Math.abs(nm.length - q.length) > max || nm[0] !== q[0]) continue;
      const dist = editDistance(q, nm, max);
      if (dist > max) continue;
      const d = describe(ix, i), chain = d.within.map(core).concat(d.id.slice(0, 3).toLowerCase());
      let score = 62 - 5 * dist + (2 - d.level) * 6;
      for (const c of ctx) score += chain.some(x => x === c || x.includes(c) || c.includes(x)) ? 30 : -45;
      hits.push({ ...d, score, spelling: true });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 6);
}

/** Edit distance, giving up once it exceeds max. */
function editDistance(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

async function pack(env, id) { return assetJson(env, `b/p/${id}.json`); }

/** A hosted region with its outline. */
export async function loadRegion(env, id) {
  const ix = await placeIndex(env), i = ix.byId.get(id);
  if (i == null) return null;
  const d = describe(ix, i), p = await pack(env, d.level === 0 ? id : parentId(id));
  const node = !p ? null : d.level === 0 ? p : (p.children || []).find(c => c.id === id);
  if (!node) return null;
  return { ...d, g: node.g, pack: `b/p/${d.level === 0 ? id : parentId(id)}.json` };
}
/** The states of a country, or the districts of a state. */
export async function loadChildren(env, id) {
  const ix = await placeIndex(env), i = ix.byId.get(id);
  if (i == null || ix.rows[i][2] > 1) return [];
  const p = await pack(env, id);
  return ((p && p.children) || []).map(c => ({ id: c.id, name: c.name, level: ix.rows[i][2] + 1, b: c.b, g: c.g, pack: `b/p/${id}.json` }));
}

/** Any other named place (city, park, valley), from OpenStreetMap. */
export async function geocode(env, query) {
  const url = `${env.GEOCODER_URL}?q=${encodeURIComponent(query)}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.005&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": env.GEOCODER_USER_AGENT, "Accept-Language": "en" } });
  if (!res.ok) return null;
  const hit = (await res.json())[0];
  if (!hit) return null;
  const [s, n, w, e] = hit.boundingbox.map(Number);
  let g = hit.geojson;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) g = { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
  const name = hit.name || String(hit.display_name).split(",")[0];
  return { id: `osm:${hit.osm_type[0]}${hit.osm_id}`, name, level: 3, b: [w, s, e, n], within: [], label: String(hit.display_name).split(",").slice(0, 3).join(",").trim(), g, osm: true };
}

/* ------------------------------------------------------------ geometry */
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Flatten an outline into polygons, each with its own bounding box, for fast point tests. */
export function prepare(g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates, out = [];
  for (const rings of polys) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const [x, y] of rings[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    out.push({ rings, w, s, e, n });
  }
  return out;
}
function inShape(polys, x, y) {
  for (const p of polys) {
    if (x < p.w || x > p.e || y < p.s || y > p.n) continue;
    let inside = false;
    for (const ring of p.rings) if (inRing(ring, x, y)) inside = !inside;
    if (inside) return true;
  }
  return false;
}
export const bboxPolygon = ([w, s, e, n]) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

/* ------------------------------------------------------- fire measurement */
export const N = 323, MI_FIRST = 10, MI_LAST = 321;      // Nov 2000 .. Oct 2026 (Nov 2026 is partial)
const FINE_BUDGET = 120;                                  // files; beyond this the 28 km tiles are used
const getMeta = env => assetJson(env, "meta.json");
const getFine = env => remember("#fine", async () => {
  const ix = await assetJson(env, "fine2.json"), f1 = {};
  for (const y in ix.f1) f1[y] = new Set(ix.f1[y]);
  return f1;
});
export async function worldSeries(env) { return Float64Array.from((await getMeta(env)).world.h); }

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/**
 * Count harmonized hotspots per month inside each outline.
 * shapes: [{ g, b }]. Returns { series: Float64Array[], cellKm } with one series per shape.
 * Small areas are measured on 5.5 km cells, large ones on 28 km cells.
 */
export async function measure(env, shapes) {
  const meta = await getMeta(env), f1 = await getFine(env);
  const prepared = shapes.map(sh => prepare(sh.g)), out = shapes.map(() => new Float64Array(N));
  const tileSet = new Set(), tiles = [];
  for (const polys of prepared) for (const p of polys) {
    const tx0 = Math.max(0, Math.floor((p.w + 180) / 10)), tx1 = Math.min(35, Math.floor((p.e + 180 - 1e-9) / 10));
    const ty0 = Math.max(0, Math.floor((p.s + 90) / 10)), ty1 = Math.min(17, Math.floor((p.n + 90 - 1e-9) / 10));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${tx}_${ty}`;
      if (!tileSet.has(key) && meta.tiles.includes(key)) { tileSet.add(key); tiles.push({ key, tx, ty }); }
    }
  }
  const jobs = [];
  for (const t of tiles) for (const y in f1) if (f1[y].has(t.key)) jobs.push({ t, y: +y });
  const fine = jobs.length <= FINE_BUDGET;
  const per = fine ? 200 : 40, deg = fine ? 0.05 : 0.25;

  // which outlines contain each cell of a tile (outlines may overlap, e.g. a country and one of its states),
  // worked out the first time a cell is seen
  const NONE = [];
  const owners = new Map();
  const ownersOf = (t, cell) => {
    let arr = owners.get(t.key);
    if (!arr) { arr = new Array(per * per); owners.set(t.key, arr); }
    let who = arr[cell];
    if (who === undefined) {
      const lc = cell % per, lr = (cell - lc) / per;
      const x = -180 + t.tx * 10 + (lc + 0.5) * deg, y = -90 + t.ty * 10 + (lr + 0.5) * deg;
      who = NONE;
      for (let i = 0; i < prepared.length; i++) if (inShape(prepared[i], x, y)) who = who === NONE ? [i] : [...who, i];
      arr[cell] = who;
    }
    return who;
  };

  if (fine) {
    await pool(jobs, 16, async ({ t, y }) => {
      const buf = await assetBin(env, `f1/${y}/${t.key}.bin.gz`);
      if (!buf) return;
      const n = new DataView(buf).getUint32(4, true);
      const cell = new Uint16Array(buf, 8, n), val = new Uint16Array(buf, 8 + 2 * n, n), mon = new Uint8Array(buf, 8 + 4 * n, n);
      const base = (y - 2000) * 12;
      for (let i = 0; i < n; i++) { const who = ownersOf(t, cell[i]); for (let j = 0; j < who.length; j++) out[who[j]][base + mon[i]] += val[i]; }
    });
  } else {
    await pool(tiles, 12, async t => {
      const buf = await assetBin(env, `t/${t.key}.bin.gz`);
      if (!buf) return;
      const n = new DataView(buf).getUint32(4, true);
      let o = 8;
      const cell = new Uint16Array(buf, o, n); o += 2 * n;
      const mi = new Uint16Array(buf, o, n); o += 2 * n;
      const m = new Uint32Array(buf, o, n); o += 8 * n;
      const s = new Uint32Array(buf, o, n);
      let last = -1, who = NONE, k = 1, a = 1;
      for (let i = 0; i < n; i++) {
        const c = cell[i];
        if (c !== last) {
          last = c; who = ownersOf(t, c);
          if (who.length) {
            const lc = c % per, lr = (c - lc) / per;
            const f = meta.regions[`${Math.floor((t.tx * 40 + lc) / 20)}_${Math.floor((t.ty * 40 + lr) / 20)}`] || [meta.kWorld, meta.aWorld];
            k = f[0]; a = f[1];
          }
        }
        if (!who.length) continue;
        const x = mi[i], h = x <= meta.miSplit ? m[i] * k * (x < meta.miAqua ? a : 1) : s[i];
        for (let j = 0; j < who.length; j++) out[who[j]][x] += h;
      }
    });
  }
  return { series: out, cellKm: fine ? 5.5 : 28 };
}

/* ------------------------------------------------- worldwide, by country */
/** Every country with a thinned outline, plus a lazily filled map from 28 km cell to country. */
function countries(env) {
  return remember("#countries", async () => {
    const p = await assetJson(env, "b/countries.json");
    const list = p.children.map(c => ({ id: c.id, name: c.name, b: c.b, polys: prepare(c.g) }));
    return { list, owner: new Int16Array(1440 * 720).fill(-2) };
  });
}
export async function countryList(env) { return (await countries(env)).list.map(c => ({ id: c.id, name: c.name, level: 0, b: c.b, pack: "b/countries.json" })); }
/** Harmonized hotspots per country for one map layer: "m/<month index>" or "y/<year>". Same order as countryList. */
export async function countryTotals(env, layer) {
  const { list, owner } = await countries(env), out = new Float64Array(list.length);
  const buf = await assetBin(env, `g/${layer}.bin.gz`);
  if (!buf) return out;
  const n = new DataView(buf).getUint32(4, true), idx = new Uint32Array(buf, 8, n), h = new Float32Array(buf, 8 + 4 * n, n);
  for (let i = 0; i < n; i++) {
    const cell = idx[i];
    let who = owner[cell];
    if (who === -2) {
      const col = cell % 1440, row = (cell - col) / 1440, x = -180 + (col + 0.5) * 0.25, y = -90 + (row + 0.5) * 0.25;
      who = -1;
      for (let k = 0; k < list.length; k++) if (inShape(list[k].polys, x, y)) { who = k; break; }
      owner[cell] = who;
    }
    if (who >= 0) out[who] += h[i];
  }
  return out;
}
/** Countries, states or districts whose centre lies inside a box [w, s, e, n]. */
export async function placesIn(env, box, level, limit = 300) {
  const ix = await placeIndex(env), out = [];
  for (let i = 0; i < ix.rows.length && out.length < limit; i++) {
    const r = ix.rows[i];
    if (r[2] !== level) continue;
    const cx = (r[3] + r[5]) / 2, cy = (r[4] + r[6]) / 2;
    if (cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]) out.push(describe(ix, i));
  }
  return out;
}
