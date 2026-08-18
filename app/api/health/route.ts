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
    // Public, unauthenticated probe route — never leak internal error
    // details. Log server-side, return a sanitized status string.
    console.error("[HEALTH] DB check failed:", error);
    return NextResponse.json(
      {
        status: "degraded",
        db: "down",
        error: "db: down",
      },
      { status: 503 },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
