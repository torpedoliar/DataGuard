#!/usr/bin/env tsx
import dotenv from "dotenv";
import { notifyOverdueIncidents } from "./notify-overdue-incidents";

dotenv.config();

const pollIntervalMs = Number(process.env.INCIDENTS_NOTIFY_POLL_INTERVAL_MS ?? 60 * 60 * 1000);

async function loop() {
  while (true) {
    try {
      const result = await notifyOverdueIncidents();
      if (result.notified > 0) console.log(`Overdue incidents: ${result.notified} notified`);
    } catch (error) {
      console.error("Overdue incident notify failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("Overdue incident notify loop crashed", error);
  process.exit(1);
});
