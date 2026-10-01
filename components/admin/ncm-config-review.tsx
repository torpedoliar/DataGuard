"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Filter,
  GitCompareArrows,
  Mail,
  MessageSquare,
  Play,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import {
  addNcmReviewNoteAction,
  deleteNcmReviewAction,
  getNcmBackupDecodeAction,
  getNcmComplianceAction,
  getNcmReviewDetail,
  getNcmReviewNotesAction,
  getNcmReviewRollbackAction,
  promoteNcmReviewAction,
  runNcmReviewCycleAction,
  sendNcmReviewReminderAction,
  startNcmReviewAction,
  updateNcmReviewStatusAction,
} from "@/actions/ncm";

type Row = Record<string, unknown>;

function pick(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface DiffDisplayLine {
  lineNum: number;
  sign: string;
  type: "equal" | "delete" | "insert";
  content: string;
}

function parseUnifiedDiffForDisplay(rawDiff: string, hideNoise: boolean): {
  lines: DiffDisplayLine[];
  addedCount: number;
  deletedCount: number;
} {
  const rawLines = rawDiff.split("\n");
  const lines: DiffDisplayLine[] = [];
  let addedCount = 0;
  let deletedCount = 0;

  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.startsWith("---") || raw.startsWith("+++")) {
      continue;
    }
    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      continue;
    }

    if (raw.startsWith("-")) {
      const content = raw.slice(1);
      if (hideNoise) {
        const lower = content.toLowerCase();
        if (
          lower.includes("ntp clock-period") ||
          lower.includes("uptime") ||
          lower.includes("last configuration change") ||
          lower.includes("nvram config last updated")
        ) {
          oldLine++;
          continue;
        }
      }
      deletedCount++;
      lines.push({
        lineNum: oldLine,
        sign: "-",
        type: "delete",
        content,
      });
      oldLine++;
    } else if (raw.startsWith("+")) {
      const content = raw.slice(1);
      if (hideNoise) {
        const lower = content.toLowerCase();
        if (
          lower.includes("ntp clock-period") ||
          lower.includes("uptime") ||
          lower.includes("last configuration change") ||
          lower.includes("nvram config last updated")
        ) {
          newLine++;
          continue;
        }
      }
      addedCount++;
      lines.push({
        lineNum: newLine,
        sign: "+",
        type: "insert",
        content,
      });
      newLine++;
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (i === rawLines.length - 1 && !raw.trim()) continue;
      lines.push({
        lineNum: newLine,
        sign: "",
        type: "equal",
        content,
      });
      oldLine++;
      newLine++;
    }
  }

  return { lines, addedCount, deletedCount };
}

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDING",
  in_review: "IN REVIEW",
  approved: "APPROVED",
  flagged: "FLAGGED",
  dismissed: "DISMISSED",
};

const inputClass = "ops-input h-9 w-full px-3 text-xs";

type DiffCategory = "all" | "vlan" | "interface" | "security" | "system";
type DiffViewStyle = "side-by-side" | "unified" | "decode";

interface DecodeVlan {
  id: number;
  name: string | null;
}

interface DecodePort {
  name: string;
  description: string | null;
  enabled: boolean;
  mode: string;
  native_vlan: number | null;
  access_vlan: number | null;
  trunk_allowed_vlans: number[];
}

interface DecodedBackup {
  backup_id: number;
  switch_id: number;
  switch_name: string;
  protocol: string;
  dialect: string;
  hostname: string | null;
  backup_taken_at: string | null;
  vlans: DecodeVlan[];
  ports: DecodePort[];
  parse_warnings?: string[];
}

interface DecodeDeltaResult {
  vlans_added: DecodeVlan[];
  vlans_removed: DecodeVlan[];
  ports_changed: { name: string; from: DecodePort; to: DecodePort }[];
  ports_added: string[];
  ports_removed: string[];
  description_changed: string[];
}

function computeDecodeDelta(a: DecodedBackup, b: DecodedBackup): DecodeDeltaResult {
  const vlanKey = (v: DecodeVlan) => `${v.id}=${v.name ?? ""}`;
  const vlansA = new Set(a.vlans.map(vlanKey));
  const vlansB = new Set(b.vlans.map(vlanKey));
  const vlans_added = b.vlans.filter((v) => !vlansA.has(vlanKey(v)));
  const vlans_removed = a.vlans.filter((v) => !vlansB.has(vlanKey(v)));

  const portKey = (p: DecodePort) =>
    [
      p.mode ?? "",
      p.native_vlan ?? "",
      p.access_vlan ?? "",
      (p.trunk_allowed_vlans ?? []).join(","),
      p.enabled ? "up" : "down",
    ].join("|");
  const portsA = new Map(a.ports.map((p) => [p.name, { obj: p, key: portKey(p) }]));
  const portsB = new Map(b.ports.map((p) => [p.name, { obj: p, key: portKey(p) }]));
  const ports_changed: { name: string; from: DecodePort; to: DecodePort }[] = [];
  for (const [name, entryB] of portsB) {
    const entryA = portsA.get(name);
    if (entryA && entryA.key !== entryB.key) {
      ports_changed.push({ name, from: entryA.obj, to: entryB.obj });
    }
  }
  const ports_added = [...portsB.keys()].filter((n) => !portsA.has(n));
  const ports_removed = [...portsA.keys()].filter((n) => !portsA.has(n));
  const description_changed = a.ports
    .filter((pa) => portsB.has(pa.name))
    .filter((pa) => {
      const pb = portsB.get(pa.name);
      return pb && (pb.obj.description ?? "") !== (pa.description ?? "");
    })
    .map((pa) => pa.name);

  return { vlans_added, vlans_removed, ports_changed, ports_added, ports_removed, description_changed };
}

function DecodeDiffView({
  baselineBackupId,
  detectedBackupId,
}: {
  baselineBackupId: number | null;
  detectedBackupId: number;
}) {
  const [detected, setDetected] = useState<DecodedBackup | null>(null);
  const [baseline, setBaseline] = useState<DecodedBackup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const pDetected = getNcmBackupDecodeAction(detectedBackupId);
    const pBaseline: Promise<{ success: boolean; data?: unknown; message?: string }> = baselineBackupId
      ? getNcmBackupDecodeAction(baselineBackupId)
      : Promise.resolve({ success: false, message: "No baseline" });

    Promise.all([pDetected, pBaseline])
      .then(([resDet, resBase]) => {
        if (cancelled) return;
        if (!resDet.success || !resDet.data) {
          setError(resDet.message || "Gagal memuat hasil decode backup dari NCM.");
          return;
        }
        setDetected(resDet.data as DecodedBackup);
        if (resBase.success && resBase.data) {
          setBaseline(resBase.data as DecodedBackup);
        } else {
          setBaseline(null);
        }
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
  }, [detectedBackupId, baselineBackupId]);

  if (loading) {
    return (
      <div className="py-8 text-center text-ops-muted flex items-center justify-center gap-2">
        <Clock className="size-4 animate-spin text-ops-accent" />
        <span className="text-xs">Mendecode konfigurasi switch (VLAN &amp; Port) dari NCM…</span>
      </div>
    );
  }

  if (error || !detected) {
    return (
      <div className="p-4 m-3 text-xs text-ops-danger bg-ops-danger/10 border border-ops-danger/30 rounded">
        {error || "Tidak ada data decode yang tersedia."}
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="p-4 space-y-4 text-xs font-mono">
        <div className="rounded border border-ops-warning/30 bg-ops-warning/10 p-3 text-ops-warning">
          Golden Baseline belum dikonfigurasi untuk switch ini. Menampilkan konfigurasi hasil decode Backup #{detectedBackupId}:
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ops-muted">
            Dialect: <strong className="text-ops-accent">{detected.dialect}</strong>
          </span>
          {detected.hostname && (
            <span className="text-ops-muted">
              Hostname: <strong className="text-ops-text">{detected.hostname}</strong>
            </span>
          )}
        </div>
        <div className="space-y-1">
          <span className="font-bold text-ops-text text-[11px] uppercase">VLANs ({detected.vlans.length}):</span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {detected.vlans.map((v) => (
              <span key={v.id} className="rounded border border-ops-border bg-ops-surface-raised px-2 py-0.5 text-[11px] text-ops-text">
                VLAN {v.id} {v.name ? `(${v.name})` : ""}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <span className="font-bold text-ops-text text-[11px] uppercase">Ports ({detected.ports.length}):</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-1">
            {detected.ports.map((p) => (
              <div key={p.name} className="rounded border border-ops-border bg-ops-surface-raised p-2.5 space-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ops-accent">{p.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.enabled ? "bg-ops-success/15 text-ops-success" : "bg-ops-danger/15 text-ops-danger"}`}>
                    {p.enabled ? "UP" : "DOWN"}
                  </span>
                </div>
                <div className="text-ops-muted">Mode: <strong className="text-ops-text">{p.mode}</strong></div>
                {p.access_vlan && <div className="text-ops-muted">Access VLAN: <strong className="text-ops-text">{p.access_vlan}</strong></div>}
                {p.native_vlan && <div className="text-ops-muted">Native VLAN: <strong className="text-ops-text">{p.native_vlan}</strong></div>}
                {p.trunk_allowed_vlans?.length > 0 && (
                  <div className="text-ops-muted">Trunk Allowed: <strong className="text-ops-text">{p.trunk_allowed_vlans.join(", ")}</strong></div>
                )}
                {p.description && <div className="text-ops-muted truncate">Desc: {p.description}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const delta = computeDecodeDelta(baseline, detected);
  const isClean =
    delta.vlans_added.length === 0 &&
    delta.vlans_removed.length === 0 &&
    delta.ports_changed.length === 0 &&
    delta.ports_added.length === 0 &&
    delta.ports_removed.length === 0 &&
    delta.description_changed.length === 0 &&
    baseline.hostname === detected.hostname;

  return (
    <div className="p-4 space-y-4 text-xs font-mono">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ops-border pb-3">
        <div className="flex items-center gap-3">
          <span className="text-ops-muted text-[11px]">
            Dialect: <strong className="text-ops-accent font-semibold">{detected.dialect}</strong>
          </span>
          {detected.hostname && (
            <span className="text-ops-muted text-[11px]">
              Hostname: <strong className="text-ops-text">{detected.hostname}</strong>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-ops-success/15 text-ops-success border border-ops-success/30">
            +{delta.vlans_added.length + delta.ports_added.length} ditambahkan
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-ops-danger/15 text-ops-danger border border-ops-danger/30">
            −{delta.vlans_removed.length + delta.ports_removed.length} dihapus
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-ops-warning/15 text-ops-warning border border-ops-warning/30">
            ~{delta.ports_changed.length + delta.description_changed.length} berubah
          </span>
        </div>
      </div>

      {baseline.hostname !== detected.hostname && (
        <div className="rounded border border-ops-warning/30 bg-ops-warning/10 p-3 space-y-1">
          <span className="font-bold text-ops-warning uppercase tracking-wider text-[10px]">Perubahan Hostname:</span>
          <div className="flex items-center gap-2">
            <span className="text-ops-danger line-through">{baseline.hostname || "—"}</span>
            <span className="text-ops-muted">→</span>
            <span className="text-ops-success font-bold">{detected.hostname || "—"}</span>
          </div>
        </div>
      )}

      {delta.vlans_added.length > 0 && (
        <div className="rounded border border-ops-success/30 bg-ops-success/10 p-3 space-y-1.5">
          <span className="font-bold text-ops-success uppercase tracking-wider text-[10px]">
            + VLAN Ditambahkan ({delta.vlans_added.length}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {delta.vlans_added.map((v) => (
              <span key={v.id} className="rounded border border-ops-success/30 bg-ops-success/15 px-2 py-0.5 text-[11px] text-ops-success">
                VLAN {v.id} {v.name ? `(${v.name})` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {delta.vlans_removed.length > 0 && (
        <div className="rounded border border-ops-danger/30 bg-ops-danger/10 p-3 space-y-1.5">
          <span className="font-bold text-ops-danger uppercase tracking-wider text-[10px]">
            − VLAN Dihapus ({delta.vlans_removed.length}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {delta.vlans_removed.map((v) => (
              <span key={v.id} className="rounded border border-ops-danger/30 bg-ops-danger/15 px-2 py-0.5 text-[11px] text-ops-danger">
                VLAN {v.id} {v.name ? `(${v.name})` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {delta.ports_changed.length > 0 && (
        <div className="space-y-2">
          <span className="font-bold text-ops-text uppercase tracking-wider text-[11px]">
            Port Berubah ({delta.ports_changed.length}):
          </span>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {delta.ports_changed.map(({ name, from, to }) => {
              const fields: [string, string | number | boolean | null, string | number | boolean | null][] = [
                ["Mode", from.mode, to.mode],
                ["Access VLAN", from.access_vlan, to.access_vlan],
                ["Native VLAN", from.native_vlan, to.native_vlan],
                ["Trunk Allowed", (from.trunk_allowed_vlans ?? []).join(",") || "—", (to.trunk_allowed_vlans ?? []).join(",") || "—"],
                ["Status", from.enabled ? "UP" : "DOWN", to.enabled ? "UP" : "DOWN"],
                ["Description", from.description ?? "—", to.description ?? "—"],
              ];
              const diffs = fields.filter(([, f, t]) => String(f) !== String(t));

              return (
                <div key={name} className="rounded-lg border border-ops-border bg-ops-surface-raised p-3 space-y-2">
                  <div className="flex items-center justify-between border-b border-ops-border pb-1.5">
                    <span className="font-bold text-ops-accent text-xs">{name}</span>
                    <span className="text-[10px] text-ops-warning font-semibold px-1.5 py-0.5 rounded bg-ops-warning/10 border border-ops-warning/30">
                      {diffs.length} atribut berubah
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    {diffs.map(([label, f, t]) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <span className="text-ops-muted font-medium text-[10px] uppercase">{label}:</span>
                        <div className="flex items-center gap-1.5 pl-1">
                          <span className="rounded bg-ops-danger/15 border border-ops-danger/30 px-1.5 py-0.5 text-ops-danger">
                            {String(f)}
                          </span>
                          <span className="text-ops-muted">→</span>
                          <span className="rounded bg-ops-success/15 border border-ops-success/30 px-1.5 py-0.5 text-ops-success font-bold">
                            {String(t)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {delta.ports_added.length > 0 && (
        <div className="rounded border border-ops-success/30 bg-ops-success/10 p-3 space-y-1">
          <span className="font-bold text-ops-success uppercase tracking-wider text-[10px]">Port Baru ({delta.ports_added.length}):</span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {delta.ports_added.map((p) => (
              <span key={p} className="rounded bg-ops-success/15 border border-ops-success/30 px-2 py-0.5 text-[11px] text-ops-success">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {delta.ports_removed.length > 0 && (
        <div className="rounded border border-ops-danger/30 bg-ops-danger/10 p-3 space-y-1">
          <span className="font-bold text-ops-danger uppercase tracking-wider text-[10px]">Port Dihapus ({delta.ports_removed.length}):</span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {delta.ports_removed.map((p) => (
              <span key={p} className="rounded bg-ops-danger/15 border border-ops-danger/30 px-2 py-0.5 text-[11px] text-ops-danger">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {isClean && (
        <div className="py-6 px-4 text-center text-ops-success flex flex-col items-center gap-2 rounded border border-ops-success/30 bg-ops-success/10">
          <CheckCircle2 className="size-6 text-ops-success" />
          <span className="font-semibold text-sm">Konfigurasi Struktural (VLAN &amp; Port) 100% Identik</span>
          <span className="text-xs text-ops-muted max-w-lg">
            Tidak ada perbedaan logic VLAN atau konfigurasi port antara Golden Baseline dan backup running-config ini.
          </span>
        </div>
      )}

      {((detected.parse_warnings?.length ?? 0) > 0 || (baseline.parse_warnings?.length ?? 0) > 0) && (
        <div className="text-[11px] text-ops-warning bg-ops-warning/10 border border-ops-warning/30 rounded p-2">
          <span>Catatan parser: {[...(baseline.parse_warnings ?? []), ...(detected.parse_warnings ?? [])].join("; ")}</span>
        </div>
      )}
    </div>
  );
}

interface SideBySideLine {
  lineA: number | null;
  textA: string;
  lineB: number | null;
  textB: string;
  type: "equal" | "delete" | "insert" | "replace";
  category: DiffCategory;
}

function classifyLine(text: string): DiffCategory {
  const lower = text.toLowerCase().trim();
  if (lower.includes("vlan")) return "vlan";
  if (
    lower.startsWith("interface ") ||
    lower.startsWith("switchport ") ||
    lower.startsWith("ip address ") ||
    lower.startsWith("shutdown") ||
    lower.startsWith("no shutdown") ||
    lower.startsWith("speed ") ||
    lower.startsWith("duplex ") ||
    lower.startsWith("spanning-tree ")
  )
    return "interface";
  if (
    lower.includes("access-list") ||
    lower.includes("acl") ||
    lower.includes("radius") ||
    lower.includes("tacacs") ||
    lower.includes("aaa ") ||
    lower.includes("crypto ") ||
    lower.includes("ssh ") ||
    lower.includes("password ") ||
    lower.includes("secret ") ||
    lower.includes("snmp-server community")
  )
    return "security";
  if (
    lower.startsWith("hostname ") ||
    lower.startsWith("ntp ") ||
    lower.startsWith("clock ") ||
    lower.startsWith("service ") ||
    lower.startsWith("logging ") ||
    lower.startsWith("banner ")
  )
    return "system";
  return "all";
}

function parseUnifiedDiffToSideBySide(rawDiff: string, hideNoise: boolean): SideBySideLine[] {
  const lines = rawDiff.split("\n");
  const rows: SideBySideLine[] = [];
  let lineA = 1;
  let lineB = 1;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("---") || line.startsWith("+++")) {
      i++;
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      lineA = parseInt(hunkMatch[1], 10);
      lineB = parseInt(hunkMatch[2], 10);
      i++;
      continue;
    }

    if (line.startsWith("-")) {
      const deletes: string[] = [];
      while (i < lines.length && lines[i].startsWith("-")) {
        deletes.push(lines[i].slice(1));
        i++;
      }
      const inserts: string[] = [];
      while (i < lines.length && lines[i].startsWith("+")) {
        inserts.push(lines[i].slice(1));
        i++;
      }

      const maxLen = Math.max(deletes.length, inserts.length);
      for (let k = 0; k < maxLen; k++) {
        const delText = deletes[k] ?? "";
        const insText = inserts[k] ?? "";

        if (hideNoise) {
          const checkNoise = (delText + " " + insText).toLowerCase();
          if (
            checkNoise.includes("ntp clock-period") ||
            checkNoise.includes("uptime") ||
            checkNoise.includes("last configuration change") ||
            checkNoise.includes("nvram config last updated")
          ) {
            if (k < deletes.length) lineA++;
            if (k < inserts.length) lineB++;
            continue;
          }
        }

        const cat = classifyLine(delText || insText);

        if (k < deletes.length && k < inserts.length) {
          rows.push({
            lineA: lineA++,
            textA: delText,
            lineB: lineB++,
            textB: insText,
            type: "replace",
            category: cat,
          });
        } else if (k < deletes.length) {
          rows.push({
            lineA: lineA++,
            textA: delText,
            lineB: null,
            textB: "",
            type: "delete",
            category: cat,
          });
        } else {
          rows.push({
            lineA: null,
            textA: "",
            lineB: lineB++,
            textB: insText,
            type: "insert",
            category: cat,
          });
        }
      }
      continue;
    }

    if (line.startsWith("+")) {
      const insText = line.slice(1);
      if (
        !hideNoise ||
        (!insText.toLowerCase().includes("ntp clock-period") &&
          !insText.toLowerCase().includes("last configuration change"))
      ) {
        rows.push({
          lineA: null,
          textA: "",
          lineB: lineB++,
          textB: insText,
          type: "insert",
          category: classifyLine(insText),
        });
      } else {
        lineB++;
      }
      i++;
      continue;
    }

    if (line.startsWith(" ")) {
      const eqText = line.slice(1);
      rows.push({
        lineA: lineA++,
        textA: eqText,
        lineB: lineB++,
        textB: eqText,
        type: "equal",
        category: classifyLine(eqText),
      });
      i++;
      continue;
    }

    i++;
  }
  return rows;
}

function summaryText(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "text diff only";
  const parts: string[] = [];
  const added = summary.vlans_added as number[] | undefined;
  const removed = summary.vlans_removed as number[] | undefined;
  const changed = summary.ports_changed as string[] | undefined;
  if (added?.length) parts.push(`VLAN +${added.join(",")}`);
  if (removed?.length) parts.push(`VLAN -${removed.join(",")}`);
  if (changed?.length) parts.push(`${changed.length} port(s) changed (${changed.slice(0, 5).join(", ")})`);
  if (summary.hostname_changed) parts.push("hostname changed");
  return parts.join(" · ") || "text diff only";
}

export function NcmConfigReview({
  reviews,
  baselines,
  switches,
  initialSelectedId,
}: {
  reviews: Row[];
  baselines: Row[];
  switches: Row[];
  initialSelectedId?: number | null;
}) {
  const router = useRouter();

  const [complianceData, setComplianceData] = useState<Row | null>(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [isTriggeringCycle, setIsTriggeringCycle] = useState(false);
  const [cycleResult, setCycleResult] = useState<Row | null>(null);
  const [cycleModalOpen, setCycleModalOpen] = useState(false);

  // Filters & selection
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<number | null>(initialSelectedId ?? null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Diff inspection settings
  const [viewStyle, setViewStyle] = useState<DiffViewStyle>("unified");
  const [activeCategory, setActiveCategory] = useState<DiffCategory>("all");
  const [hideNoise, setHideNoise] = useState(false);

  // Notes thread
  const [notes, setNotes] = useState<Row[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Action states & Modals
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteReviewId, setPromoteReviewId] = useState<number | null>(null);
  const [promoteReason, setPromoteReason] = useState("");
  const [promoteComment, setPromoteComment] = useState("");
  const [isPromoting, setIsPromoting] = useState(false);

  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackScript, setRollbackScript] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [flagIncidentRef, setFlagIncidentRef] = useState("");

  const switchMap = useMemo(() => {
    return new Map(switches.map((s) => [pick(s, "id", "switch_id", "switchId"), s]));
  }, [switches]);

  const baselineMap = useMemo(() => {
    return new Map(baselines.map((b) => [pick(b, "id", "baseline_id", "baselineId"), b]));
  }, [baselines]);

  // Load compliance overview
  useEffect(() => {
    let cancelled = false;
    getNcmComplianceAction()
      .then((res) => {
        if (!cancelled && !("message" in res)) setComplianceData(res as Row);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Update selected if initialSelectedId changes
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selected) {
      setSelected(initialSelectedId);
    }
  }, [initialSelectedId, selected]);

  // Fetch diff when a review is selected
  useEffect(() => {
    if (selected === null) {
      setDiff(null);
      setDiffError(null);
      setNotes([]);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setDiffError(null);
    setLoadingDiff(true);

    getNcmReviewDetail(selected)
      .then((res) => {
        if (cancelled) return;
        if (res.message) {
          setDiffError(res.message);
        } else {
          setDiff(res.diff || "(diff kosong / tidak ada perubahan)");
        }
      })
      .catch((err) => {
        if (!cancelled) setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    // Also load review notes
    getNcmReviewNotesAction(selected)
      .then((res) => {
        if (!cancelled && Array.isArray(res)) setNotes(res as Row[]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const parsedDiffRows = useMemo(() => {
    if (!diff) return [];
    return parseUnifiedDiffToSideBySide(diff, hideNoise);
  }, [diff, hideNoise]);

  const unifiedDisplay = useMemo(() => {
    if (!diff) return { lines: [], addedCount: 0, deletedCount: 0 };
    return parseUnifiedDiffForDisplay(diff, hideNoise);
  }, [diff, hideNoise]);

  const isCleanMatch = useMemo(() => {
    if (diff === null) return false;
    return (
      !diff.trim() ||
      diff === "(diff kosong / tidak ada perubahan)" ||
      (unifiedDisplay.addedCount === 0 && unifiedDisplay.deletedCount === 0 && parsedDiffRows.every((r) => r.type === "equal"))
    );
  }, [diff, unifiedDisplay, parsedDiffRows]);

  const filteredDiffRows = useMemo(() => {
    if (activeCategory === "all") return parsedDiffRows;
    return parsedDiffRows.filter((r) => r.type !== "equal" && r.category === activeCategory);
  }, [parsedDiffRows, activeCategory]);

  const filteredReviews = useMemo(() => {
    if (!statusFilter) return reviews;
    return reviews.filter((r) => (pick(r, "status") || "pending") === statusFilter);
  }, [reviews, statusFilter]);

  async function handleSendReminder() {
    if (!window.confirm("Kirim email reminder status review pending & gap baseline ke administrator sekarang?")) return;
    setIsSendingReminder(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await sendNcmReviewReminderAction();
      if (res.success) {
        setActionSuccess(res.message);
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingReminder(false);
    }
  }

  async function handleTriggerCycle() {
    if (!window.confirm("Jalankan siklus review sekarang untuk seluruh switch? Semua switch yang identik dengan baseline akan di-reset siklusnya, dan hasil audit akan dikirim via email.")) return;
    setIsTriggeringCycle(true);
    setActionError(null);
    try {
      const res = await runNcmReviewCycleAction();
      if (res.success) {
        setCycleResult(res.data as Row);
        setCycleModalOpen(true);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTriggeringCycle(false);
    }
  }

  async function handleStartReview(reviewId: number) {
    setActionError(null);
    try {
      const res = await startNcmReviewAction(reviewId);
      if (res.success) {
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteReview(reviewId: number, switchName: string) {
    if (!window.confirm(`Hapus riwayat review #${reviewId} (${switchName})? Tindakan ini akan menghapus riwayat audit dan catatan review secara permanen.`)) {
      return;
    }
    setDeletingId(reviewId);
    setActionError(null);
    try {
      const res = await deleteNcmReviewAction(reviewId);
      if (res.success) {
        if (selected === reviewId) setSelected(null);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDecideStatus(reviewId: number, status: string, defaultComment?: string) {
    if (status === "flagged") {
      setPromoteReviewId(reviewId);
      setFlagIncidentRef("");
      setRollbackModalOpen(true);
      setRollbackLoading(true);
      try {
        const res = await getNcmReviewRollbackAction(reviewId);
        setRollbackScript(typeof res === "string" ? res : (res as Row).message ? String((res as Row).message) : "");
      } catch {
        setRollbackScript("! Failed to fetch rollback script from server.");
      } finally {
        setRollbackLoading(false);
      }
      return;
    }

    const comment =
      window.prompt(
        status === "approved"
          ? `Konfirmasi Approve untuk review #${reviewId}? Masukkan catatan / justifikasi verifikasi:`
          : `Keputusan ${status} untuk review #${reviewId}? (opsional, catatan bisa ditambah di thread)`,
        defaultComment ?? "",
      ) ?? undefined;

    if (comment === undefined) return;

    setActionError(null);
    try {
      const res = await updateNcmReviewStatusAction(reviewId, status, comment || defaultComment, true);
      if (res.success) {
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function openPromoteModal(reviewId: number) {
    setPromoteReviewId(reviewId);
    setPromoteReason("");
    setPromoteComment("");
    setPromoteModalOpen(true);
    setActionError(null);
  }

  async function handlePromoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteReviewId || !promoteReason.trim()) return;
    setIsPromoting(true);
    setActionError(null);
    try {
      const res = await promoteNcmReviewAction(promoteReviewId, promoteReason.trim(), promoteComment.trim() || undefined);
      if (res.success) {
        setPromoteModalOpen(false);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPromoting(false);
    }
  }

  async function handleFlagSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteReviewId) return;
    const comment = flagIncidentRef.trim()
      ? `[FLAGGED - Remediation Required] ${flagIncidentRef.trim()}`
      : "[FLAGGED - Remediation Required] Unapproved drift";
    setActionError(null);
    try {
      const res = await updateNcmReviewStatusAction(promoteReviewId, "flagged", comment, false);
      if (res.success) {
        setRollbackModalOpen(false);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddNote(reviewId: number) {
    const text = noteDraft.trim();
    if (!text) return;
    setIsAddingNote(true);
    setActionError(null);
    try {
      const res = await addNcmReviewNoteAction(reviewId, text);
      if (res.success) {
        setNoteDraft("");
        const refreshedNotes = await getNcmReviewNotesAction(reviewId);
        if (Array.isArray(refreshedNotes)) setNotes(refreshedNotes as Row[]);
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAddingNote(false);
    }
  }

  // Stats calculation
  const totalSwitches = Number(complianceData?.switches_total ?? switches.length);
  const withBaseline = Number(complianceData?.switches_with_baseline ?? baselines.length);
  const coverage = totalSwitches > 0 ? Math.round((withBaseline / totalSwitches) * 100) : 0;
  const pendingCount = Number(complianceData?.reviews_pending ?? reviews.filter((r) => (pick(r, "status") || "pending") === "pending").length);
  const flaggedCount = Number(complianceData?.reviews_flagged ?? reviews.filter((r) => pick(r, "status") === "flagged").length);
  const missingSwitches = (complianceData?.switches_missing_baseline as string[]) || [];
  const staleBaselines = (complianceData?.baselines_stale as string[]) || [];

  return (
    <div className="space-y-4">
      {/* 1. COMPLIANCE PANEL (ISO 27001 A.8.9) */}
      <section className="ops-panel p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ops-border pb-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-ops-accent" />
              <h3 className="text-base font-bold text-ops-text">Compliance Overview (ISO 27001 A.8.9)</h3>
            </div>
            <p className="mt-1 text-xs text-ops-muted max-w-3xl">
              Setiap switch memiliki golden baseline; setiap perbedaan (drift) membuka tiket review di sini.
              Menyediakan bukti kepatuhan manajemen konfigurasi dan audit jejak operasional.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ops-success/30 bg-ops-success/10 px-2.5 py-1 text-xs font-semibold text-ops-success">
              <span className="size-2 rounded-full bg-ops-success animate-pulse" />
              ISO 27001 Active
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-ops-border bg-ops-surface-raised p-3">
            <div className="text-2xl font-bold font-mono text-ops-accent">{coverage}%</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Baseline Coverage</div>
          </div>
          <div className="rounded-lg border border-ops-border bg-ops-surface-raised p-3">
            <div className="text-2xl font-bold font-mono text-ops-warning">{pendingCount}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Reviews Pending</div>
          </div>
          <div className="rounded-lg border border-ops-border bg-ops-surface-raised p-3">
            <div className="text-2xl font-bold font-mono text-ops-danger">{flaggedCount}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Flagged Drift</div>
          </div>
          <div className="rounded-lg border border-ops-border bg-ops-surface-raised p-3">
            <div className="text-2xl font-bold font-mono text-ops-text">{missingSwitches.length}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Without Baseline</div>
          </div>
          <div className="rounded-lg border border-ops-border bg-ops-surface-raised p-3">
            <div className="text-2xl font-bold font-mono text-ops-info">{staleBaselines.length}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Reminder Due</div>
          </div>
        </div>

        {missingSwitches.length > 0 && (
          <p className="text-xs text-ops-warning bg-ops-warning/10 border border-ops-warning/30 rounded p-2.5">
            Switch belum memiliki baseline: <strong>{missingSwitches.join(", ")}</strong>. Deteksi drift tidak aktif pada switch tersebut sampai baseline dibuat.
          </p>
        )}

        {staleBaselines.length > 0 && (
          <p className="text-xs text-ops-info bg-ops-info/10 border border-ops-info/30 rounded p-2.5">
            Review berkala jatuh tempo: <strong>{staleBaselines.join(", ")}</strong>. Buka sesi review untuk switch tersebut untuk re-attestasi dan reset siklus.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              type="button"
              variant="secondary"
              isPending={isSendingReminder}
              onClick={handleSendReminder}
              title="Kirim email reminder status review pending & gap baseline ke administrator sekarang"
            >
              <Mail className="size-4 text-ops-info" />
              Kirim Reminder Email
            </ActionButton>
          </div>
          <ActionButton
            type="button"
            isPending={isTriggeringCycle}
            onClick={handleTriggerCycle}
            className="bg-ops-warning/15 text-ops-warning border-ops-warning/30 hover:bg-ops-warning/25 font-bold"
            title="Bandingkan seluruh switch ke baseline sekarang, reset siklus periode, dan kirim email hasil review"
          >
            <Sparkles className="size-4 text-ops-warning" />
            Jalankan Siklus Review Sekarang (All Switches)
          </ActionButton>
        </div>
      </section>

      {/* BANNER NOTIFIKASI ERROR / SUCCESS */}
      {actionSuccess && (
        <div className="rounded-lg border border-ops-success/30 bg-ops-success/10 p-3 text-sm text-ops-success flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)}><X className="size-4" /></button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-ops-danger/30 bg-ops-danger/10 p-3 text-sm text-ops-danger flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}><X className="size-4" /></button>
        </div>
      )}

      {/* 2. FILTER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ops-border bg-ops-surface-raised p-3">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-ops-muted" />
          <span className="text-xs font-semibold text-ops-text">Filter Status Review:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ops-input h-8 px-2.5 text-xs"
          >
            <option value="">Semua Status ({reviews.length})</option>
            <option value="pending">Pending</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <span className="text-xs text-ops-muted">
          Menampilkan {filteredReviews.length} dari {reviews.length} tiket review
        </span>
      </div>

      {/* 3. REVIEWS TABLE */}
      <div className="overflow-x-auto rounded-lg border border-ops-border bg-ops-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ops-border text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2.5 px-3">ID</th>
              <th className="py-2.5 px-3">Switch</th>
              <th className="py-2.5 px-3">Dibuat</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Reviewer</th>
              <th className="py-2.5 px-3">Ringkasan Perubahan</th>
              <th className="py-2.5 px-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredReviews.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-ops-muted">
                  Tidak ada review yang cocok dengan filter.
                </td>
              </tr>
            )}
            {filteredReviews.map((r) => {
              const id = Number(pick(r, "id", "review_id", "reviewId"));
              const swId = pick(r, "switch_id", "switchId");
              const sw = switchMap.get(swId);
              const switchName = pick(r, "switch_name", "switchName") || (sw ? pick(sw, "name", "hostname") : "") || `#${swId}`;
              const status = pick(r, "status", "state") || "pending";
              const reviewerName = pick(r, "reviewed_by_name", "reviewedByName");
              const starterName = pick(r, "started_by_name", "startedByName");
              const reviewedAt = pick(r, "reviewed_at", "reviewedAt");
              const startedAt = pick(r, "started_at", "startedAt");
              const diffSum = (r.diff_summary as Record<string, unknown>) || {};
              const isCurrentSelected = selected === id;

              const blId = pick(r, "baseline_id", "baselineId");
              const bl = baselineMap.get(blId);
              const blDate = bl ? formatDateShort(pick(bl, "created_at", "createdAt")) : "";
              const baselineBackupId = Number(pick(r, "baseline_backup_id") || (bl ? pick(bl, "backup_id") : 0)) || null;
              const detectedBackupId = Number(pick(r, "backup_id"));

              return (
                <Fragment key={id}>
                  <tr
                    className={`border-t border-ops-border transition-colors ${
                      isCurrentSelected
                        ? "bg-ops-surface-raised"
                        : "hover:bg-ops-surface-raised"
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono font-medium text-ops-text">#{id}</td>
                    <td className="py-2.5 px-3 font-semibold text-ops-text">{switchName}</td>
                    <td className="py-2.5 px-3 text-ops-text text-xs">{formatDate(pick(r, "created_at", "createdAt"))}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          status === "flagged"
                            ? "border-ops-danger/30 bg-ops-danger/10 text-ops-danger"
                            : status === "approved"
                            ? "border-ops-success/30 bg-ops-success/10 text-ops-success"
                            : status === "in_review"
                            ? "border-ops-info/30 bg-ops-info/10 text-ops-info"
                            : "border-ops-warning/30 bg-ops-warning/10 text-ops-warning"
                        }`}
                      >
                        {STATUS_LABEL[status] ?? status.toUpperCase()}
                      </span>
                      {status === "approved" && reviewedAt && (
                        <div className="text-[10px] text-ops-success font-mono mt-1 flex items-center gap-1">
                          <CheckCircle2 className="size-3 text-ops-success" />
                          {formatDate(reviewedAt)}
                        </div>
                      )}
                      {status === "flagged" && reviewedAt && (
                        <div className="text-[10px] text-ops-danger font-mono mt-1 flex items-center gap-1">
                          <AlertTriangle className="size-3 text-ops-danger" />
                          {formatDate(reviewedAt)}
                        </div>
                      )}
                      {status === "in_review" && startedAt && (
                        <div className="text-[10px] text-ops-info font-mono mt-1 flex items-center gap-1">
                          <Clock className="size-3 text-ops-info" />
                          {formatDate(startedAt)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {status === "approved" ? (
                        <div>
                          <span className="font-semibold text-ops-success text-xs">{reviewerName || "operator"}</span>
                          <div className="text-[10px] text-ops-muted">Disetujui</div>
                        </div>
                      ) : status === "flagged" ? (
                        <div>
                          <span className="font-semibold text-ops-danger text-xs">{reviewerName || "operator"}</span>
                          <div className="text-[10px] text-ops-muted">Ditandai</div>
                        </div>
                      ) : status === "in_review" ? (
                        <div>
                          <span className="text-ops-info text-xs italic">In review: {starterName || reviewerName || "operator"}</span>
                        </div>
                      ) : (
                        <span className="text-ops-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-ops-text max-w-xs truncate" title={JSON.stringify(diffSum)}>
                      {summaryText(diffSum)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <ActionButton
                          size="sm"
                          variant={isCurrentSelected ? "primary" : "secondary"}
                          onClick={() => setSelected(isCurrentSelected ? null : id)}
                        >
                          <GitCompareArrows className="size-3.5" />
                          {isCurrentSelected ? "Tutup Diff" : "Diff"}
                        </ActionButton>

                        {status === "pending" ? (
                          <ActionButton
                            size="sm"
                            variant="secondary"
                            onClick={() => handleStartReview(id)}
                            title="Ambil review ini untuk dikerjakan"
                          >
                            <Play className="size-3.5 text-ops-info" />
                            Mulai Review
                          </ActionButton>
                        ) : status === "in_review" ? (
                          <>
                            <ActionButton
                              size="sm"
                              onClick={() => openPromoteModal(id)}
                              className="bg-ops-warning/15 text-ops-warning border-ops-warning/30 hover:bg-ops-warning/25"
                              title="Setujui dan jadikan backup ini sebagai Golden Baseline baru"
                            >
                              ★ Promote
                            </ActionButton>
                            <ActionButton
                              size="sm"
                              variant="secondary"
                              onClick={() => handleDecideStatus(id, "approved", "Approve drift operasional, pertahankan baseline lama")}
                              title="Setujui perubahan ini tetapi pertahankan baseline lama"
                            >
                              ✓ Keep Old
                            </ActionButton>
                            <ActionButton
                              size="sm"
                              variant="danger"
                              onClick={() => handleDecideStatus(id, "flagged")}
                              title="Tandai pelanggaran konfigurasi & tampilkan instruksi rollback"
                            >
                              Flag
                            </ActionButton>
                          </>
                        ) : (
                          <span className="text-xs text-ops-muted italic">{pick(r, "comment") ? "has note" : "selesai"}</span>
                        )}

                        <ActionButton
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteReview(id, switchName)}
                          isPending={deletingId === id}
                          className="text-ops-danger hover:bg-ops-danger/10 p-1.5"
                          title="Hapus riwayat review ini"
                        >
                          <Trash2 className="size-3.5" />
                        </ActionButton>
                      </div>
                    </td>
                  </tr>

                  {/* INLINE EXPANDED DIFF VIEWER UNDER ROW (MATCHING IMAGE 2) */}
                  {isCurrentSelected && (
                    <tr key={`${id}-diff`} className="border-t border-b border-ops-border bg-ops-bg">
                      <td colSpan={7} className="p-0">
                        <div>
                          {/* Header Bar matching Image 2 */}
                          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-ops-border bg-ops-surface-raised">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono font-medium text-ops-text">
                                running-config vs golden baseline {blDate ? `(${blDate})` : blId ? `(#${blId})` : ""}
                              </span>
                              <span className="text-[11px] font-mono text-ops-muted">
                                · Review #{id} ({switchName})
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              {/* View Mode Toggle */}
                              <div className="flex items-center rounded border border-ops-border bg-ops-bg p-0.5 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => setViewStyle("side-by-side")}
                                  className={`rounded px-2.5 py-0.5 font-mono transition-colors ${
                                    viewStyle === "side-by-side"
                                      ? "bg-ops-accent text-ops-text font-bold"
                                      : "text-ops-muted hover:text-ops-text"
                                  }`}
                                >
                                  Side-by-Side
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setViewStyle("unified")}
                                  className={`rounded px-2.5 py-0.5 font-mono transition-colors ${
                                    viewStyle === "unified"
                                      ? "bg-ops-accent text-ops-text font-bold"
                                      : "text-ops-muted hover:text-ops-text"
                                  }`}
                                >
                                  Unified
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setViewStyle("decode")}
                                  className={`rounded px-2.5 py-0.5 font-mono transition-colors ${
                                    viewStyle === "decode"
                                      ? "bg-ops-accent text-ops-text font-bold"
                                      : "text-ops-muted hover:text-ops-text"
                                  }`}
                                >
                                  Decode View
                                </button>
                              </div>

                              {viewStyle !== "decode" && (
                                <label className="flex items-center gap-1.5 cursor-pointer text-ops-muted text-xs hover:text-ops-text">
                                  <input
                                    type="checkbox"
                                    checked={hideNoise}
                                    onChange={(e) => setHideNoise(e.target.checked)}
                                    className="size-3.5 rounded border-ops-border bg-ops-surface-raised text-ops-accent"
                                  />
                                  <span>Hide Noise</span>
                                </label>
                              )}

                              {/* Badges +X -Y matching Image 2 */}
                              {viewStyle !== "decode" && (
                                <div className="flex items-center gap-1.5 font-mono text-xs">
                                  {unifiedDisplay.addedCount > 0 && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full font-bold bg-ops-success/15 border border-ops-success/30 text-ops-success">
                                      +{unifiedDisplay.addedCount}
                                    </span>
                                  )}
                                  {unifiedDisplay.deletedCount > 0 && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full font-bold bg-ops-danger/15 border border-ops-danger/30 text-ops-danger">
                                      -{unifiedDisplay.deletedCount}
                                    </span>
                                  )}
                                  {unifiedDisplay.addedCount === 0 && unifiedDisplay.deletedCount === 0 && !loadingDiff && (
                                    <span className="text-[11px] text-ops-muted font-mono">0 changes</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Diff Content */}
                          {viewStyle === "decode" ? (
                            <DecodeDiffView
                              key={`${detectedBackupId}-${baselineBackupId}`}
                              baselineBackupId={baselineBackupId}
                              detectedBackupId={detectedBackupId}
                            />
                          ) : (
                            <>
                              {diffError && (
                                <div className="p-4 m-3 text-sm text-ops-danger bg-ops-danger/10 border border-ops-danger/30 rounded">
                                  {diffError}
                                </div>
                              )}

                              {loadingDiff && (
                                <div className="py-8 text-center text-ops-muted flex items-center justify-center gap-2">
                                  <Clock className="size-4 animate-spin text-ops-accent" />
                                  <span>Memuat perbandingan diff dari NCM…</span>
                                </div>
                              )}

                              {isCleanMatch && !loadingDiff && !diffError && (
                                <div className="py-6 px-4 text-center text-ops-success flex flex-col items-center gap-2">
                                  <CheckCircle2 className="size-6 text-ops-success" />
                                  <span className="font-semibold text-sm">Konfigurasi 100% Identik (Tidak Ada Drift)</span>
                                  <span className="text-xs text-ops-muted">
                                    Konfigurasi backup switch ini sesuai sepenuhnya dengan Golden Baseline.
                                  </span>
                                  {(status === "pending" || status === "in_review") && (
                                    <ActionButton
                                      type="button"
                                      size="sm"
                                      onClick={() => handleDecideStatus(id, "approved", "Konfirmasi sesuai: konfigurasi identik dengan baseline (tanpa drift)")}
                                      className="bg-ops-success/15 text-ops-success border border-ops-success/30 hover:bg-ops-success/25 mt-2 font-bold"
                                    >
                                      ✓ Konfirmasi Sesuai (Attest Clean &amp; Reset Siklus)
                                    </ActionButton>
                                  )}
                                </div>
                              )}

                              {diff !== null && !loadingDiff && !isCleanMatch && viewStyle === "unified" && (
                                <div className="py-3 px-2 font-mono text-xs overflow-x-auto max-h-[500px] bg-ops-bg">
                                  <div className="divide-y divide-transparent">
                                    {unifiedDisplay.lines.map((line, idx) => (
                                      <div
                                        key={idx}
                                        className={`flex items-start font-mono text-xs leading-6 px-4 py-0.5 ${
                                          line.type === "insert"
                                            ? "bg-ops-success/15 text-ops-success"
                                            : line.type === "delete"
                                            ? "bg-ops-danger/15 text-ops-danger"
                                            : "text-ops-text hover:bg-ops-surface-raised"
                                        }`}
                                      >
                                        <span className="w-10 shrink-0 text-right pr-3 text-ops-muted select-none">
                                          {line.lineNum}
                                        </span>
                                        <span
                                          className={`w-4 shrink-0 text-center font-bold select-none ${
                                            line.type === "insert"
                                              ? "text-ops-success"
                                              : line.type === "delete"
                                              ? "text-ops-danger"
                                              : "text-transparent"
                                          }`}
                                        >
                                          {line.sign}
                                        </span>
                                        <span className="whitespace-pre-wrap pl-3 break-all">{line.content}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {diff !== null && !loadingDiff && !isCleanMatch && viewStyle === "side-by-side" && (
                                <div className="overflow-x-auto max-h-[500px] bg-ops-bg">
                                  <div className="flex flex-wrap items-center gap-1.5 p-3 border-b border-ops-border bg-ops-surface-raised text-xs">
                                    <span className="font-semibold text-ops-muted uppercase tracking-wider text-[10px]">Filter Kategori:</span>
                                    {(
                                      [
                                        ["all", "All Changes"],
                                        ["vlan", "VLANs"],
                                        ["interface", "Interfaces"],
                                        ["security", "Security & AAA"],
                                        ["system", "System/Host"],
                                      ] as const
                                    ).map(([cat, label]) => (
                                      <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setActiveCategory(cat)}
                                        className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${activeCategory === cat ? "bg-ops-warning/15 text-ops-warning border border-ops-warning/30 font-bold" : "bg-ops-bg text-ops-muted hover:text-ops-text border border-ops-border"}`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="grid grid-cols-2 border-b border-ops-border bg-ops-surface-raised text-[11px] font-mono font-bold uppercase tracking-wider text-ops-muted">
                                    <div className="py-2 px-3 border-r border-ops-border text-ops-text flex items-center justify-between">
                                      <span>Golden Baseline (Target State)</span>
                                      <span className="text-[10px] text-ops-muted">Kiri</span>
                                    </div>
                                    <div className="py-2 px-3 text-ops-text flex items-center justify-between">
                                      <span>Current Running Config (Detected State)</span>
                                      <span className="text-[10px] text-ops-muted">Kanan</span>
                                    </div>
                                  </div>

                                  <div className="divide-y divide-ops-border font-mono text-xs">
                                    {filteredDiffRows.map((row, idx) => {
                                      const bgClassA =
                                        row.type === "delete"
                                          ? "bg-ops-danger/15 text-ops-danger"
                                          : row.type === "replace"
                                          ? "bg-ops-warning/15 text-ops-warning"
                                          : "text-ops-muted";
                                      const bgClassB =
                                        row.type === "insert"
                                          ? "bg-ops-success/15 text-ops-success"
                                          : row.type === "replace"
                                          ? "bg-ops-success/15 text-ops-success"
                                          : "text-ops-muted";

                                      return (
                                        <div key={idx} className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] border-b border-ops-border hover:bg-ops-surface-raised">
                                          <span className="py-1 px-2 text-right text-ops-muted select-none bg-ops-surface-raised border-r border-ops-border">
                                            {row.lineA ?? ""}
                                          </span>
                                          <pre className={`py-1 px-2.5 whitespace-pre-wrap break-words border-r border-ops-border m-0 ${bgClassA}`}>
                                            {row.textA}
                                          </pre>
                                          <span className="py-1 px-2 text-right text-ops-muted select-none bg-ops-surface-raised border-r border-ops-border">
                                            {row.lineB ?? ""}
                                          </span>
                                          <pre className={`py-1 px-2.5 whitespace-pre-wrap break-words m-0 ${bgClassB}`}>
                                            {row.textB}
                                          </pre>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {/* Audit Notes Thread */}
                          <div className="border-t border-ops-border bg-ops-surface-raised p-4 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-bold text-ops-text uppercase tracking-wider">
                              <MessageSquare className="size-4 text-ops-accent" />
                              <span>Audit Notes &amp; Evidence Trail ({notes.length})</span>
                            </div>

                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {notes.length === 0 && (
                                <p className="text-xs text-ops-muted italic">Belum ada catatan audit pada tiket review ini.</p>
                              )}
                              {notes.map((n, i) => (
                                <div key={i} className="rounded border border-ops-border bg-ops-bg p-2.5 text-xs">
                                  <div className="flex items-center justify-between text-ops-muted text-[11px] pb-1">
                                    <span className="font-semibold text-ops-text">{pick(n, "author_name", "authorName") || `User #${pick(n, "author_id", "authorId") || "?"}`}</span>
                                    <span>{formatDate(pick(n, "created_at", "createdAt"))}</span>
                                  </div>
                                  <p className="text-ops-text whitespace-pre-wrap mt-0.5">{pick(n, "body")}</p>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2 pt-1">
                              <textarea
                                rows={2}
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                placeholder="Tambah catatan audit (mis. konfirmasi NOC, referensi tiket, justifikasi teknis)…"
                                className="ops-input w-full p-2 text-xs placeholder:text-ops-muted"
                              />
                              <ActionButton
                                type="button"
                                variant="secondary"
                                isPending={isAddingNote}
                                disabled={!noteDraft.trim()}
                                onClick={() => handleAddNote(id)}
                                className="shrink-0"
                              >
                                Kirim Catatan
                              </ActionButton>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MODAL 1: APPROVE & PROMOTE TO BASELINE */}
      {promoteModalOpen && promoteReviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setPromoteModalOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-ops-border bg-ops-surface p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ops-border pb-3">
              <h3 className="text-base font-bold text-ops-text flex items-center gap-2">
                <Sparkles className="size-5 text-ops-warning" />
                Approve &amp; Promote to Golden Baseline
              </h3>
              <button type="button" onClick={() => setPromoteModalOpen(false)} className="text-ops-muted hover:text-ops-text">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-ops-text">
              Aksi ini akan menyetujui drift (status <strong>APPROVED</strong>) dan memperbarui golden baseline switch dengan konfigurasi ini secara atomik. Siklus review berkala akan di-reset (diperpanjang 6 bulan).
            </p>

            <form onSubmit={handlePromoteSubmit} className="space-y-3">
              <label className="block space-y-1 text-xs font-medium text-ops-text">
                <span>Change Request ID / Justifikasi Otorisasi (Wajib ISO 27001) *</span>
                <input
                  type="text"
                  required
                  value={promoteReason}
                  onChange={(e) => setPromoteReason(e.target.value)}
                  placeholder="e.g. CR-2026-089: Penambahan VLAN 20 server finance"
                  className={inputClass}
                  autoFocus
                />
              </label>

              <label className="block space-y-1 text-xs font-medium text-ops-text">
                <span>Catatan Operasional Tambahan (Opsional)</span>
                <textarea
                  rows={3}
                  value={promoteComment}
                  onChange={(e) => setPromoteComment(e.target.value)}
                  placeholder="Catatan verifikasi atau referensi teknis…"
                  className="ops-input w-full p-2 text-xs placeholder:text-ops-muted"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-ops-border">
                <ActionButton type="button" variant="ghost" onClick={() => setPromoteModalOpen(false)}>
                  Batal
                </ActionButton>
                <ActionButton
                  type="submit"
                  isPending={isPromoting}
                  disabled={!promoteReason.trim()}
                  className="bg-ops-warning text-ops-text hover:bg-ops-warning/80 font-bold"
                >
                  Konfirmasi &amp; Jadikan Baseline Baru
                </ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: FLAG & ROLLBACK REMEDIATION GUIDANCE */}
      {rollbackModalOpen && promoteReviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setRollbackModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-ops-border bg-ops-surface p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ops-border pb-3">
              <h3 className="text-base font-bold text-ops-danger flex items-center gap-2">
                <AlertTriangle className="size-5 text-ops-danger" />
                Flag Unapproved Drift &amp; Rollback Guidance
              </h3>
              <button type="button" onClick={() => setRollbackModalOpen(false)} className="text-ops-muted hover:text-ops-text">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-ops-text">
              Drift ini akan ditandai sebagai <strong>FLAGGED</strong> (temuan perubahan tidak terotorisasi untuk ISO 27001). Berikut adalah instruksi rollback CLI otomatis untuk remedi mengembalikan switch ke baseline.
            </p>

            <label className="block space-y-1 text-xs font-medium text-ops-text">
              <span>Incident / Violation Reference (Opsional)</span>
              <input
                type="text"
                value={flagIncidentRef}
                onChange={(e) => setFlagIncidentRef(e.target.value)}
                placeholder="e.g. INC-2026-401: Unauthorized VLAN creation on Core Switch"
                className={inputClass}
              />
            </label>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ops-muted mb-1">
                Remediation CLI Rollback Script:
              </div>
              {rollbackLoading ? (
                <p className="p-4 text-center text-xs text-ops-muted bg-ops-bg rounded">Membuat script rollback…</p>
              ) : (
                <pre className="max-h-52 overflow-auto rounded border border-ops-border bg-ops-bg p-3 font-mono text-xs text-ops-text">
                  {rollbackScript || "! Tidak ada script rollback yang tersedia."}
                </pre>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ops-border">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(rollbackScript);
                  alert("Script rollback berhasil disalin ke clipboard!");
                }}
                className="inline-flex items-center gap-1.5 rounded border border-ops-border bg-ops-surface-raised px-3 py-1.5 text-xs text-ops-text hover:border-ops-accent/50"
              >
                <Copy className="size-3.5" />
                Salin Script Rollback
              </button>
              <div className="flex items-center gap-2">
                <ActionButton type="button" variant="ghost" onClick={() => setRollbackModalOpen(false)}>
                  Batal
                </ActionButton>
                <ActionButton
                  type="button"
                  variant="danger"
                  onClick={handleFlagSubmit}
                >
                  Konfirmasi &amp; Tandai FLAGGED
                </ActionButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CYCLE ATTESTATION RESULT */}
      {cycleModalOpen && cycleResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setCycleModalOpen(false)}>
          <div className="w-full max-w-xl rounded-xl border border-ops-border bg-ops-surface p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ops-border pb-3">
              <h3 className="text-base font-bold text-ops-text flex items-center gap-2">
                <CheckCircle2 className="size-5 text-ops-success" />
                Siklus Review Fleet Selesai
              </h3>
              <button type="button" onClick={() => setCycleModalOpen(false)} className="text-ops-muted hover:text-ops-text">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-sm text-ops-text font-semibold">{pick(cycleResult, "message")}</p>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded border border-ops-border bg-ops-bg p-3 text-center">
                <div className="text-xl font-bold font-mono text-ops-text">{pick(cycleResult, "total_checked")}</div>
                <div className="text-[11px] text-ops-muted">Total Diperiksa</div>
              </div>
              <div className="rounded border border-ops-border bg-ops-bg p-3 text-center">
                <div className="text-xl font-bold font-mono text-ops-success">{pick(cycleResult, "clean_count")}</div>
                <div className="text-[11px] text-ops-muted">Clean Attested</div>
              </div>
              <div className="rounded border border-ops-border bg-ops-bg p-3 text-center">
                <div className="text-xl font-bold font-mono text-ops-warning">{pick(cycleResult, "drift_count")}</div>
                <div className="text-[11px] text-ops-muted">Review Baru</div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-ops-border">
              <ActionButton type="button" onClick={() => setCycleModalOpen(false)}>
                Tutup Ringkasan
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
