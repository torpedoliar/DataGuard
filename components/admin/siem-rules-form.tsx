"use client";

import { updateSiemRuleDetail, updateSiemRules } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
import { getIncidentSeverityTone } from "@/lib/ui/status";
import { KNOWN_GROUP_BY_FIELDS, KNOWN_NORMALIZED_TYPES, KNOWN_TAGS } from "@/lib/siem/rule-form-reference";
import { siemSeverities, type SiemSeverity } from "@/lib/siem/types";
import { Edit, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

export type SiemRuleRow = {
  id: number;
  key: string;
  name: string;
  description: string;
  category: string;
  severity: SiemSeverity;
  enabled: boolean;
  alertEnabled: boolean;
  conditions: Record<string, unknown>;
  groupBy: string[];
  mitreTactics?: string[];
  mitreTechniques?: string[];
  isoControls?: string[];
};

type ToggleState = Record<number, { enabled: boolean; alertEnabled: boolean }>;

// Conditions arrive as a persisted jsonb object; the guided selects only need
// the two array keys they own. Anything else (fieldMatches, activeHours, …)
// stays in the advanced JSON handled server-side.
function arrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function EditRuleModal({ rule, onClose }: { rule: SiemRuleRow; onClose: () => void }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemRuleDetail, undefined);
  const initialTypes = arrayOf(rule.conditions?.normalizedTypes);
  const initialTags = arrayOf(rule.conditions?.tags);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      onClose();
    }
  }, [state?.success, router, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="ops-panel w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit SIEM rule</h3>
            <p className="text-[13px] text-ops-muted">{rule.key}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ops-muted hover:bg-ops-surface hover:text-ops-text" disabled={isPending} aria-label="Close dialog">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <form action={action} className="space-y-4 p-5">
          <input type="hidden" name="id" value={rule.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-ops-text md:col-span-2">
              Name
              <input
                name="name"
                defaultValue={rule.name}
                required
                maxLength={200}
                className="ops-input h-9 w-full px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text md:col-span-2">
              Description
              <textarea
                name="description"
                defaultValue={rule.description}
                maxLength={2000}
                rows={2}
                className="ops-input w-full px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Severity
              <select
                name="severity"
                defaultValue={rule.severity}
                className="ops-input h-9 w-full px-3 text-sm"
              >
                {siemSeverities.map((severity) => (
                  <option key={severity} value={severity}>{severity}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Category
              <input
                name="category"
                defaultValue={rule.category}
                required
                maxLength={100}
                className="ops-input h-9 w-full px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Threshold
              <input
                name="threshold"
                type="number"
                min={1}
                max={100000}
                placeholder="(none)"
                className="ops-input h-9 w-full px-3 text-sm"
              />
              <span className="text-xs text-ops-muted">Used for threshold/sequence rules. Leave blank otherwise.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Window (seconds)
              <input
                name="windowSeconds"
                type="number"
                min={1}
                max={86400}
                placeholder="(none)"
                className="ops-input h-9 w-full px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Event Types (normalized)
              <select
                multiple
                name="normalizedTypes"
                defaultValue={initialTypes}
                size={6}
                className="ops-input w-full px-2 py-1.5 text-xs"
              >
                {KNOWN_NORMALIZED_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.produced ? type.value : `${type.value} ⚠️ (belum ada parser)`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-ops-muted">Ctrl/⌘+klik untuk multi-pilih. ⚠️ = tipe belum diproduksi normalizer — rule tidak akan menyala.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              Tags (semua harus ada)
              <select
                multiple
                name="tags"
                defaultValue={initialTags}
                size={6}
                className="ops-input w-full px-2 py-1.5 text-xs"
              >
                {KNOWN_TAGS.map((tag) => (
                  <option key={tag.value} value={tag.value}>{tag.value}</option>
                ))}
              </select>
              <span className="text-xs text-ops-muted">Rule hanya match event yang punya SEMUA tag terpilih.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text md:col-span-2">
              Group By (korelasi & first-seen)
              <select
                multiple
                name="groupBy"
                defaultValue={rule.groupBy ?? []}
                size={4}
                className="ops-input w-full px-2 py-1.5 text-xs"
              >
                {KNOWN_GROUP_BY_FIELDS.map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
              <span className="text-xs text-ops-muted">Untuk first_seen/threshold/baseline: satu finding per kombinasi nilai field terpilih.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text md:col-span-2">
              Conditions lanjutan (JSON — regex fieldMatches/suppression/activeHours)
              <textarea
                name="conditions"
                rows={3}
                placeholder="{}"
                className="ops-input w-full px-3 py-2 font-mono text-xs"
              />
              <span className="text-xs text-ops-muted">Khusus kondisi advanced. Event types, tags, dan groupBy di atas di-merge ke sini saat disimpan.</span>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              MITRE Tactics
              <input
                name="mitreTactics"
                defaultValue={(rule.mitreTactics ?? []).join(", ")}
                placeholder="Credential Access, Discovery"
                className="ops-input h-9 w-full px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text">
              MITRE Techniques
              <input
                name="mitreTechniques"
                defaultValue={(rule.mitreTechniques ?? []).join(", ")}
                placeholder="T1110, T1110.001"
                className="ops-input h-9 w-full px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ops-text md:col-span-2">
              ISO 27001 Controls
              <input
                name="isoControls"
                defaultValue={(rule.isoControls ?? []).join(", ")}
                placeholder="A.8.15, A.8.16"
                className="ops-input h-9 w-full px-3 text-sm"
              />
              <span className="text-xs text-ops-muted">Comma-separated. Shown in the coverage matrix.</span>
            </label>
          </div>

          {state?.errors && (
            <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
              {Object.values(state.errors).flat().join(" ")}
            </div>
          )}
          {state?.message && !state.success && (
            <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{state.message}</div>
          )}

          <div className="flex justify-end gap-3 border-t border-ops-border pt-4">
            <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>Cancel</ActionButton>
            <ActionButton type="submit" isPending={isPending}>Save Rule</ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SiemRulesForm({ rules, alertMinSeverity }: { rules: SiemRuleRow[]; alertMinSeverity: SiemSeverity }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemRules, undefined);
  const [toggles, setToggles] = useState<ToggleState>(() =>
    Object.fromEntries(rules.map((rule) => [rule.id, { enabled: rule.enabled, alertEnabled: rule.alertEnabled }])),
  );
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const grouped = useMemo(() => {
    const map = new Map<string, SiemRuleRow[]>();
    for (const rule of rules) {
      const list = map.get(rule.category) ?? [];
      list.push(rule);
      map.set(rule.category, list);
    }
    return [...map.entries()];
  }, [rules]);

  const setEnabled = (id: number, value: boolean) =>
    setToggles((prev) => ({ ...prev, [id]: { enabled: value, alertEnabled: value ? prev[id].alertEnabled : false } }));
  const setAlert = (id: number, value: boolean) =>
    setToggles((prev) => ({ ...prev, [id]: { ...prev[id], alertEnabled: value } }));

  const ruleIds = rules.map((rule) => rule.id).join(",");
  const editingRule = editingRuleId !== null ? rules.find((rule) => rule.id === editingRuleId) ?? null : null;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="ruleIds" value={ruleIds} />

      <div className="ops-panel max-w-md p-5">
        <label className="space-y-1.5 text-sm font-medium text-ops-muted">
          Severity Minimum Alert
          <select
            name="alertMinSeverity"
            defaultValue={alertMinSeverity}
            className="ops-input h-9 w-full px-3 text-sm"
          >
            {siemSeverities.map((severity) => (
              <option key={severity} value={severity}>{severity}</option>
            ))}
          </select>
          <span className="block text-xs text-ops-subtle">Finding di bawah severity ini tidak masuk antrean alert Telegram.</span>
        </label>
      </div>

      {grouped.map(([category, list]) => (
        <div key={category} className="ops-panel p-5">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{category}</h2>
          <div className="mt-4 divide-y divide-ops-border/60">
            {list.map((rule) => {
              const current = toggles[rule.id];
              return (
                <div key={rule.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ops-text">{rule.name}</span>
                      <StatusBadge tone={getIncidentSeverityTone(rule.severity)}>{rule.severity}</StatusBadge>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ops-subtle">{rule.description}</p>
                    {(rule.mitreTechniques?.length || rule.isoControls?.length) ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(rule.mitreTechniques ?? []).map((technique) => (
                          <span key={technique} className="rounded-sm border border-ops-info/40 bg-ops-info-soft px-1.5 py-0.5 font-mono text-xs text-ops-info">{technique}</span>
                        ))}
                        {(rule.isoControls ?? []).map((control) => (
                          <span key={control} className="rounded-sm border border-ops-info/40 bg-ops-info-soft px-1.5 py-0.5 font-mono text-xs text-ops-info">{control}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-5">
                    <label className="flex items-center gap-2 text-xs text-ops-muted">
                      <input
                        type="checkbox"
                        name={`enabled-${rule.id}`}
                        checked={current.enabled}
                        onChange={(event) => setEnabled(rule.id, event.target.checked)}
                        className="size-4 accent-ops-accent"
                      />
                      Aktif
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ops-muted">
                      <input
                        type="checkbox"
                        name={`alert-${rule.id}`}
                        checked={current.alertEnabled}
                        disabled={!current.enabled}
                        onChange={(event) => setAlert(rule.id, event.target.checked)}
                        className="size-4 accent-ops-success disabled:opacity-40"
                      />
                      Kirim ke Telegram
                    </label>
                    <ActionButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingRuleId(rule.id)}
                      icon={<Edit className="size-3.5" />}
                      title="Edit rule detail (severity, threshold, conditions, ...)"
                    >
                      Edit
                    </ActionButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {state?.errors && (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">Pengaturan rule tersimpan.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>Simpan Pengaturan Rule</ActionButton>
      </div>

      {editingRule && <EditRuleModal rule={editingRule} onClose={() => setEditingRuleId(null)} />}
    </form>
  );
}
