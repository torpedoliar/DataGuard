import { NextResponse } from "next/server";
import { runHeartbeatOnce } from "@/scripts/ncm-heartbeat-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ==================== GET /api/cron/ncm-heartbeat (ticket 09) ====================
// External-scheduler entry point (pattern: app/api/cron/siem-retention).
// The heartbeat worker script is the always-on path; this route lets an
// external scheduler (cron/systemd) drive the same run. GET is idempotent:
// it only updates last_seen/status and files/resolves incidents.

export async function GET(request: Request) {
  // Optional CRON_SECRET authorization check if configured
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const checked = await runHeartbeatOnce();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      checked,
    });
  } catch (error) {
    console.error("[CRON] NCM heartbeat failed:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
