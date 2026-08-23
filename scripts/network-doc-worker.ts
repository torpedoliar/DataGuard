import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { syncNetworkDocs, resolveNetworkDocConfig, resolveNetworkDocWorkerInterval } from "@/lib/network-doc";
import { logAuditManual } from "@/lib/audit";

// One-shot (--sync-once) or the scheduled loop worker. Loop mode is what the
// docker service runs; the one-shot is the manual CLI path. Since each site
// may point at its own network-doc API, every configured site is synced on
// each pass — sites without a URL/key are skipped, never crash.

const SYNC_ONCE = process.argv.includes("--sync-once");
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOnce(): Promise<void> {
  const allSites = await db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.isActive, true));

  let synced = 0;
  for (const site of allSites) {
    const config = await resolveNetworkDocConfig(site.id);
    if (!config.url || !config.apiKey) continue;

    const summary = await syncNetworkDocs(site.id);
    // A lock-busy skip returns switchesTotal 0 + a "sync lain sedang berjalan"
    // warning: log it, but don't count it as synced or write an audit row —
    // the run that holds the lock logs its own.
    if (summary.switchesTotal === 0 && summary.warnings.some((w) => w.includes("sync lain sedang berjalan"))) {
      console.log(`[network-doc] site "${site.name}": skipped — another sync is running`);
      continue;
    }
    synced++;
    console.log(
      `[network-doc] site "${site.name}": ${summary.switchesMatched}/${summary.switchesTotal} switches matched, ` +
        `vlans +${summary.vlansCreated}/~${summary.vlansUpdated}, ports +${summary.portsCreated}/~${summary.portsUpdated}`,
    );
    for (const warning of summary.warnings) {
      console.log(`[network-doc] site "${site.name}" warning: ${warning}`);
    }

    await logAuditManual({
      action: "UPDATE",
      entity: "network_port",
      entityName: "Network Doc Sync",
      siteId: site.id,
      detail: JSON.stringify(summary),
    });
  }

  if (synced === 0) {
    console.log(
      "[network-doc] no sites configured — atur per-site di Settings › Network Docs (URL + API key per site). Skipping.",
    );
  }
}

async function loop() {
  while (true) {
    const storedInterval = await resolveNetworkDocWorkerInterval();
    // Clamp so a typo'd stored/env interval can never tight-loop the worker.
    const intervalMs = Math.max(storedInterval || DEFAULT_INTERVAL_MS, 60_000);
    try {
      await runOnce();
    } catch (error) {
      console.error("[network-doc] sync failed:", error);
    }
    await sleep(intervalMs);
  }
}

if (require.main === module) {
  if (SYNC_ONCE) {
    runOnce()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  } else {
    void loop().catch((error) => {
      console.error("[network-doc] worker exited:", error);
      process.exit(1);
    });
  }
}