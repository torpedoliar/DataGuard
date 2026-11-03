"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, GitCompareArrows, Search, X } from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import StatsCard from "@/components/ui/stats-card";
import { DataTableEmpty } from "@/components/ui/data-table";
import { getNcmBackupDecodeAction, getNcmBackupDiffAction, getNcmBackupSideBySideAction } from "@/actions/ncm";

export type NcmChangeRow = {
  switchId: number;
  switchName: string;
  model: string | null;
  baselineBackupId: number | null;
  baselineAt: string | null;
  latestBackupId: number | null;
  latestAt: string | null;
  latestSeq: number | null;
  state: "changed" | "clean" | "no-baseline" | "no-backup";
};

type DecodeVlan = { id: number; name: string | null };

type DecodePort = {
  name: string;
  description: string | null;
  enabled: boolean;
  mode: string;
  native_vlan: number | null;
  access_vlan: number | null;
  trunk_allowed_vlans: number[];
};

type DecodedBackup = {
  backup_id: number;
  hostname: string | null;
  dialect: string;
  vlans: DecodeVlan[];
  ports: DecodePort[];
  parse_warnings?: string[];
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDateShort(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATE_META: Record<NcmChangeRow["state"], { label: string; className: string }> = {
  changed: { label: "BERUBAH", className: "border-ops-warning/25 bg-ops-warning-soft text-ops-warning" },
  clean: { label: "SAMA", className: "border-ops-success/25 bg-ops-success-soft text-ops-success" },
  "no-baseline": { label: "TANPA BASELINE", className: "border-ops-border-strong bg-ops-surface-raised text-ops-muted" },
  "no-backup": { label: "BELUM ADA BACKUP", className: "border-ops-danger/25 bg-ops-danger-soft text-ops-danger" },
};

function portKey(port: DecodePort): string {
  return [
    port.mode || "",
    port.native_vlan ?? "",
    port.access_vlan ?? "",
    (port.trunk_allowed_vlans || []).join(","),
    port.enabled ? "up" : "down",
  ].join("|");
}

function DecodeView({ baselineId, latestId }: { baselineId: number | null; latestId: number }) {
  const [baseline, setBaseline] = useState<DecodedBackup | null>(null);
  const [latest, setLatest] = useState<DecodedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const basePromise: Promise<{ success: boolean; data?: unknown; message?: string }> = baselineId
      ? getNcmBackupDecodeAction(baselineId)
      : Promise.resolve({ success: false, message: "Tanpa baseline" });

    Promise.all([getNcmBackupDecodeAction(latestId), basePromise])
      .then(([latestRes, baseRes]) => {
        if (cancelled) return;
        if (!latestRes.success || !latestRes.data) {
          setError(latestRes.message || "Gagal decode backup terakhir.");
          return;
        }
        setLatest(latestRes.data as DecodedBackup);
        if (baseRes.success && baseRes.data) setBaseline(baseRes.data as DecodedBackup);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [baselineId, latestId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-ops-muted">
        <Clock className="size-4 animate-spin text-ops-accent" />
        Mendecode konfigurasi baseline & backup terakhir…
      </div>
    );
  }

  if (error || !latest) {
    return (
      <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
        {error || "Data decode tidak tersedia."}
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="space-y-2 text-xs">
        <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
          Switch ini belum punya golden baseline. Yang ditampilkan hanya hasil decode backup terakhir.
        </div>
        <div className="text-ops-muted">
          Hostname: <strong className="text-ops-text">{latest.hostname || "—"}</strong> · Dialect:{" "}
          <strong className="text-ops-text">{latest.dialect}</strong> · VLAN {latest.vlans.length} · Port{" "}
          {latest.ports.length}
        </div>
      </div>
    );
  }

  const baseVlanKeys = new Set(baseline.vlans.map((v) => v.id + "=" + (v.name || "")));
  const latestVlanKeys = new Set(latest.vlans.map((v) => v.id + "=" + (v.name || "")));
  const vlansAdded = latest.vlans.filter((v) => !baseVlanKeys.has(v.id + "=" + (v.name || "")));
  const vlansRemoved = baseline.vlans.filter((v) => !latestVlanKeys.has(v.id + "=" + (v.name || "")));

  const basePorts = new Map(baseline.ports.map((p) => [p.name, p]));
  const latestPorts = new Map(latest.ports.map((p) => [p.name, p]));
  const portsChanged: { name: string; from: DecodePort; to: DecodePort }[] = [];
  for (const [name, to] of latestPorts) {
    const from = basePorts.get(name);
    if (from && portKey(from) !== portKey(to)) portsChanged.push({ name, from, to });
  }
  const portsAdded = [...latestPorts.keys()].filter((name) => !basePorts.has(name));
  const portsRemoved = [...basePorts.keys()].filter((name) => !latestPorts.has(name));
  const hostnameChanged = (baseline.hostname || "") !== (latest.hostname || "");

  const identical =
    vlansAdded.length === 0 &&
    vlansRemoved.length === 0 &&
    portsChanged.length === 0 &&
    portsAdded.length === 0 &&
    portsRemoved.length === 0 &&
    !hostnameChanged;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-ops-success/25 bg-ops-success-soft px-2 py-0.5 font-semibold text-ops-success">
          +{vlansAdded.length + portsAdded.length} ditambah
        </span>
        <span className="rounded-sm border border-ops-danger/25 bg-ops-danger-soft px-2 py-0.5 font-semibold text-ops-danger">
          −{vlansRemoved.length + portsRemoved.length} dihapus
        </span>
        <span className="rounded-sm border border-ops-warning/25 bg-ops-warning-soft px-2 py-0.5 font-semibold text-ops-warning">
          ~{portsChanged.length} port berubah
        </span>
        <span className="text-ops-muted">
          Baseline #{baselineId} → backup #{latestId}
        </span>
      </div>

      {identical && (
        <div className="flex items-center gap-2 rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">
          <CheckCircle2 className="size-4" />
          <span>Konfigurasi (VLAN, port, hostname) identik dengan baseline.</span>
        </div>
      )}

      {hostnameChanged && (
        <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px]">
          Hostname: <span className="text-ops-danger line-through">{baseline.hostname || "—"}</span>
          {" → "}
          <span className="font-semibold text-ops-success">{latest.hostname || "—"}</span>
        </div>
      )}

      {vlansAdded.length > 0 && (
        <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px]">
          <span className="font-semibold text-ops-success">VLAN ditambahkan: </span>
          <span className="text-ops-text">
            {vlansAdded.map((v) => "VLAN " + v.id + (v.name ? " (" + v.name + ")" : "")).join(", ")}
          </span>
        </div>
      )}

      {vlansRemoved.length > 0 && (
        <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px]">
          <span className="font-semibold text-ops-danger">VLAN dihapus: </span>
          <span className="text-ops-text">
            {vlansRemoved.map((v) => "VLAN " + v.id + (v.name ? " (" + v.name + ")" : "")).join(", ")}
          </span>
        </div>
      )}

      {portsChanged.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[13px] font-semibold text-ops-text">Port berubah ({portsChanged.length})</span>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {portsChanged.map((entry) => {
              const fields: [string, string, string][] = [
                ["Mode", entry.from.mode || "—", entry.to.mode || "—"],
                ["Access VLAN", String(entry.from.access_vlan ?? "—"), String(entry.to.access_vlan ?? "—")],
                ["Native VLAN", String(entry.from.native_vlan ?? "—"), String(entry.to.native_vlan ?? "—")],
                [
                  "Trunk Allowed",
                  (entry.from.trunk_allowed_vlans || []).join(",") || "—",
                  (entry.to.trunk_allowed_vlans || []).join(",") || "—",
                ],
                ["Status", entry.from.enabled ? "UP" : "DOWN", entry.to.enabled ? "UP" : "DOWN"],
                ["Deskripsi", entry.from.description || "—", entry.to.description || "—"],
              ];
              const diffs = fields.filter(([, from, to]) => from !== to);
              return (
                <div key={entry.name} className="ops-panel-subtle p-2.5">
                  <div className="mb-1 font-semibold text-ops-accent">{entry.name}</div>
                  {diffs.map(([label, from, to]) => (
                    <div key={label} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-24 shrink-0 text-ops-muted">{label}</span>
                      <span className="rounded-sm bg-ops-danger/15 px-1.5 text-ops-danger">{from}</span>
                      <span className="text-ops-muted">→</span>
                      <span className="rounded-sm bg-ops-success/15 px-1.5 font-semibold text-ops-success">{to}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(portsAdded.length > 0 || portsRemoved.length > 0) && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          {portsAdded.length > 0 && (
            <span className="text-ops-success">Port baru: {portsAdded.join(", ")}</span>
          )}
          {portsRemoved.length > 0 && (
            <span className="text-ops-danger">Port hilang: {portsRemoved.join(", ")}</span>
          )}
        </div>
      )}
    </div>
  );
}

type ViewMode = "side-by-side" | "decode" | "unified";

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "side-by-side", label: "Side-by-Side" },
  { id: "decode", label: "Decode" },
  { id: "unified", label: "Unified" },
];

type SideRow = { line_a: number; line_b: number; text_a: string; text_b: string; op: string };
type SideStats = { added_lines: number; removed_lines: number; changed_lines: number; total_changes: number };

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-xs text-ops-muted">
      <Clock className="size-4 animate-spin text-ops-accent" />
      {label}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
      {message}
    </div>
  );
}

/** Unified text diff of baseline vs latest backup (NCM /backups/diff). */
function UnifiedView({ leftId, rightId }: { leftId: number; rightId: number }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNcmBackupDiffAction(leftId, rightId)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setLines(res.diff.split("\n"));
        else setError(res.message);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId]);

  if (error) return <ErrorRow message={error} />;
  if (!lines) return <LoadingRow label="Memuat diff terpadu…" />;

  return (
    <pre className="max-h-[28rem] overflow-auto rounded-md border border-ops-border bg-ops-surface-sunken p-3 font-mono text-[11px] leading-5 tabular-nums">
      {lines.map((line, index) => {
        const tone =
          line.startsWith("+") && !line.startsWith("+++")
            ? "text-ops-success"
            : line.startsWith("-") && !line.startsWith("---")
              ? "text-ops-danger"
              : line.startsWith("@@")
                ? "text-ops-info"
                : "text-ops-muted";
        return (
          <div key={index} className={tone}>
            <span className="mr-3 inline-block w-10 select-none text-right opacity-40">{index + 1}</span>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** Structured side-by-side rows (NCM /backups/diff/side-by-side). */
function SideBySideView({ leftId, rightId }: { leftId: number; rightId: number }) {
  const [rows, setRows] = useState<SideRow[] | null>(null);
  const [stats, setStats] = useState<SideStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNcmBackupSideBySideAction(leftId, rightId)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.message);
          return;
        }
        const payload = res.data as { rows?: SideRow[]; stats?: SideStats };
        setRows(payload.rows ?? []);
        setStats(payload.stats ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId]);

  if (error) return <ErrorRow message={error} />;
  if (!rows) return <LoadingRow label="Memuat perbandingan side-by-side…" />;

  return (
    <div className="space-y-2">
      {stats && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-sm border border-ops-success/25 bg-ops-success-soft px-2 py-0.5 font-semibold text-ops-success">
            +{stats.added_lines} baris
          </span>
          <span className="rounded-sm border border-ops-danger/25 bg-ops-danger-soft px-2 py-0.5 font-semibold text-ops-danger">
            -{stats.removed_lines} baris
          </span>
          <span className="rounded-sm border border-ops-warning/25 bg-ops-warning-soft px-2 py-0.5 font-semibold text-ops-warning">
            ~{stats.changed_lines} diubah
          </span>
        </div>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-md border border-ops-border">
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-[1] border-b border-ops-border bg-ops-surface-raised text-xs font-medium text-ops-muted">
            <tr className="text-left">
              <th className="w-10 px-2 py-1.5">A</th>
              <th className="px-2 py-1.5">Baseline</th>
              <th className="w-10 px-2 py-1.5">B</th>
              <th className="px-2 py-1.5">Backup terakhir</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border [&>tr:hover]:bg-ops-surface-raised/60">
            {rows.map((row, index) => {
              const leftTone = row.op === "delete" || row.op === "replace" ? "bg-ops-danger/10 text-ops-danger" : "text-ops-text";
              const rightTone = row.op === "insert" || row.op === "replace" ? "bg-ops-success/10 text-ops-success" : "text-ops-text";
              return (
                <tr key={index} className="align-top">
                  <td className="px-2 py-0.5 font-mono tabular-nums text-ops-muted">{row.line_a || ""}</td>
                  <td className={"px-2 py-0.5 font-mono whitespace-pre-wrap break-all " + leftTone}>
                    {row.text_a || " "}
                  </td>
                  <td className="px-2 py-0.5 font-mono tabular-nums text-ops-muted">{row.line_b || ""}</td>
                  <td className={"px-2 py-0.5 font-mono whitespace-pre-wrap break-all " + rightTone}>
                    {row.text_b || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparePanel({ baselineId, latestId }: { baselineId: number | null; latestId: number }) {
  const [mode, setMode] = useState<ViewMode>(baselineId ? "side-by-side" : "decode");
  const effective: ViewMode = baselineId ? mode : "decode";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-md border border-ops-border bg-ops-surface-sunken p-0.5 text-[11px]">
          {VIEW_MODES.map((view) => {
            const disabled = !baselineId && view.id !== "decode";
            const active = effective === view.id;
            return (
              <button
                key={view.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(view.id)}
                className={
                  "rounded-sm px-2.5 py-0.5 font-mono transition-colors " +
                  (active ? "bg-ops-accent font-medium text-ops-accent-fg" : "text-ops-muted hover:text-ops-text") +
                  (disabled ? " cursor-not-allowed opacity-40" : "")
                }
              >
                {view.label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] tabular-nums text-ops-muted">
          baseline #{baselineId ?? "-"} &rarr; backup #{latestId}
        </span>
      </div>

      {effective === "decode" && <DecodeView baselineId={baselineId} latestId={latestId} />}
      {effective === "unified" && baselineId !== null && (
        <UnifiedView leftId={baselineId} rightId={latestId} />
      )}
      {effective === "side-by-side" && baselineId !== null && (
        <SideBySideView leftId={baselineId} rightId={latestId} />
      )}
    </div>
  );
}

export function NcmChangeHistory({ rows }: { rows: NcmChangeRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | NcmChangeRow["state"]>("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      changed: rows.filter((r) => r.state === "changed").length,
      clean: rows.filter((r) => r.state === "clean").length,
      noBaseline: rows.filter((r) => r.state === "no-baseline").length,
      noBackup: rows.filter((r) => r.state === "no-backup").length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && row.state !== filter) return false;
      if (!needle) return true;
      return (row.switchName + " " + (row.model || "")).toLowerCase().includes(needle);
    });
  }, [rows, query, filter]);

  return (
    <div className="flex flex-col gap-4">
      <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatsCard label="Switch berubah" value={stats.changed} tone="warning" icon={<AlertTriangle />} />
        <StatsCard label="Sama dengan baseline" value={stats.clean} tone="success" icon={<CheckCircle2 />} />
        <StatsCard label="Tanpa baseline" value={stats.noBaseline} tone="neutral" icon={<Clock />} />
        <StatsCard label="Total switch dipantau" value={stats.total} tone="accent" icon={<GitCompareArrows />} />
      </section>

      {stats.changed > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>{stats.changed} switch</strong> konfigurasinya berbeda dari golden baseline — lihat baris
            yang ditandai, lalu buka perbandingan decode.
          </span>
        </div>
      )}

      <div className="ops-panel-subtle flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <Search className="size-4 text-ops-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari switch atau model…"
              className="ops-input h-8 w-56 px-2.5 text-xs"
            />
          </label>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as "all" | NcmChangeRow["state"])}
            className="ops-input h-8 px-2.5 text-xs"
          >
            <option value="all">Semua status ({stats.total})</option>
            <option value="changed">Berubah ({stats.changed})</option>
            <option value="clean">Sama ({stats.clean})</option>
            <option value="no-baseline">Tanpa baseline ({stats.noBaseline})</option>
            <option value="no-backup">Belum ada backup ({stats.noBackup})</option>
          </select>
        </div>
        <span className="text-xs text-ops-muted">
          Menampilkan {visible.length} dari {rows.length} switch
        </span>
      </div>

      <div className="ops-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] border-b border-ops-border bg-ops-surface-raised text-xs font-medium text-ops-muted">
            <tr className="text-left">
              <th className="px-3 py-2.5">Switch</th>
              <th className="px-3 py-2.5">Model</th>
              <th className="px-3 py-2.5">Baseline</th>
              <th className="px-3 py-2.5">Backup terakhir</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border bg-ops-surface [&>tr:hover]:bg-ops-surface-raised/60">
            {visible.length === 0 && (
              <DataTableEmpty colSpan={6} title="Tidak ada switch yang cocok dengan filter." />
            )}
            {visible.map((row) => {
              const isOpen = openId === row.switchId;
              const meta = STATE_META[row.state];
              return (
                <Fragment key={row.switchId}>
                  <tr
                    className={
                      "transition-colors " +
                      (row.state === "changed" ? "bg-ops-warning-soft/40 " : "") +
                      (isOpen ? "bg-ops-surface-raised" : "")
                    }
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {row.state === "changed" && <span className="size-2 rounded-full bg-ops-warning" />}
                        <span className="font-semibold text-ops-text">{row.switchName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ops-muted">{row.model || "—"}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-ops-text">
                      {row.baselineBackupId ? (
                        <span>
                          #{row.baselineBackupId}
                          <span className="ml-1 text-ops-muted">{formatDateShort(row.baselineAt)}</span>
                        </span>
                      ) : (
                        <span className="text-ops-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-ops-text">
                      {row.latestBackupId ? (
                        <span>
                          #{row.latestBackupId}
                          <span className="ml-1 text-ops-muted">{formatDate(row.latestAt)}</span>
                        </span>
                      ) : (
                        <span className="text-ops-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={"inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold " + meta.className}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {row.latestBackupId ? (
                        <ActionButton
                          size="sm"
                          variant={isOpen ? "primary" : "secondary"}
                          onClick={() => setOpenId(isOpen ? null : row.switchId)}
                        >
                          <GitCompareArrows className="size-3.5" />
                          {isOpen ? "Tutup" : "Bandingkan"}
                        </ActionButton>
                      ) : (
                        <span className="text-xs text-ops-muted">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && row.latestBackupId && (
                    <tr>
                      <td colSpan={6} className="bg-ops-surface-raised p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[13px] font-semibold text-ops-text">
                            Perbandingan decode — {row.switchName}
                          </span>
                          <button type="button" onClick={() => setOpenId(null)} className="text-ops-muted hover:text-ops-text">
                            <X className="size-4" />
                          </button>
                        </div>
                        <ComparePanel baselineId={row.baselineBackupId} latestId={row.latestBackupId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
