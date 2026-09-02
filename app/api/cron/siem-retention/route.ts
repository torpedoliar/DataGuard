import { NextResponse } from "next/server";
import { runSiemRetentionCleanup } from "@/lib/siem/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Optional CRON_SECRET authorization check if configured
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSiemRetentionCleanup({ batchSize: 2000 });
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error) {
    console.error("[CRON] SIEM retention failed:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
