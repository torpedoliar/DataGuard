import { NextResponse } from "next/server";
import { Pool } from "pg";
import { buildDatabaseUrl } from "@/lib/database-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pool = new Pool({
    connectionString: buildDatabaseUrl(),
    connectionTimeoutMillis: 2000,
  });
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      db: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "down",
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
