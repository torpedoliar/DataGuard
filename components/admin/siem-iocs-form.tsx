"use client";

import { createSiemIoc, deleteSiemIoc, toggleSiemIoc, type SiemIocRow } from "@/actions/siem-iocs";
import ActionButton from "@/components/ui/action-button";
import EmptyState from "@/components/ui/empty-state";
import StatusBadge from "@/components/ui/status-badge";
import { siemSeverities } from "@/lib/siem/types";
import { getIncidentSeverityTone } from "@/lib/ui/status";
import { Crosshair, Trash2 } from "lucide-react";
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
      <form action={createAction} className="ops-panel p-5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Tambah IOC</h2>
        <p className="mt-0.5 text-[13px] text-ops-muted">
          IOC aktif akan dicocokkan ke field srcIp/dstIp/sourceIp (type ip) atau username/program (domain/hash) oleh rule <code>indicator_match</code>.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Type
            <select name="type" className="ops-input h-9 w-full px-3 text-sm">
              <option value="ip">IP</option>
              <option value="domain">Domain</option>
              <option value="hash">Hash</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted md:col-span-2">
            Value
            <input name="value" required maxLength={500} placeholder="evil.example.com" className="ops-input h-9 w-full px-3 font-mono text-sm" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Severity
            <select name="severity" defaultValue="High" className="ops-input h-9 w-full px-3 text-sm">
              {siemSeverities.map((severity) => (
                <option key={severity} value={severity}>{severity}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted">
            Kedaluwarsa (hari)
            <input name="expiresDays" type="number" min={1} max={3650} placeholder="tanpa batas" className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-ops-muted md:col-span-4">
            Deskripsi
            <input name="description" maxLength={1000} placeholder="Sumber / konteks indikator" className="ops-input h-9 w-full px-3 text-sm" />
          </label>
          <div className="flex items-end">
            <ActionButton type="submit" isPending={createPending}>Tambah</ActionButton>
          </div>
        </div>
        {errors && <div className="mt-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{Object.values(errors).flat().join(" ")}</div>}
        {message && !createState?.success && <div className="mt-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{message}</div>}
      </form>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
          Daftar IOC (<span className="tabular-nums">{iocs.length}</span>)
        </h2>
        {iocs.length === 0 ? (
          <EmptyState
            icon={<Crosshair className="size-5" />}
            title="Belum ada IOC"
            description="Tambahkan indikator di atas."
          />
        ) : (
          <div className="ops-panel divide-y divide-ops-border p-5">
            {iocs.map((ioc) => (
              <div key={ioc.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm border border-ops-border-strong px-1.5 py-0.5 font-mono text-xs text-ops-muted">{ioc.type}</span>
                    <span className="truncate font-mono text-sm text-ops-text">{ioc.value}</span>
                    <StatusBadge tone={getIncidentSeverityTone(ioc.severity)}>{ioc.severity}</StatusBadge>
                  </div>
                  {ioc.description && <p className="mt-0.5 truncate text-xs text-ops-subtle">{ioc.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-ops-muted">
                    <input type="checkbox" checked={ioc.enabled} disabled={togglePending} onChange={() => {
                      const data = new FormData();
                      data.set("id", String(ioc.id));
                      toggleAction(data);
                    }} className="size-4 accent-ops-accent" />
                    Aktif
                  </label>
                  <ActionButton
                    type="button"
                    variant="danger"
                    size="icon"
                    isPending={deletePending}
                    aria-label={`Hapus IOC ${ioc.value}`}
                    onClick={() => {
                      if (!confirm(`Hapus IOC ${ioc.value}?`)) return;
                      const data = new FormData();
                      data.set("id", String(ioc.id));
                      deleteAction(data);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
        {message && !createState?.message && <div className="text-[13px] text-ops-muted">{message}</div>}
      </section>
    </div>
  );
}
