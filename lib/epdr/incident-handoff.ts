import { z } from "zod";

export const incidentHandoffSchema = z.object({
  detectionId: z.number().int().positive().max(2147483647),
  assigneeId: z.number().int().positive().max(2147483647).nullable(),
  picGroupId: z.number().int().positive().max(2147483647).nullable(),
  note: z.string().trim().min(1).max(500),
}).strict();

/** Operator review priority is local; it never grants provider execution. */
export function handoffSeverity(value: string): "Low" | "Medium" | "High" | "Critical" {
  return value === "Low" || value === "Medium" || value === "High" || value === "Critical" ? value : "Medium";
}
