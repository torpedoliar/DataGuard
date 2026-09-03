import { describe, expect, it } from "vitest";
import {
  calculateCvssSeverity,
  getThreatSeverityTone,
  getThreatStatusTone,
  threatIntelSchema,
} from "@/lib/threat-intel";

describe("Threat Intelligence domain logic", () => {
  it("calculates severity correctly based on CVSS score", () => {
    expect(calculateCvssSeverity(9.8)).toBe("critical");
    expect(calculateCvssSeverity(9.0)).toBe("critical");
    expect(calculateCvssSeverity(8.7)).toBe("high");
    expect(calculateCvssSeverity(7.0)).toBe("high");
    expect(calculateCvssSeverity(6.5)).toBe("medium");
    expect(calculateCvssSeverity(4.0)).toBe("medium");
    expect(calculateCvssSeverity(3.9)).toBe("low");
    expect(calculateCvssSeverity(0.5)).toBe("low");
    expect(calculateCvssSeverity(null)).toBe("medium");
    expect(calculateCvssSeverity(undefined)).toBe("medium");
  });

  it("maps status and severity tones accurately", () => {
    expect(getThreatStatusTone("mitigated")).toBe("success");
    expect(getThreatStatusTone("open")).toBe("danger");
    expect(getThreatStatusTone("in_progress")).toBe("info");
    expect(getThreatStatusTone("not_applicable")).toBe("neutral");

    expect(getThreatSeverityTone("critical")).toBe("danger");
    expect(getThreatSeverityTone("high")).toBe("warning");
    expect(getThreatSeverityTone("medium")).toBe("info");
    expect(getThreatSeverityTone("low")).toBe("neutral");
  });

  it("validates form schema correctly", () => {
    const valid = {
      title: "Veeam Backup & Replication RCE",
      source: "The Hacker News",
      sourceUrl: "https://thehackernews.com/advisory-123",
      intelDate: "2026-01-07",
      cveList: "CVE-2025-59168, CVE-2025-59469",
      cvssScore: 8.7,
      affectedAsset: "Veeam Backup & Replication SJA",
      status: "open",
      description: "Critical RCE via postgres parameter",
    };

    const parsed = threatIntelSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = {
      ...valid,
      title: "", // empty title
    };
    const parsedInvalid = threatIntelSchema.safeParse(invalid);
    expect(parsedInvalid.success).toBe(false);

    const invalidCvss = {
      ...valid,
      cvssScore: 15, // > 10
    };
    const parsedCvss = threatIntelSchema.safeParse(invalidCvss);
    expect(parsedCvss.success).toBe(false);
  });
});
