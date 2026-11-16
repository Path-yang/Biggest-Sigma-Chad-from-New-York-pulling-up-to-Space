import type { StateCode } from "./types";
import type { Action, Card, Context, Inbound, Outbound, Place, Turn } from "./askproto";
import type { Box, MapMark } from "./cmap";
import { NAME, SLUG, STS } from "./data";
import { WORLD, countryAt, nameOf, slugOf, theName } from "./world";
import { countryKey } from "./country";
import { mapCountry, mapFocus, mapMarks, mapView } from "./cmap";
import { go, goCountry } from "./views";
import { parseInbound } from "./askproto";
import { cardEl, h, prose } from "./askcards";
import { voiceAnswer, voiceBusy, voiceInit, voiceStop } from "./voice";

/* =====================================================================
   THE FIRE COPILOT: a chat window that asks the HotSpotters FireCopilot agent (DeepSeek, on Cloudflare) about
   fire anywhere, then shows its result cards and moves this page to what it found. Nothing connects until the
   reader opens the window. Every question costs the agent's owner money, so nothing here retries on its own.
   ===================================================================== */
const SOCKET = "wss://hotspotters.compare/agents/fire-copilot/";
const SESSION_KEY = "bc-copilot-session";
const OPEN_TIMEOUT = 12000;
/** the agent can take a while over a hard question; this long with no word from it means it is gone */
const QUIET_LIMIT = 120000;
/** limits on one answer, so a faulty agent cannot freeze the page: characters of text, result cards, follow-ups */
const MAX_TEXT = 12000;
const MAX_CARDS = 12;
const MAX_SUGGEST = 6;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** outline colours for the copilot's shapes on the light country map, clear of the yellow-to-red squares */
const MARK_TONES = ["#2166ac", "#6a3d9a", "#1b7837", "#8c510a"];
const HONESTY =
  "Answers come from the HotSpotters copilot (DeepSeek), which counts all FIRMS heat detections, gas flares included. Its totals often run higher than this page's, so compare trends, not exact counts.";

/* ---------- where the reader is ---------- */
type Here =
  { kind: "globe" } | { kind: "compare" } | { kind: "state"; st: StateCode } | { kind: "country"; k: string | null; name: string };

function here(): Here {
  const hash = location.hash;
  if (hash.startsWith("#c/")) {
    let slug = hash.slice(3);
    try {
      slug = slugOf(decodeURIComponent(slug));
    } catch {
      slug = slugOf(slug);
    }
    const k = WORLD.find(c => slugOf(c.k) === slug)?.k ?? countryKey();
    return { kind: "country", k, name: k ? nameOf(k) : "" };
  }
  const st = STS.find(s => "#" + SLUG[s] === hash);
  if (st) return { kind: "state", st };
  return hash === "#compare" ? { kind: "compare" } : { kind: "globe" };
}
/** "New York State": the agent's place search would otherwise often take New York to mean the city */
const stateName = (st: StateCode) => (st === "NY" ? "New York State" : NAME[st]);
function whereLabel(at: Here) {
  if (at.kind === "country") return at.name;
  if (at.kind === "state") return NAME[at.st];
  if (at.kind === "compare") return "New York and California";
  return "";
}
/** the plain note added after a question that names no place, so the agent knows what "here" is */
function placeNote(at: Here) {
  if (at.kind === "country" && at.name) return `(I'm looking at ${theName(at.name)}.)`;
  if (at.kind === "state") return `(I'm looking at ${stateName(at.st)}.)`;
  if (at.kind === "compare") return "(I'm comparing New York State and California.)";
  return "";
}
const NOTE_RE = /\s*\(I'm (?:looking at|comparing) [^()]*\.\)$/;

const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** words that start with a capital but are not places */
const NOT_PLACES = new Set(
  [
    ...MONTHS,
    ...MONTHS.map(m => m.slice(0, 3)),
    "I",
    "I'm",
    "I'd",
    "I've",
    "NASA",
    "FIRMS",
    "MODIS",
    "VIIRS",
    "NOAA",
    "DeepSeek",
    "HotSpotters",
    "Copilot",
    "OK",
  ].map(w => w.toLowerCase()),
);
/** does the question already name a place? A country we know, or a capitalised word that is not the start of a
    sentence (Punjab, Los Angeles County, USA) */
function namesAPlace(q: string) {
  const f = ` ${fold(q)} `;
  if (WORLD.some(c => f.includes(` ${fold(c.n)} `))) return true;
  const words = q.split(/\s+/);
  return words.some((w, i) => {
    const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "");
    if (i === 0 || !/^[A-Z]/.test(bare) || NOT_PLACES.has(bare.toLowerCase())) return false;
    return !/[.?!:]$/.test(words[i - 1]);
  });
}

/* ---------- places the agent names, matched to this site ---------- */
const COUNTRY_ALIAS: Record<string, string> = {
  "united states of america": "United_States",
  usa: "United_States",
  "russian federation": "Russian_Federation",
  czechia: "Czech_Republic",
  turkiye: "Turkey",
  "cabo verde": "Cape_Verde",
  "ivory coast": "Cote_d_Ivoire",
  gambia: "The_Gambia",
  "viet nam": "Vietnam",
  burma: "Myanmar",
  swaziland: "Swaziland",
  "east timor": "Timor-Leste",
  congo: "Republic_of_Congo",
  "democratic republic of congo": "Democratic_Republic_of_the_Congo",
  "dr congo": "Democratic_Republic_of_the_Congo",
  macedonia: "Macedonia_Former_Yugoslav_Republic_of",
  micronesia: "Federated_States_of_Micronesia",
  "korea republic of": "Republic_of_Korea",
  bahamas: "Bahamas",
};
function countryNamed(name: string) {
  const f = fold(name).replace(/^the /, "");
  if (!f) return null;
  return WORLD.find(c => fold(c.n).replace(/^the /, "") === f || fold(c.k) === f)?.k ?? COUNTRY_ALIAS[f] ?? null;
}
type Dest = { kind: "state"; st: StateCode } | { kind: "country"; k: string } | null;
/** which page of this site holds a place: one of the two states, or a country page */
function destOf(p: Place): Dest {
  const parts = p.label.split(",").map(t => t.trim()),
    country = p.level === 0 ? p.name : parts.length > 1 ? parts[parts.length - 1] : "";
  const k = countryNamed(country) ?? (p.b ? (countryAt((p.b[0] + p.b[2]) / 2, (p.b[1] + p.b[3]) / 2)?.k ?? null) : null);
  if (k === "United_States" && p.level >= 1) {
    const stName = p.level === 1 ? p.name : (parts[parts.length - 2] ?? "");
    const st = STS.find(s => NAME[s] === stName);
    if (st) return { kind: "state", st };
  }
  return k ? { kind: "country", k } : null;
}

/* ---------- the window ---------- */
type Live = {
  box: HTMLElement;
  status: HTMLElement;
  statusText: HTMLElement;
  cards: HTMLElement;
  text: HTMLElement;
  raw: string;
  suggest: string[];
  choices: string[];
  question: string;
  /** the page this answer belongs to; the agent only moves the page while the reader is still on it */
  hash: string;
  cardCount: number;
  /** a pending animation frame that redraws the answer text, or 0 */
  frame: number;
  /** places already offered with an "Open" button in this answer */
  offered: string[];
  /** the question was spoken, not typed */
  said: boolean;
};
const UI = {
  launch: null as HTMLButtonElement | null,
  root: null as HTMLElement | null,
  log: null as HTMLElement | null,
  input: null as HTMLTextAreaElement | null,
  send: null as HTMLButtonElement | null,
  fresh: null as HTMLButtonElement | null,
  where: null as HTMLElement | null,
  /** a hidden polite live region: the finished answer is read out once, not on every streamed word */
  said: null as HTMLElement | null,
};
let ws: WebSocket | null = null,
  opening: Promise<void> | null = null,
  /* the conversation on screen came from the agent's hello (or from a reset); later hellos are reconnects */
  shown = false,
  turn: Live | null = null,
  quiet: number | undefined,
  pendingMap: { k: string; run: () => void; until: number } | null = null;

function sessionId(fresh = false) {
  let id: string | null = null;
  try {
    if (!fresh) id = sessionStorage.getItem(SESSION_KEY);
  } catch {
    /* storage is blocked: the conversation lasts as long as the page */
  }
  if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
    /* the id is the only key to the conversation on the agent's side, so it must not be guessable */
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = "bc" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      /* as above */
    }
  }
  return id;
}

/* ---------- connection ---------- */
function connect(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (opening) return opening;
  opening = new Promise<void>((ok, fail) => {
    let sock: WebSocket;
    try {
      sock = new WebSocket(SOCKET + sessionId());
    } catch {
      return fail(new Error("unreachable"));
    }
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) fail(err);
      else ok();
    };
    const timer = setTimeout(() => {
      sock.close();
      settle(new Error("timeout"));
    }, OPEN_TIMEOUT);
    sock.onmessage = e => {
      const m = parseInbound(e.data);
      if (!m) return;
      if (m.type === "hello") {
        ws = sock;
        if (!shown && !turn) restore(m.transcript);
        shown = true;
        settle(null);
      } else onEvent(m);
    };
    sock.onerror = () => settle(new Error("unreachable"));
    sock.onclose = () => {
      settle(new Error("closed"));
      /* a socket this page already let go of (after giving up on an answer) ends nothing */
      if (ws !== sock) return;
      ws = null;
      if (turn) finish("The connection to the copilot dropped before the answer finished.");
    };
  }).finally(() => {
    opening = null;
  });
  return opening;
}
function post(msg: Outbound) {
  ws?.send(JSON.stringify(msg));
}
function context(): Context {
  return { selection: null, view: here().kind === "country" ? mapView() : null, layer: null };
}

/* ---------- conversation ---------- */
const scroll = () => {
  if (UI.log) UI.log.scrollTop = UI.log.scrollHeight;
};
function nextMonth() {
  return MONTHS[(new Date().getMonth() + 1) % 12];
}
function starters(at: Here): string[] {
  const m = nextMonth();
  if (at.kind === "country" && at.name) {
    const n = theName(at.name);
    return [
      `Was 2025 an unusual fire year for ${n}?`,
      `Which parts of ${n} should I watch in ${m}?`,
      `What were the worst fire years in ${n}?`,
    ];
  }
  if (at.kind === "state") {
    const n = stateName(at.st);
    return [`Which counties in ${n} should I watch in ${m}?`, `Was 2025 unusual for ${n}?`, `Is fire increasing in ${n}?`];
  }
  if (at.kind === "compare") return ["Compare New York State and California in 2025", "When is fire season in New York State?"];
  return [
    `Where should I watch for fire in ${m}?`,
    "Which countries had the most fire in 2025?",
    "What is a hotspot, and where does the data come from?",
  ];
}
function chips(list: string[], cls: string) {
  const box = h("div", `askChips ${cls}`);
  for (const q of list) {
    const b = h("button", "", q);
    b.type = "button";
    b.onclick = () => ask(q);
    box.appendChild(b);
  }
  return box;
}
function welcome() {
  const at = here(),
    box = h("div", "askWelcome");
  box.appendChild(
    h(
      "p",
      "",
      "Ask about fire anywhere on Earth since 2000: a country, a province, a county, a month or a year. When it finds a place this site covers, it opens that page for you.",
    ),
  );
  box.appendChild(h("p", "askTry", whereLabel(at) ? `Try, for ${whereLabel(at)}` : "Try"));
  box.appendChild(chips(starters(at), "start"));
  return box;
}
const hooks = {
  go: (p: Place) => gotoPlace(p, true),
  focus: (name: string, b: Box) => gotoPlace({ id: "", name, label: name, level: 2, b, g: null }, true),
};
function botBlock(cards: Card[], text: string) {
  const m = h("div", "askMsg bot");
  for (const c of cards) m.appendChild(cardEl(c, hooks));
  const t = h("div", "askText");
  prose(t, text);
  m.appendChild(t);
  return m;
}
function restore(items: Turn[]) {
  const log = UI.log!;
  log.textContent = "";
  if (!items.length) {
    log.appendChild(welcome());
    return;
  }
  items.forEach((it, i) => {
    if (it.role === "user") log.appendChild(userBlock(it.text.replace(NOTE_RE, "")));
    else {
      log.appendChild(botBlock(it.cards, it.text));
      if (i === items.length - 1 && it.choices.length) log.appendChild(chips(it.choices, "follow"));
    }
  });
  scroll();
}
function userBlock(text: string, said = false) {
  const m = h("div", "askMsg user"),
    p = m.appendChild(h("p"));
  if (said) p.appendChild(h("span", "askVia", "Said"));
  p.append(text);
  return m;
}
const IDLE_HINT = "Ask about a place, a month or a year";
function setBusy(b: boolean) {
  UI.root?.classList.toggle("busy", b);
  UI.log?.setAttribute("aria-busy", String(b));
  if (UI.send) UI.send.disabled = b;
  if (UI.fresh) UI.fresh.disabled = b;
  if (UI.input) UI.input.placeholder = b ? "Wait for this answer…" : IDLE_HINT;
  voiceBusy(b);
}
type NoteButton = { label: string; run: () => void };
/** on phones the window covers the page, so a change to the page happens out of sight: offer a way out to see it */
const seeIt = (): NoteButton | undefined => (innerWidth <= 600 ? { label: "See it", run: () => close(true) } : undefined);
/** a quiet line in the answer saying what the page did, so a moved map or a new page is never a surprise */
function noteDid(text: string, button?: NoteButton) {
  const target = turn ? turn.box : UI.log?.lastElementChild;
  if (!(target instanceof HTMLElement)) return;
  const p = target.appendChild(h("p", "askDid", text));
  if (button) {
    const b = p.appendChild(h("button", "askSee", button.label));
    b.type = "button";
    b.onclick = button.run;
  }
  scroll();
}

function ask(raw: string, said = false) {
  const q = raw.trim().slice(0, 500);
  if (!q || turn) return;
  const log = UI.log!;
  log.querySelector(".askWelcome")?.remove();
  log.querySelectorAll(".askChips.follow,.askOffline,.askConnecting").forEach(x => x.remove());
  if (UI.said) UI.said.textContent = "";
  log.appendChild(userBlock(q, said));
  const box = h("div", "askMsg bot"),
    status = h("div", "askStatus"),
    statusText = h("span", "", "Connecting");
  status.append(h("span", "askPulse"), statusText);
  const live: Live = {
    box,
    status,
    statusText,
    cards: h("div", "askCards"),
    text: h("div", "askText"),
    raw: "",
    suggest: [],
    choices: [],
    question: q,
    hash: location.hash,
    cardCount: 0,
    frame: 0,
    offered: [],
    said,
  };
  box.append(status, live.cards, live.text);
  log.appendChild(box);
  turn = live;
  scroll();
  if (UI.input) {
    UI.input.value = "";
    UI.input.style.height = "";
  }
  setBusy(true);
  const at = here(),
    note = placeNote(at),
    text = note && !namesAPlace(q) ? `${q} ${note}` : q;
  connect().then(
    () => {
      if (turn !== live) return;
      live.statusText.textContent = "Thinking";
      post({ type: "chat", text, context: context() });
      wait();
    },
    () => {
      if (turn === live) finish("unreachable");
    },
  );
}
/** restart the clock that gives up on an agent that has gone silent */
function wait() {
  clearTimeout(quiet);
  quiet = setTimeout(() => finish("No answer came back from the copilot."), QUIET_LIMIT);
}
/** redraw the streamed answer at most once a frame */
function draw(t: Live) {
  if (t.frame) return;
  t.frame = requestAnimationFrame(() => {
    t.frame = 0;
    prose(t.text, t.raw);
    scroll();
  });
}
function onEvent(m: Inbound) {
  const t = turn;
  /* nothing from the agent counts once its answer is over, least of all a move of the page */
  if (!t) return;
  wait();
  switch (m.type) {
    case "action":
      act(m.action, t);
      return;
    case "status":
      t.statusText.textContent = m.text || "Working";
      break;
    case "card":
      if (t.cardCount >= MAX_CARDS) return;
      t.cardCount++;
      t.cards.appendChild(cardEl(m.card, hooks));
      for (const s of m.card.suggest) if (t.suggest.length < MAX_SUGGEST && !t.suggest.includes(s)) t.suggest.push(s);
      break;
    case "delta":
      if (t.raw.length >= MAX_TEXT) return;
      t.raw = (t.raw + m.text).slice(0, MAX_TEXT);
      t.status.hidden = true;
      draw(t);
      return;
    case "retract":
      t.raw = "";
      t.text.textContent = "";
      t.status.hidden = false;
      break;
    case "choices":
      t.choices = m.options;
      break;
    case "error":
      finish(m.message);
      return;
    case "done":
      finish();
      return;
    case "hello":
      return;
  }
  scroll();
}
function finish(error?: string) {
  const t = turn;
  if (!t) return;
  turn = null;
  clearTimeout(quiet);
  t.status.remove();
  if (t.frame) cancelAnimationFrame(t.frame);
  t.frame = 0;
  prose(t.text, t.raw);
  if (error && ws) {
    /* give up on this socket: the agent may still be streaming the old answer into it, and messages carry no
       turn ids, so that answer would land under the next question. A new socket starts clean. */
    const old = ws;
    ws = null;
    old.close();
  }
  if (UI.said) UI.said.textContent = error ? (error === "unreachable" ? UNREACHABLE : error) : t.text.textContent || "Answer ready.";
  if (error) {
    const box = h("div", "askError");
    box.appendChild(h("p", "", error === "unreachable" ? UNREACHABLE : error));
    const again = h("button", "askAgain", "Try again");
    again.type = "button";
    again.onclick = () => {
      const asked = t.box.previousElementSibling;
      if (asked?.classList.contains("user")) asked.remove();
      t.box.remove();
      ask(t.question, t.said);
    };
    box.appendChild(again);
    t.box.appendChild(box);
  } else if (t.choices.length) UI.log!.appendChild(chips(t.choices, "follow"));
  else if (t.suggest.length) UI.log!.appendChild(chips(t.suggest.slice(0, 3), "follow"));
  setBusy(false);
  scroll();
  if (innerWidth > 900 && UI.root && !UI.root.hidden) UI.input?.focus();
  if (t.said && !error) voiceAnswer(t.raw);
}
const UNREACHABLE = "Can't reach the copilot at hotspotters.compare. It may be down, or this network may block it.";
function newConversation() {
  if (turn) return;
  voiceStop();
  mapMarks([]);
  UI.log!.textContent = "";
  UI.log!.appendChild(welcome());
  shown = true;
  if (ws && ws.readyState === WebSocket.OPEN) post({ type: "reset" });
  else {
    sessionId(true);
    /* a socket already on its way joins the old conversation: clear it there too (a reset costs nothing) */
    opening?.then(
      () => post({ type: "reset" }),
      () => {},
    );
  }
}

/* ---------- what the copilot does to the page ---------- */
/** room the open chat window takes from the map's right or bottom edge */
function mapPad() {
  const pad = { right: 0, bottom: 0 },
    root = UI.root,
    host = document.getElementById("cMap");
  if (!root || root.hidden || !host) return pad;
  const r = root.getBoundingClientRect(),
    m = host.getBoundingClientRect();
  if (r.left > m.left + 120) pad.right = Math.max(0, m.right - r.left);
  else pad.bottom = Math.max(0, m.bottom - r.top);
  return pad;
}
function showMapSection() {
  const host = document.getElementById("cMap");
  if (!host) return;
  const r = host.getBoundingClientRect();
  if (r.bottom < 80 || r.top > innerHeight - 120) host.scrollIntoView({ block: "center" });
}
function marksFor(list: Place[]): MapMark[] {
  return list.map((p, i) => ({ name: p.name, tone: MARK_TONES[i % MARK_TONES.length], geometry: p.g, box: p.b }));
}
/** frame places on the country map now, or once the map of country k is ready (after a page change) */
function frame(k: string, list: Place[], focus: Box | null) {
  const run = () => {
    if (mapCountry() !== k) return;
    const drawn = list.filter(p => p.b || p.g);
    mapMarks(marksFor(drawn));
    const b = focus ?? union(drawn.map(p => p.b).filter((x): x is Box => x !== null));
    if (b) mapFocus(b, mapPad(), 8);
    showMapSection();
  };
  if (mapCountry() === k) run();
  else {
    pendingMap = { k, run, until: Date.now() + 25000 };
    tickPending();
  }
}
function tickPending() {
  const p = pendingMap;
  if (!p) return;
  if (mapCountry() === p.k) {
    pendingMap = null;
    setTimeout(p.run, 300);
  } else if (Date.now() > p.until || here().kind !== "country") pendingMap = null;
  else setTimeout(tickPending, 400);
}
function union(bs: Box[]): Box | null {
  if (!bs.length) return null;
  return bs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]);
}
/** the copilot changed the page itself: the answer still belongs on the page it moved to */
function followed() {
  if (turn) turn.hash = location.hash;
}
/** move the page to a place: its state page, or its country page with the place framed on the map. `shapes` are
    the places of an outline or mark action to draw there instead of the place itself, `focus` the box to frame. */
function gotoPlace(p: Place, byHand = false, shapes: Place[] = [], focus: Box | null = null) {
  if (p.id === "world") return;
  const dest = destOf(p),
    at = here();
  if (!dest) {
    if (byHand) noteDid(`${p.name} is not on a page of this site.`);
    return;
  }
  if (dest.kind === "state") {
    if (at.kind === "state" && at.st === dest.st) {
      if (byHand) scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    noteDid(`Opened ${NAME[dest.st]}.`, seeIt());
    go(dest.st);
    followed();
    return;
  }
  const onIt = at.kind === "country" && at.k === dest.k;
  if (!onIt) {
    noteDid(`Opened ${nameOf(dest.k)}.`, seeIt());
    goCountry(dest.k);
    followed();
  }
  const list = shapes.length ? shapes : p.level >= 1 && p.b ? [p] : [];
  if (list.length || focus) {
    if (onIt) noteDid(outlined(list), seeIt());
    frame(dest.k, list, focus);
  } else if (onIt && byHand) showMapSection();
}
const outlined = (list: Place[]) =>
  list.length === 1 ? `Outlined ${list[0].name} on the map.` : list.length ? `Outlined ${list.length} places on the map.` : "Moved the map.";
/** the reader went to another page while the agent worked: offer the agent's place instead of pulling them back */
function offerPlace(p: Place, t: Live, run: () => void) {
  const dest = destOf(p);
  if (!dest) return;
  const at = here();
  if (dest.kind === "state" ? at.kind === "state" && at.st === dest.st : at.kind === "country" && at.k === dest.k) return;
  const name = dest.kind === "state" ? NAME[dest.st] : nameOf(dest.k);
  if (t.offered.includes(name)) return;
  t.offered.push(name);
  noteDid(`This answer is about ${name}.`, { label: `Open ${name}`, run });
}
const countryOf = (p: Place) => {
  const d = destOf(p);
  return d?.kind === "country" ? d.k : null;
};
/** the country whose map is on screen, ready for shapes, or null */
function mapHere() {
  const at = here();
  return at.kind === "country" && at.k && mapCountry() === at.k ? at.k : null;
}
function act(a: Action, t: Live) {
  const moved = location.hash !== t.hash;
  switch (a.type) {
    case "goto":
      if (moved) return offerPlace(a.place, t, () => gotoPlace(a.place, true));
      return gotoPlace(a.place);
    case "outline":
    case "mark": {
      const focusPlace = a.type === "mark" && a.focus && a.focus.level >= 1 ? a.focus : null,
        k = moved ? null : mapHere();
      if (k) {
        const list = a.places.filter(p => p.level >= 1 && countryOf(p) === k),
          focus = focusPlace && countryOf(focusPlace) === k ? focusPlace.b : null;
        if (list.length || focus) {
          frame(k, list, focus);
          noteDid(outlined(list), seeIt());
          return;
        }
      }
      /* none of it lies on the map on screen (or no map is ready yet): open the page that holds it */
      const lead = (a.type === "mark" ? a.focus : null) ?? a.places[0];
      if (!lead) return;
      const dest = countryOf(lead),
        shapes = dest ? a.places.filter(p => p.level >= 1 && countryOf(p) === dest) : [],
        focus = dest && focusPlace && countryOf(focusPlace) === dest ? focusPlace.b : null;
      if (moved) return offerPlace(lead, t, () => gotoPlace(lead, true, shapes, focus));
      return gotoPlace(lead, false, shapes, focus);
    }
    case "highlight": {
      /* the watch areas' outlines live in the agent's own files, which this page cannot read: frame the area */
      const p = a.parent,
        k = moved ? null : mapHere();
      if (p && p.level >= 1 && p.b && k && countryOf(p) === k) mapFocus(p.b, mapPad(), 8);
      return;
    }
  }
}

/* ---------- open, close, follow the page ---------- */
function syncPlace() {
  const at = here(),
    paper = at.kind === "country";
  for (const el of [UI.launch, UI.root]) el?.classList.toggle("paper", paper);
  document.body.dataset.askView = at.kind;
  if (UI.where) UI.where.textContent = whereLabel(at);
  /* the starter questions follow the page while nothing has been asked */
  const w = UI.log?.querySelector(".askWelcome");
  if (w) w.replaceWith(welcome());
}
function open() {
  const { root, launch } = UI;
  if (!root || !launch) return;
  syncPlace();
  root.hidden = false;
  launch.hidden = true;
  launch.setAttribute("aria-expanded", "true");
  if (!shown && !UI.log!.childElementCount) UI.log!.appendChild(h("p", "askConnecting", "Connecting to the copilot…"));
  /* on phones the window fills the screen and is modal; focus goes to the window itself there, not the question
     box, so the on-screen keyboard does not jump up over it */
  if (innerWidth <= 600) root.setAttribute("aria-modal", "true");
  else root.removeAttribute("aria-modal");
  setTimeout(() => (innerWidth > 900 ? UI.input : root)?.focus(), 60);
  connect().catch(() => {
    /* a question already sent shows its own error under it */
    if (shown || turn) return;
    const log = UI.log!;
    log.textContent = "";
    log.appendChild(welcome());
    shown = true;
    const box = h("div", "askError askOffline");
    box.appendChild(
      h("p", "", "Can't reach the copilot at hotspotters.compare right now. You can still ask; it will try again when you send."),
    );
    log.appendChild(box);
  });
}
/** `keepReading`: the window closes so the reader can see the page; an answer being read aloud goes on */
function close(keepReading = false) {
  const { root, launch } = UI;
  if (!root || !launch) return;
  voiceStop(keepReading);
  root.hidden = true;
  launch.hidden = false;
  launch.setAttribute("aria-expanded", "false");
  launch.focus();
}

/** keep Tab inside the full-screen window on phones */
function trapTab(e: KeyboardEvent, root: HTMLElement) {
  const all = [...root.querySelectorAll<HTMLElement>("button,textarea,a[href]")].filter(x => !x.hasAttribute("disabled") && x.offsetParent);
  if (!all.length) return;
  const first = all[0],
    last = all[all.length - 1],
    now = document.activeElement;
  if (e.shiftKey && (now === first || now === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && now === last) {
    e.preventDefault();
    first.focus();
  }
}
const MARK = () => {
  const m = h("span", "askMark");
  m.setAttribute("aria-hidden", "true");
  m.append(h("i"), h("i"), h("i"));
  return m;
};
export function copilotInit() {
  const launch = h("button", "askLaunch");
  launch.type = "button";
  launch.id = "askLaunch";
  launch.setAttribute("aria-controls", "ask");
  launch.setAttribute("aria-expanded", "false");
  launch.append(MARK(), h("span", "askLT", "Ask the fire copilot"));
  launch.onclick = open;

  const root = h("section", "ask");
  root.id = "ask";
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Fire copilot");
  const head = h("header", "askHead"),
    title = h("div", "askTitle"),
    where = h("span", "askWhere"),
    fresh = h("button", "askNew", "New conversation"),
    shut = h("button", "askX");
  title.append(MARK(), h("b", "", "Fire copilot"), where);
  fresh.type = shut.type = "button";
  fresh.onclick = newConversation;
  shut.setAttribute("aria-label", "Close the copilot");
  shut.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';
  shut.onclick = () => close();
  head.append(title, fresh, shut);
  const note = h("p", "askNote", HONESTY),
    log = h("div", "askLog"),
    said = h("div", "askSaid");
  said.setAttribute("role", "status");
  said.setAttribute("aria-live", "polite");
  const form = h("form", "askForm"),
    input = h("textarea"),
    send = h("button", "askSend");
  input.rows = 1;
  input.maxLength = 500;
  input.placeholder = IDLE_HINT;
  input.setAttribute("aria-label", "Your question");
  input.setAttribute("enterkeyhint", "send");
  send.type = "submit";
  send.setAttribute("aria-label", "Send");
  send.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5"/></svg>';
  form.append(input, send);
  form.onsubmit = e => {
    e.preventDefault();
    ask(input.value);
  };
  /* the page's own keys (Escape closes the data sheet) stay out of the question box */
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") close();
    else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "";
    input.style.height = Math.min(120, input.scrollHeight) + "px";
  });
  root.addEventListener("keydown", e => {
    if (e.key === "Escape" && !root.hidden) {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab" && root.getAttribute("aria-modal") === "true") trapTab(e, root);
  });
  root.append(head, note, log, form, said);
  document.body.append(launch, root);
  Object.assign(UI, { launch, root, log, input, send, fresh, where, said });
  voiceInit({ root, log, form, input, send, note, launch, open, ask: q => ask(q, true), busy: () => turn !== null });
  syncPlace();
  addEventListener("hashchange", () => setTimeout(syncPlace, 0));
  /* the data sheet (#compare, "Open the full data"): the copilot window makes room for its header */
  const sheet = document.getElementById("sheetWrap");
  if (sheet) {
    const track = () => document.body.classList.toggle("askOverSheet", !sheet.hidden);
    new MutationObserver(track).observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
    track();
  }
}
