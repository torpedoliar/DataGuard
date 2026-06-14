import { NextResponse } from "next/server";
import { requireSuperadminAction } from "@/lib/action-auth";
import { collectMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSuperadminAction();
  if (!guard.ok) {
    return NextResponse.json({ message: guard.message }, { status: 401 });
  }

  try {
    const body = await collectMetrics();
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (error) {
      // intentionally swallow — metrics never throws
    }
    return NextResponse.json(
      {
        siem: {
          alerts: { queued: null, sent: null, failed: null },
          retention: { lastRunAt: null },
          partition: { lastEnsureRunAt: null },
        },
        backup: { lastBackupAt: null, lastRestoreAt: null },
        health: { dbOk: false, appUptimeSec: process.uptime() },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
