import type { Box } from "./cmap";

/* =====================================================================
   THE FIRE COPILOT'S MESSAGES. The copilot is the HotSpotters FireCopilot agent (a Cloudflare Durable Object
   running DeepSeek), reached over a WebSocket. Everything it sends is untrusted: each message is checked field by
   field here, and anything malformed is dropped, so the rest of the page only ever sees these types.
   ===================================================================== */

export type View = { lat: number; lon: number; zoom: number; bbox: Box };
/** the agent's selection ids are its own region ids, which this page does not have, so selection is always null */
export type Context = { selection: null; view: View | null; layer: null };
export type Outbound = { type: "chat"; text: string; context: Context } | { type: "reset" };

export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] };
/** a place as the agent describes it; level 0 is a country, 1 a state or province, 2 a district or county */
export type Place = { id: string; name: string; label: string; level: number; b: Box | null; g: Geometry | null };
export type Action =
  | { type: "goto"; place: Place }
  | { type: "outline"; places: Place[] }
  | { type: "mark"; focus: Place | null; places: Place[] }
  | { type: "highlight"; parent: Place | null };

export type Tone = "high" | "up" | "flat" | "down";
export type Badge = { text: string; tone: Tone };
export type Bars = {
  type: "bars";
  title: string;
  labels: string[];
  values: (number | null)[];
  ref: number[] | null;
  refLine: number | null;
  refLabel: string;
  highlight: number[];
};
export type Series = { name: string; values: (number | null)[]; ref: boolean; tone: number };
export type Lines = { type: "lines"; title: string; labels: string[]; series: Series[] };
export type RankItem = { name: string; sub: string; value: string; chip: Badge | null; spark: number[]; b: Box | null };
export type Card = {
  eyebrow: string;
  title: string;
  badge: Badge | null;
  big: { value: string; caption: string } | null;
  chart: Bars | Lines | null;
  table: { head: string[]; rows: string[][]; plain: boolean } | null;
  rank: { title: string; items: RankItem[] } | null;
  rows: { k: string; v: string; tone: Tone | null }[];
  foot: string;
  go: Place | null;
  suggest: string[];
};
export type Turn = { role: "user"; text: string } | { role: "assistant"; text: string; cards: Card[]; choices: string[] };
export type Inbound =
  | { type: "hello"; transcript: Turn[] }
  | { type: "status"; text: string }
  | { type: "card"; card: Card }
  | { type: "action"; action: Action }
  | { type: "delta"; text: string }
  | { type: "retract" }
  | { type: "choices"; options: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

/* ---------- checking ---------- */
type Obj = Record<string, unknown>;
const isObj = (u: unknown): u is Obj => typeof u === "object" && u !== null && !Array.isArray(u);
const LIMIT = 2000;
/** text from a string or a number, cut to a sane length; anything else is empty */
const text = (u: unknown, max = LIMIT) => (typeof u === "string" ? u.slice(0, max) : typeof u === "number" && isFinite(u) ? String(u) : "");
const num = (u: unknown): number | null => (typeof u === "number" && isFinite(u) ? u : null);
const list = (u: unknown, max = 200): unknown[] => (Array.isArray(u) ? u.slice(0, max) : []);
const texts = (u: unknown, max = 200) => list(u, max).map(x => text(x, 300));
const nums = (u: unknown, max = 400) => list(u, max).map(num);
const TONES: Tone[] = ["high", "up", "flat", "down"];
const tone = (u: unknown): Tone | null => TONES.find(t => t === u) ?? null;

function box(u: unknown): Box | null {
  const a = list(u, 4)
    .map(num)
    .filter((v): v is number => v !== null);
  if (a.length !== 4) return null;
  const [w, s, e, n] = a;
  return s <= n && Math.abs(s) <= 90 && Math.abs(n) <= 90 && Math.abs(w) <= 540 && Math.abs(e) <= 540 ? [w, s, e, n] : null;
}
function geometry(u: unknown): Geometry | null {
  if (!isObj(u) || !Array.isArray(u.coordinates)) return null;
  return u.type === "Polygon" || u.type === "MultiPolygon" ? { type: u.type, coordinates: u.coordinates } : null;
}
function place(u: unknown): Place | null {
  if (!isObj(u)) return null;
  const name = text(u.name, 200);
  if (!name) return null;
  const p = { id: text(u.id, 80), name, label: text(u.label, 300) || name, level: num(u.level) ?? -1, b: box(u.b), g: geometry(u.g) };
  return p.b && p.b[2] - p.b[0] > 180 ? acrossDateLine(p) : p;
}
/** every [lon, lat] pair in a GeoJSON coordinate tree */
function eachPoint(c: unknown, f: (pt: number[]) => void) {
  if (!Array.isArray(c)) return;
  if (typeof c[0] === "number" && typeof c[1] === "number") f(c as number[]);
  else for (const x of c) eachPoint(x, f);
}
function shiftWest(c: unknown): unknown {
  if (!Array.isArray(c)) return c;
  if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0] < 0 ? c[0] + 360 : c[0], ...c.slice(1)];
  return c.map(shiftWest);
}
/** a box sent as [-180, s, 180, n] (Chukotka, Fiji's east, a Kiribati group) frames the whole world: rebuild it from the
    shape across the date line, east of 180 (lon + 360), with the shape moved the same way. No shape: no box. */
function acrossDateLine(p: Place): Place {
  if (!p.g) return { ...p, b: null };
  let w = Infinity,
    e = -Infinity,
    w2 = Infinity,
    e2 = -Infinity,
    s = Infinity,
    n = -Infinity;
  eachPoint(p.g.coordinates, ([x, y]) => {
    const x2 = x < 0 ? x + 360 : x;
    w = Math.min(w, x);
    e = Math.max(e, x);
    w2 = Math.min(w2, x2);
    e2 = Math.max(e2, x2);
    s = Math.min(s, y);
    n = Math.max(n, y);
  });
  if (!Number.isFinite(w) || !Number.isFinite(s)) return { ...p, b: null };
  if (e - w <= e2 - w2) return { ...p, b: [w, s, e, n] };
  return { ...p, b: [w2, s, e2, n], g: { type: p.g.type, coordinates: shiftWest(p.g.coordinates) as unknown[] } };
}
const places = (u: unknown) =>
  list(u, 60)
    .map(place)
    .filter((p): p is Place => p !== null);
function badge(u: unknown): Badge | null {
  if (!isObj(u)) return null;
  const t = text(u.text, 60);
  return t ? { text: t, tone: tone(u.cls) ?? "flat" } : null;
}

function action(u: unknown): Action | null {
  if (!isObj(u)) return null;
  if (u.type === "goto") {
    const p = place(u.place);
    return p ? { type: "goto", place: p } : null;
  }
  if (u.type === "outline") return { type: "outline", places: places(u.places) };
  if (u.type === "mark") return { type: "mark", focus: place(u.focus), places: places(u.places) };
  if (u.type === "highlight") return { type: "highlight", parent: place(u.parent) };
  return null;
}

function chart(u: unknown): Bars | Lines | null {
  if (!isObj(u)) return null;
  const labels = texts(u.labels, 60);
  if (u.type === "lines") {
    const series = list(u.series, 6)
      .filter(isObj)
      .map((s, i): Series => ({ name: text(s.name, 120), values: nums(s.values, 60), ref: s.tone === "ref", tone: num(s.tone) ?? i }));
    return series.length && labels.length ? { type: "lines", title: text(u.title, 200), labels, series } : null;
  }
  const values = nums(u.values, 60);
  if (!values.length || !labels.length) return null;
  const ref = Array.isArray(u.ref) ? nums(u.ref, 60).map(v => v ?? 0) : null;
  return {
    type: "bars",
    title: text(u.title, 200),
    labels,
    values,
    ref,
    refLine: num(u.refLine),
    refLabel: text(u.refLabel, 60) || "usual",
    highlight: nums(u.highlight, 60).filter((v): v is number => v !== null),
  };
}

export function card(u: unknown): Card | null {
  if (!isObj(u)) return null;
  const big = isObj(u.big) ? { value: text(u.big.value, 80), caption: text(u.big.caption, 300) } : null;
  const t = u.table;
  const table = isObj(t)
    ? { head: texts(t.head, 6), rows: list(t.rows, 20).map(r => texts(Array.isArray(r) ? r : [r], 6)), plain: t.plain === true }
    : null;
  const rk = u.rank;
  const rank = isObj(rk)
    ? {
        title: text(rk.title, 300),
        items: list(rk.items, 12)
          .filter(isObj)
          .map((it): RankItem => ({
            name: text(it.name, 200),
            sub: text(it.sub, 200),
            value: text(it.value, 40),
            chip: badge(it.chip),
            spark: nums(it.spark, 24).map(v => v ?? 0),
            b: box(it.b),
          })),
      }
    : null;
  return {
    eyebrow: text(u.eyebrow, 200),
    title: text(u.title, 200),
    badge: badge(u.badge),
    big,
    chart: chart(u.chart),
    table: table && table.rows.length ? table : null,
    rank: rank && rank.items.length ? rank : null,
    rows: list(u.rows, 12)
      .filter(isObj)
      .map(r => ({ k: text(r.k, 120), v: text(r.v, 300), tone: tone(r.cls) })),
    foot: text(u.foot, 600),
    go: isObj(u.go) ? place(u.go.place) : null,
    suggest: texts(u.suggest, 4).filter(Boolean),
  };
}
const cards = (u: unknown) =>
  list(u, 12)
    .map(card)
    .filter((c): c is Card => c !== null);

function turn(u: unknown): Turn | null {
  if (!isObj(u)) return null;
  if (u.role === "user") return { role: "user", text: text(u.text, 1000) };
  if (u.role === "assistant") return { role: "assistant", text: text(u.text, 8000), cards: cards(u.cards), choices: texts(u.choices, 6) };
  return null;
}

/** one WebSocket message from the agent, checked; null when it is not one this page understands */
export function parseInbound(raw: unknown): Inbound | null {
  let m: unknown;
  try {
    m = JSON.parse(typeof raw === "string" ? raw : "");
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.type) {
    case "hello":
      return {
        type: "hello",
        transcript: list(m.transcript, 200)
          .map(turn)
          .filter((t): t is Turn => t !== null),
      };
    case "status":
      return { type: "status", text: text(m.text, 200) };
    case "card": {
      const c = card(m.card);
      return c ? { type: "card", card: c } : null;
    }
    case "action": {
      const a = action(m.action);
      return a ? { type: "action", action: a } : null;
    }
    case "delta":
      return { type: "delta", text: text(m.text, 4000) };
    case "retract":
      return { type: "retract" };
    case "choices":
      return { type: "choices", options: texts(m.options, 6).filter(Boolean) };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: text(m.message, 400) || "Something went wrong." };
    default:
      return null;
  }
}
