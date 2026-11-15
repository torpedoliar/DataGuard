import { describe, expect, it } from "vitest";
import { playbookConfigMatches, playbookConfigSchema } from "./playbook-config";

const config = { templateId: "ioa", name: "IOA review", mode: "simulate" as const,
  filters: { source: "threatsync" as const, category: "ioa" as const, score: "range" as const, minScore: 7, maxScore: 10 } };

describe("persisted simulation configuration", () => {
  it("accepts a bounded simulation-only configuration", () => {
    expect(playbookConfigSchema.parse(config)).toEqual(config);
  });
  it.each(["automatic", "approval", "local", "provider_auto"])("rejects %s as an execution mode", (mode) => {
    expect(playbookConfigSchema.safeParse({ ...config, mode }).success).toBe(false);
  });
  it("rejects arbitrary commands, unknown templates and invalid ranges", () => {
    expect(playbookConfigSchema.safeParse({ ...config, url: "https://example.invalid" }).success).toBe(false);
    expect(playbookConfigSchema.safeParse({ ...config, templateId: "run-command" }).success).toBe(false);
    expect(playbookConfigSchema.safeParse({ ...config, filters: { ...config.filters, minScore: 10, maxScore: 1 } }).success).toBe(false);
  });
  it("keeps category/source/range filters conjunctive and missing scores separate", () => {
    expect(playbookConfigMatches(config, { source: "threatsync", category: "ioa", score: 8 })).toBe(true);
    expect(playbookConfigMatches(config, { source: "event_export", category: "ioa", score: 8 })).toBe(false);
    expect(playbookConfigMatches(config, { source: "threatsync", category: "malware", score: 8 })).toBe(false);
    expect(playbookConfigMatches(config, { source: "threatsync", category: "ioa", score: null })).toBe(false);
    expect(playbookConfigMatches({ ...config, filters: { ...config.filters, score: "missing" } }, { source: "threatsync", category: "ioa", score: null })).toBe(true);
  });
});
