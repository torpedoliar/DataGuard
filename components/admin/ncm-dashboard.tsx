"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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

function formatBytes(bytes: unknown): string {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return String(bytes || "-");
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

const cardClass = "rounded-lg border border-slate-700/50 bg-slate-900/40 p-4";
const inputClass = "h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white";
const labelClass = "space-y-1 text-sm font-medium text-slate-300";

const PROTOCOLS = [
  { value: "ssh", label: "SSH (CLI)", defaultPort: 22 },
  { value: "telnet", label: "Telnet (CLI)", defaultPort: 23 },
  { value: "websmart", label: "WebSmart Traditional (HTTP POST)", defaultPort: 80 },
  { value: "websmart-v2", label: "WebSmart V2 (RSA Encrypted API)", defaultPort: 80 },
  { value: "http", label: "HTTP Web UI", defaultPort: 80 },
  { value: "https", label: "HTTPS Web UI", defaultPort: 443 },
  { value: "snmp", label: "SNMP", defaultPort: 161 },
] as const;

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

function SwitchArea({
  switches,
  credentials,
  inventoryDevices,
}: {
  switches: Row[];
  credentials: Row[];
  inventoryDevices: Row[];
}) {
  const router = useRouter();
  const [addState, addAction, isAdding] = useActionState(addNcmSwitch, undefined);
  const [editState, editAction, isEditing] = useActionState(updateNcmSwitch, undefined);
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteNcmSwitch, undefined);
  const [credState, credAction, isCred] = useActionState(rotateNcmCredentials, undefined);
  const [editing, setEditing] = useState<Row | null>(null);
  const [credFor, setCredFor] = useState<Row | null>(null);

  // Form states for Add Switch
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("");
  const [switchName, setSwitchName] = useState<string>("");
  const [switchIp, setSwitchIp] = useState<string>("");
  const [switchModel, setSwitchModel] = useState<string>("");
  const [switchProtocol, setSwitchProtocol] = useState<string>("ssh");
  const [switchPort, setSwitchPort] = useState<string>("22");
  const [credMode, setCredMode] = useState<"new" | "existing">(credentials.length > 0 ? "existing" : "new");

  useEffect(() => {
    if (addState?.success || editState?.success || deleteState?.success || credState?.success) {
      setEditing(null);
      setCredFor(null);
      setSelectedInventoryId("");
      setSwitchName("");
      setSwitchIp("");
      setSwitchModel("");
      setSwitchProtocol("ssh");
      setSwitchPort("22");
      router.refresh();
    }
  }, [addState?.success, editState?.success, deleteState?.success, credState?.success, router]);

  function handleSelectInventory(devId: string) {
    setSelectedInventoryId(devId);
    if (!devId) return;
    const dev = inventoryDevices.find((d) => String(d.id) === devId);
    if (dev) {
      setSwitchName(pick(dev, "name"));
      setSwitchIp(pick(dev, "ipAddress", "ip_address", "ip"));
      const brand = pick(dev, "brandName", "brand_name", "brand");
      const desc = pick(dev, "description");
      const combinedModel = [brand, desc].filter(Boolean).join(" ");
      setSwitchModel(combinedModel || brand || desc || "");
    }
  }

  function handleProtocolChange(val: string) {
    setSwitchProtocol(val);
    const found = PROTOCOLS.find((p) => p.value === val);
    if (found) {
      setSwitchPort(String(found.defaultPort));
    }
  }

  const busy = isAdding || isEditing || isDeleting || isCred;

  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionHeader icon={<Server className="size-4" />} title="Switches" subtitle="Tambah, edit, hapus switch dan pengaturan kredensial backup" meta={`${switches.length} switch`} />
      <ResultBanner state={addState} />
      <ResultBanner state={editState} />
      <ResultBanner state={deleteState} />
      <ResultBanner state={credState} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2 pr-3">Nama &amp; Seri</th>
              <th className="py-2 pr-3">IP Address</th>
              <th className="py-2 pr-3">Protokol</th>
              <th className="py-2 pr-3">Port</th>
              <th className="py-2 pr-3">Kredensial</th>
              <th className="py-2 pr-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {switches.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-sm text-ops-muted">Belum ada switch terdaftar.</td></tr>
            )}
            {switches.map((sw) => {
              const id = pick(sw, "id", "switch_id", "switchId");
              const model = pick(sw, "model", "switch_model");
              const credName = (sw.credential as { name?: string } | undefined)?.name || pick(sw, "credential_name");
              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-white">{pick(sw, "name", "hostname") || "-"}</div>
                    {model && <div className="text-xs text-ops-muted">{model}</div>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-300">{pick(sw, "ip_address", "ip", "host") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300 font-mono text-xs">{pick(sw, "protocol") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300 font-mono text-xs">{pick(sw, "port") || "-"}</td>
                  <td className="py-2 pr-3 text-slate-300">
                    {credName ? (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 border border-slate-700">
                        <KeyRound className="size-3 text-ops-accent" />
                        {credName}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
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

      {/* FORM TAMBAH SWITCH LENGKAP */}
      <form action={addAction} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 pt-3">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <Plus className="size-4 text-ops-accent" />
          <span>Tambah Switch Baru</span>
        </div>

        {/* 1. Ambil dari Inventory DC-Check */}
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">
              Ambil Data dari Inventory DC-Check (Opsional)
            </span>
            {inventoryDevices.length > 0 && (
              <span className="text-[11px] text-ops-muted">
                {inventoryDevices.length} perangkat tersedia di site aktif
              </span>
            )}
          </div>
          <select
            className={inputClass}
            value={selectedInventoryId}
            onChange={(e) => handleSelectInventory(e.target.value)}
          >
            <option value="">— Input manual switch baru (bukan dari inventory) —</option>
            {inventoryDevices.map((dev) => {
              const devId = pick(dev, "id");
              const devName = pick(dev, "name");
              const devIp = pick(dev, "ipAddress", "ip_address", "ip");
              const devBrand = pick(dev, "brandName", "brand_name", "brand");
              const devCat = pick(dev, "categoryName", "category_name", "category");
              const devDesc = pick(dev, "description");
              return (
                <option key={devId} value={devId}>
                  {devName} {devIp ? `(${devIp})` : "(tanpa IP)"} — {devBrand || ""} {devCat || ""} {devDesc ? `· ${devDesc}` : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* 2. Informasi Switch */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Nama Switch *
            <input
              name="name"
              required
              value={switchName}
              onChange={(e) => setSwitchName(e.target.value)}
              placeholder="e.g. SW-CORE-01"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            IP Address
            <input
              name="ip"
              value={switchIp}
              onChange={(e) => setSwitchIp(e.target.value)}
              placeholder="10.10.0.1"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Seri / Model Switch
            <input
              name="model"
              value={switchModel}
              onChange={(e) => setSwitchModel(e.target.value)}
              placeholder="e.g. GS950/52PS V2, FS750"
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>
              Protokol
              <select
                name="protocol"
                value={switchProtocol}
                onChange={(e) => handleProtocolChange(e.target.value)}
                className={inputClass}
              >
                {PROTOCOLS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Port
              <input
                name="port"
                inputMode="numeric"
                value={switchPort}
                onChange={(e) => setSwitchPort(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        </div>

        {/* 3. Pengaturan Kredensial Backup */}
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-slate-200">Pengaturan Credential Backup:</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="credModeSelection"
                  checked={credMode === "new"}
                  onChange={() => setCredMode("new")}
                  className="size-3.5"
                />
                Buat Kredensial Baru
              </label>
              {credentials.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                  <input
                    type="radio"
                    name="credModeSelection"
                    checked={credMode === "existing"}
                    onChange={() => setCredMode("existing")}
                    className="size-3.5"
                  />
                  Gunakan Profil NCM yang Ada ({credentials.length})
                </label>
              )}
            </div>
          </div>

          {credMode === "new" ? (
            <div className="grid gap-3 sm:grid-cols-3 pt-1">
              <label className={labelClass}>
                Username Backup *
                <input
                  name="username"
                  required
                  autoComplete="off"
                  placeholder="manager / admin"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Password Backup *
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Password switch"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Enable Password (opsional)
                <input
                  name="enablePassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enable secret (bila ada)"
                  className={inputClass}
                />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 pt-1">
              <label className={labelClass}>
                Pilih Profil Kredensial NCM *
                <select name="credentialId" required className={inputClass}>
                  <option value="">Pilih profil kredensial…</option>
                  {credentials.map((c) => {
                    const cId = pick(c, "id");
                    const cName = pick(c, "name");
                    const cUser = pick(c, "username");
                    return (
                      <option key={cId} value={cId}>
                        {cName} {cUser ? `(user: ${cUser})` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <ActionButton type="submit" isPending={isAdding}>
            <Plus className="size-4" />
            Tambah Switch
          </ActionButton>
        </div>
      </form>

      {/* EDIT MODAL */}
      {editing && (
        <form action={editAction} className="grid gap-3 rounded-lg border border-ops-accent/30 bg-ops-accent/5 p-4 md:grid-cols-4">
          <input type="hidden" name="id" value={pick(editing, "id", "switch_id", "switchId")} />
          <div className="md:col-span-4 text-xs font-semibold uppercase tracking-wider text-ops-accent">
            Edit Switch #{pick(editing, "id", "switch_id", "switchId")}
          </div>
          <label className={labelClass}>Nama<input name="name" defaultValue={pick(editing, "name", "hostname")} required className={inputClass} /></label>
          <label className={labelClass}>IP<input name="ip" defaultValue={pick(editing, "ip_address", "ip", "host")} className={inputClass} /></label>
          <label className={labelClass}>Seri / Model<input name="model" defaultValue={pick(editing, "model", "switch_model")} placeholder="e.g. GS950/52PS" className={inputClass} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>
              Protokol
              <select name="protocol" defaultValue={pick(editing, "protocol") || "ssh"} className={inputClass}>
                {PROTOCOLS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>Port<input name="port" defaultValue={pick(editing, "port")} inputMode="numeric" className={inputClass} /></label>
          </div>

          {credentials.length > 0 && (
            <label className={`${labelClass} md:col-span-4`}>
              Ganti Profil Kredensial NCM (opsional)
              <select name="credentialId" defaultValue={pick(editing, "credential_id", "credentialId")} className={inputClass}>
                <option value="">(Pertahankan kredensial saat ini)</option>
                {credentials.map((c) => {
                  const cId = pick(c, "id");
                  const cName = pick(c, "name");
                  const cUser = pick(c, "username");
                  return <option key={cId} value={cId}>{cName} {cUser ? `(user: ${cUser})` : ""}</option>;
                })}
              </select>
            </label>
          )}

          <div className="flex justify-end gap-2 md:col-span-4 pt-1">
            <ActionButton type="button" variant="ghost" onClick={() => setEditing(null)}>Batal</ActionButton>
            <ActionButton type="submit" isPending={isEditing}>Simpan Perubahan</ActionButton>
          </div>
        </form>
      )}

      {/* ROTATE CREDENTIALS MODAL */}
      {credFor && (
        <form action={credAction} className="grid gap-3 rounded-lg border border-ops-accent/30 bg-ops-accent/5 p-4 md:grid-cols-3">
          <input type="hidden" name="switchId" value={pick(credFor, "id", "switch_id", "switchId")} />
          <p className="text-sm text-slate-300 md:col-span-3">
            Rotasi kredensial untuk <span className="font-semibold text-white">{pick(credFor, "name", "hostname") || `#${pick(credFor, "id")}`}</span>. Password diteruskan ke NCM dan tidak pernah disimpan di database DG.
          </p>
          <label className={labelClass}>Username<input name="username" required autoComplete="off" className={inputClass} /></label>
          <label className={labelClass}>Password<input name="password" type="password" required autoComplete="new-password" className={inputClass} /></label>
          <div className="flex items-end justify-end gap-2">
            <ActionButton type="button" variant="ghost" onClick={() => setCredFor(null)}>Batal</ActionButton>
            <ActionButton type="submit" isPending={isCred}>Rotasi Kredensial</ActionButton>
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

  const switchMap = useMemo(() => {
    return new Map(switches.map((s) => [pick(s, "id", "switch_id", "switchId"), s]));
  }, [switches]);

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
              <th className="py-2 pr-3">Switch &amp; Seri</th>
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
              const swId = pick(bk, "switch_id", "switchId");
              const sw = switchMap.get(swId);
              const switchName = pick(bk, "switch_name", "switchName") || (sw ? pick(sw, "name", "hostname") : "") || (swId ? `Switch #${swId}` : "-");
              const switchModel = pick(bk, "switch_model", "switchModel", "model") || (sw ? pick(sw, "model") : "");
              const sizeFormatted = formatBytes(pick(bk, "size_bytes", "sizeBytes", "size"));

              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3 font-mono font-medium text-white">#{id}</td>
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-white">{switchName}</div>
                    {switchModel ? (
                      <div className="text-xs text-ops-muted">{switchModel}</div>
                    ) : (
                      <div className="text-[11px] text-slate-500 font-mono">ID: #{swId}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{formatDate(pick(bk, "created_at", "createdAt", "taken_at"))}</td>
                  <td className="py-2 pr-3 text-slate-300 font-mono text-xs">{sizeFormatted}</td>
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
              const model = pick(sw, "model", "switch_model");
              return <option key={id} value={id}>{pick(sw, "name", "hostname") || `#${id}`} {model ? `(${model})` : ""}</option>;
            })}
          </select>
        </label>
        <ActionButton type="submit" isPending={isBackup}><Clock className="size-4" />Backup Sekarang</ActionButton>
      </form>
    </section>
  );
}

// ==================== Area 3: Baselines & Reviews ====================

function ReviewArea({
  baselines,
  reviews,
  switches,
}: {
  baselines: Row[];
  reviews: Row[];
  switches: Row[];
}) {
  const router = useRouter();
  const [decideState, decideAction, isDeciding] = useActionState(decideNcmReview, undefined);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const switchMap = useMemo(() => {
    return new Map(switches.map((s) => [pick(s, "id", "switch_id", "switchId"), s]));
  }, [switches]);

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
              <th className="py-2 pr-3">Switch / Target</th>
              <th className="py-2 pr-3">Seri / Model</th>
              <th className="py-2 pr-3">Dari Backup</th>
              <th className="py-2 pr-3">Dibuat</th>
              <th className="py-2 pr-3">Status Review / Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {baselines.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-sm text-ops-muted">Belum ada baseline golden.</td></tr>
            )}
            {baselines.map((bl) => {
              const id = pick(bl, "id", "baseline_id", "baselineId");
              const swId = pick(bl, "switch_id", "switchId");
              const sw = switchMap.get(swId);
              const kind = pick(bl, "kind") || "switch";
              const targetName = pick(bl, "switch_name", "switchName") || (sw ? pick(sw, "name", "hostname") : "") || (kind === "model" ? `Template Model: ${pick(bl, "model")}` : (swId ? `Switch #${swId}` : "—"));
              const model = pick(bl, "model") || (sw ? pick(sw, "model") : "") || "—";
              const backupId = pick(bl, "backup_id", "backupId") || "—";
              const createdAt = formatDate(pick(bl, "created_at", "createdAt"));
              const reviewer = pick(bl, "last_reviewed_by_name", "lastReviewedByName");
              const reviewStatus = pick(bl, "last_review_status", "lastReviewStatus");

              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-2 pr-3 font-mono font-medium text-white">#{id}</td>
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-white">{targetName}</div>
                    <div className="text-[11px] text-ops-muted">{kind === "model" ? "Template Model" : "Per switch"}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-300">{model}</td>
                  <td className="py-2 pr-3 font-mono text-slate-300">#{backupId}</td>
                  <td className="py-2 pr-3 text-slate-300">{createdAt}</td>
                  <td className="py-2 pr-3">
                    {reviewStatus ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${reviewStatus === "approved" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : reviewStatus === "flagged" ? "border-red-400/25 bg-red-400/10 text-red-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
                        {reviewStatus.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-xs text-ops-muted">Aktif</span>
                    )}
                    {reviewer && <div className="text-[11px] text-slate-400 mt-0.5">Oleh: {reviewer}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-2">
        {reviews.length === 0 && <p className="text-sm text-ops-muted">Tidak ada review menunggu keputusan.</p>}
        {reviews.map((rv) => {
          const id = pick(rv, "id", "review_id", "reviewId");
          const status = pick(rv, "status", "state") || "pending";
          const swId = pick(rv, "switch_id", "switchId");
          const sw = switchMap.get(swId);
          const switchName = pick(rv, "switch_name", "switchName") || (sw ? pick(sw, "name", "hostname") : "") || (swId ? `Switch #${swId}` : "");
          return (
            <div key={id} className="rounded-lg border border-slate-700/50 bg-slate-900/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-300">
                  <span className="font-semibold text-white">Review #{id}</span>
                  <span className="ml-2 inline-flex h-6 items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2 text-[11px] font-medium text-amber-300">{status}</span>
                  {switchName && (
                    <span className="ml-2 text-xs text-ops-muted">{switchName}</span>
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

export default function NcmDashboard({
  overview,
  inventoryDevices = [],
  isSuperadmin,
}: {
  overview: NcmOverview;
  inventoryDevices?: Row[];
  isSuperadmin: boolean;
}) {
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
  const jobs = asRows(overview.jobs);
  const backups = asRows(overview.backups);
  const baselines = asRows(overview.baselines);
  const reviews = asRows(overview.reviews);
  const credentials = asRows(overview.credentials);

  return (
    <div className="space-y-4">
      <SwitchArea
        switches={switches}
        credentials={credentials}
        inventoryDevices={inventoryDevices}
      />
      <BackupArea
        switches={switches}
        jobs={jobs}
        backups={backups}
      />
      <ReviewArea
        baselines={baselines}
        reviews={reviews}
        switches={switches}
      />
      <ConnectionArea overview={overview} isSuperadmin={isSuperadmin} />
    </div>
  );
}
