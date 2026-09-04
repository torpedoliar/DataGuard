"use client";

import { useState, useTransition } from "react";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import Modal from "@/components/ui/modal";
import PageHeader from "@/components/ui/page-header";
import StatusBadge from "@/components/ui/status-badge";
import PhotoModal from "@/components/report/photo-modal";
import ThreatIntelDetailModal from "./threat-intel-detail-modal";
import ThreatIntelFormModal from "./threat-intel-form-modal";
import ThreatIntelKpi from "./threat-intel-kpi";
import ThreatIntelTable from "./threat-intel-table";
import { deleteThreatIntel, getThreatIntelligences } from "@/actions/threat-intel";
import { exportThreatIntelToExcel } from "@/lib/compliance/threat-intel-export";
import { generateIso27001ThreatIntelPdf } from "@/lib/compliance/threat-intel-pdf";
import {
  threatSeverities,
  threatSeverityLabels,
  threatStatuses,
  threatStatusLabels,
  type ThreatIntelRecord,
  type ThreatIntelStats,
  type ThreatSeverity,
  type ThreatStatus,
} from "@/lib/threat-intel";
import {
  FileSpreadsheet,
  FileText,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
} from "lucide-react";

interface ThreatIntelClientProps {
  initialData: ThreatIntelRecord[];
  initialStats: ThreatIntelStats;
  currentSiteId: number | null;
  currentSiteName: string;
  devices: { id: number; name: string; assetCode: string | null }[];
}

export default function ThreatIntelClient({
  initialData,
  initialStats,
  currentSiteId,
  currentSiteName,
  devices,
}: ThreatIntelClientProps) {
  const [items, setItems] = useState<ThreatIntelRecord[]>(initialData);
  const [stats, setStats] = useState<ThreatIntelStats>(initialStats);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<ThreatStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<ThreatSeverity | "all">("all");
  const [siteScope, setSiteScope] = useState<"current" | "all">(currentSiteId ? "current" : "all");

  // Modals state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<ThreatIntelRecord | null>(null);
  const [editingItem, setEditingItem] = useState<ThreatIntelRecord | null>(null);
  const [deletingItem, setDeletingItem] = useState<ThreatIntelRecord | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ path: string; caption?: string } | null>(null);

  // Reload data from server
  const reloadData = (
    overrideSiteScope?: "current" | "all",
    overrideStatus?: ThreatStatus | "all",
    overrideSeverity?: ThreatSeverity | "all",
    overrideSearch?: string
  ) => {
    const activeSite = (overrideSiteScope ?? siteScope) === "current" ? currentSiteId : "all";
    startTransition(async () => {
      const res = await getThreatIntelligences({
        siteId: activeSite,
        status: overrideStatus ?? statusFilter,
        severity: overrideSeverity ?? severityFilter,
        search: overrideSearch ?? searchTerm,
      });
      if (res.success) {
        setItems(res.items);
        setStats(res.stats);
      }
    });
  };

  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
    reloadData(siteScope, statusFilter, severityFilter, term);
  };

  const handleStatusFilterChange = (status: ThreatStatus | "all") => {
    setStatusFilter(status);
    reloadData(siteScope, status, severityFilter, searchTerm);
  };

  const handleSeverityFilterChange = (severity: ThreatSeverity | "all") => {
    setSeverityFilter(severity);
    reloadData(siteScope, statusFilter, severity, searchTerm);
  };

  const handleSiteScopeChange = (scope: "current" | "all") => {
    setSiteScope(scope);
    reloadData(scope, statusFilter, severityFilter, searchTerm);
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setSeverityFilter("all");
    setSiteScope(currentSiteId ? "current" : "all");
    reloadData(currentSiteId ? "current" : "all", "all", "all", "");
  };

  const handleDeleteConfirm = () => {
    if (!deletingItem) return;
    startTransition(async () => {
      const res = await deleteThreatIntel(deletingItem.id);
      if (res.success) {
        setDeletingItem(null);
        reloadData();
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        eyebrow="Compliance / ISO 27001"
        title="Threat Intelligence & Technical Vulnerabilities"
        description="Dokumentasi & pelacakan kerentanan teknis terstruktur standar ISO/IEC 27001:2022 Control A.5.7 & A.8.8"
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusBadge tone="info" className="hidden sm:inline-flex px-3 py-1">
              <Shield className="size-3.5 mr-1" />
              ISO/IEC 27001:2022 A.5.7 & A.8.8
            </StatusBadge>

            {/* Export Excel Button */}
            <ActionButton
              type="button"
              variant="secondary"
              icon={<FileSpreadsheet className="size-4 text-emerald-500" />}
              onClick={() => exportThreatIntelToExcel(items, currentSiteName)}
              title="Export formatted Excel report"
            >
              Export Excel
            </ActionButton>

            {/* Export PDF Button */}
            <ActionButton
              type="button"
              variant="secondary"
              icon={<FileText className="size-4 text-blue-400" />}
              onClick={() =>
                generateIso27001ThreatIntelPdf(items, {
                  siteName: currentSiteName,
                  stats,
                })
              }
              title="Export formal ISO 27001 compliance audit PDF"
            >
              Export ISO PDF
            </ActionButton>

            {/* Add New Advisory Button */}
            <ActionButton
              type="button"
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditingItem(null);
                setFormModalOpen(true);
              }}
            >
              + New Advisory
            </ActionButton>
          </div>
        }
      />

      {/* KPI Cards */}
      <ThreatIntelKpi stats={stats} />

      {/* Filter Toolbar */}
      <DataToolbar>
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative min-w-[240px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input
              type="text"
              placeholder="Cari CVE, judul, aset, sumber..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="ops-input h-9 w-full pl-9 pr-3 text-sm"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="size-3.5 text-ops-muted" />
            <select
              value={statusFilter}
              onChange={(e) =>
                handleStatusFilterChange(e.target.value as ThreatStatus | "all")
              }
              className="ops-input h-9 px-2.5 text-xs capitalize"
            >
              <option value="all">Semua Status</option>
              {threatStatuses.map((st) => (
                <option key={st} value={st}>
                  {threatStatusLabels[st]}
                </option>
              ))}
            </select>
          </div>

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={(e) =>
              handleSeverityFilterChange(e.target.value as ThreatSeverity | "all")
            }
            className="ops-input h-9 px-2.5 text-xs capitalize"
          >
            <option value="all">Semua Severity</option>
            {threatSeverities.map((sev) => (
              <option key={sev} value={sev}>
                {threatSeverityLabels[sev]}
              </option>
            ))}
          </select>

          {/* Site Scope Filter */}
          {currentSiteId && (
            <select
              value={siteScope}
              onChange={(e) => handleSiteScopeChange(e.target.value as "current" | "all")}
              className="ops-input h-9 px-2.5 text-xs"
            >
              <option value="current">Site Aktif ({currentSiteName})</option>
              <option value="all">Semua Site (Global)</option>
            </select>
          )}

          {/* Reset Filter Button */}
          {(searchTerm || statusFilter !== "all" || severityFilter !== "all" || (currentSiteId && siteScope !== "current")) && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-xs text-ops-muted hover:text-ops-text px-2 py-1"
              title="Reset filters"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>

        <div className="text-xs text-ops-muted font-medium">
          {items.length} advisory ditemukan
        </div>
      </DataToolbar>

      {/* Main Table */}
      <ThreatIntelTable
        items={items}
        onViewDetail={(item) => setViewingItem(item)}
        onEdit={(item) => {
          setEditingItem(item);
          setFormModalOpen(true);
        }}
        onDelete={(item) => setDeletingItem(item)}
        onViewPhoto={(photoPath, caption) =>
          setPreviewPhoto({ path: photoPath, caption })
        }
      />

      {/* Case Reader Detail Modal (Popup on threat click) */}
      {viewingItem && (
        <ThreatIntelDetailModal
          open={Boolean(viewingItem)}
          item={viewingItem}
          onClose={() => setViewingItem(null)}
          onEdit={(item) => {
            setViewingItem(null);
            setEditingItem(item);
            setFormModalOpen(true);
          }}
          onViewPhoto={(photoPath, caption) =>
            setPreviewPhoto({ path: photoPath, caption })
          }
        />
      )}

      {/* Add / Edit Form Modal */}
      {formModalOpen && (
        <ThreatIntelFormModal
          open={formModalOpen}
          onClose={() => {
            setFormModalOpen(false);
            setEditingItem(null);
          }}
          onSuccess={() => reloadData()}
          initialItem={editingItem}
          currentSiteId={currentSiteId}
          devices={devices}
        />
      )}

      {/* Photo Preview Modal (Uses our fixed portaled PhotoModal!) */}
      {previewPhoto && (
        <PhotoModal
          photoPath={previewPhoto.path}
          deviceName={previewPhoto.caption || "Threat Intelligence Evidence"}
          onClose={() => setPreviewPhoto(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingItem && (
        <Modal
          open={Boolean(deletingItem)}
          onClose={() => setDeletingItem(null)}
          title="Hapus Rekaman Threat Intelligence"
          panelClassName="w-full max-w-md rounded-xl border border-ops-border bg-ops-surface-raised shadow-2xl p-5"
        >
          <div className="space-y-4">
            <p className="text-sm text-ops-text">
              Apakah Anda yakin ingin menghapus advisory ini:
            </p>
            <div className="rounded-md border border-ops-border bg-ops-bg p-3">
              <p className="font-semibold text-sm text-ops-text">{deletingItem.title}</p>
              <p className="text-xs text-ops-muted mt-0.5">Asset: {deletingItem.affectedAsset}</p>
            </div>
            <p className="text-xs text-red-400">
              ⚠️ Tindakan ini akan menghapus data advisory dan semua file bukti gambar terkait.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => setDeletingItem(null)}
                disabled={isPending}
              >
                Batal
              </ActionButton>
              <ActionButton
                type="button"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={handleDeleteConfirm}
                isPending={isPending}
                disabled={isPending}
              >
                Hapus
              </ActionButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
