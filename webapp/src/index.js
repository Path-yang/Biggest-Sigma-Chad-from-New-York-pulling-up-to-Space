/* HotSpotters copilot: a Cloudflare Agent (one Durable Object per conversation) that answers
   questions about fire activity with DeepSeek and a small set of tools over the site's own data.

   Browser <-> agent messages (JSON over the agent WebSocket):
     in   { type: "chat", text, context }      context = { selection, view, layer }
     in   { type: "reset" }
     out  { type: "hello", transcript }        on connect, to restore the conversation
     out  { type: "status", text }             what the agent is doing right now
     out  { type: "card", card }               a result card (see tools.js)
     out  { type: "action", action }           a map action: goto | outline | highlight
     out  { type: "delta", text }              the answer, streamed
     out  { type: "done" } | { type: "error", message }
*/
import { Agent, routeAgentRequest } from "agents";
import { TOOLS, toolSchemas, ToolError } from "./tools.js";
import { measure, worldSeries } from "./data.js";
import { runAnalysis, FireApi } from "./analysis.js";
import { voiceSession } from "./voice.js";
export { FireApi };

const MAX_STEPS = 8, MAX_TURNS_KEPT = 8, MAX_MESSAGES = 80;

const SYSTEM = `You are the HotSpotters copilot, an assistant for fire emergency response teams. You answer questions about fire activity anywhere on Earth from a satellite record that runs from November 2000 to October 2026 (the latest complete month). Today is 15 November 2026.

How to work
- Use the tools for every number. Never state a hotspot count, rank, percentage or population from memory.
- The tools accept place names directly, so call the data tool straight away. Write places with context, e.g. "Los Angeles County, California" or "Punjab, India". Use find_place only when a tool reports several places with the same name and the user's meaning is unclear.
- "here", "this area", "this region" mean place "selection". If nothing is selected and the user means what is on screen, use place "view".
- Pick one tool per question where possible: area_report for a specific month or year or "now"; area_history for worst, most unusual, trend and fire season; compare for place against place or year against year; outlook for anything in the future or "where should I watch"; population_exposure for people living in watch areas (US states only).
- For anything those do not cover (ranking the parts of a place for a past period, sums over several places, thresholds, custom spans), use run_analysis and write the code. Do not tell the user a data question is out of scope before trying it.
- If a tool says it corrected a spelling, carry on with the corrected place.
- Trust tool results. Do not call further tools to double-check a result you already have; every tool call shows a card to the user, so make only the calls the answer needs (usually one). In run_analysis, do all the working in a single program and include a table only when it is worth showing.
- Months after October 2026 have no data. For them use outlook, and say it is an estimate from past years, not a weather forecast.
- If a place has other matches with the same name, say in a few words which one you used.

Free-form and opinion questions
- Answer every question. People will type loosely ("most dangerous place here", "where will it burn next month", "is it bad right now"). Work out what they most likely mean, say the assumption in a few words, and answer with data.
- "Dangerous", "worst", "at risk", "bad" mean the most fire activity in this record (or the most unusual, if they ask about change). Say that this is what you measured; you cannot see homes, wind or terrain.
- "In your opinion" or "what do you think" still gets a data-backed answer, phrased as your reading of the record.
- No place given: use the selected area; if nothing is selected and the map is zoomed in (zoom 4 or more), use place "view"; otherwise answer for the whole world, by country. No period given: for the past use the latest complete month or year; for the future use the next calendar month (December 2026).
- "Where will fire happen next month / where should I look" with no place: use outlook with place "world", which ranks countries, then offer to narrow down.
- "This region / on screen / here" for a ranking: use run_analysis with fire.placesIn("view" or "selection", "states" or "districts").
- Use ask_user only when you truly cannot choose, e.g. the user names something that could be two very different places and the app state does not help.

How to answer
- Lead with the answer itself: the place, number or yes/no the user asked for, in the first sentence. Never stop at describing what you looked up or what you assumed.
- The app shows a result card with the figures and moves the map, so do not repeat every row of the card. Write 2 to 4 short sentences that give the takeaway a responder needs: what happened, how unusual it is, and one thing worth noticing.
- Plain language. Say "hotspots" and "usual" (the middle value for that time of year). No jargon about satellites or sensors unless asked. No headings, no tables; a short list only when ranking several places.
- Report what the record shows. Do not guess at causes (weather, farming, policy) or give operational advice unless the user asks; if you mention a likely cause, say it is general knowledge and not from this data.
- Be direct about uncertainty and never overstate. A hotspot is a satellite pixel flagged as burning, not a count of fires or of area burned.
- If a tool returns an error, tell the user plainly what is missing and what they could ask instead.

Facts you may use for general questions (answer these without tools)
- What a hotspot is: a spot on the ground, about 375 m across, that a satellite flagged as hot enough to be burning when it passed over. One fire usually produces many hotspots; small or short fires can be missed; cloud and smoke can hide fire; gas flares and volcanoes also appear.
- Where the data comes from: NASA's Fire Information for Resource Management System (FIRMS), which publishes detections from the MODIS instruments (since November 2000) and the sharper VIIRS instruments (since January 2012). This is not a NASA product.
- One consistent record: the newer instruments report several times more hotspots for the same fires, so the older record is scaled to match them region by region, using the years when both flew. Tested on 2012 to 2025, the scaled record tracks the newer one closely (correlation 0.997 across regions and years).
- "Usual" means the middle value (median) for that calendar month, or year, across the record.
- Outlooks: 60% the middle value of the last ten years for that month, 40% the average of the last three. They rank where fire is normally concentrated; they do not use weather, drought or fuel conditions.
- Place boundaries come from geoBoundaries (countries, states, districts) and OpenStreetMap for other places. Fire inside a boundary is counted on 5.5 km cells for small areas and 28 km cells for large ones, so small places are approximate.
- Population figures are US Census county estimates and count everyone in a county, not people near fires.
- Latest data: complete through October 2026; November 2026 is partial and the most recent months may still be revised.`;

function contextNote(ctx) {
  const parts = [];
  const s = ctx.selection;
  parts.push(s ? `Selected area: ${s.label || s.name}${s.kind === "region" ? ` (id ${s.id})` : " (drawn by the user)"}` : "Selected area: none (whole world)");
  if (ctx.view && ctx.view.bbox) parts.push(`Map view: centre ${ctx.view.lat}, ${ctx.view.lon}, zoom ${ctx.view.zoom}`);
  if (ctx.layer) parts.push(`Map shows: ${ctx.layer.year ? (ctx.layer.month >= 0 ? "month " + (ctx.layer.month + 1) + " of " : "") + ctx.layer.year : "all years"}`);
  return `[App state: ${parts.join(". ")}.]`;
}

/** One streamed chat completion. Calls onText for answer text; resolves to { content, toolCalls }. */
async function complete(env, messages, onText, useTools = true) {
  const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: env.DEEPSEEK_MODEL, messages, ...(useTools ? { tools: toolSchemas, tool_choice: "auto" } : {}), temperature: 0.3, max_tokens: 1400, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`The language model did not respond (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(), calls = [];
  let buf = "", content = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let delta;
      try { delta = JSON.parse(data).choices?.[0]?.delta; } catch { continue; }
      if (!delta) continue;
      if (delta.content) { content += delta.content; onText(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const c = calls[tc.index] || (calls[tc.index] = { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    }
  }
  return { content, toolCalls: calls.filter(Boolean) };
}

export class FireCopilot extends Agent {
  busy = false;

  async onConnect(connection) {
    const transcript = (await this.ctx.storage.get("transcript")) || [];
    connection.send(JSON.stringify({ type: "hello", transcript }));
  }

  async onMessage(connection, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const send = o => { try { connection.send(JSON.stringify(o)); } catch { /* the reader went away */ } };
    if (msg.type === "reset") { await this.ctx.storage.deleteAll(); return send({ type: "hello", transcript: [] }); }
    if (msg.type !== "chat") return;
    const text = String(msg.text || "").trim().slice(0, 600);
    if (!text) return;
    if (this.busy) return send({ type: "error", message: "Still working on the last question." });
    this.busy = true;
    try { await this.answer(text, msg.context || {}, send); }
    catch (err) { console.error(err); send({ type: "error", message: err instanceof ToolError ? err.message : "Something went wrong while answering. Please try again." }); }
    finally { this.busy = false; send({ type: "done" }); }
  }

  async answer(text, ctx, send) {
    const store = this.ctx.storage, env = this.env;
    const history = (await store.get("history")) || [], transcript = (await store.get("transcript")) || [];
    if (transcript.length >= MAX_MESSAGES) throw new ToolError("This conversation is long. Start a new chat to keep going.");
    const cards = [], actions = [];
    const T = {
      env, ctx,
      store: { get: k => store.get(k), put: (k, v) => store.put(k, v) },
      measure: shapes => measure(env, shapes),
      world: () => worldSeries(env),
      population: async () => { const r = await env.ASSETS.fetch(new Request("https://assets.local/data/b/pop_usa.json")); return r.ok ? r.json() : null; },
      analyze: code => runAnalysis(env, this.ctx.exports, ctx, code),
      ask: (question, options) => { asked = { question, options }; },
      card: c => { cards.push(c); send({ type: "card", card: c }); },
      action: a => { actions.push(a); send({ type: "action", action: a }); },
    };
    const turn = [{ role: "user", content: `${text}\n\n${contextNote(ctx)}` }];
    let reply = "", asked = null;
    for (let step = 0; step < MAX_STEPS && !asked; step++) {
      send({ type: "status", text: step ? "Putting it together" : "Thinking" });
      const out = await complete(env, [{ role: "system", content: SYSTEM }, ...history, ...turn], t => { reply += t; send({ type: "delta", text: t }); });
      if (!out.toolCalls.length) break;
      if (reply) { reply = ""; send({ type: "retract" }); }       // text before a tool call is a preamble, not the answer
      turn.push({ role: "assistant", content: out.content || "", tool_calls: out.toolCalls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })) });
      for (const call of out.toolCalls) {
        const tool = TOOLS.find(t => t.name === call.name);
        let result;
        try {
          if (!tool) throw new ToolError(`There is no tool called ${call.name}.`);
          const args = JSON.parse(call.args || "{}");
          send({ type: "status", text: tool.status(args) });
          result = await tool.run(args, T);
        } catch (err) {
          if (!(err instanceof ToolError) && !(err instanceof SyntaxError)) console.error(call.name, err);
          result = { error: err instanceof ToolError ? err.message : err instanceof SyntaxError ? "The tool arguments were not valid JSON." : "The data could not be read just now." };
        }
        turn.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    if (asked) {                                                // the copilot needs one thing from the user before it can answer
      reply = asked.question; send({ type: "delta", text: reply }); send({ type: "choices", options: asked.options });
    } else if (!reply.trim()) {                                 // ran out of steps: answer in words from whatever was gathered
      send({ type: "status", text: "Writing the answer" });
      const out = await complete(env, [{ role: "system", content: SYSTEM }, ...history, ...turn,
        { role: "user", content: "Answer my question now, in plain words, from what you have gathered. If something could not be worked out, say what, and suggest how I could ask instead. Do not call tools." }],
        t => { reply += t; send({ type: "delta", text: t }); }, false).catch(() => null);
      if (!reply.trim()) { reply = "I couldn't get a clear answer from the record for that. Try naming a place and a period, for example \"Which parts of Kenya burned most in 2024?\""; send({ type: "delta", text: reply }); }
    }

    // remember the conversation: the model sees past questions and answers, the page can redraw the cards
    const kept = [...history, { role: "user", content: text }, { role: "assistant", content: reply }].slice(-MAX_TURNS_KEPT * 2);
    transcript.push({ role: "user", text }, { role: "assistant", text: reply, cards, choices: asked ? asked.options : undefined });
    await store.put({ history: kept, transcript });
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/voice/session") return voiceSession(request, env);
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  },
};
