// Diagnostic: why aren't SIEM findings reaching Telegram?
// Walks every gate in queueSiemTelegramAlerts() against recent findings and
// dumps the alert queue state. Run inside container:
//   docker cp scripts/check-siem-alert.js dccheck_app:/app/scripts/check-siem-alert.js
//   docker exec dccheck_app node scripts/check-siem-alert.js
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

const RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 };

async function main() {
  const url = buildDatabaseUrl();
  console.log("DB:", url.replace(/:[^:@]*@/, ":***@"));
  const pool = new Pool({ connectionString: url });

  const settings = (await pool.query(
    "select alert_min_severity from siem_settings order by id limit 1",
  )).rows[0];
  const minSeverity = settings?.alert_min_severity ?? "High";
  console.log("alert_min_severity:", minSeverity, "(rank", RANK[minSeverity] + ")");

  // Alert queue overview.
  const queue = (await pool.query(
    "select status, count(*)::int n from siem_alerts where channel='telegram' group by status order by status",
  )).rows;
  console.log("\nsiem_alerts (telegram) by status:");
  if (!queue.length) console.log("  (none)");
  for (const q of queue) console.log("  " + q.status + ":", q.n);

  // Any stuck failed/pending? Show them.
  const stuck = (await pool.query(
    `select id, finding_id, status, sent_at, left(coalesce(error,''),120) err, created_at
     from siem_alerts where channel='telegram' and status in ('pending','failed')
     order by created_at desc limit 20`,
  )).rows;
  if (stuck.length) {
    console.log("\nStuck telegram alerts (pending/failed):");
    for (const a of stuck) {
      console.log(`  alert#${a.id} finding#${a.finding_id} ${a.status} created=${a.created_at?.toISOString?.() ?? a.created_at}`);
      if (a.err) console.log("    error:", a.err);
    }
  }

  // Walk gates for recent non-resolved findings (last 3 days).
  const findings = (await pool.query(
    `select f.id, f.title, f.severity, f.status, f.last_seen_at, f.created_at,
            f.rule_id, r.alert_enabled, f.site_id, s.name site_name, s.telegram_chat_id,
            (select count(*)::int from siem_alerts a where a.finding_id=f.id and a.channel='telegram') tg_alerts
     from siem_findings f
     left join siem_rules r on r.id=f.rule_id
     left join sites s on s.id=f.site_id
     where f.status <> 'Resolved' and f.last_seen_at > now() - interval '3 days'
     order by f.last_seen_at desc limit 30`,
  )).rows;

  console.log(`\nRecent non-resolved findings (last 3 days): ${findings.length}`);
  for (const f of findings) {
    const reasons = [];
    if (!f.rule_id) reasons.push("no rule linked");
    else if (!f.alert_enabled) reasons.push("rule.alert_enabled=false");
    if (RANK[f.severity] < RANK[minSeverity]) reasons.push(`severity ${f.severity} < min ${minSeverity}`);
    if (f.tg_alerts > 0) reasons.push(`already has ${f.tg_alerts} telegram alert row(s) -> never re-queued`);
    if (!f.site_id) reasons.push("no site linked");
    else if (!f.telegram_chat_id) reasons.push(`site "${f.site_name}" has no telegram_chat_id`);

    const verdict = reasons.length ? "BLOCKED: " + reasons.join("; ") : "OK -> should queue";
    console.log(`  finding#${f.id} [${f.severity}/${f.status}] "${f.title}" site=${f.site_name ?? "-"}`);
    console.log("    " + verdict);
  }

  await pool.end();
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
