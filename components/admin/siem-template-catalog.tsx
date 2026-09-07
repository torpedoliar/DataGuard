"use client";

import { installSiemTemplates, type SiemTemplateRow } from "@/actions/siem-settings";
import type { NeedsDataSourceTemplate } from "@/lib/siem/default-rules";
import ActionButton from "@/components/ui/action-button";
import { Lock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

export type { SiemTemplateRow };

export default function SiemTemplateCatalog({
  available,
  locked,
}: {
  available: SiemTemplateRow[];
  locked: NeedsDataSourceTemplate[];
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(installSiemTemplates, undefined);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (state?.success) {
      setChecked(new Set());
      router.refresh();
    }
  }, [state?.success, router]);

  if (available.length === 0 && locked.length === 0) return null;

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Tambah dari Template</h2>
        <span className="text-xs text-slate-400">
          {available.length > 0 ? `${available.length} template tersedia` : "Semua template sudah terpasang"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Template deteksi siap pakai per tactic MITRE. Centang lalu pasang — menjadi rule biasa yang bisa diedit/dimatikan. Template first_seen bisa berisik di minggu pertama.
      </p>

      {available.length > 0 && (
        <form action={action} className="mt-4">
          <div className="divide-y divide-slate-700/40">
            {available.map((template) => (
              <label key={template.key} className="flex cursor-pointer items-start gap-3 py-3">
                <input
                  type="checkbox"
                  name="keys"
                  value={template.key}
                  checked={checked.has(template.key)}
                  onChange={() => toggle(template.key)}
                  className="mt-1 size-4 accent-blue-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{template.name}</span>
                    <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{template.severity}</span>
                    <span className="rounded border border-slate-600 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{template.ruleType}</span>
                    {(template.mitreTactics ?? []).map((tactic) => (
                      <span key={tactic} className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-300">{tactic}</span>
                    ))}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{template.description}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-600">{template.key}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <ActionButton type="submit" isPending={isPending} disabled={checked.size === 0} icon={<Plus className="size-4" />}>
              Pasang {checked.size > 0 ? `(${checked.size})` : ""}
            </ActionButton>
            {available.length > 1 && (
              <button
                type="button"
                onClick={() => setChecked(new Set(available.map((template) => template.key)))}
                className="text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline"
              >
                Pilih semua
              </button>
            )}
          </div>

          {state?.message && !state.success && (
            <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{state.message}</div>
          )}
          {state?.success && (
            <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">
              {state.installed} template terpasang sebagai rule aktif.
            </div>
          )}
        </form>
      )}

      {locked.length > 0 && (
        <div className="mt-5 border-t border-slate-700/50 pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Lock className="size-3.5" /> Butuh sumber data
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {locked.map((template) => (
              <div key={template.key} className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{template.tactic}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-200">{template.name}</p>
                <p className="mt-1 text-xs text-slate-400">{template.description}</p>
                <p className="mt-2 text-xs text-amber-200/90">⚠️ {template.missingSignal}</p>
                <p className="mt-1 text-xs text-slate-500">Aktifkan: {template.howToEnable}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
