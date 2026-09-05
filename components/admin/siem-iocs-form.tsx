"use client";

import { createSiemIoc, deleteSiemIoc, toggleSiemIoc, type SiemIocRow } from "@/actions/siem-iocs";
import ActionButton from "@/components/ui/action-button";
import { siemSeverities } from "@/lib/siem/types";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

const TYPE_HINTS: Record<SiemIocRow["type"], string> = {
  ip: "192.0.2.10",
  domain: "evil.example.com",
  hash: "sha256:…",
};

export default function SiemIocsForm({ iocs }: { iocs: SiemIocRow[] }) {
  const router = useRouter();
  const [createState, createAction, createPending] = useActionState(createSiemIoc, undefined);
  const [toggleState, toggleAction, togglePending] = useActionState(toggleSiemIoc, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteSiemIoc, undefined);

  useEffect(() => {
    if (createState?.success || toggleState?.success || deleteState?.success) router.refresh();
  }, [createState?.success, toggleState?.success, deleteState?.success, router]);

  const errors = createState?.errors ?? toggleState?.errors ?? deleteState?.errors;
  const message = createState?.message ?? toggleState?.message ?? deleteState?.message;

  return (
    <div className="space-y-6">
      <form action={createAction} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <h2 className="text-sm font-semibold text-white">Tambah IOC</h2>
        <p className="mt-1 text-xs text-slate-400">
          IOC aktif akan dicocokkan ke field srcIp/dstIp/sourceIp (type ip) atau username/program (domain/hash) oleh rule <code>indicator_match</code>.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Type
            <select name="type" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white">
              <option value="ip">IP</option>
              <option value="domain">Domain</option>
              <option value="hash">Hash</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300 md:col-span-2">
            Value
            <input name="value" required maxLength={500} placeholder="evil.example.com" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Severity
            <select name="severity" defaultValue="High" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white">
              {siemSeverities.map((severity) => (
                <option key={severity} value={severity}>{severity}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300">
            Kedaluwarsa (hari)
            <input name="expiresDays" type="number" min={1} max={3650} placeholder="tanpa batas" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-300 md:col-span-4">
            Deskripsi
            <input name="description" maxLength={1000} placeholder="Sumber / konteks indikator" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white" />
          </label>
          <div className="flex items-end">
            <ActionButton type="submit" isPending={createPending}>Tambah</ActionButton>
          </div>
        </div>
        {errors && <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{Object.values(errors).flat().join(" ")}</div>}
        {message && !createState?.success && <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{message}</div>}
      </form>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <h2 className="text-sm font-semibold text-white">Daftar IOC ({iocs.length})</h2>
        {iocs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Belum ada IOC. Tambahkan indikator di atas.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-700/40">
            {iocs.map((ioc) => (
              <div key={ioc.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-slate-600 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">{ioc.type}</span>
                    <span className="truncate font-mono text-sm text-white">{ioc.value}</span>
                    <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{ioc.severity}</span>
                  </div>
                  {ioc.description && <p className="mt-0.5 truncate text-xs text-slate-500">{ioc.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={ioc.enabled} disabled={togglePending} onChange={() => {
                      const data = new FormData();
                      data.set("id", String(ioc.id));
                      toggleAction(data);
                    }} className="size-4 accent-blue-500" />
                    Aktif
                  </label>
                  <ActionButton
                    type="button"
                    variant="secondary"
                    isPending={deletePending}
                    onClick={() => {
                      if (!confirm(`Hapus IOC ${ioc.value}?`)) return;
                      const data = new FormData();
                      data.set("id", String(ioc.id));
                      deleteAction(data);
                    }}
                    className="!border-red-500/40 !text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
        {message && !createState?.message && <div className="mt-3 text-sm text-slate-400">{message}</div>}
      </div>
    </div>
  );
}
