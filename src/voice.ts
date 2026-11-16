import { h } from "./askcards";

/* =====================================================================
   VOICE FOR THE FIRE COPILOT, built on the browser's own speech services: no keys and no server of ours.
   Speech to text is the Web Speech API's SpeechRecognition (Chrome, Edge, Safari; Firefox has none, and then no
   mic is shown). One press asks one question: the words appear in the question box as they are heard, and the
   final words go to the copilot exactly as a typed question would. Text to speech is speechSynthesis, which reads
   the first sentence or two of the answer to a spoken question. Nothing here starts again on its own: every
   question costs the agent's owner money, and a mic that reopens by itself is a trap.
   ===================================================================== */

/* ---------- the parts of the Web Speech API this page uses (TypeScript's DOM types leave SpeechRecognition out) ---------- */
type HeardEvent = { results: SpeechRecognitionResultList };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((e: HeardEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;
function recognizer(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof C === "function" ? C : null;
}
const canSpeak = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
const english = () => (navigator.languages ?? []).find(l => /^en\b/i.test(l));
/** listen in English when the reader reads it at all: this site, its place names and the agent's answers are English */
const listenLang = () => english() ?? (navigator.language || "en-US");
/** read an English answer in an English voice: a French or German one says "3,412" as a decimal */
function speakLang(text: string) {
  const looksEnglish = /\b(the|and|with|were|than|which|there|this|that|hotspots?|fires?|burned)\b/i.test(text);
  return looksEnglish ? (english() ?? "en-US") : navigator.language || "en-US";
}

/** what the copilot gives this module: its window, its question box, and a way to ask */
export type VoiceHost = {
  root: HTMLElement;
  log: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  /** the honesty line; the voice privacy note goes under it */
  note: HTMLElement;
  launch: HTMLButtonElement;
  open: () => void;
  /** ask the copilot a spoken question, by the same path as a typed one */
  ask: (q: string) => void;
  busy: () => boolean;
};

const ALOUD_KEY = "bc-copilot-aloud";
/** after a press to stop, wait this long for the final words; then send the words heard so far */
const STOP_GRACE = 2000;
/** the longest one question may listen; browsers end on silence long before this */
const LISTEN_LIMIT = 30000;
/** a second press of the launcher's mic lands on the window's send button once the window is open: ignore it */
const DOUBLE_PRESS = 700;
const STARTING = "Starting the microphone…";
const LISTENING = "Listening…";
const PRIVACY = "Voice uses your browser's speech service; in Chrome that sends audio to Google.";
const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser to talk to the copilot.",
  "service-not-allowed": "Speech recognition is turned off in this browser. You can type your question instead.",
  "no-speech": "No speech was heard. Press the mic to try again.",
  "audio-capture": "No microphone was found. You can type your question instead.",
  network: "The browser's speech service could not be reached. You can type your question instead.",
  "language-not-supported": "This browser cannot recognise speech in your language. You can type your question instead.",
};
const OTHER_ERROR = "Voice input stopped. You can type your question instead.";

const MIC_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><g class="off"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></g><rect class="on" x="6" y="6" width="8" height="8" rx="1.5"/></svg>';
const SPEAKER_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 8v4h3l4 3.5v-11L6.5 8z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9"/></svg>';

type Parts = {
  host: VoiceHost;
  mic: HTMLButtonElement;
  line: HTMLElement;
  lineIcon: HTMLElement;
  lineText: HTMLElement;
  lineStop: HTMLButtonElement;
  /** notes for screen readers; the listening line itself is not announced, so no announcement reaches the mic */
  sr: HTMLElement;
  info: HTMLElement;
  aloud: HTMLButtonElement | null;
};
let V: Parts | null = null;
type LineKind = "starting" | "listening" | "speaking" | "note";
let lineKind: LineKind | null = null;

/** one press of the mic: the recogniser, and what the question box held before it */
type Session = {
  r: Recognition;
  before: string;
  placeholder: string;
  heard: string;
  error: string;
  /** the browser has begun taking audio (after any permission prompt) */
  started: boolean;
  /** the reader said the question is done (a second press, Enter): send what was heard when listening ends */
  send: boolean;
  stopping: number;
  limit: number;
};
let session: Session | null = null;
let utter: SpeechSynthesisUtterance | null = null,
  /* the page an answer was read out on; moving to another page stops the reading */
  utterHash = "",
  readAloud = true,
  /* the window was closed to look at the page ("See it" on phones): the answer to a spoken question is still read */
  lookingAtPage = false;

/* ---------- the status line over the question box: listening, reading aloud, or a short note ---------- */
function showLine(kind: LineKind, text: string) {
  if (!V) return;
  lineKind = kind;
  V.line.dataset.kind = kind;
  V.lineIcon.innerHTML = kind === "speaking" ? SPEAKER_SVG : "";
  V.lineText.textContent = text;
  V.lineStop.hidden = kind !== "speaking";
  V.sr.textContent = kind === "note" ? text : "";
  if (!V.line.hidden) return;
  /* the line takes room from the conversation: keep its last words in view */
  const log = V.host.log,
    atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  V.line.hidden = false;
  if (atEnd) log.scrollTop = log.scrollHeight;
}
function hideLine() {
  if (!V || V.line.hidden) return;
  const hadFocus = V.line.contains(document.activeElement);
  lineKind = null;
  V.line.hidden = true;
  V.sr.textContent = "";
  if (hadFocus && !V.mic.disabled) V.mic.focus();
}
function fit() {
  if (!V) return;
  const t = V.host.input;
  t.style.height = "";
  /* the box is border-box: its height is the text plus the border, or a 2px scrollbar shows beside the words */
  t.style.height = Math.min(120, t.scrollHeight + t.offsetHeight - t.clientHeight) + "px";
}
function setMic(on: boolean) {
  if (!V) return;
  /* the label stays the same and aria-pressed says whether it is on: a changing label is read out to the mic */
  V.mic.setAttribute("aria-pressed", String(on));
  V.mic.title = on ? "Stop and send" : "Start talking";
  V.host.root.classList.toggle("listening", on);
  /* while listening, the mic is the way to send: Send would ask the half-heard words as a typed question */
  V.host.send.disabled = on || V.host.busy();
}

/* ---------- speech to text ---------- */
function listen() {
  const Ctor = recognizer();
  if (!V || !Ctor || session || V.host.busy()) return;
  hush();
  primeSpeech();
  const r = new Ctor();
  r.lang = listenLang();
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  const input = V.host.input,
    s: Session = { r, before: input.value, placeholder: input.placeholder, heard: "", error: "", started: false, send: false, stopping: 0, limit: 0 };
  r.onstart = r.onaudiostart = () => began(s);
  r.onresult = e => heard(s, e);
  r.onerror = e => {
    s.error = e.error;
  };
  r.onend = () => ended(s);
  try {
    r.start();
  } catch {
    showLine("note", OTHER_ERROR);
    return;
  }
  session = s;
  setMic(true);
  /* not "Listening" yet: the browser may first ask for the microphone, and words said meanwhile are lost */
  input.placeholder = STARTING;
  showLine("starting", STARTING);
}
/** the browser has the microphone: from here words are heard, and the time limit runs */
function began(s: Session) {
  if (session !== s || !V || s.started) return;
  s.started = true;
  s.limit = window.setTimeout(() => stopListening(false), LISTEN_LIMIT);
  if (V.host.input.placeholder === STARTING) V.host.input.placeholder = LISTENING;
  if (lineKind === "starting") showLine("listening", "Listening. Ask your question out loud.");
}
function heard(s: Session, e: HeardEvent) {
  if (session !== s || !V) return;
  began(s);
  let words = "",
    final = e.results.length > 0;
  for (let i = 0; i < e.results.length; i++) {
    const res = e.results[i];
    words += res[0]?.transcript ?? "";
    if (!res.isFinal) final = false;
  }
  const most = V.host.input.maxLength > 0 ? V.host.input.maxLength : 500;
  words = words.replace(/\s+/g, " ").trim();
  const full = words.length >= most;
  if (full) words = words.slice(0, most).replace(/\s+\S*$/, "");
  s.heard = words;
  V.host.input.value = words;
  fit();
  if (final && words) {
    /* the question is complete: let the recogniser go before asking, so nothing it does later lands anywhere */
    release(s, true);
    sendHeard(words);
  } else if (full) stopListening(true);
}
function ended(s: Session) {
  if (session !== s || !V) return;
  release(s, false);
  const failed = s.error && s.error !== "aborted" ? s.error : "";
  /* a press to stop means "that is my question": send it, even when the browser gave no final words */
  if (s.send && s.heard && !failed) return sendHeard(s.heard);
  if (!s.heard) {
    V.host.input.value = s.before;
    fit();
  }
  if (failed) showLine("note", ERRORS[failed] ?? OTHER_ERROR);
  else if (s.heard) showLine("note", "Press send to ask this, or change it first.");
  else hideLine();
}
function sendHeard(words: string) {
  if (!V) return;
  hideLine();
  const { host, mic } = V;
  /* the mic is disabled while the copilot answers; keep the keyboard in the window */
  if (document.activeElement === mic) host.root.focus();
  host.ask(words);
}
/** forget a session: no handler of it runs again */
function release(s: Session, abort: boolean) {
  s.r.onstart = s.r.onaudiostart = s.r.onresult = s.r.onerror = s.r.onend = null;
  clearTimeout(s.stopping);
  clearTimeout(s.limit);
  if (abort) {
    try {
      s.r.abort();
    } catch {
      /* already over */
    }
  }
  if (session === s) session = null;
  setMic(false);
  const ph = V?.host.input.placeholder;
  if (V && (ph === STARTING || ph === LISTENING)) V.host.input.placeholder = s.placeholder;
}
/** end listening and let the recogniser give its final words: on a press to stop (`send`), or at the time limit */
function stopListening(send: boolean) {
  const s = session;
  if (!s) return;
  if (send) s.send = true;
  if (s.stopping) return;
  /* still waiting for the microphone (a permission prompt, say): nothing was heard, so there is nothing to send */
  if (!s.started) return cancelListening(true);
  try {
    s.r.stop();
  } catch {
    /* already stopping */
  }
  s.stopping = window.setTimeout(() => {
    if (session !== s) return;
    try {
      s.r.abort();
    } catch {
      /* already over */
    }
    ended(s);
  }, STOP_GRACE);
}
/** drop the question being spoken; `restore` puts back what the box held before */
function cancelListening(restore: boolean) {
  const s = session;
  if (!s || !V) return;
  release(s, true);
  if (lineKind === "listening" || lineKind === "starting") hideLine();
  if (restore) {
    V.host.input.value = s.before;
    fit();
  }
}

/* ---------- text to speech ---------- */
/** the first sentence or two of an answer, as plain words to say: no Markdown, no links */
export function spoken(raw: string): string {
  const lines = raw
    .split("\n")
    .map(l =>
      l
        .trim()
        .replace(/^>\s*/, "")
        .replace(/^#+\s*/, "")
        .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\b(see|visit)\s+https?:\/\/\S+/gi, "$1 the link")
        .replace(/\bhttps?:\/\/\S+/gi, "")
        .replace(/\*+|`+|~~|__/g, "")
        /* said as "about 16,900" and "1990 to 2024", not "tilde 16,900" and "2012 minus 2024" */
        .replace(/(?:~|≈)\s*(?=\d)/g, "about ")
        .replace(/\s*→\s*/g, " to ")
        .replace(/\b(\d{4})\s*[–-]\s*(\d{2,4})\b(?![–-]\d)/g, "$1 to $2")
        .replace(/(\d)\s*×/g, "$1 times")
        .replace(/\s+/g, " ")
        .trim(),
    )
    /* a Markdown table is for the eye; the cards and the text around it say what it shows */
    .filter(l => /[A-Za-z0-9]/.test(l) && !l.startsWith("|"))
    .map(l => (/[.!?:;。！？]$/.test(l) ? l : l + "."));
  const all = sentences(lines.join(" "));
  let out = all[0] ?? "";
  if (all[1] && out.length < 110 && out.length + all[1].length < 300) out += " " + all[1];
  if (out.length > 320) out = out.slice(0, 300).replace(/\s+\S*$/, "") + "…";
  return out;
}
/** a full stop ends a sentence unless it closes a short form ("e.g.", "U.S.", "Jan.") or sits inside a number */
const SHORT_FORM = /(?:\b(?:e\.g|i\.e|etc|vs|approx|ca|Mt|St|Dr|Mr|Mrs|Ms|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|\b[A-Z])\.$/;
function sentences(text: string) {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c !== "." && c !== "!" && c !== "?") || (i + 1 < text.length && text[i + 1] !== " ")) continue;
    const piece = text.slice(start, i + 1);
    if (c === "." && SHORT_FORM.test(piece)) continue;
    if (piece.trim()) out.push(piece.trim());
    start = i + 1;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
/** Safari on iPhone only lets a page speak once it has spoken during a tap: the mic press says nothing, once */
let primed = false;
function primeSpeech() {
  if (primed || !canSpeak()) return;
  primed = true;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}
function say(text: string) {
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speakLang(text);
  /* some engines (no voices installed) never end or fail an utterance: once the engine is idle, it is over */
  const watch = window.setInterval(() => {
    if (utter !== u || (!synth.speaking && !synth.pending)) over();
  }, 1500);
  const over = () => {
    clearInterval(watch);
    if (utter !== u) return;
    utter = null;
    if (lineKind === "speaking") hideLine();
  };
  u.onend = over;
  u.onerror = over;
  /* kept in a variable as well: Chrome can drop an utterance nothing refers to before it has finished */
  utter = u;
  utterHash = location.hash;
  showLine("speaking", "Reading the answer aloud");
  synth.speak(u);
}
/** stop reading aloud, if this page is */
function hush() {
  if (!utter) return;
  utter = null;
  window.speechSynthesis.cancel();
  if (lineKind === "speaking") hideLine();
}

/* ---------- what the copilot calls ---------- */
/** the copilot finished answering a spoken question: read the start of the answer aloud */
export function voiceAnswer(raw: string) {
  if (!V || !V.aloud || !readAloud || (V.host.root.hidden && !lookingAtPage)) return;
  say(spoken(raw) || "The answer is on the screen.");
}
/** the copilot started or finished an answer */
export function voiceBusy(busy: boolean) {
  if (!V) return;
  V.mic.disabled = busy;
  if (!busy) return;
  /* a new question, typed, picked or spoken: whatever was being said or heard is over */
  hush();
  cancelListening(false);
  if (lineKind === "note") hideLine();
}
/** the window closed, or the conversation started over: stop listening, and stop speaking unless `keepReading`
 *  (the window closed so the reader can look at what the answer shows on the page) */
export function voiceStop(keepReading = false) {
  lookingAtPage = keepReading;
  if (!keepReading) hush();
  cancelListening(true);
  if (lineKind !== "speaking") hideLine();
}

function setAloud(on: boolean) {
  readAloud = on;
  V?.aloud?.setAttribute("aria-pressed", String(on));
  if (!on) hush();
  try {
    localStorage.setItem(ALOUD_KEY, on ? "1" : "0");
  } catch {
    /* storage is blocked: the choice lasts as long as the page */
  }
}

/** add the mic to the copilot, where the browser can turn speech into text; elsewhere add nothing at all */
export function voiceInit(host: VoiceHost) {
  if (!recognizer()) return;
  const mic = h("button", "askMic");
  mic.type = "button";
  mic.innerHTML = MIC_SVG;
  mic.setAttribute("aria-label", "Talk to the copilot");
  mic.onclick = () => (session ? stopListening(true) : listen());
  host.send.before(mic);

  const line = h("div", "askVoice"),
    lineIcon = h("span", "askVoiceIcon"),
    lineText = h("span", "askVoiceText"),
    lineStop = h("button", "askVoiceStop", "Stop");
  line.hidden = true;
  lineIcon.setAttribute("aria-hidden", "true");
  lineStop.type = "button";
  lineStop.setAttribute("aria-label", "Stop reading aloud");
  lineStop.onclick = hush;
  line.append(lineIcon, lineText, lineStop);
  host.form.before(line);
  const sr = h("span", "askVoiceSr");
  sr.setAttribute("role", "status");
  host.root.append(sr);

  /* said before the first press, not after: the audio goes to the browser's speech service from the first word */
  const info = h("span", "askVoiceInfo");
  info.appendChild(h("span", "", PRIVACY));
  let aloud: HTMLButtonElement | null = null;
  if (canSpeak()) {
    aloud = h("button", "askAloud");
    aloud.type = "button";
    aloud.append(h("span", "askSw"), "Read answers aloud");
    aloud.title = "Read the start of each answer to a spoken question aloud";
    aloud.onclick = () => setAloud(!readAloud);
    info.appendChild(aloud);
    try {
      readAloud = localStorage.getItem(ALOUD_KEY) !== "0";
    } catch {
      /* storage is blocked: read aloud, the default */
    }
    aloud.setAttribute("aria-pressed", String(readAloud));
  }
  host.note.appendChild(info);

  /* a mic on the closed launcher: open the window and start listening in one press */
  const quick = h("button", "askLaunchMic");
  quick.type = "button";
  quick.setAttribute("aria-label", "Talk to the fire copilot");
  quick.title = "Talk to the fire copilot";
  quick.innerHTML = MIC_SVG;
  let quickAt = -Infinity;
  quick.onclick = () => {
    quickAt = performance.now();
    host.open();
    if (host.busy()) return;
    listen();
    setTimeout(() => mic.focus(), 90);
  };
  host.launch.after(quick);
  /* the second click of a double press on the launcher's mic lands on whatever in the window now sits under it
     (the send button, or on a phone a starter question): ignore it */
  host.root.addEventListener(
    "click",
    e => {
      if (performance.now() - quickAt > DOUBLE_PRESS) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  document.body.classList.add("askVoiceOK");
  /* on phones the launcher sits centred over the globe; the quick mic follows its right end */
  new ResizeObserver(() => {
    if (host.launch.offsetWidth) document.body.style.setProperty("--askLW", host.launch.offsetWidth + "px");
  }).observe(host.launch);

  V = { host, mic, line, lineIcon, lineText, lineStop, sr, info, aloud };
  setMic(false);

  /* typing takes over from the voice: stop reading, and keep what is typed instead of what was being heard */
  host.input.addEventListener("input", () => {
    hush();
    cancelListening(false);
    if (lineKind === "note") hideLine();
  });
  /* while listening, a submit means "that is my question": stop and send the spoken words, by the spoken path */
  host.root.addEventListener(
    "submit",
    e => {
      if (!session) return;
      e.preventDefault();
      e.stopPropagation();
      stopListening(true);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    e => {
      /* Escape stops listening (dropping the question) or reading aloud before it closes the window, from anywhere */
      if (e.key === "Escape") {
        if (session) cancelListening(true);
        else if (utter) {
          hush();
          if (host.root.hidden) return;
        } else return;
        e.stopPropagation();
        e.preventDefault();
      } else if (e.key === "Enter" && session && e.target === host.input && !e.shiftKey && !e.isComposing) {
        e.stopPropagation();
        e.preventDefault();
        stopListening(true);
      }
    },
    true,
  );
  /* the copilot moves the page itself before it finishes; only a later move, the reader's, stops the reading */
  addEventListener("hashchange", () => {
    if (utter && location.hash !== utterHash) hush();
  });
  addEventListener("pagehide", () => {
    hush();
    cancelListening(false);
  });
}
