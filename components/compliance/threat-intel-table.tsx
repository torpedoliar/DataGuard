"use client";

import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import IconButton from "@/components/ui/icon-button";
import StatusBadge from "@/components/ui/status-badge";
import {
  getThreatSeverityTone,
  getThreatStatusTone,
  threatSeverityLabels,
  threatStatusLabels,
  type ThreatIntelRecord,
} from "@/lib/threat-intel";
import { Edit2, ExternalLink, Image as ImageIcon, Trash2 } from "lucide-react";

interface ThreatIntelTableProps {
  items: ThreatIntelRecord[];
  onEdit: (item: ThreatIntelRecord) => void;
  onDelete: (item: ThreatIntelRecord) => void;
  onViewPhoto: (photoPath: string, caption?: string) => void;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ThreatIntelTable({
  items,
  onEdit,
  onDelete,
  onViewPhoto,
}: ThreatIntelTableProps) {
  return (
    <DataTableFrame>
      <DataTable>
        <DataTableHead>
          <tr>
            <th className="px-3.5 py-3">Tanggal Info</th>
            <th className="px-3.5 py-3">Sumber</th>
            <th className="px-3.5 py-3 min-w-[280px]">Deskripsi Kerentanan</th>
            <th className="px-3.5 py-3">Asset Terdampak</th>
            <th className="px-3.5 py-3">Status</th>
            <th className="px-3.5 py-3">Tgl Mitigasi</th>
            <th className="px-3.5 py-3 min-w-[220px]">Patching / Tindakan</th>
            <th className="px-3.5 py-3 text-center">Bukti</th>
            <th className="px-3.5 py-3 text-right">Aksi</th>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {items.length === 0 ? (
            <DataTableEmpty
              colSpan={9}
              title="Belum ada data Threat Intelligence"
              description="Klik tombol '+ New Advisory' untuk menambahkan rekaman kerentanan baru."
            />
          ) : (
            items.map((item) => {
              const cveArray = item.cveList
                ? item.cveList
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean)
                : [];

              return (
                <tr
                  key={item.id}
                  className="group transition-colors hover:bg-ops-surface"
                >
                  {/* 1. Tanggal Informasi */}
                  <td className="whitespace-nowrap px-3.5 py-3 text-xs font-mono text-ops-muted">
                    {formatDate(item.intelDate)}
                  </td>

                  {/* 2. Sumber */}
                  <td className="px-3.5 py-3 text-xs">
                    {item.sourceUrl ? (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300 hover:underline"
                        title={item.sourceUrl}
                      >
                        <span className="truncate max-w-[120px]">{item.source}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-ops-text font-medium">{item.source}</span>
                    )}
                  </td>

                  {/* 3. Deskripsi Kerentanan */}
                  <td className="px-3.5 py-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ops-text text-sm leading-tight">
                          {item.title}
                        </span>
                        {item.cvssScore !== null && item.cvssScore !== undefined && (
                          <StatusBadge
                            tone={getThreatSeverityTone(item.severity)}
                            className="text-[10px] px-2 py-0.5"
                          >
                            CVSS: {item.cvssScore.toFixed(1)} ({threatSeverityLabels[item.severity]})
                          </StatusBadge>
                        )}
                      </div>

                      {cveArray.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {cveArray.map((cve, idx) => (
                            <span
                              key={idx}
                              className="rounded border border-ops-border bg-ops-bg px-1.5 py-0.5 font-mono text-[10px] text-ops-muted"
                            >
                              {cve}
                            </span>
                          ))}
                        </div>
                      )}

                      {item.description && (
                        <p className="text-xs text-ops-muted line-clamp-2 mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* 4. Asset Yang Terdampak */}
                  <td className="px-3.5 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-ops-text text-xs">
                        {item.affectedAsset}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {item.siteName ? (
                          <span className="rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 text-[10px]">
                            {item.siteName}
                          </span>
                        ) : (
                          <span className="rounded bg-slate-500/10 text-slate-400 border border-slate-500/20 px-1.5 py-0.5 text-[10px]">
                            Global (All Sites)
                          </span>
                        )}
                        {item.deviceName && (
                          <span className="rounded bg-ops-surface border border-ops-border px-1.5 py-0.5 text-[10px] text-ops-muted">
                            Device: {item.deviceName}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 5. Status Mitigasi */}
                  <td className="whitespace-nowrap px-3.5 py-3">
                    <StatusBadge
                      tone={getThreatStatusTone(item.status)}
                      dot
                      className="text-xs capitalize"
                    >
                      {threatStatusLabels[item.status]}
                    </StatusBadge>
                  </td>

                  {/* 6. Tanggal Mitigasi */}
                  <td className="whitespace-nowrap px-3.5 py-3 text-xs font-mono text-ops-muted">
                    {formatDate(item.mitigatedAt)}
                  </td>

                  {/* 7. Patching / Tindakan Mitigasi */}
                  <td className="px-3.5 py-3 text-xs text-ops-muted">
                    {item.mitigationAction ? (
                      <p className="line-clamp-2 text-ops-text">{item.mitigationAction}</p>
                    ) : (
                      "-"
                    )}
                  </td>

                  {/* 8. Bukti (Multi-evidence Gallery) */}
                  <td className="px-3.5 py-3 text-center">
                    {item.evidences && item.evidences.length > 0 ? (
                      <div className="flex items-center justify-center gap-1.5">
                        {item.evidences.map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() =>
                              onViewPhoto(
                                ev.filePath,
                                ev.caption ? `${item.title} - ${ev.caption}` : item.title
                              )
                            }
                            className="group/thumb relative size-9 overflow-hidden rounded-md border border-ops-border bg-ops-surface hover:border-ops-accent transition-all shrink-0"
                            title={ev.caption || ev.fileName || "View evidence"}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={ev.filePath}
                              alt={ev.caption || "Evidence thumbnail"}
                              className="size-full object-cover group-hover/thumb:scale-110 transition-transform"
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-ops-muted text-xs inline-flex items-center gap-1">
                        <ImageIcon className="size-3.5 opacity-40" />
                        None
                      </span>
                    )}
                  </td>

                  {/* 9. Aksi */}
                  <td className="whitespace-nowrap px-3.5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        icon={<Edit2 className="size-4" />}
                        label="Edit advisory"
                        onClick={() => onEdit(item)}
                      />
                      <IconButton
                        icon={<Trash2 className="size-4 text-red-400" />}
                        label="Delete advisory"
                        onClick={() => onDelete(item)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </DataTableBody>
      </DataTable>
    </DataTableFrame>
  );
}
