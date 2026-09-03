import { z } from "zod";
import { type UiTone } from "@/lib/ui/status";

export const threatStatuses = [
  "open",
  "in_progress",
  "mitigated",
  "not_applicable",
  "accepted_risk",
] as const;
export type ThreatStatus = (typeof threatStatuses)[number];

export const threatSeverities = ["critical", "high", "medium", "low"] as const;
export type ThreatSeverity = (typeof threatSeverities)[number];

export function calculateCvssSeverity(score: number | null | undefined): ThreatSeverity {
  if (score === null || score === undefined || Number.isNaN(score)) return "medium";
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

export function getThreatStatusTone(status: ThreatStatus): UiTone {
  switch (status) {
    case "mitigated":
      return "success";
    case "in_progress":
      return "info";
    case "open":
      return "danger";
    case "not_applicable":
    case "accepted_risk":
      return "neutral";
    default:
      return "neutral";
  }
}

export function getThreatSeverityTone(severity: ThreatSeverity): UiTone {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

export const threatStatusLabels: Record<ThreatStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  mitigated: "Mitigated",
  not_applicable: "Not Applicable",
  accepted_risk: "Accepted Risk",
};

export const threatSeverityLabels: Record<ThreatSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const threatIntelSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  source: z.string().trim().min(1, "Source is required"),
  sourceUrl: z.string().trim().url("Invalid URL format").or(z.literal("")).optional(),
  intelDate: z.string().min(1, "Intel date is required"),
  cveList: z.string().trim().optional(),
  cvssScore: z.coerce.number().min(0).max(10).optional().nullable(),
  severity: z.enum(threatSeverities).optional(),
  description: z.string().trim().optional(),
  affectedAsset: z.string().trim().min(1, "Affected asset is required"),
  status: z.enum(threatStatuses).default("open"),
  mitigatedAt: z.string().optional().nullable(),
  mitigationAction: z.string().trim().optional(),
  siteId: z.coerce.number().optional().nullable(),
  deviceId: z.coerce.number().optional().nullable(),
});

export type ThreatIntelFormData = z.infer<typeof threatIntelSchema>;

export type ThreatIntelEvidence = {
  id: number;
  threatIntelId: number;
  filePath: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  caption: string | null;
  createdAt: Date;
};

export type ThreatIntelRecord = {
  id: number;
  siteId: number | null;
  siteName?: string | null;
  deviceId: number | null;
  deviceName?: string | null;
  intelDate: Date;
  source: string;
  sourceUrl: string | null;
  title: string;
  cveList: string | null;
  cvssScore: number | null;
  severity: ThreatSeverity;
  description: string | null;
  affectedAsset: string;
  status: ThreatStatus;
  mitigatedAt: Date | null;
  mitigationAction: string | null;
  createdById: number | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  evidences: ThreatIntelEvidence[];
};

export type ThreatIntelStats = {
  total: number;
  open: number;
  inProgress: number;
  mitigated: number;
  notApplicableOrAccepted: number;
  criticalHigh: number;
  mitigationRate: number;
};
