// SIEM AI ROUTER DIAGNOSTIC — capture exactly what the configured
// OpenAI-compatible router returns for the request the app sends. The current
// parser accepts chat.completion envelopes, SSE, Responses API shapes, and
// Anthropic content blocks; this script prints the raw shape so any remaining
// incompatibility is visible without guessing.
//
// No rebuild needed. Run inside the container:
//   docker cp scripts/debug-siem-ai-content.js dccheck_app:/app/scripts/debug-siem-ai-content.js
//   docker exec dccheck_app node scripts/debug-siem-ai-content.js
//
// Routers that only accept stream:true:
//   docker exec dccheck_app node scripts/debug-siem-ai-content.js --stream
const fs = require("fs");
const { Pool } = require("pg");

function buildDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const host = env.DB_HOST || "localhost";
  const port = env.DB_PORT || "5432";
  const user = env.DB_USER || "postgres";
  const password = env.DB_PASSWORD || "postgres";
  const name = env.DB_NAME || "dccheck";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

async function main() {
  const forceStream = process.argv.includes("--stream");
  const pool = new Pool({ connectionString: buildDatabaseUrl() });
  const [s] = (await pool.query(
    "select ai_endpoint_url, ai_default_model, ai_api_key from siem_settings order by id limit 1",
  )).rows;
  await pool.end();
  if (!s) { console.log("no siem_settings row"); return; }

  let ep = String(s.ai_endpoint_url).trim().replace(/\/+$/, "");
  if (!ep.endsWith("/chat/completions")) ep += "/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (s.ai_api_key && s.ai_api_key.trim()) headers.Authorization = "Bearer " + s.ai_api_key.trim();

  // Realistic prompt that elicits a strict-JSON answer, mirroring the app.
  const prompt = [
    "You are a defensive SIEM analyst. Return strict JSON with keys: summary, likelyCause, impact, recommendedActions, evidence.",
    "recommendedActions and evidence must be arrays of strings.",
    "Finding: Power supply failure on CORE SWITCH X930, severity Critical, 1 event observed.",
    "Provide a concise analysis as json.",
  ].join("\n");

  // Same minimal body the app sends: no temperature, no response_format.
  const body = {
    model: s.ai_default_model,
    messages: [
      { role: "system", content: "You produce evidence-only defensive SIEM analysis as strict JSON." },
      { role: "user", content: prompt },
    ],
    stream: forceStream,
  };

  console.log("POST", ep, "model", s.ai_default_model, "stream", forceStream);
  const resp = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
  console.log("HTTP", resp.status, "content-type:", resp.headers.get("content-type"));

  const raw = await resp.text();
  fs.writeFileSync("/tmp/siem-raw-body.txt", raw);
  console.log("raw body length:", raw.length, "(saved to /tmp/siem-raw-body.txt)");
  console.log("---- first 1200 chars ----");
  console.log(raw.slice(0, 1200));

  console.log("---- detected shape ----");
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:") || trimmed.includes("\ndata:")) {
    console.log("SSE stream: data: event lines");
  }
  try {
    const parsed = JSON.parse(trimmed);
    console.log("single JSON object, keys:", Object.keys(parsed).join(", "));
    if (Array.isArray(parsed.choices)) {
      const choice = parsed.choices[0] || {};
      console.log("choices[0] keys:", Object.keys(choice).join(", "));
      console.log("message keys:", choice.message ? Object.keys(choice.message).join(", ") : "(none)");
      console.log("finish_reason:", choice.finish_reason);
    }
    if (parsed.error) console.log("provider error:", JSON.stringify(parsed.error).slice(0, 300));
    if (typeof parsed.output_text === "string") console.log("OpenAI Responses shape (output_text)");
    if (Array.isArray(parsed.output)) console.log("OpenAI Responses shape (output[])");
    if (Array.isArray(parsed.content) || typeof parsed.content === "string") {
      console.log("content-block / unwrapped shape");
    }
  } catch {
    console.log("body is not a single JSON document (SSE or concatenated)");
  }
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
