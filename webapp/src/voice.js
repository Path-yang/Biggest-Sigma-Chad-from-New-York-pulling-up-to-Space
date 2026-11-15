/* Voice for the copilot: mints a short-lived OpenAI Realtime key for the browser.
   The browser then talks to OpenAI directly over WebRTC. The voice model has one tool,
   ask_hotspotters, which the page answers by asking the DeepSeek copilot, so every figure
   it speaks comes from the same fire record and the map and cards update as usual. */

const INSTRUCTIONS = `You are the voice of HotSpotters, a fire observability service for emergency response teams. The user is talking to you while looking at a world map of satellite fire detections ("hotspots") from November 2000 to October 2026.
- For anything about fire, places, dates, trends, outlooks, comparisons, population or the data itself, call ask_hotspotters with the user's question rewritten as one complete, self-contained question (include the place and period they mean, and "this area" if they refer to what is selected or on screen). Then speak the answer it returns.
- Never state a number, place ranking or fact about fire that did not come from ask_hotspotters.
- Speak briefly: one to three sentences, the takeaway first. The screen shows the details, so say "I've put the details on screen" rather than reading tables aloud. Round numbers when speaking ("about sixteen hundred").
- While waiting for the tool, you may say a few words such as "Let me check."
- If the request is unclear, ask one short question. Reply in the user's language. Be calm and direct; these are responders at work.`;

const TOOL = {
  type: "function",
  name: "ask_hotspotters",
  description: "Answers any question about fire activity anywhere on Earth from 2000 to 2026, outlooks for coming months, comparisons, population in watch areas, and how the data works. Also moves the map and shows result cards on screen.",
  parameters: { type: "object", properties: { question: { type: "string", description: "The user's question as one complete sentence, with place and period." } }, required: ["question"] },
};

export async function voiceSession(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const origin = request.headers.get("origin") || "";
  if (origin && !/^https:\/\/nasa\.ojassurana\.com$|^http:\/\/localhost(:\d+)?$/.test(origin)) return new Response("Forbidden", { status: 403 });
  if (!env.OPENAI_API_KEY) return Response.json({ error: "Voice is not configured." }, { status: 503 });
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL,
        instructions: INSTRUCTIONS,
        tools: [TOOL],
        tool_choice: "auto",
        audio: {
          input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad", eagerness: "medium" } },
          output: { voice: env.OPENAI_REALTIME_VOICE },
        },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.value) {
    console.error("realtime session", res.status, JSON.stringify(body).slice(0, 500));
    return Response.json({ error: "Voice could not start.", detail: body.error && body.error.message }, { status: 502 });
  }
  return Response.json({ key: body.value, model: env.OPENAI_REALTIME_MODEL, expires_at: body.expires_at }, { headers: { "cache-control": "no-store" } });
}
