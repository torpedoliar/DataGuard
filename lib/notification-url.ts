import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { globalSettings } from "../db/schema";
import { secureOrigin } from "./base-origin";

// ponytail: headless workers (SIEM/parser) have no request host, so login
// remembers the host the operator actually used; alerts link there. APP_URL
// env overrides when a public domain exists and login host is an internal IP.

export async function resolveNotificationBaseUrl(): Promise<string> {
  if (process.env.npm_lifecycle_event === "build") return "";

  let stored = "";
  try {
    const row = await db
      .select({ notificationBaseUrl: globalSettings.notificationBaseUrl })
      .from(globalSettings)
      .limit(1);
    stored = row[0]?.notificationBaseUrl?.trim() ?? "";
  } catch {
    // DB unreachable — fall back to request host only.
  }

  let host: string | null = null;
  try {
    host = (await headers()).get("host");
  } catch {
    // Called outside a request (worker) — rely on stored/APP_URL.
  }

  return secureOrigin(stored || process.env.APP_URL || host || "localhost:3000");
}

export async function rememberNotificationBaseUrl(host: string) {
  try {
    const rows = await db.select({ id: globalSettings.id }).from(globalSettings).limit(1);
    if (rows[0]) {
      await db.update(globalSettings).set({ notificationBaseUrl: host }).where(eq(globalSettings.id, rows[0].id));
    } else {
      await db.insert(globalSettings).values({ notificationBaseUrl: host });
    }
  } catch {
    // Non-fatal: linking just falls back to request host.
  }
}
