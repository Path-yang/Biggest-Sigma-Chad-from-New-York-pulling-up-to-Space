// Ask the deployed copilot one question and print what comes back.
const q = process.argv[2], ctx = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const ws = new WebSocket(`wss://nasa.ojassurana.com/agents/fire-copilot/test-${Date.now()}`);
const t0 = Date.now(); let text = "";
ws.onopen = () => {};
ws.onmessage = e => {
  let m; try { m = JSON.parse(e.data); } catch { return; }
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  if (m.type === "hello") ws.send(JSON.stringify({ type: "chat", text: q, context: ctx }));
  else if (m.type === "status") console.log(`[${t}s] status: ${m.text}`);
  else if (m.type === "card") console.log(`[${t}s] card: ${m.card.kind} | ${m.card.eyebrow} | ${m.card.title} | ${m.card.big?.value || ""} ${m.card.big?.caption || ""}`);
  else if (m.type === "action") console.log(`[${t}s] action: ${m.action.type} | ${m.action.toast}`);
  else if (m.type === "delta") text += m.text;
  else if (m.type === "retract") text = "";
  else if (m.type === "error") console.log(`[${t}s] ERROR: ${m.message}`);
  else if (m.type === "done") { console.log(`[${t}s] answer: ${text}`); ws.close(); }
};
ws.onerror = e => { console.log("socket error", e.message || e); process.exit(1); };
setTimeout(() => { console.log("timeout; partial:", text); process.exit(1); }, 60000);
