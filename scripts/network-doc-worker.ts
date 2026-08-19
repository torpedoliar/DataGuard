import "dotenv/config";
import { syncNetworkDocs, resolveNetworkDocConfig } from "@/lib/network-doc";
import { logAuditManual } from "@/lib/audit";

// One-shot (--sync-once) or the scheduled loop worker. Loop mode is what the
// docker service runs; the one-shot is the manual CLI path (and what tests
// exercise). Never run against a site id we cannot parse: the worker has
// restart: always, so a misconfigured interval must not crash-loop it.

const SYNC_ONCE = process.argv.includes("--sync-once");
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOnce(): Promise<void> {
  const config = await resolveNetworkDocConfig();
  const siteId = config.siteId;
  if (!config.url || !config.apiKey || siteId === null || !Number.isInteger(siteId)) {
    console.log(
      "[network-doc] not configured — atur di Settings › Network Docs " +
        "(URL + API key + Site ID), atau set NETWORK_DOC_URL / NETWORK_DOC_API_KEY / NETWORK_DOC_SITE_ID di .env. Skipping.",
    );
    return;
  }

  const summary = await syncNetworkDocs(siteId);
  console.log(
    `[network-doc] site ${config.siteId}: ${summary.switchesMatched}/${summary.switchesTotal} switches matched, ` +
      `vlans +${summary.vlansCreated}/~${summary.vlansUpdated}, ports +${summary.portsCreated}/~${summary.portsUpdated}`,
  );
  for (const warning of summary.warnings) {
    console.log(`[network-doc] warning: ${warning}`);
  }

  await logAuditManual({
    action: "UPDATE",
    entity: "network_port",
    entityName: "Network Doc Sync",
    siteId: config.siteId,
    detail: JSON.stringify(summary),
  });
}

async function loop() {
  while (true) {
    const config = await resolveNetworkDocConfig();
    const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
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
