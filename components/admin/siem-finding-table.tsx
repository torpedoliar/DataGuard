"use client";

import { generateSiemAiAnalysis } from "@/actions/siem-ai";
import { createIncidentFromSiemFinding, updateSiemFindingStatus } from "@/actions/siem-findings";
import ActionButton from "@/components/ui/action-button";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { getIncidentSeverityTone } from "@/lib/ui/status";
import { CheckCircle2, Eye, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

export type SiemFindingRow = {
  id: number;
  title: string;
  summary: string;
  humanAnalysis: string | null;
  recommendedAction: string | null;
  aiAnalysis: Record<string, unknown> | null;
  aiGeneratedAt: Date | null;
  severity: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "Acknowledged" | "Resolved";
  eventCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sampleEventIds: number[];
  correlationKey: string;
  createdIncidentId: number | null;
  ruleKey: string | null;
  ruleName: string | null;
  ruleCategory: string | null;
  siteName: string | null;
  deviceId: number | null;
  deviceName: string | null;
  sourceName: string | null;
  sourceIp: string | null;
};

function statusTone(status: SiemFindingRow["status"]) {
  if (status === "Open") return "info";
  if (status === "Acknowledged") return "warning";
  return "success";
}

import { formatWibDateTime } from "@/lib/ui/datetime";
function formatDate(date: Date) {
  return formatWibDateTime(date);
}

function FindingStatusForm({ finding }: { finding: SiemFindingRow }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(updateSiemFindingStatus, undefined);
  const [status, setStatus] = useState(finding.status);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="id" value={finding.id} />
      <select name="status" value={status} onChange={(event) => setStatus(event.target.value as SiemFindingRow["status"])} className="ops-input h-8 min-w-32 px-2 text-xs">
        <option value="Open">Open</option>
        <option value="Acknowledged">Acknowledged</option>
        <option value="Resolved">Resolved</option>
      </select>
      <ActionButton type="submit" size="sm" variant="secondary" isPending={isPending}>Save</ActionButton>
    </form>
  );
}

function CreateIncidentForm({ finding }: { finding: SiemFindingRow }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(createIncidentFromSiemFinding, undefined);
  const disabled = !finding.deviceId || Boolean(finding.createdIncidentId);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <div className="space-y-1 text-right">
      <form action={action}>
        <input type="hidden" name="id" value={finding.id} />
        <ActionButton type="submit" size="sm" disabled={disabled} isPending={isPending} icon={<ShieldCheck className="size-4" />}>Create Incident</ActionButton>
      </form>
      {!finding.deviceId && <p className="text-xs text-amber-200">Map source to device first.</p>}
      {state?.message && !state.success && <p className="text-xs text-red-200">{state.message}</p>}
    </div>
  );
}

function GenerateAiAnalysisForm({ finding }: { finding: SiemFindingRow }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(generateSiemAiAnalysis, undefined);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <div className="space-y-1 text-right">
      <form action={action}>
        <input type="hidden" name="id" value={finding.id} />
        <ActionButton type="submit" size="sm" variant="secondary" isPending={isPending}>AI Analysis</ActionButton>
      </form>
      {state?.message && !state.success && <p className="text-xs text-red-200">{state.message}</p>}
    </div>
  );
}

function AiAnalysisBlock({ analysis }: { analysis: Record<string, unknown> }) {
  const summary = typeof analysis.summary === "string" ? analysis.summary : null;
  const likelyCause = typeof analysis.likelyCause === "string" ? analysis.likelyCause : null;
  const impact = typeof analysis.impact === "string" ? analysis.impact : null;
  const actions = Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions.filter((item): item is string => typeof item === "string") : [];

  return (
    <div className="mt-2 max-w-xl rounded-md border border-purple-400/25 bg-purple-500/10 p-3 text-xs text-purple-100">
      {summary && <p><span className="font-semibold">AI:</span> {summary}</p>}
      {likelyCause && <p className="mt-1"><span className="font-semibold">Likely cause:</span> {likelyCause}</p>}
      {impact && <p className="mt-1"><span className="font-semibold">Impact:</span> {impact}</p>}
      {actions.length > 0 && <p className="mt-1"><span className="font-semibold">Next:</span> {actions.join(" ")}</p>}
    </div>
  );
}

export default function SiemFindingTable({ findings }: { findings: SiemFindingRow[] }) {
  return (
    <DataTableFrame>
      <DataTable>
        <DataTableHead>
          <tr>
            <th className="px-4 py-3">Finding</th>
            <th className="px-4 py-3">Rule</th>
            <th className="px-4 py-3">Asset / Source</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Last Seen</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {findings.length === 0 ? (
            <DataTableEmpty colSpan={7} title="No SIEM findings" description="Rule worker findings appear here after parsed events match enabled rules." />
          ) : findings.map((finding) => (
            <tr key={finding.id} className="align-top transition-colors hover:bg-ops-surface">
              <td className="px-4 py-3">
                <div className="font-semibold text-ops-text">#{finding.id} {finding.title}</div>
                <p className="mt-1 max-w-xl text-sm text-ops-muted">{finding.humanAnalysis || finding.summary}</p>
                {finding.recommendedAction && <p className="mt-2 max-w-xl text-xs text-emerald-200">Action: {finding.recommendedAction}</p>}
                {finding.aiAnalysis && <AiAnalysisBlock analysis={finding.aiAnalysis} />}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge tone="neutral">{finding.eventCount} events</StatusBadge>
                  {finding.createdIncidentId && (
                    <Link href={`/admin/incidents/${finding.createdIncidentId}`}>
                      <StatusBadge tone="danger">incident #{finding.createdIncidentId}</StatusBadge>
                    </Link>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-ops-text">{finding.ruleName || finding.ruleKey || "Unknown rule"}</div>
                <div className="text-xs text-ops-muted">{finding.ruleCategory || "Uncategorized"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-ops-text">{finding.deviceName || "Unmapped device"}</div>
                <div className="text-xs text-ops-muted">{finding.sourceName || finding.sourceIp || "No source"}</div>
              </td>
              <td className="px-4 py-3"><StatusBadge tone={getIncidentSeverityTone(finding.severity)} dot>{finding.severity}</StatusBadge></td>
              <td className="px-4 py-3"><StatusBadge tone={statusTone(finding.status)}>{finding.status}</StatusBadge></td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-ops-muted">{formatDate(finding.lastSeenAt)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-col items-end gap-2">
                  <FindingStatusForm finding={finding} />
                  <div className="flex gap-2">
                    <ActionButton
                      href={finding.sampleEventIds.length
                        ? `/admin/siem/events?eventIds=${finding.sampleEventIds.join(",")}`
                        : `/admin/siem/events?sourceIp=${finding.sourceIp ?? ""}`}
                      variant="ghost" size="sm" icon={<Eye className="size-4" />}>Events</ActionButton>
                    {finding.status === "Resolved" && <CheckCircle2 className="mt-1 size-4 text-emerald-300" />}
                  </div>
                  <GenerateAiAnalysisForm finding={finding} />
                  <CreateIncidentForm finding={finding} />
                </div>
              </td>
            </tr>
          ))}
        </DataTableBody>
      </DataTable>
    </DataTableFrame>
  );
}
