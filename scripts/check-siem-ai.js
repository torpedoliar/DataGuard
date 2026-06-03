// Diagnostic: dump siem_settings AI config (key masked) + live provider test.
// Run inside container:  docker exec dccheck_app node scripts/check-siem-ai.js
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

  // Live test using EXACTLY what is stored in the DB.
  const s = r.rows[0];
  if (s && s.ai_endpoint_url && s.ai_default_model) {
    let ep = String(s.ai_endpoint_url).trim().replace(/\/+$/, "");
    if (!ep.endsWith("/chat/completions")) ep += "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (s.full_key && s.full_key.trim()) headers.Authorization = "Bearer " + s.full_key.trim();
    console.log("\nLive test ->", ep, "(auth:", headers.Authorization ? "yes" : "no", ")");
    try {
      const resp = await fetch(ep, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: s.ai_default_model,
          messages: [{ role: "user", content: "say hi" }],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });
      const text = await resp.text();
      console.log("STATUS:", resp.status);
      console.log("BODY:", text.slice(0, 600));
    } catch (e) {
      console.log("FETCH ERROR:", e.message);
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
