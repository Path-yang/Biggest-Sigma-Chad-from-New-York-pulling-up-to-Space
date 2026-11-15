import type { Box } from "./cmap";
import type { Bars, Card, Lines, Place } from "./askproto";

/* =====================================================================
   THE FIRE COPILOT'S RESULT CARDS AND ANSWERS, drawn with DOM calls only: every string from the agent goes in
   as text (textContent, SVG <title>), never as markup, so nothing it sends can run on this page.
   Card layouts follow the HotSpotters client (public/copilot.js) with this site's own look.
   ===================================================================== */

type Tag = keyof HTMLElementTagNameMap;
export function h<K extends Tag>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const SVG = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number>, txt?: string) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === "number" ? v.toFixed(1).replace(/\.0$/, "") : v);
  if (txt != null) e.textContent = txt;
  return e;
}
const tip = (parent: Element, txt: string) => parent.appendChild(s("title", {}, txt));
const big = (n: number) => Math.round(n).toLocaleString("en-US");

/* ---------- charts ---------- */
function barsSvg(c: Bars) {
  const W = 340,
    H = 108,
    x0 = 2,
    x1 = W - 2,
    y0 = 6,
    y1 = H - 20,
    n = c.values.length,
    vals = c.values.map(v => v ?? 0),
    max = Math.max(1, ...vals, ...(c.ref ?? []), c.refLine ?? 0),
    bw = (x1 - x0) / n,
    hi = new Set(c.highlight),
    y = (v: number) => y1 - (v / max) * (y1 - y0),
    svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": c.title || "Chart" });
  svg.appendChild(s("line", { x1: x0, x2: x1, y1, y2: y1, class: "askAxis" }));
  c.values.forEach((v, i) => {
    const hgt = v == null ? 0 : Math.max(v > 0 ? 1.5 : 0, y1 - y(v)),
      x = x0 + i * bw + bw * 0.14,
      bar = s("rect", { x, y: y1 - hgt, width: bw * 0.72, height: hgt, class: hi.has(i) ? "askBar hi" : "askBar" });
    const ref = c.ref?.[i];
    tip(bar, `${c.labels[i] ?? ""}: ${v == null ? "no data" : big(v)}${ref != null ? ` (${c.refLabel} ${big(ref)})` : ""}`);
    svg.appendChild(bar);
    if (ref != null) svg.appendChild(s("line", { x1: x - 1, x2: x + bw * 0.72 + 1, y1: y(ref), y2: y(ref), class: "askRef" }));
  });
  if (c.refLine != null) svg.appendChild(s("line", { x1: x0, x2: x1, y1: y(c.refLine), y2: y(c.refLine), class: "askRefLine" }));
  /* twelve months get an initial each; longer runs label the highlighted bars and the ends, skipping collisions */
  const label = (i: number) =>
    svg.appendChild(
      s(
        "text",
        { x: x0 + (i + 0.5) * bw, y: H - 5, "text-anchor": "middle", class: hi.has(i) ? "hi" : "" },
        n === 12 ? (c.labels[i] ?? "").slice(0, 1) : (c.labels[i] ?? ""),
      ),
    );
  if (n === 12) for (let i = 0; i < n; i++) label(i);
  else {
    const placed: number[] = [];
    for (const i of [...hi, 0, n - 1]) if (i >= 0 && i < n && !placed.some(j => Math.abs(j - i) * bw < 32)) (placed.push(i), label(i));
  }
  return svg;
}
function linesSvg(c: Lines) {
  const W = 340,
    H = 120,
    x0 = 4,
    x1 = W - 4,
    y0 = 6,
    y1 = H - 20,
    n = c.labels.length,
    max = Math.max(1, ...c.series.flatMap(sr => sr.values.map(v => v ?? 0))),
    X = (i: number) => x0 + ((i + 0.5) * (x1 - x0)) / n,
    Y = (v: number) => y1 - (v / max) * (y1 - y0),
    svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": c.title || "Chart" });
  svg.appendChild(s("line", { x1: x0, x2: x1, y1, y2: y1, class: "askAxis" }));
  for (const sr of c.series) {
    const g = s("g", { class: sr.ref ? "askSeries ref" : `askSeries t${sr.tone % 4}` });
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) g.appendChild(s("polyline", { points: run.join(" ") }));
      run = [];
    };
    sr.values.forEach((v, i) => {
      if (v == null) return flush();
      run.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
      if (!sr.ref) {
        const dot = s("circle", { cx: X(i), cy: Y(v), r: 4, class: "askDot" });
        tip(dot, `${sr.name}, ${c.labels[i] ?? ""}: ${big(v)}`);
        g.appendChild(dot);
      }
    });
    flush();
    svg.appendChild(g);
  }
  c.labels.forEach((l, i) => svg.appendChild(s("text", { x: X(i), y: H - 5, "text-anchor": "middle" }, n === 12 ? l.slice(0, 1) : l)));
  return svg;
}
function spark(vals: number[]) {
  const max = Math.max(1, ...vals),
    w = 4,
    gap = 2,
    svg = s("svg", { class: "askSpark", viewBox: `0 0 ${vals.length * (w + gap)} 20`, "aria-hidden": "true" });
  vals.forEach((v, i) => {
    const hgt = Math.max(v > 0 ? 1.5 : 0.6, (v / max) * 18);
    svg.appendChild(
      s("rect", { x: i * (w + gap), y: 20 - hgt, width: w, height: hgt, class: i >= vals.length - 3 ? "askBar hi" : "askBar" }),
    );
  });
  return svg;
}
function chartEl(c: Bars | Lines) {
  const fig = h("figure", "askChart"),
    cap = h("figcaption");
  cap.appendChild(h("span", "", c.title));
  if (c.type === "bars" && (c.ref || c.refLine != null)) {
    const key = h("span", "askKey");
    key.append(h("i", c.ref ? "ln" : "dash"), c.refLabel);
    cap.appendChild(key);
  }
  fig.appendChild(cap);
  fig.appendChild(c.type === "lines" ? linesSvg(c) : barsSvg(c));
  if (c.type === "lines") {
    const leg = h("div", "askLegend");
    for (const sr of c.series) {
      const k = h("span", "askKey");
      k.append(h("i", sr.ref ? "dash" : `t${sr.tone % 4}`), sr.name);
      leg.appendChild(k);
    }
    fig.appendChild(leg);
  }
  return fig;
}

/* ---------- cards ---------- */
export type CardHooks = { go: (p: Place) => void; focus: (name: string, b: Box) => void };
export function cardEl(c: Card, hooks: CardHooks) {
  const card = h("article", "askCard"),
    head = h("header"),
    titles = h("div");
  if (c.eyebrow) titles.appendChild(h("p", "askEye", c.eyebrow));
  titles.appendChild(h("h4", "", c.title));
  head.appendChild(titles);
  if (c.badge) head.appendChild(h("span", `askBadge ${c.badge.tone}`, c.badge.text));
  card.appendChild(head);
  if (c.big) {
    const b = h("p", "askBig");
    b.append(h("b", "", c.big.value), h("span", "", c.big.caption));
    card.appendChild(b);
  }
  if (c.chart) card.appendChild(chartEl(c.chart));
  if (c.table) {
    const wrap = h("div", "askScroll"),
      t = h("table", c.table.plain ? "askTable plain" : "askTable"),
      tr = h("tr");
    c.table.head.forEach((x, i) => {
      const th = h("th");
      if (i && !c.table!.plain) th.appendChild(h("i", `t${(i - 1) % 4}`));
      th.append(x);
      tr.appendChild(th);
    });
    t.appendChild(h("thead")).appendChild(tr);
    const body = t.appendChild(h("tbody"));
    c.table.rows.forEach((r, k) => {
      const row = body.appendChild(h("tr"));
      r.forEach((x, i) => {
        if (i) return row.appendChild(h("td", "", x));
        const th = row.appendChild(h("th"));
        if (c.table!.plain) th.appendChild(h("span", "n", String(k + 1)));
        th.append(x);
      });
    });
    wrap.appendChild(t);
    card.appendChild(wrap);
  }
  if (c.rank) {
    card.appendChild(h("p", "askRankT", c.rank.title));
    const ol = h("ol", "askRank");
    c.rank.items.forEach((it, i) => {
      const li = ol.appendChild(h("li")),
        row = it.b ? h("button", "askRow") : h("div", "askRow");
      if (it.b && row instanceof HTMLButtonElement) {
        const b = it.b;
        row.type = "button";
        row.title = `Show ${it.name} on the map`;
        row.onclick = () => hooks.focus(it.name, b);
      }
      const who = h("span", "who");
      who.append(h("b", "", it.name));
      if (it.sub) who.appendChild(h("small", "", it.sub));
      row.append(h("span", "n", String(i + 1)), who);
      if (it.spark.length) row.appendChild(spark(it.spark));
      const val = h("span", "val");
      val.appendChild(h("b", "", it.value));
      if (it.chip) val.appendChild(h("span", `askBadge ${it.chip.tone}`, it.chip.text));
      row.appendChild(val);
      li.appendChild(row);
    });
    card.appendChild(ol);
  }
  if (c.rows.length) {
    const dl = h("dl", "askRows");
    for (const r of c.rows) {
      const d = dl.appendChild(h("div"));
      d.append(h("dt", "", r.k), h("dd", r.tone ?? "", r.v));
    }
    card.appendChild(dl);
  }
  if (c.foot) card.appendChild(h("p", "askFoot", c.foot));
  if (c.go) {
    const p = c.go,
      go = h("button", "askGo", "Show it on the page");
    go.type = "button";
    go.onclick = () => hooks.go(p);
    card.appendChild(go);
  }
  return card;
}

/* ---------- the answer text: a small safe subset of Markdown (paragraphs, lists, bold) plus web links (https only) ---------- */
const INLINE = /\*\*([^*\n]+)\*\*|(https:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
function inline(parent: HTMLElement, line: string) {
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) parent.append(line.slice(at, i));
    if (m[1] != null) parent.appendChild(h("b", "", m[1]));
    else {
      const a = h("a", "", m[2]);
      a.href = m[2];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      parent.appendChild(a);
    }
    at = i + m[0].length;
  }
  if (at < line.length) parent.append(line.slice(at));
}
export function prose(box: HTMLElement, raw: string) {
  box.textContent = "";
  let ul: HTMLElement | null = null;
  for (const lineRaw of raw.split("\n")) {
    const line = lineRaw.trim(),
      item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      if (!ul) ul = box.appendChild(h("ul"));
      inline(ul.appendChild(h("li")), item[1]);
      continue;
    }
    ul = null;
    if (line) inline(box.appendChild(h("p")), line.replace(/^#+\s*/, ""));
  }
}
