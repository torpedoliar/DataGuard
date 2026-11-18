import { NextResponse } from "next/server";
import { runExecutionRetention } from "@/lib/epdr/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runExecutionRetention({ batchSize: 500 });
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      result,
    });
  } catch {
    // Never surface raw DB errors in the response.
    return NextResponse.json(
      { status: "error", error: "epdr_retention_failed" },
      { status: 500 },
    );
  }
}
