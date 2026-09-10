#!/usr/bin/env tsx
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { runHeartbeatAllSites, ncmHeartbeatDeps } from "@/lib/ncm-heartbeat";

// One-shot (--run-once) or the scheduled loop worker (pattern:
// scripts/network-doc-worker.ts). Every configured site is pinged per pass —
// sites without a URL/key are skipped by the domain layer, never crash; a
// per-site crash is caught and the pass continues with the next site.

dotenv.config();

const runOnce = process.argv.includes("--run-once");
// ponytail: single global interval; per-site intervals if ops ever asks.
const intervalMs = Math.max(Number(process.env.NCM_HEARTBEAT_INTERVAL_MS ?? 5 * 60_000), 60_000);
const log = (line: string) => console.log(`[ncm-heartbeat] ${line}`);

export async function runHeartbeatOnce(): Promise<number> {
    const activeSites = await db.select({ id: sites.id, name: sites.name })
        .from(sites).where(eq(sites.isActive, true));

    const results = await runHeartbeatAllSites(ncmHeartbeatDeps, { sites: activeSites });
    for (const r of results) {
        if (!r.configured) continue;
        log(`site ${r.siteId}: ${r.ok ? "online" : `miss=${r.missCount} status=${r.status}`}${r.error ? ` — ${r.error.slice(0, 120)}` : ""}`);
        if (r.incidentCreated) log(`site ${r.siteId}: OFFLINE after ${r.missCount} misses — incident #${r.incidentId} filed.`);
        if (r.ok && r.status === "online") void r; // recovery close is logged by the incident layer
    }
    if (results.every((r) => !r.configured)) {
        log("no sites configured — atur per-site di Settings › NCM Connection.");
    }
    return results.filter((r) => r.configured).length;
}

async function loop() {
    log(`worker started. Polling every ${intervalMs / 1000}s...`);
    while (true) {
        try {
            await runHeartbeatOnce();
        } catch (error) {
            console.error("[ncm-heartbeat] pass failed:", error);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

if (require.main === module) {
    const run = runOnce ? runHeartbeatOnce().then((n) => log(`run-once finished. Checked ${n} site(s).`)) : loop();
    void run.catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
