// PHASE 1 DIAGNOSTIC — capture the REAL provider content that fails to parse,
// and run a copy of the current extractor against it to discriminate:
//   - extractor OK here but prod fails -> stale deployment chunk (root cause = build)
//   - extractor FAILS here             -> real extractor bug (we now have the bytes)
//
// No rebuild needed. Run inside container:
//   docker cp scripts/debug-siem-ai-content.js dccheck_app:/app/scripts/debug-siem-ai-content.js
//   docker exec dccheck_app node scripts/debug-siem-ai-content.js
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

// EXACT copy of the current production extractor (keep in sync to test it).
function extractFirstJsonObject(content) {
  const trimmed = content.trim();
  try {
    return { value: JSON.parse(trimmed), path: "direct" };
  } catch {}
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return { value: JSON.parse(fenced.trim()), path: "fenced" };
  } catch {}
  const source = fenced;
  const start = source.indexOf("{");
  if (start === -1) throw new Error("no JSON object");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { value: JSON.parse(source.slice(start, i + 1)), path: "balanced@" + (i + 1) };
    }
  }
  throw new Error("unbalanced JSON object");
}

async function main() {
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

  // Realistic prompt that elicits a LARGE strict-JSON response, mirroring the
  // real SIEM analysis request (5 keys, arrays, detailed evidence).
  const prompt = [
    "You are a defensive SIEM analyst. Return strict JSON with keys: summary, likelyCause, impact, recommendedActions, evidence.",
    "recommendedActions and evidence must be arrays of strings. Be detailed and thorough with at least 6 evidence items.",
    "Finding: Power supply failure on CORE SWITCH X930, severity Critical, 1 event observed.",
    "Provide a comprehensive analysis as json.",
  ].join("\n");

  console.log("POST", ep, "model", s.ai_default_model);
  const resp = await fetch(ep, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: s.ai_default_model,
      messages: [
        { role: "system", content: "You produce evidence-only defensive SIEM analysis as strict JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  console.log("HTTP", resp.status, "content-type:", resp.headers.get("content-type"));

  // Read the RAW body first — the failure is in parsing THIS envelope.
  const rawBody = await resp.text();
  fs.writeFileSync("/tmp/siem-raw-body.txt", rawBody);
  console.log("raw body length:", rawBody.length);
  try {
    JSON.parse(rawBody);
    console.log("ENVELOPE JSON.parse: OK");
  } catch (e) {
    console.log("ENVELOPE JSON.parse: FAILS ->", e.message, "  <<< THIS is the real bug");
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const p = Number(m[1]);
      console.log("---- envelope bytes around", p, "----");
      console.log(JSON.stringify(rawBody.slice(Math.max(0, p - 80), p + 80)));
      console.log("---- char codes at boundary ----");
      console.log([...rawBody.slice(p - 2, p + 6)].map((c) => c.charCodeAt(0)));
    }
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.log("\nCannot use envelope as-is; raw body saved to /tmp/siem-raw-body.txt");
    return;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    console.log("NO STRING CONTENT. Full response:");
    console.log(JSON.stringify(data, null, 2).slice(0, 1500));
    return;
  }

  fs.writeFileSync("/tmp/siem-content.txt", content);
  console.log("content length:", content.length);
  console.log("---- first 120 chars ----");
  console.log(JSON.stringify(content.slice(0, 120)));
  console.log("---- last 200 chars ----");
  console.log(JSON.stringify(content.slice(-200)));

  // Does a naive parse reproduce the prod error?
  try {
    JSON.parse(content);
    console.log("NAIVE JSON.parse: OK (so trailing text is NOT the issue here)");
  } catch (e) {
    console.log("NAIVE JSON.parse: FAILS ->", e.message);
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const p = Number(m[1]);
      console.log("---- bytes around position", p, "----");
      console.log(JSON.stringify(content.slice(Math.max(0, p - 60), p + 60)));
    }
  }

  // Does the CURRENT extractor handle it?
  try {
    const r = extractFirstJsonObject(content);
    console.log("EXTRACTOR: OK via", r.path, "-> keys:", Object.keys(r.value));
    console.log(">> If prod still fails on this, root cause = STALE DEPLOYMENT, not the code.");
  } catch (e) {
    console.log("EXTRACTOR: FAILS ->", e.message);
    console.log(">> Real extractor bug. Full content saved to /tmp/siem-content.txt");
  }
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
