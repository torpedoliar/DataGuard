import { NextResponse } from "next/server";
import { and, eq, like, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  devices,
  incidentUpdates,
  incidents,
  ncmSettings,
  siteTelegramChatIds,
  sites,
} from "@/db/schema";
import { decryptIfEncrypted } from "@/lib/crypto";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { escapeTelegramHtml, sendTelegramAlert } from "@/lib/telegram";
import { resolveNotificationBaseUrl } from "@/lib/notification-url";
import {
  ncmIngestSchema,
  processNcmEvent,
  verifyNcmSignature,
  type NcmIngestDeps,
  type NcmIngestEvent,
} from "@/lib/ncm-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ==================== POST /api/ncm/ingest (ticket 06) ====================
// Inbound NCM event webhook. Auth is per-site HMAC: the NCM instance signs
// the raw body with the site's ncm_settings.webhook_secret
// (X-NCM-Signature: sha256=<hex>) — we find the site by trying each
// configured secret (site counts are tiny; no extra routing column).
// The NCM sender is a machine with no CSRF token, so the route must stay
// reachable: add to csrfExemptPrefixes in middleware.ts (pattern:
// /api/siem-ingest). Delivery is best-effort end to end — an event must
// never 500 on a broken notification path.

const NCM_RATE_LIMIT = { windowMs: 60_000, max: 60 } as const;

type SiteCandidate = { siteId: number; siteName: string; secret: string };

async function findSiteCandidates(): Promise<SiteCandidate[]> {
  const rows = await db
    .select({
      siteId: ncmSettings.siteId,
      siteName: sites.name,
      webhookSecret: ncmSettings.webhookSecret,
    })
    .from(ncmSettings)
    .innerJoin(sites, eq(sites.id, ncmSettings.siteId));

  const candidates: SiteCandidate[] = [];
  for (const row of rows) {
    const secret = decryptIfEncrypted(row.webhookSecret);
    if (secret) candidates.push({ siteId: row.siteId, siteName: row.siteName, secret });
  }
  return candidates;
}

// DB-backed deps for processNcmEvent. The dedupe marker lives in the
// incident description (`ncm_event_id:<key>`) — no extra table. Markers on
// RESOLVED incidents are ignored for dedupe (only open incidents match), so
// the same NCM event id can legitimately re-open a new incident later.
const deps: NcmIngestDeps = {
  async findDevicesBySite(siteId) {
    const rows = await db
      .select({ id: devices.id, name: devices.name })
      .from(devices)
      .where(eq(devices.siteId, siteId))
      .orderBy(devices.id);
    return rows;
  },

  async findOpenIncidentByMarker(siteId, marker) {
    const rows = await db
      .select({ id: incidents.id, title: incidents.title })
      .from(incidents)
      .where(and(eq(incidents.siteId, siteId), like(incidents.description, `%${marker}%`), ne(incidents.status, "Verified")))
      .limit(1);
    return rows[0] ?? null;
  },

  async findOpenBackupFailedIncident(siteId, switchLabel) {
    const rows = await db
      .select({ id: incidents.id, title: incidents.title })
      .from(incidents)
      .where(
        and(
          eq(incidents.siteId, siteId),
          like(incidents.title, `Backup failed: ${switchLabel}%`),
          or(eq(incidents.status, "Open"), eq(incidents.status, "In Progress")),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async findOpenDriftIncident(siteId, switchLabel) {
    const rows = await db
      .select({ id: incidents.id, title: incidents.title })
      .from(incidents)
      .where(
        and(
          eq(incidents.siteId, siteId),
          like(incidents.title, `Config drift: ${switchLabel}%`),
          or(eq(incidents.status, "Open"), eq(incidents.status, "In Progress")),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async insertIncident(values) {
    const [row] = await db
      .insert(incidents)
      .values({
        siteId: values.siteId,
        deviceId: values.deviceId,
        title: values.title,
        description: values.description,
        severity: values.severity,
        status: "Open",
      })
      .returning({ id: incidents.id, title: incidents.title });
    return row!;
  },

  async insertIncidentUpdate(values) {
    await db.insert(incidentUpdates).values({
      incidentId: values.incidentId,
      updateType: "comment",
      note: values.note,
      newStatus: values.newStatus as "Open",
    });
  },

  async resolveIncident(incidentId, note) {
    await db.transaction(async (tx) => {
      await tx
        .update(incidents)
        .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(incidents.id, incidentId));
      await tx.insert(incidentUpdates).values({
        incidentId,
        updateType: "status_changed",
        note,
        previousStatus: "Open",
        newStatus: "Resolved",
      });
    });
  },
};

async function notifyTelegram(
  siteId: number,
  siteName: string,
  event: NcmIngestEvent,
  actions: { kind: string; incidentId: number; severity: string | null }[],
): Promise<void> {
  // Fire-and-forget Telegram fan-out (same contract as actions/incidents.ts):
  // a Telegram outage must never fail the ingest response.
  setImmediate(async () => {
    try {
      const [site] = await db
        .select({ telegramChatId: sites.telegramChatId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      if (!site) return;

      const severity = actions[0]?.severity ?? "Medium";
      const recipients = await db
        .select({ chatId: siteTelegramChatIds.chatId, severityFilter: siteTelegramChatIds.severityFilter })
        .from(siteTelegramChatIds)
        .where(and(eq(siteTelegramChatIds.siteId, siteId), eq(siteTelegramChatIds.enabled, true)));
      const allowed = recipients
        .filter((r) => {
          if (!r.severityFilter) return true;
          const list = r.severityFilter.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
          return list.includes(severity);
        })
        .map((r) => r.chatId);
      if (allowed.length === 0 && site.telegramChatId?.trim()) allowed.push(site.telegramChatId.trim());
      if (allowed.length === 0) return;

      const baseUrl = await resolveNotificationBaseUrl();
      const esc = escapeTelegramHtml;
      const label = event.payload.switch_name?.trim() || (event.payload.switch_id !== undefined ? `switch #${event.payload.switch_id}` : "switch");
      const lines: string[] = [];
      for (const action of actions) {
        const link = `<a href="${esc(`${baseUrl}/admin/incidents/${action.incidentId}`)}">#${action.incidentId}</a>`;
        if (action.kind === "created") {
          lines.push(`<b>NCM ${esc(event.type)}</b> — incident ${link} opened (${esc(action.severity ?? "Medium")})`);
        } else {
          lines.push(`<b>NCM ${esc(event.type)}</b> — incident ${link} auto-resolved`);
        }
      }
      const message = [`Site: ${esc(siteName)}`, `Device: ${esc(label)}`, ...lines].join("\n");

      for (const chatId of allowed) {
        // Best-effort; result deliberately not audited here (route, not action).
        void sendTelegramAlert(chatId, message);
      }
    } catch (error) {
      console.error("[ncm-ingest] telegram notify failed:", error);
    }
  });
}

export async function POST(request: Request) {
  // Rate limit per source IP before any DB work (pattern: app/api/admin/*).
  const ip = getClientIp(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
  );
  const limit = checkRateLimit("ncm-ingest", ip ?? "unknown", NCM_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  const rawBody = await request.text();

  let parsedEvent: NcmIngestEvent;
  try {
    parsedEvent = ncmIngestSchema.parse(JSON.parse(rawBody));
  } catch {
    // Parse BEFORE auth so garbage never reaches the HMAC loop; auth errors
    // stay generic once the body is parseable (do not leak which sites exist).
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let matched: SiteCandidate | null = null;
  try {
    const signature = request.headers.get("x-ncm-signature");
    for (const candidate of await findSiteCandidates()) {
      if (verifyNcmSignature(rawBody, signature, candidate.secret)) {
        matched = candidate;
        break;
      }
    }
  } catch (error) {
    console.error("[ncm-ingest] site lookup failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!matched) {
    // 401 for both "no site configured" and "bad signature" — no oracle.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let outcome;
  try {
    outcome = await processNcmEvent(deps, {
      siteId: matched.siteId,
      siteName: matched.siteName,
      event: parsedEvent,
    });
  } catch (error) {
    console.error("[ncm-ingest] processing failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (outcome.actions.length > 0) {
    notifyTelegram(matched.siteId, matched.siteName, parsedEvent, outcome.actions);
  }

  return NextResponse.json({
    ok: true,
    site_id: matched.siteId,
    actions: outcome.actions,
    device_id: outcome.deviceId,
  });
}
