"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Clock, GitCompareArrows, History, Search, X } from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import { getNcmReviewDetail } from "@/actions/ncm";

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

/** One-line human summary of a drift record's structured diff. */
function summaryText(summary: Row): string {
  const parts: string[] = [];
  const added = (summary.vlans_added as number[] | undefined) ?? [];
  const removed = (summary.vlans_removed as number[] | undefined) ?? [];
  const changed = (summary.ports_changed as string[] | undefined) ?? [];
  const renamed = (summary.vlans_renamed as number[] | undefined) ?? [];
  if (added.length) parts.push(`VLAN +${added.join(",")}`);
  if (removed.length) parts.push(`VLAN -${removed.join(",")}`);
  if (renamed.length) parts.push(`VLAN renamed ${renamed.join(",")}`);
  if (changed.length) parts.push(`${changed.length} port(s) changed (${changed.slice(0, 5).join(", ")})`);
  if (summary.hostname_changed) parts.push("hostname changed");
  return parts.join(" · ") || "text diff only";
}

function DiffViewer({ reviewId, onClose }: { reviewId: number; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mounted once per opened review (the row unmounts on close), so the
    // initial `loading` state already covers the fetch below.
    let cancelled = false;
    getNcmReviewDetail(reviewId)
      .then((res) => {
        if (cancelled) return;
        if (res.diff !== undefined) setDiff(res.diff);
        else setError(res.message || "Diff tidak tersedia.");
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
  }, [reviewId]);

  return (
    <div className="border-t border-ops-border bg-ops-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ops-text">
          Diff review #{reviewId}
        </span>
        <button type="button" onClick={onClose} className="text-ops-muted hover:text-ops-text">
          <X className="size-4" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-ops-muted">
          <Clock className="size-4 animate-spin text-ops-accent" />
          Memuat diff dari NCM…
        </div>
      ) : error ? (
        <div className="rounded border border-ops-danger/30 bg-ops-danger/10 p-3 text-xs text-ops-danger">
          {error}
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto rounded border border-ops-border bg-ops-surface p-3 text-[11px] leading-5">
          {(diff ?? "").split("\n").map((line, index) => {
            const tone = line.startsWith("+")
              ? "text-ops-success"
              : line.startsWith("-")
                ? "text-ops-danger"
                : line.startsWith("@@")
                  ? "text-ops-info"
                  : "text-ops-muted";
            return (
              <div key={index} className={tone}>
                <span className="mr-3 inline-block w-10 select-none text-right opacity-50">
                  {index + 1}
                </span>
                {line || " "}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

export function NcmChangeHistory({ reviews }: { reviews: Row[] }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return reviews;
    return reviews.filter((row) => {
      const haystack = [
        pick(row, "id"),
        pick(row, "switch_name"),
        summaryText((row.diff_summary as Row) ?? {}),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [reviews, query]);

  return (
    <div className="space-y-4">
      <section className="ops-panel p-5 space-y-3">
        <div className="flex items-start gap-2">
          <History className="mt-0.5 size-5 text-ops-accent" />
          <div>
            <h3 className="text-base font-bold text-ops-text">Riwayat Perubahan Konfigurasi</h3>
            <p className="mt-1 max-w-3xl text-xs text-ops-muted">
              Catatan otomatis setiap perubahan konfigurasi switch yang terdeteksi saat backup
              dibandingkan dengan golden baseline. Ini adalah jejak bukti (read-only), bukan tiket
              review — attestation berkala ada di menu <strong>Config Review</strong>.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ops-border bg-ops-surface-raised p-3">
        <label className="flex items-center gap-2">
          <Search className="size-4 text-ops-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari switch, ID, atau perubahan…"
            className="ops-input h-8 w-64 px-2.5 text-xs"
          />
        </label>
        <span className="text-xs text-ops-muted">
          Menampilkan {filtered.length} dari {reviews.length} catatan perubahan
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-ops-border bg-ops-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ops-border text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2.5 px-3">ID</th>
              <th className="py-2.5 px-3">Switch</th>
              <th className="py-2.5 px-3">Terdeteksi</th>
              <th className="py-2.5 px-3">Ringkasan Perubahan</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-ops-muted">
                  Belum ada catatan perubahan konfigurasi.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const id = Number(pick(row, "id"));
              const summary = (row.diff_summary as Row) ?? {};
              const isOpen = openId === id;
              return (
                <Fragment key={id}>
                  <tr className={`border-t border-ops-border transition-colors ${isOpen ? "bg-ops-surface-raised" : "hover:bg-ops-surface-raised"}`}>
                    <td className="py-2.5 px-3 font-mono font-medium text-ops-text">#{id}</td>
                    <td className="py-2.5 px-3 font-semibold text-ops-text">
                      {pick(row, "switch_name") || `#${pick(row, "switch_id")}`}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-ops-text">
                      {formatDate(pick(row, "created_at"))}
                    </td>
                    <td className="max-w-md truncate py-2.5 px-3 text-xs text-ops-text" title={JSON.stringify(summary)}>
                      {summaryText(summary)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center rounded-full border border-ops-warning/30 bg-ops-warning/10 px-2 py-0.5 text-[11px] font-semibold text-ops-warning">
                        {pick(row, "status") || "pending"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <ActionButton
                        size="sm"
                        variant={isOpen ? "primary" : "secondary"}
                        onClick={() => setOpenId(isOpen ? null : id)}
                      >
                        <GitCompareArrows className="size-3.5" />
                        {isOpen ? "Tutup Diff" : "Diff"}
                      </ActionButton>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <DiffViewer reviewId={id} onClose={() => setOpenId(null)} />
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
