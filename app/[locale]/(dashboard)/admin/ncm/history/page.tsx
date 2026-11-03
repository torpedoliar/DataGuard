import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { getNcmChangeOverviewAction } from "@/actions/ncm";
import { NcmChangeHistory } from "@/components/admin/ncm-change-history";
import type { NcmChangeRow } from "@/components/admin/ncm-change-history";
import PageHeader from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Riwayat Perubahan" };

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value);
}

function toNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/**
 * Per-switch comparison of the latest successful backup against the golden
 * baseline. Baseline resolution mirrors NCM: a per-switch baseline wins, a
 * per-model template is the fallback.
 */
function buildRows(switches: Row[], backups: Row[], baselines: Row[]): NcmChangeRow[] {
  const bySwitch = new Map<number, Row>();
  const byModel = new Map<string, Row>();

  for (const baseline of baselines) {
    const kind = text(baseline, "kind");
    if (kind === "switch") {
      const switchId = toNumber(baseline, "switch_id");
      if (switchId !== null) bySwitch.set(switchId, baseline);
    } else if (kind === "model") {
      const model = text(baseline, "model");
      if (model) byModel.set(model, baseline);
    }
  }

  const latestBackup = new Map<number, Row>();
  for (const backup of backups) {
    const switchId = toNumber(backup, "switch_id");
    if (switchId === null) continue;
    if (text(backup, "success") === "false") continue;
    const current = latestBackup.get(switchId);
    if (!current) {
      latestBackup.set(switchId, backup);
      continue;
    }
    const currentAt = Date.parse(text(current, "created_at")) || 0;
    const candidateAt = Date.parse(text(backup, "created_at")) || 0;
    if (candidateAt > currentAt) latestBackup.set(switchId, backup);
  }

  const rank = (state: NcmChangeRow["state"]): number =>
    state === "changed" ? 0 : state === "no-backup" ? 1 : state === "clean" ? 2 : 3;

  return switches
    .filter((row) => text(row, "is_active") !== "false")
    .map((row) => {
      const switchId = toNumber(row, "id") ?? 0;
      const model = text(row, "model") || null;
      const baseline = bySwitch.get(switchId) ?? (model ? byModel.get(model) : undefined) ?? null;
      const baselineBackupId = baseline ? toNumber(baseline, "backup_id") : null;
      const latest = latestBackup.get(switchId) ?? null;
      const latestBackupId = latest ? toNumber(latest, "id") : null;

      let state: NcmChangeRow["state"] = "no-baseline";
      if (baselineBackupId === null) state = "no-baseline";
      else if (latestBackupId === null) state = "no-backup";
      else if (latestBackupId === baselineBackupId) state = "clean";
      else state = "changed";

      return {
        switchId,
        switchName: text(row, "name") || "#" + String(switchId),
        model,
        baselineBackupId,
        baselineAt: baseline ? text(baseline, "created_at") || null : null,
        latestBackupId,
        latestAt: latest ? text(latest, "created_at") || null : null,
        latestSeq: latest ? toNumber(latest, "switch_seq") : null,
        state,
      };
    })
    .sort((a, b) => rank(a.state) - rank(b.state) || a.switchName.localeCompare(b.switchName));
}

export default async function NcmChangeHistoryPage() {
  const session = await verifySession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/checklist");
  if (!session.activeSiteId) redirect("/select-site");

  const result = await getNcmChangeOverviewAction().catch((error) => ({
    status: "offline" as const,
    error: error instanceof Error ? error.message : String(error),
  }));

  const rows =
    result.status === "online"
      ? buildRows(asRows(result.switches), asRows(result.backups), asRows(result.baselines))
      : [];

  return (
    <main className="mx-auto flex w-full max-w-[1600px] animate-enter flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Admin / NCM"
        title="Change history"
        description="Perbandingan backup terakhir setiap switch dengan golden baseline-nya. Switch yang berbeda ditandai, dan tiap baris bisa dibuka sebagai perbandingan decode VLAN & port."
      />
      {result.status !== "online" && (
        <div className="rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
          {"message" in result ? result.message : "NCM tidak dapat dihubungi: " + result.error}
        </div>
      )}
      <NcmChangeHistory rows={rows} />
    </main>
  );
}
