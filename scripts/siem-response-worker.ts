#!/usr/bin/env tsx
// SOAR response worker: executes siem_response_actions rows whose status is
// "approved". Execution = POST payload to webhookUrl. Never executes actions
// still pending approval (the two-person rule lives in the approve action).
// Secrets stay out of logs: only status codes and truncated bodies are stored.

import dotenv from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { siemResponseActions } from "../db/schema";
import { logAudit } from "../lib/audit";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_RESPONSE_WORKER_POLL_INTERVAL_MS ?? 15000);
const EXECUTE_TIMEOUT_MS = 15_000;

async function executeAction(action: typeof siemResponseActions.$inferSelect): Promise<void> {
  const executedAt = new Date();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);
    const response = await fetch(action.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...action.payload, findingId: action.findingId, actionType: action.actionType }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const bodyText = (await response.text()).slice(0, 2000);
    await db.update(siemResponseActions).set({
      status: response.ok ? "executed" : "failed",
      executedAt,
      responseStatus: response.status,
      responseBody: bodyText,
      updatedAt: new Date(),
    }).where(eq(siemResponseActions.id, action.id));

    await logAudit({
      action: "UPDATE",
      entity: "siem_response_action",
      entityId: action.id,
      entityName: action.actionType,
      detail: `executed: http ${response.status}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(siemResponseActions).set({
      status: "failed",
      executedAt,
      error: message.slice(0, 1000),
      updatedAt: new Date(),
    }).where(eq(siemResponseActions.id, action.id));

    await logAudit({
      action: "UPDATE",
      entity: "siem_response_action",
      entityId: action.id,
      entityName: action.actionType,
      detail: `execution failed: ${message.slice(0, 200)}`,
    });
  }
}

async function runOnce(): Promise<number> {
  const approved = await db
    .select()
    .from(siemResponseActions)
    .where(inArray(siemResponseActions.status, ["approved"]))
    .limit(20);

  let executed = 0;
  for (const action of approved) {
    // Guard against a cancel landing between SELECT and POST: re-check status
    // and claim the row atomically (update returns rows affected only when the
    // status was still "approved" — a cancelled row claims nothing).
    const claimed = await db.update(siemResponseActions)
      .set({ status: "executing", updatedAt: new Date() })
      .where(and(eq(siemResponseActions.id, action.id), eq(siemResponseActions.status, "approved")))
      .returning({ id: siemResponseActions.id });
    if (claimed.length === 0) continue;
    await executeAction(action);
    executed++;
  }
  return executed;
}

async function loop(): Promise<void> {
  console.log(`[siem-response-worker] starting; poll=${pollIntervalMs}ms`);
  while (true) {
    try {
      const executed = await runOnce();
      if (executed > 0) console.log(`[siem-response-worker] executed ${executed} action(s)`);
    } catch (error) {
      console.error("[siem-response-worker] tick failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("[siem-response-worker] crashed:", error);
  process.exit(1);
});
