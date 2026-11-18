/**
 * Shared saved-version classifier.
 *
 * One place decides whether a stored playbook version is usable for a local
 * review: the configuration parses, the template still exists in the catalog,
 * and the stored definition still matches the catalog exactly (a changed
 * catalog requires a NEW version; old ones are never reinterpreted). The
 * server actions (`epdr-local-playbooks`, `epdr-playbook-history`) and the
 * local engine share this so their compatibility answers cannot drift.
 */
import { isDeepStrictEqual } from "node:util";
import { playbookConfigSchema, type PlaybookConfig } from "./playbook-config";
import { PLAYBOOK_TEMPLATES, type PlaybookTemplate } from "./playbooks";

export type PlaybookVersionCompatibility =
  | { compatible: true; config: PlaybookConfig; template: PlaybookTemplate }
  | { compatible: false; reason: "invalid_configuration" | "unknown_template" | "definition_changed" };

export function classifyPlaybookVersion(configuration: unknown, definition: unknown): PlaybookVersionCompatibility {
  const config = playbookConfigSchema.safeParse(configuration);
  if (!config.success) {
    // The schema's templateId refine rejects unknown ids; call that out
    // specifically so the operator sees "template gone", not a generic
    // configuration error.
    const rawTemplateId = configuration !== null && typeof configuration === "object"
      && typeof (configuration as { templateId?: unknown }).templateId === "string"
      ? (configuration as { templateId: string }).templateId : null;
    if (rawTemplateId !== null && !PLAYBOOK_TEMPLATES.some((item) => item.id === rawTemplateId)) {
      return { compatible: false, reason: "unknown_template" };
    }
    return { compatible: false, reason: "invalid_configuration" };
  }
  const template = PLAYBOOK_TEMPLATES.find((item) => item.id === config.data.templateId);
  if (!template) return { compatible: false, reason: "unknown_template" };
  if (!isDeepStrictEqual(definition, { schemaVersion: 1, template })) {
    return { compatible: false, reason: "definition_changed" };
  }
  return { compatible: true, config: config.data, template };
}
