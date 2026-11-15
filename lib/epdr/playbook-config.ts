import { z } from "zod";
import { PLAYBOOK_TEMPLATES, matchesPlaybookFilters, type PlaybookFilters } from "./playbooks";

export const playbookConfigSchema = z.object({
  templateId: z.string().refine((id) => PLAYBOOK_TEMPLATES.some((template) => template.id === id), "Unknown template"),
  name: z.string().trim().min(1).max(120),
  mode: z.literal("simulate"),
  filters: z.object({
    category: z.enum(["all", "ioa", "malware", "pup", "virus", "exploit"]),
    source: z.enum(["all", "threatsync", "event_export", "health", "local"]),
    score: z.enum(["all", "missing", "range"]),
    minScore: z.number().int().min(1).max(10),
    maxScore: z.number().int().min(1).max(10),
  }).strict().refine((value) => value.minScore <= value.maxScore, "Invalid score range"),
}).strict();

export type PlaybookConfig = z.infer<typeof playbookConfigSchema>;

/** Versioned configuration never carries an action URL, provider task or dispatch mode. */
export function playbookConfigMatches(config: PlaybookConfig, signal: { source: string; category: string; score: number | null }): boolean {
  return matchesPlaybookFilters(signal, config.filters as PlaybookFilters);
}
