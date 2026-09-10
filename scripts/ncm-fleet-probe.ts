/**
 * Ticket 12 — fleet e2e probe: the real heartbeat state machine
 * (lib/ncm-heartbeat.ts checkNcmSite) driven through the real DG client
 * (lib/ncm.ts fetchNcmSwitches) against a real HTTP NCM stand-in
 * (GET /api/v1/switches, key-checked). Offline is a genuine network
 * failure: the stand-in's socket is closed, exactly like a powered-off box
 * behind the VPN. DB deps are in-memory fakes (pattern:
 * lib/ncm-heartbeat.test.ts) — the probe never touches Postgres.
 *
 * Usage: npx tsx scripts/ncm-fleet-probe.ts
 */
import http from "node:http";
import { fetchNcmSwitches } from "../lib/ncm";
import {
    checkNcmSite,
    NCM_OFFLINE_THRESHOLD,
    type NcmHeartbeatDeps,
    type NcmHeartbeatNotifyEvent,
} from "../lib/ncm-heartbeat";

const PROBE_KEY = "fleet-probe-key";

function must(ok: unknown, message: string): void {
    if (!ok) throw new Error(message);
}

/** Minimal NCM stand-in: only the heartbeat ping surface. start on a fixed
 * port so stop()/start() models "matikan / nyalakan" the same box. */
function makeNcmStandin() {
    const server = http.createServer((req, res) => {
        if (req.url !== "/api/v1/switches") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "not found" }));
            return;
        }
        if (req.headers["x-api-key"] !== PROBE_KEY) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "invalid key" }));
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
    });
    let port = 0;
    return {
        async start(): Promise<string> {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, "127.0.0.1", () => resolve());
            });
            port = (server.address() as { port: number }).port;
            return `http://127.0.0.1:${port}`;
        },
        async stop(): Promise<void> {
            await new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            });
        },
    };
}

async function main(): Promise<void> {
    const ncm = makeNcmStandin();
    let baseUrl = await ncm.start();

    // In-memory heartbeat store (ncm_settings row + offline incident) and the
    // Telegram seam fake — same shape as makeDeps in lib/ncm-heartbeat.test.ts.
    const site = { siteId: 1, siteName: "Probe Site" };
    const notifyEvents: NcmHeartbeatNotifyEvent[] = [];
    const incidents: { title: string; severity: string }[] = [];
    const resolved: { incidentId: number; note: string }[] = [];
    let row: { status: "online" | "offline"; missCount: number; lastSeenAt?: Date | null } | null = null;
    let openIncident: { id: number; title: string } | null = null;
    let nextIncidentId = 901;

    const deps: NcmHeartbeatDeps = {
        resolveNcmConfig: async () => ({ url: baseUrl, adminApiKey: PROBE_KEY }),
        pingNcm: (config) => fetchNcmSwitches(config), // the real DG client, real HTTP
        touchNcmLastSeen: async () => {},
        getHeartbeatRow: async () => row,
        setHeartbeatRow: async (_siteId, values) => {
            row = { ...row, status: values.status, missCount: values.missCount, ...(values.lastSeenAt ? { lastSeenAt: values.lastSeenAt } : {}) };
        },
        findDevicesBySite: async () => [{ id: 1, name: "SW-PROBE" }],
        findOpenOfflineIncident: async () => openIncident,
        insertIncident: async (values) => {
            incidents.push({ title: values.title, severity: values.severity });
            const created = { id: nextIncidentId++, title: values.title };
            openIncident = created;
            return created;
        },
        insertIncidentUpdate: async () => {},
        resolveIncident: async (incidentId, note) => {
            resolved.push({ incidentId, note });
            openIncident = null;
        },
        notifyEvent: async (event) => {
            notifyEvents.push({ ...event });
        },
    };

    // 1. Online: real roundtrip through the real client with the real key.
    const up = await checkNcmSite(deps, site);
    must(up.configured && up.ok && up.status === "online" && up.missCount === 0, `expected online, got ${JSON.stringify(up)}`);
    console.log(`online: checkNcmSite ok against ${baseUrl}`);

    // 2. Matikan NCM → 3 miss → OFFLINE + High incident + 1 Telegram.
    await ncm.stop();
    const misses: Awaited<ReturnType<typeof checkNcmSite>>[] = [];
    for (let i = 0; i < NCM_OFFLINE_THRESHOLD; i++) misses.push(await checkNcmSite(deps, site));
    must(misses[0]!.ok === false && misses[0]!.status === "online" && misses[0]!.missCount === 1, `miss 1 must stay online, got ${JSON.stringify(misses[0])}`);
    const flipped = misses[NCM_OFFLINE_THRESHOLD - 1]!;
    must(flipped.ok === false && flipped.status === "offline" && flipped.incidentCreated && flipped.incidentId !== null, `expected OFFLINE + incident at ${NCM_OFFLINE_THRESHOLD} misses, got ${JSON.stringify(flipped)}`);
    must(incidents.length === 1 && incidents[0]!.severity === "High" && incidents[0]!.title === "Site NCM offline: Probe Site", `expected one High offline incident, got ${JSON.stringify(incidents)}`);
    must(notifyEvents.length === 1 && notifyEvents[0]!.kind === "offline" && notifyEvents[0]!.siteName === "Probe Site", `expected exactly 1 offline notification, got ${JSON.stringify(notifyEvents)}`);
    console.log(`offline: ${NCM_OFFLINE_THRESHOLD} misses → incident #${flipped.incidentId} (High), 1 telegram offline event`);

    // 3. Dedupe while still down: no re-file, no re-notify.
    const extra = await checkNcmSite(deps, site);
    must(extra.status === "offline" && extra.incidentCreated === false, `extra miss must stay offline without re-filing, got ${JSON.stringify(extra)}`);
    must(notifyEvents.length === 1 && incidents.length === 1 && resolved.length === 0, "dedupe failed: extra miss changed nothing");
    console.log("dedupe: extra miss keeps 1 incident, 1 notification");

    // 4. Nyalakan lagi → online + auto-resolve + 1 recovery Telegram.
    baseUrl = await ncm.start();
    const recovered = await checkNcmSite(deps, site);
    must(recovered.ok && recovered.status === "online" && recovered.missCount === 0, `expected recovery to online, got ${JSON.stringify(recovered)}`);
    must(resolved.length === 1 && resolved[0]!.incidentId === flipped.incidentId, `recovery must auto-resolve incident #${flipped.incidentId}, got ${JSON.stringify(resolved)}`);
    must(notifyEvents.length === 2 && notifyEvents[1]!.kind === "recovered", `expected exactly 1 recovery notification, got ${JSON.stringify(notifyEvents.map((e) => e.kind))}`);
    console.log("recovery: online again, incident auto-resolved, 1 telegram recovery event");
    console.log("FLEET PROBE PASSED");
    await ncm.stop();
}

void main().catch((error: unknown) => {
    console.error("FLEET PROBE FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
});
