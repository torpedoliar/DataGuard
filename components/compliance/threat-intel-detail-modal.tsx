"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
import {
  getThreatSeverityTone,
  getThreatStatusTone,
  threatSeverityLabels,
  threatStatusLabels,
  type ThreatIntelRecord,
} from "@/lib/threat-intel";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  MapPin,
  Server,
  Shield,
  Wrench,
  ZoomIn,
} from "lucide-react";

export interface ThreatIntelDetailModalProps {
  item: ThreatIntelRecord | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (item: ThreatIntelRecord) => void;
  onViewPhoto?: (photoPath: string, caption?: string) => void;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ThreatIntelDetailModal({
  item,
  open,
  onClose,
  onEdit,
  onViewPhoto,
}: ThreatIntelDetailModalProps) {
  if (!item) return null;

  const cveArray = item.cveList
    ? item.cveList
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  const handleEditClick = () => {
    if (onEdit) {
      onEdit(item);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.title}
      description="ISO/IEC 27001:2022 Control A.5.7 (Threat Intelligence) & A.8.8 (Management of Technical Vulnerabilities)"
      panelClassName="w-full max-w-4xl max-h-[85vh] sm:max-h-[90vh] flex flex-col rounded-xl border border-ops-border bg-ops-surface-raised shadow-2xl overflow-hidden"
      bodyClassName="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6 text-ops-text"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 text-xs text-ops-muted">
            <Clock className="size-3.5" />
            <span>
              Dicatat pada {formatDate(item.createdAt)}
              {item.createdByName ? ` oleh ${item.createdByName}` : ""}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <ActionButton
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Tutup
            </ActionButton>

            {onEdit && (
              <ActionButton
                type="button"
                variant="primary"
                icon={<Edit2 className="size-4" />}
                onClick={handleEditClick}
              >
                Edit Advisory
              </ActionButton>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Top Header Card */}
        <div className="rounded-lg border border-ops-border bg-ops-bg/60 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {item.cvssScore !== null && item.cvssScore !== undefined && (
                <StatusBadge
                  tone={getThreatSeverityTone(item.severity)}
                  className="px-2.5 py-1 text-xs font-semibold"
                >
                  CVSS {item.cvssScore.toFixed(1)} · {threatSeverityLabels[item.severity]}
                </StatusBadge>
              )}
              <StatusBadge
                tone={getThreatStatusTone(item.status)}
                dot
                className="px-2.5 py-1 text-xs capitalize font-medium"
              >
                {threatStatusLabels[item.status]}
              </StatusBadge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-ops-muted font-mono">
              <Calendar className="size-3.5 text-ops-accent" />
              <span>Tanggal Info: {formatShortDate(item.intelDate)}</span>
            </div>
          </div>

          <h3 className="text-xl font-bold text-ops-text leading-snug">
            {item.title}
          </h3>
        </div>

        {/* Section 1: Overview & Asset Scope (Grid 2 cols) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Source & CVEs */}
          <div className="rounded-lg border border-ops-border bg-ops-surface/60 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-ops-border/60 pb-2 text-xs font-semibold text-ops-muted uppercase tracking-wider">
              <Globe className="size-3.5 text-blue-400" />
              <span>Sumber Informasi & CVE</span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ops-muted">Sumber Publikasi:</span>
                <span className="font-semibold text-ops-text">{item.source}</span>
              </div>

              {item.sourceUrl && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ops-muted">Tautan Advisory:</span>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline font-medium max-w-[200px] truncate"
                    title={item.sourceUrl}
                  >
                    <span>Buka Sumber Resmi</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </div>
              )}

              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-xs text-ops-muted">Daftar CVE Terkait:</span>
                {cveArray.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {cveArray.map((cve, idx) => {
                      const isCveFormat = /^CVE-\d{4}-\d+$/i.test(cve);
                      return isCveFormat ? (
                        <a
                          key={idx}
                          href={`https://nvd.nist.gov/vuln/detail/${cve}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-ops-border bg-ops-bg px-2 py-0.5 font-mono text-xs text-ops-accent hover:border-ops-accent transition-colors"
                          title={`Lihat detail ${cve} di NVD NIST`}
                        >
                          <span>{cve}</span>
                          <ExternalLink className="size-2.5 opacity-70" />
                        </a>
                      ) : (
                        <span
                          key={idx}
                          className="rounded border border-ops-border bg-ops-bg px-2 py-0.5 font-mono text-xs text-ops-text"
                        >
                          {cve}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-ops-muted italic">Tidak ada referensi CVE spesifik</span>
                )}
              </div>
            </div>
          </div>

          {/* Affected Assets & Location */}
          <div className="rounded-lg border border-ops-border bg-ops-surface/60 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-ops-border/60 pb-2 text-xs font-semibold text-ops-muted uppercase tracking-wider">
              <Server className="size-3.5 text-amber-400" />
              <span>Asset & Lingkup Infrastruktur</span>
            </div>

            <div className="flex flex-col gap-2.5 text-xs">
              <div className="flex flex-col gap-1">
                <span className="text-ops-muted">Nama / Jenis Asset Terdampak:</span>
                <span className="font-semibold text-ops-text text-sm bg-ops-bg/80 px-2.5 py-1.5 rounded border border-ops-border">
                  {item.affectedAsset}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="flex flex-col gap-1 bg-ops-bg/40 p-2 rounded border border-ops-border/50">
                  <span className="text-[11px] text-ops-muted flex items-center gap-1">
                    <MapPin className="size-3 text-ops-muted" /> Site Lokasi
                  </span>
                  <span className="font-medium text-ops-text truncate">
                    {item.siteName || "Global (Semua Site)"}
                  </span>
                </div>

                <div className="flex flex-col gap-1 bg-ops-bg/40 p-2 rounded border border-ops-border/50">
                  <span className="text-[11px] text-ops-muted flex items-center gap-1">
                    <Layers className="size-3 text-ops-muted" /> Perangkat Terikat
                  </span>
                  <span className="font-medium text-ops-text truncate">
                    {item.deviceName || "Umum / Belum diikat"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Technical Description */}
        <div className="rounded-lg border border-ops-border bg-ops-surface/60 p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 border-b border-ops-border/60 pb-2 text-xs font-semibold text-ops-muted uppercase tracking-wider">
            <FileText className="size-3.5 text-ops-accent" />
            <span>Deskripsi & Analisis Kerentanan Teknis</span>
          </div>

          <div className="bg-ops-bg/70 p-4 rounded-lg border border-ops-border/70 text-sm leading-relaxed whitespace-pre-wrap text-ops-text font-normal">
            {item.description || "Tidak ada deskripsi rinci untuk kasus ini."}
          </div>
        </div>

        {/* Section 3: Remediation & Mitigation (ISO 27001 A.8.8) */}
        <div className={`rounded-lg border p-4 flex flex-col gap-2.5 ${
          item.status === "mitigated"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}>
          <div className="flex items-center justify-between border-b border-ops-border/50 pb-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ops-text">
              <Wrench className="size-3.5 text-emerald-400" />
              <span>Rencana Tindakan / Patching (ISO 27001 Control A.8.8)</span>
            </div>

            {item.mitigatedAt && (
              <div className="flex items-center gap-1 text-xs text-emerald-400 font-mono">
                <CheckCircle2 className="size-3" />
                <span>Dieksekusi: {formatShortDate(item.mitigatedAt)}</span>
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-lg bg-ops-bg/80 border border-ops-border text-sm leading-relaxed whitespace-pre-wrap text-ops-text">
            {item.mitigationAction || "Belum ada catatan rencana mitigasi / patching tertulis."}
          </div>
        </div>

        {/* Section 4: Evidences & Documentation */}
        <div className="rounded-lg border border-ops-border bg-ops-surface/60 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-ops-border/60 pb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-ops-muted uppercase tracking-wider">
              <ImageIcon className="size-3.5 text-ops-accent" />
              <span>Bukti Pelaksanaan & Dokumentasi ({item.evidences?.length || 0})</span>
            </div>
            <span className="text-[11px] text-ops-muted">Klik foto untuk memperbesar</span>
          </div>

          {item.evidences && item.evidences.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {item.evidences.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => onViewPhoto && onViewPhoto(ev.filePath, ev.caption || ev.fileName || undefined)}
                  className="group relative cursor-pointer overflow-hidden rounded-lg border border-ops-border bg-ops-bg transition-all hover:border-ops-accent/50 hover:shadow-lg"
                >
                  <div className="aspect-video w-full overflow-hidden bg-ops-surface flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ev.filePath}
                      alt={ev.caption || ev.fileName || "Bukti kerentanan"}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity flex items-center justify-center group-hover:opacity-100">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ops-surface/90 text-xs font-medium text-ops-text shadow">
                        <ZoomIn className="size-3.5 text-ops-accent" />
                        <span>Perbesar</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 flex flex-col gap-1 border-t border-ops-border/60">
                    <p className="text-xs font-medium text-ops-text truncate">
                      {ev.caption || ev.fileName}
                    </p>
                    <p className="text-[10px] text-ops-muted font-mono">
                      {formatShortDate(ev.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-ops-muted bg-ops-bg/40 rounded border border-dashed border-ops-border">
              <Shield className="size-6 text-ops-muted/60 mb-1.5" />
              <span>Belum ada lampiran bukti foto atau dokumen mitigasi.</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
