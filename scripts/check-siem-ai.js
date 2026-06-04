// Diagnostic: dump siem_settings AI config (key masked) + live provider test.
// Run inside container:  docker exec dccheck_app node scripts/check-siem-ai.js
//
// The live test mirrors the SHIPPED app logic (lib/siem/ai-analysis.ts): it
// sends the optional OpenAI-style tuning params, then drops whichever the
// gateway rejects on a 400 and retries. This makes one config work across any
// swapped-in model — DeepSeek (takes temperature + response_format), Anthropic
// (claude-opus-4-8 rejects `temperature`), GPT, Gemini, etc. Keep in sync.
const { Pool } = require("pg");

// Optional params different backends accept different subsets of. A gateway 400
// names the offending field in backticks, e.g. "`temperature` is deprecated for
// this model." — pull those out, drop them, retry. Bounded by param count.
const OPTIONAL_REQUEST_PARAMS = ["temperature", "response_format"];
function offendingParamsFromError(body) {
  const lowered = String(body).toLowerCase();
  return OPTIONAL_REQUEST_PARAMS.filter((p) => lowered.includes("`" + p + "`"));
}

// POST with adaptive param-stripping retry (mirror of requestSiemAiAnalysis).
// Returns { status, body, dropped, attempts }.
async function postWithAdaptiveRetry(ep, headers, baseBody) {
  const dropped = new Set();
  let last = { status: 0, body: "" };
  for (let attempt = 0; attempt <= OPTIONAL_REQUEST_PARAMS.length; attempt += 1) {
    const body = { ...baseBody };
    for (const p of dropped) delete body[p];
    const resp = await fetch(ep, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await resp.text();
    last = { status: resp.status, body: text };
    if (resp.ok) return { ...last, dropped: [...dropped], attempts: attempt + 1 };
    if (resp.status === 400) {
      const offending = offendingParamsFromError(text).filter((p) => !dropped.has(p));
      if (offending.length > 0) {
        for (const p of offending) dropped.add(p);
        continue; // retry without the rejected param(s)
      }
    }
    break; // non-400, or 400 we can't fix by dropping a known param
  }
  return { ...last, dropped: [...dropped], attempts: OPTIONAL_REQUEST_PARAMS.length + 1 };
}

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
  const url = buildDatabaseUrl();
  console.log("DB:", url.replace(/:[^:@]*@/, ":***@"));
  const pool = new Pool({ connectionString: url });

  const count = await pool.query("select count(*)::int n from siem_settings");
  console.log("siem_settings rows:", count.rows[0].n);

  const r = await pool.query(
    `select id, ai_enabled, ai_endpoint_url, ai_default_model,
            length(ai_api_key) as key_len, left(ai_api_key, 8) as key_head,
            ai_api_key as full_key
     from siem_settings order by id`,
  );
  for (const row of r.rows) {
    console.log("----- row id", row.id, "-----");
    console.log("  ai_enabled      :", row.ai_enabled);
    console.log("  ai_endpoint_url :", JSON.stringify(row.ai_endpoint_url));
    console.log("  ai_default_model:", JSON.stringify(row.ai_default_model));
    console.log("  key_len         :", row.key_len);
    console.log("  key_head        :", row.key_head);
  }

  // Live tests using stored DB config, varying the prompt wording.
  const s = r.rows[0];
  if (s && s.ai_endpoint_url && s.ai_default_model) {
    let ep = String(s.ai_endpoint_url).trim().replace(/\/+$/, "");
    if (!ep.endsWith("/chat/completions")) ep += "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (s.full_key && s.full_key.trim()) headers.Authorization = "Bearer " + s.full_key.trim();

    const cases = [
      { label: "CAPITAL JSON (like real app)", sys: "You produce evidence-only defensive SIEM analysis as strict JSON.", user: "Return strict JSON with keys: summary. say hi" },
      { label: "lowercase json", sys: "Respond only with json.", user: "Return a json object that says hi" },
    ];
    for (const c of cases) {
      console.log("\nLive test [" + c.label + "] ->", ep);
      try {
        const result = await postWithAdaptiveRetry(ep, headers, {
          model: s.ai_default_model,
          messages: [{ role: "system", content: c.sys }, { role: "user", content: c.user }],
          temperature: 0.2,
          response_format: { type: "json_object" },
        });
        console.log("STATUS:", result.status, "(attempts:", result.attempts + ")");
        if (result.dropped.length) console.log("DROPPED PARAMS:", result.dropped.join(", "));
        console.log("BODY:", result.body.slice(0, 400));
      } catch (e) {
        console.log("FETCH ERROR:", e.message);
      }
    }
  } else {
    console.log("\nSkipping live test: endpoint or model missing in DB.");
  }

  await pool.end();
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
