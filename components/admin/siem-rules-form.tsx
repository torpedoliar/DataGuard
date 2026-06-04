"use client";

import { updateSiemRules } from "@/actions/siem-settings";
import ActionButton from "@/components/ui/action-button";
import { siemSeverities, type SiemSeverity } from "@/lib/siem/types";
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
};

type ToggleState = Record<number, { enabled: boolean; alertEnabled: boolean }>;

export default function SiemRulesForm({ rules, alertMinSeverity }: { rules: SiemRuleRow[]; alertMinSeverity: SiemSeverity }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemRules, undefined);
  const [toggles, setToggles] = useState<ToggleState>(() =>
    Object.fromEntries(rules.map((rule) => [rule.id, { enabled: rule.enabled, alertEnabled: rule.alertEnabled }])),
  );

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

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="ruleIds" value={ruleIds} />

      <div className="max-w-md rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <label className="space-y-1.5 text-sm font-medium text-slate-300">
          Severity Minimum Alert
          <select
            name="alertMinSeverity"
            defaultValue={alertMinSeverity}
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          >
            {siemSeverities.map((severity) => (
              <option key={severity} value={severity}>{severity}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Finding di bawah severity ini tidak masuk antrean alert Telegram.</span>
        </label>
      </div>

      {grouped.map(([category, list]) => (
        <div key={category} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <h2 className="text-sm font-semibold text-white">{category}</h2>
          <div className="mt-4 divide-y divide-slate-700/40">
            {list.map((rule) => {
              const current = toggles[rule.id];
              return (
                <div key={rule.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{rule.name}</span>
                      <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{rule.severity}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{rule.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-5">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        name={`enabled-${rule.id}`}
                        checked={current.enabled}
                        onChange={(event) => setEnabled(rule.id, event.target.checked)}
                        className="size-4 accent-blue-500"
                      />
                      Aktif
                    </label>
                    <label className={`flex items-center gap-2 text-xs ${current.enabled ? "text-slate-300" : "text-slate-600"}`}>
                      <input
                        type="checkbox"
                        name={`alert-${rule.id}`}
                        checked={current.alertEnabled}
                        disabled={!current.enabled}
                        onChange={(event) => setAlert(rule.id, event.target.checked)}
                        className="size-4 accent-emerald-500 disabled:opacity-40"
                      />
                      Kirim ke Telegram
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {state?.errors && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
          {Object.values(state.errors).flat().join(" ")}
        </div>
      )}
      {state?.message && !state.success && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>
      )}
      {state?.success && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">Pengaturan rule tersimpan.</div>
      )}

      <div className="flex justify-end">
        <ActionButton type="submit" isPending={isPending}>Simpan Pengaturan Rule</ActionButton>
      </div>
    </form>
  );
}
