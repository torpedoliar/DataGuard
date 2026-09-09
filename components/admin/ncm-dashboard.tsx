"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Clock,
  DatabaseBackup,
  GitCompareArrows,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import {
  addNcmSwitch,
  createNcmBaseline,
  decideNcmReview,
  deleteNcmSwitch,
  getNcmReviewDetail,
  rotateNcmCredentials,
  triggerNcmBackup,
  updateNcmSchedule,
  updateNcmSwitch,
  type NcmOverview,
  type NcmWriteResult,
} from "@/actions/ncm";

type Row = Record<string, unknown>;

// NCM field names can drift across versions (switch_id vs switchId, dst).
function pick(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function asRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const container = value as { data?: unknown; items?: unknown } | null;
  if (container && Array.isArray(container.data)) return container.data as Row[];
  if (container && Array.isArray(container.items)) return container.items as Row[];
  return [];
}

function formatLastSeen(value: string | null): string {
  if (!value) return "tidak pernah";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "tidak pernah" : date.toLocaleString();
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const cardClass = "rounded-lg border border-slate-700/50 bg-slate-900/40 p-4";
const inputClass = "h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white";
const labelClass = "space-y-1 text-sm font-medium text-slate-300";

function ResultBanner({ state }: { state: NcmWriteResult | null | undefined }) {
  if (!state?.message) return null;
  const ok = "success" in state && state.success;
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"
      }`}
    >
      {state.message}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, meta }: { icon: React.ReactNode; title: string; subtitle: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-ops-accent/12 text-ops-accent">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-ops-muted">{subtitle}</p>
        </div>
      </div>
      {meta && <span className="text-xs text-ops-muted">{meta}</span>}
    </div>
  );
}

// ==================== Area 1: Switches CRUD ====================

function SwitchArea({ switches }: { switches: Row[] }) {
  const router = useRouter();
  const [addState, addAction, isAdding] = useActionState(addNcmSwitch, undefined);
  const [editState, editAction, isEditing] = useActionState(updateNcmSwitch, undefined);
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteNcmSwitch, undefined);
  const [credState, credAction, isCred] = useActionState(rotateNcmCredentials, undefined);
  const [editing, setEditing] = useState<Row | null>(null);
  const [credFor, setCredFor] = useState<Row | null>(null);

  useEffect(() => {
    if (addState?.success || editState?.success || deleteState?.success || credState?.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient modal state after the write round-trips (repo-wide pattern)
      setEditing(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setCredFor(null);
      router.refresh();
    }
  }, [addState?.success, editState?.success, deleteState?.success, credState?.success, router]);

  const busy = isAdding || isEditing || isDeleting || isCred;

  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionHeader icon={<Server className="size-4" />} title="Switches" subtitle="Tambah, edit, hapus switch dan rotasi kredensial" meta={`${switches.length} switch`} />
      <ResultBanner state={addState} />
      <ResultBanner state={editState} />
      <ResultBanner state={deleteState} />
      <ResultBanner state={credState} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2 pr-3">Nama</th>
              <th className="py-2 pr-3">IP</th>
              <th className="py-2 pr-3">Protokol</th>
              <th className="py-2 pr-3">Port</th>
              <th className="py-2 pr-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {switches.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-sm text-ops-muted">Belum ada switch terdaftar.</td></tr>
            )}
            {switches.map((sw) => {
              const id = pick(sw, "id", "switch_id", "switchId");
              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3 font-medium text-white">{pick(sw, "name", "hostname") || "-"}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-300">{pick(sw, "ip_address", "ip", "host") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300">{pick(sw, "protocol") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300">{pick(sw, "port") || "-"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex justify-end gap-1">
                      <ActionButton size="sm" variant="secondary" title="Edit switch" onClick={() => setEditing(sw)}>Edit</ActionButton>
                      <ActionButton size="sm" variant="secondary" title="Rotasi kredensial" onClick={() => setCredFor(sw)}><KeyRound className="size-3.5" /></ActionButton>
                      <ActionButton size="sm" variant="danger" title="Hapus switch" disabled={busy} formAction={deleteAction} onClick={() => {}}>
                        <input type="hidden" name="id" value={id} />
                        Hapus
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form action={addAction} className="grid gap-3 border-t border-slate-800 pt-3 md:grid-cols-4">
        <label className={labelClass}>Nama<input name="name" required className={inputClass} /></label>
        <label className={labelClass}>IP (opsional)<input name="ip" placeholder="10.0.0.3" className={inputClass} /></label>
        <label className={labelClass}>
          Protokol
          <select name="protocol" className={inputClass} defaultValue="">
            <option value="">—</option>
            <option value="ssh">ssh</option>
            <option value="telnet">telnet</option>
            <option value="snmp">snmp</option>
          </select>
        </label>
        <label className={labelClass}>Port (opsional)<input name="port" inputMode="numeric" className={inputClass} /></label>
        <div className="flex justify-end md:col-span-4"><ActionButton type="submit" isPending={isAdding}><Plus className="size-4" />Tambah Switch</ActionButton></div>
      </form>

      {editing && (
        <form action={editAction} className="grid gap-3 rounded-lg border border-ops-accent/30 bg-ops-accent/5 p-3 md:grid-cols-4">
          <input type="hidden" name="id" value={pick(editing, "id", "switch_id", "switchId")} />
          <label className={labelClass}>Nama<input name="name" defaultValue={pick(editing, "name", "hostname")} required className={inputClass} /></label>
          <label className={labelClass}>IP<input name="ip" defaultValue={pick(editing, "ip_address", "ip", "host")} className={inputClass} /></label>
          <label className={labelClass}>
            Protokol
            <select name="protocol" defaultValue={pick(editing, "protocol")} className={inputClass}>
              <option value="">—</option>
              <option value="ssh">ssh</option>
              <option value="telnet">telnet</option>
              <option value="snmp">snmp</option>
            </select>
          </label>
          <label className={labelClass}>Port<input name="port" defaultValue={pick(editing, "port")} inputMode="numeric" className={inputClass} /></label>
          <div className="flex justify-end gap-2 md:col-span-4">
            <ActionButton type="button" variant="ghost" onClick={() => setEditing(null)}>Batal</ActionButton>
            <ActionButton type="submit" isPending={isEditing}>Simpan</ActionButton>
          </div>
        </form>
      )}

      {credFor && (
        <form action={credAction} className="grid gap-3 rounded-lg border border-ops-accent/30 bg-ops-accent/5 p-3 md:grid-cols-3">
          <input type="hidden" name="switchId" value={pick(credFor, "id", "switch_id", "switchId")} />
          <p className="text-sm text-slate-300 md:col-span-3">Rotasi kredensial untuk <span className="font-semibold text-white">{pick(credFor, "name", "hostname") || `#${pick(credFor, "id")}`}</span>. Password diteruskan ke NCM dan tidak pernah disimpan/log di DG.</p>
          <label className={labelClass}>Username<input name="username" required autoComplete="off" className={inputClass} /></label>
          <label className={labelClass}>Password<input name="password" type="password" required autoComplete="new-password" className={inputClass} /></label>
          <div className="flex items-end justify-end gap-2">
            <ActionButton type="button" variant="ghost" onClick={() => setCredFor(null)}>Batal</ActionButton>
            <ActionButton type="submit" isPending={isCred}>Rotasi</ActionButton>
          </div>
        </form>
      )}
    </section>
  );
}

// ==================== Area 2: Backups & Schedules ====================

function BackupArea({ switches, jobs, backups }: { switches: Row[]; jobs: Row[]; backups: Row[] }) {
  const router = useRouter();
  const [schedState, schedAction, isSched] = useActionState(updateNcmSchedule, undefined);
  const [backupState, backupAction, isBackup] = useActionState(triggerNcmBackup, undefined);
  const [baselineState, baselineAction, isBaseline] = useActionState(createNcmBaseline, undefined);
  const [editingJob, setEditingJob] = useState<Row | null>(null);

  useEffect(() => {
    if (schedState?.success || backupState?.success || baselineState?.success) router.refresh();
  }, [schedState?.success, backupState?.success, baselineState?.success, router]);

  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionHeader icon={<DatabaseBackup className="size-4" />} title="Backups & Schedules" subtitle="Ubah jadwal, picu backup on-demand, buat baseline dari backup" meta={`${backups.length} backup · ${jobs.length} job`} />
      <ResultBanner state={schedState} />
      <ResultBanner state={backupState} />
      <ResultBanner state={baselineState} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2 pr-3">Backup</th>
              <th className="py-2 pr-3">Switch</th>
              <th className="py-2 pr-3">Dibuat</th>
              <th className="py-2 pr-3">Ukuran</th>
              <th className="py-2 pr-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-sm text-ops-muted">Belum ada backup.</td></tr>
            )}
            {backups.map((bk) => {
              const id = pick(bk, "id", "backup_id", "backupId");
              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3 font-medium text-white">#{id}</td>
                  <td className="py-2 pr-3 text-slate-300">{pick(bk, "switch_name", "switchName", "switch_id", "switchId") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300">{formatDate(pick(bk, "created_at", "createdAt", "taken_at"))}</td>
                  <td className="py-2 pr-3 text-slate-300">{pick(bk, "size_bytes", "sizeBytes", "size") || "-"}</td>
                  <td className="py-2 pr-3 text-right">
                    <form action={baselineAction} className="inline-flex">
                      <input type="hidden" name="backupId" value={id} />
                      <ActionButton size="sm" variant="secondary" isPending={isBaseline} title="Buat baseline golden dari backup ini"><Layers className="size-3.5" />Baseline</ActionButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border-t border-slate-800 pt-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2 pr-3">Job</th>
              <th className="py-2 pr-3">Jadwal (cron)</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={4} className="py-3 text-sm text-ops-muted">Belum ada job terjadwal.</td></tr>
            )}
            {jobs.map((job) => {
              const id = pick(job, "id", "job_id", "jobId");
              const enabled = pick(job, "enabled", "is_enabled") === "true";
              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3 font-medium text-white">#{id} {pick(job, "job_type", "type", "name")}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-300">{pick(job, "schedule", "cron") || "-"}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium ${enabled ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}>
                      {enabled ? "aktif" : "nonaktif"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <ActionButton size="sm" variant="secondary" onClick={() => setEditingJob(job)}>Edit</ActionButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingJob && (
        <form action={schedAction} className="grid gap-3 rounded-lg border border-ops-accent/30 bg-ops-accent/5 p-3 md:grid-cols-3">
          <input type="hidden" name="jobId" value={pick(editingJob, "id", "job_id", "jobId")} />
          <label className={labelClass}>Jadwal (cron)<input name="schedule" defaultValue={pick(editingJob, "schedule", "cron")} required className={inputClass} /></label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
            <input type="checkbox" name="enabled" defaultChecked={pick(editingJob, "enabled", "is_enabled") === "true"} className="size-4" />
            Aktif
          </label>
          <div className="flex items-end justify-end gap-2">
            <ActionButton type="button" variant="ghost" onClick={() => setEditingJob(null)}>Batal</ActionButton>
            <ActionButton type="submit" isPending={isSched}>Simpan Jadwal</ActionButton>
          </div>
        </form>
      )}

      <form action={backupAction} className="flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
        <label className={`${labelClass} min-w-56 flex-1`}>
          Picu backup on-demand
          <select name="switchId" className={inputClass} required>
            <option value="">Pilih switch…</option>
            {switches.map((sw) => {
              const id = pick(sw, "id", "switch_id", "switchId");
              return <option key={id} value={id}>{pick(sw, "name", "hostname") || `#${id}`}</option>;
            })}
          </select>
        </label>
        <ActionButton type="submit" isPending={isBackup}><Clock className="size-4" />Backup Sekarang</ActionButton>
      </form>
    </section>
  );
}

// ==================== Area 3: Baselines & Reviews ====================

function ReviewArea({ baselines, reviews }: { baselines: Row[]; reviews: Row[] }) {
  const router = useRouter();
  const [decideState, decideAction, isDeciding] = useActionState(decideNcmReview, undefined);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState<number | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (decideState?.success) router.refresh();
  }, [decideState?.success, router]);

  async function loadDiff(reviewId: number) {
    setLoadingDiff(reviewId);
    setDetailError(null);
    try {
      const result = (await getNcmReviewDetail(reviewId)) as Row;
      if (result.message) {
        setDetailError(String(result.message));
        setDetail(null);
      } else {
        setDetail(result);
      }
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
      setDetail(null);
    } finally {
      setLoadingDiff(null);
    }
  }

  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionHeader icon={<GitCompareArrows className="size-4" />} title="Baselines & Reviews" subtitle="Baseline golden dan antrian review drift" meta={`${baselines.length} baseline · ${reviews.length} review`} />
      <ResultBanner state={decideState} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2 pr-3">Baseline</th>
              <th className="py-2 pr-3">Dari backup</th>
              <th className="py-2 pr-3">Dibuat</th>
            </tr>
          </thead>
          <tbody>
            {baselines.length === 0 && (
              <tr><td colSpan={3} className="py-3 text-sm text-ops-muted">Belum ada baseline golden.</td></tr>
            )}
            {baselines.map((bl) => (
              <tr key={pick(bl, "id", "baseline_id", "baselineId")} className="border-t border-slate-800">
                <td className="py-2 pr-3 font-medium text-white">#{pick(bl, "id", "baseline_id", "baselineId")}</td>
                <td className="py-2 pr-3 text-slate-300">#{pick(bl, "backup_id", "backupId") || "-"}</td>
                <td className="py-2 pr-3 text-slate-300">{formatDate(pick(bl, "created_at", "createdAt"))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-2">
        {reviews.length === 0 && <p className="text-sm text-ops-muted">Tidak ada review menunggu keputusan.</p>}
        {reviews.map((rv) => {
          const id = pick(rv, "id", "review_id", "reviewId");
          const status = pick(rv, "status", "state") || "pending";
          return (
            <div key={id} className="rounded-lg border border-slate-700/50 bg-slate-900/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-300">
                  <span className="font-semibold text-white">Review #{id}</span>
                  <span className="ml-2 inline-flex h-6 items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2 text-[11px] font-medium text-amber-300">{status}</span>
                  {pick(rv, "switch_name", "switchName", "switch_id") && (
                    <span className="ml-2 text-xs text-ops-muted">{pick(rv, "switch_name", "switchName", "switch_id")}</span>
                  )}
                </div>
                <ActionButton size="sm" variant="secondary" isPending={loadingDiff === Number(id)} onClick={() => loadDiff(Number(id))}>
                  <GitCompareArrows className="size-3.5" />Lihat Diff
                </ActionButton>
              </div>

              {detail && pick(detail, "id") === id && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300">{pick(detail, "diff", "config_diff", "patch") || "(diff kosong)"}</pre>
              )}
              {detailError && <p className="mt-2 text-sm text-red-300">{detailError}</p>}

              {status === "pending" && (
                <form action={decideAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="reviewId" value={id} />
                  <input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className={`${inputClass} h-8 max-w-64 flex-1`} />
                  <button type="submit" name="decision" value="approve" disabled={isDeciding} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-ops-accent px-3 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#0a7a6f] disabled:opacity-55">
                    <ShieldCheck className="size-3.5" />Approve
                  </button>
                  <button type="submit" name="decision" value="reject" disabled={isDeciding} className="inline-flex h-8 items-center rounded-md border border-red-500/30 bg-red-500/12 px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-55 dark:text-red-200">
                    Reject
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ==================== Area 4: Connection (superadmin-only) ====================

function ConnectionArea({ overview, isSuperadmin }: { overview: NcmOverview & { status: "online" | "offline" | "unconfigured" }; isSuperadmin: boolean }) {
  const url = "url" in overview ? overview.url : null;
  const lastSeen = "lastSeenAt" in overview ? overview.lastSeenAt : null;
  return (
    <section className={`${cardClass} space-y-2`}>
      <SectionHeader icon={<Router className="size-4" />} title="Connection" subtitle="Koneksi per site ke aplikasi NCM" />
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        <div><dt className="text-xs uppercase text-ops-muted">URL</dt><dd className="font-mono text-xs text-slate-300">{url || "—"}</dd></div>
        <div><dt className="text-xs uppercase text-ops-muted">Terakhir terlihat</dt><dd className="text-slate-300">{formatLastSeen(lastSeen)}</dd></div>
      </dl>
      <p className="text-xs text-ops-muted">
        {isSuperadmin
          ? <>Atur URL dan Admin API Key di <Link href="/admin/settings" className="text-ops-accent hover:underline">Settings → NCM Connection</Link>.</>
          : "Pengaturan koneksi hanya dapat diubah superadmin."}
      </p>
    </section>
  );
}

// ==================== Root ====================

export default function NcmDashboard({ overview, isSuperadmin }: { overview: NcmOverview; isSuperadmin: boolean }) {
  const router = useRouter();
  if (overview.status === "unconfigured") {
    return (
      <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-200">
        <p className="font-semibold">NCM belum dikonfigurasi untuk site ini.</p>
        <p className="mt-1">{overview.message}</p>
        {isSuperadmin && (
          <ActionButton className="mt-3" size="sm" href="/admin/settings">Buka Settings</ActionButton>
        )}
      </div>
    );
  }

  if (overview.status === "offline") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-200">
          <WifiOff className="size-5 shrink-0" />
          <div>
            <p className="font-semibold">NCM offline — terakhir terlihat {formatLastSeen(overview.lastSeenAt)}</p>
            <p className="mt-0.5 text-xs text-red-300/80">{overview.error}</p>
          </div>
          <ActionButton className="ml-auto" size="sm" variant="secondary" onClick={() => router.refresh()}><RefreshCw className="size-3.5" />Coba lagi</ActionButton>
        </div>
        <ConnectionArea overview={overview} isSuperadmin={isSuperadmin} />
      </div>
    );
  }

  const switches = asRows(overview.switches);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-emerald-300">
        <Activity className="size-4" />NCM online — {overview.url}
        <RefreshCw className="ml-2 size-3.5 text-ops-muted" />
      </div>
      <SwitchArea switches={switches} />
      <BackupArea switches={switches} jobs={asRows(overview.jobs)} backups={asRows(overview.backups)} />
      <ReviewArea baselines={asRows(overview.baselines)} reviews={asRows(overview.reviews)} />
      <ConnectionArea overview={overview} isSuperadmin={isSuperadmin} />
    </div>
  );
}
