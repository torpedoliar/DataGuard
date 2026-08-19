"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncNetworkDocsAction } from "@/actions/network-docs";
import type { NetworkDocSyncSummary } from "@/lib/network-doc";
import ActionButton from "@/components/ui/action-button";

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "default" | "good" | "warn" }) {
  const valueClass =
    tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-ops-text";
  return (
    <div className="rounded-md border border-ops-border bg-ops-surface-raised p-3">
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="mt-1 text-xs text-ops-muted">{label}</div>
    </div>
  );
}

export default function NetworkDocsButton() {
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<NetworkDocSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncNetworkDocsAction();
        if ("message" in result) {
          setSummary(null);
          setError(result.message);
          return;
        }
        setSummary(result);
      } catch (err) {
        setSummary(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ActionButton
          type="button"
          onClick={run}
          isPending={isPending}
          icon={<RefreshCw className="size-4" />}
        >
          Sync from network-doc
        </ActionButton>
        {isPending && <span className="text-sm text-ops-muted">Menyinkronkan…</span>}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <SummaryCard label="Switch total" value={summary.switchesTotal} />
            <SummaryCard label="Switch matched" value={summary.switchesMatched} tone="good" />
            <SummaryCard
              label="Switch unmatched"
              value={summary.switchesUnmatched}
              tone={summary.switchesUnmatched > 0 ? "warn" : "default"}
            />
            <SummaryCard label="VLAN dibuat" value={summary.vlansCreated} />
            <SummaryCard label="VLAN diupdate" value={summary.vlansUpdated} />
            <SummaryCard label="Port dibuat" value={summary.portsCreated} />
            <SummaryCard label="Port diupdate" value={summary.portsUpdated} />
          </div>

          {summary.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-amber-200">Warnings</div>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-amber-100/80">
                {summary.warnings.map((warning, i) => (
                  <li key={i}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.switchesTotal === 0 && summary.warnings.length === 0 && (
            <p className="text-sm text-ops-muted">Network-doc mengembalikan 0 switch untuk site ini.</p>
          )}
        </div>
      )}
    </div>
  );
}
