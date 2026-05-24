#!/usr/bin/env tsx
import dotenv from "dotenv";
import { DEFAULT_SIEM_RULES } from "../lib/siem/default-rules";
import { runSiemRules, seedDefaultSiemRules } from "../lib/siem/rule-runner";

dotenv.config();

const pollIntervalMs = Number(process.env.SIEM_RULE_WORKER_POLL_INTERVAL_MS ?? 10000);
const lookbackSeconds = Number(process.env.SIEM_RULE_LOOKBACK_SECONDS ?? 900);
const eventLimit = Number(process.env.SIEM_RULE_EVENT_LIMIT ?? 500);

async function runOnce() {
  await seedDefaultSiemRules(DEFAULT_SIEM_RULES);
  return runSiemRules({ lookbackSeconds, limit: eventLimit });
}

async function loop() {
  while (true) {
    const result = await runOnce();
    if (result.candidates > 0) console.log(`SIEM rules evaluated: ${result.candidates} candidates, ${result.created} created, ${result.updated} updated`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void loop().catch((error) => {
  console.error("SIEM rule worker failed", error);
  process.exit(1);
});
