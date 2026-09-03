"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import ActionButton from "@/components/ui/action-button";
import Modal from "@/components/ui/modal";
import StatusBadge from "@/components/ui/status-badge";
import { createThreatIntel, updateThreatIntel } from "@/actions/threat-intel";
import {
  calculateCvssSeverity,
  getThreatSeverityTone,
  threatSeverityLabels,
  threatStatuses,
  threatStatusLabels,
  type ThreatIntelRecord,
  type ThreatStatus,
} from "@/lib/threat-intel";
import { AlertCircle, ImagePlus, Trash2, UploadCloud } from "lucide-react";

interface ThreatIntelFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialItem?: ThreatIntelRecord | null;
  currentSiteId: number | null;
  devices: { id: number; name: string; assetCode: string | null }[];
}

type NewEvidencePreview = {
  file: File;
  previewUrl: string;
  caption: string;
};

export default function ThreatIntelFormModal({
  open,
  onClose,
  onSuccess,
  initialItem,
  currentSiteId,
  devices,
}: ThreatIntelFormModalProps) {
  const isEdit = Boolean(initialItem);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState(initialItem?.title || "");
  const [source, setSource] = useState(initialItem?.source || "The Hacker News");
  const [sourceUrl, setSourceUrl] = useState(initialItem?.sourceUrl || "");
  const [intelDate, setIntelDate] = useState(
    initialItem
      ? new Date(initialItem.intelDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0]
  );
  const [cveList, setCveList] = useState(initialItem?.cveList || "");
  const [cvssScore, setCvssScore] = useState<string>(
    initialItem?.cvssScore !== null && initialItem?.cvssScore !== undefined
      ? String(initialItem.cvssScore)
      : ""
  );
  const [description, setDescription] = useState(initialItem?.description || "");
  const [affectedAsset, setAffectedAsset] = useState(initialItem?.affectedAsset || "");
  const [deviceId, setDeviceId] = useState<string>(
    initialItem?.deviceId ? String(initialItem.deviceId) : ""
  );
  const [siteId, setSiteId] = useState<string>(
    initialItem?.siteId !== undefined && initialItem?.siteId !== null
      ? String(initialItem.siteId)
      : currentSiteId
      ? String(currentSiteId)
      : "global"
  );
  const [status, setStatus] = useState<ThreatStatus>(initialItem?.status || "open");
  const [mitigatedAt, setMitigatedAt] = useState(
    initialItem?.mitigatedAt
      ? new Date(initialItem.mitigatedAt).toISOString().split("T")[0]
      : ""
  );
  const [mitigationAction, setMitigationAction] = useState(
    initialItem?.mitigationAction || ""
  );

  // Evidence files
  const [newEvidences, setNewEvidences] = useState<NewEvidencePreview[]>([]);
  const [deletedEvidenceIds, setDeletedEvidenceIds] = useState<number[]>([]);

  // Computed severity
  const parsedCvss = cvssScore === "" ? null : parseFloat(cvssScore);
  const computedSeverity = calculateCvssSeverity(parsedCvss);

  const handleDeviceChange = (devIdStr: string) => {
    setDeviceId(devIdStr);
    if (devIdStr && !affectedAsset) {
      const dev = devices.find((d) => String(d.id) === devIdStr);
      if (dev) setAffectedAsset(dev.name);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const added: NewEvidencePreview[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      added.push({
        file,
        previewUrl: URL.createObjectURL(file),
        caption: "",
      });
    }
    setNewEvidences((prev) => [...prev, ...added]);
    e.target.value = "";
  };

  const removeNewEvidence = (index: number) => {
    setNewEvidences((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].previewUrl);
      copy.splice(index, 1);
      return copy;
    });
  };

  const markEvidenceDeleted = (id: number) => {
    setDeletedEvidenceIds((prev) => [...prev, id]);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!source.trim()) {
      setError("Source is required");
      return;
    }
    if (!affectedAsset.trim()) {
      setError("Affected asset is required");
      return;
    }

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("source", source.trim());
    if (sourceUrl.trim()) formData.append("sourceUrl", sourceUrl.trim());
    formData.append("intelDate", intelDate);
    if (cveList.trim()) formData.append("cveList", cveList.trim());
    if (parsedCvss !== null && !isNaN(parsedCvss)) {
      formData.append("cvssScore", String(parsedCvss));
    }
    formData.append("severity", computedSeverity);
    if (description.trim()) formData.append("description", description.trim());
    formData.append("affectedAsset", affectedAsset.trim());
    formData.append("status", status);
    if (mitigatedAt) formData.append("mitigatedAt", mitigatedAt);
    if (mitigationAction.trim()) {
      formData.append("mitigationAction", mitigationAction.trim());
    }

    if (siteId && siteId !== "global") {
      formData.append("siteId", siteId);
    }
    if (deviceId) {
      formData.append("deviceId", deviceId);
    }

    // New evidence files & captions
    for (const ev of newEvidences) {
      formData.append("evidences", ev.file);
      formData.append("captions", ev.caption.trim());
    }

    if (isEdit && deletedEvidenceIds.length > 0) {
      formData.append("deletedEvidenceIds", JSON.stringify(deletedEvidenceIds));
    }

    startTransition(async () => {
      const res = isEdit && initialItem
        ? await updateThreatIntel(initialItem.id, formData)
        : await createThreatIntel(formData);

      if (!res.success) {
        setError(res.message || "Failed to save advisory");
        return;
      }

      onSuccess();
      onClose();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Threat Intelligence Advisory" : "New Threat Intelligence Advisory"}
      description="ISO/IEC 27001:2022 Control A.5.7 (Threat Intel) & A.8.8 (Vulnerability Management)"
      panelClassName="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-ops-border bg-ops-surface-raised shadow-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
            Vulnerability / Advisory Title *
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Veeam Backup & Replication RCE"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="ops-input w-full h-9 px-3 text-sm"
          />
        </div>

        {/* Source & Source URL */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Source Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. The Hacker News, CISA, Vendor"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Source Bulletin URL
            </label>
            <input
              type="url"
              placeholder="https://thehackernews.com/..."
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm"
            />
          </div>
        </div>

        {/* Date, CVE List, CVSS Score */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Intel Date *
            </label>
            <input
              type="date"
              required
              value={intelDate}
              onChange={(e) => setIntelDate(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              CVE ID(s)
            </label>
            <input
              type="text"
              placeholder="CVE-2025-59168, CVE-2025-59469"
              value={cveList}
              onChange={(e) => setCveList(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">
                CVSS Base Score
              </label>
              <StatusBadge
                tone={getThreatSeverityTone(computedSeverity)}
                className="text-[10px] px-1.5 py-0.2"
              >
                {threatSeverityLabels[computedSeverity]}
              </StatusBadge>
            </div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              placeholder="e.g. 8.7"
              value={cvssScore}
              onChange={(e) => setCvssScore(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm font-mono"
            />
          </div>
        </div>

        {/* Affected Asset & Device Hybrid Picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Affected Asset Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Veeam Backup & Replication SJA"
              value={affectedAsset}
              onChange={(e) => setAffectedAsset(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Linked Hardware Device (Optional)
            </label>
            <select
              value={deviceId}
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm"
            >
              <option value="">None (Software / VM / External)</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.assetCode ? `(${d.assetCode})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Site Scope & Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Site Scope
            </label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm"
            >
              {currentSiteId && <option value={String(currentSiteId)}>Active Site</option>}
              <option value="global">Global (All Sites)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Mitigation Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ThreatStatus)}
              className="ops-input w-full h-9 px-3 text-sm capitalize"
            >
              {threatStatuses.map((st) => (
                <option key={st} value={st}>
                  {threatStatusLabels[st]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
              Mitigation Date
            </label>
            <input
              type="date"
              value={mitigatedAt}
              onChange={(e) => setMitigatedAt(e.target.value)}
              className="ops-input w-full h-9 px-3 text-sm font-mono"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
            Vulnerability Details / Technical Impact
          </label>
          <textarea
            rows={2}
            placeholder="A vulnerability that allows a Backup Administrator to perform RCE as postgres user..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="ops-input w-full p-2.5 text-xs"
          />
        </div>

        {/* Mitigation Action / Patching */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted mb-1">
            Patching / Mitigation Action
          </label>
          <textarea
            rows={2}
            placeholder="Patching Veeam Backup & Replication to version 13.0.1.1071..."
            value={mitigationAction}
            onChange={(e) => setMitigationAction(e.target.value)}
            className="ops-input w-full p-2.5 text-xs"
          />
        </div>

        {/* Evidence Attachments Section */}
        <div className="rounded-lg border border-ops-border bg-ops-bg/40 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-text flex items-center gap-1.5">
              <UploadCloud className="size-4 text-ops-accent" />
              Bukti Lampiran (Screenshots / Evidence)
            </span>
            <label className="inline-flex items-center gap-1 cursor-pointer rounded-md bg-ops-surface border border-ops-border px-2.5 py-1 text-xs font-medium text-ops-text hover:bg-ops-surface-raised hover:text-ops-accent transition-colors">
              <ImagePlus className="size-3.5" />
              <span>Tambah Foto Bukti</span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>

          {/* Existing Evidences (Edit Mode) */}
          {isEdit && initialItem?.evidences && initialItem.evidences.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-ops-muted">Bukti Tersimpan:</p>
              <div className="grid grid-cols-2 gap-2">
                {initialItem.evidences
                  .filter((ev) => !deletedEvidenceIds.includes(ev.id))
                  .map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-ops-border bg-ops-surface p-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ev.filePath}
                          alt="Evidence"
                          className="size-10 object-cover rounded shrink-0 border border-ops-border"
                        />
                        <span className="truncate text-ops-text text-xs">
                          {ev.caption || ev.fileName || "Evidence image"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => markEvidenceDeleted(ev.id)}
                        className="text-red-400 hover:text-red-300 p-1 shrink-0"
                        title="Hapus bukti ini"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Newly Selected Evidence Previews */}
          {newEvidences.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-ops-accent font-medium">Foto Baru Yang Akan Diupload:</p>
              <div className="space-y-2">
                {newEvidences.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2.5 rounded-md border border-ops-border bg-ops-surface p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt="Preview"
                      className="size-10 object-cover rounded shrink-0 border border-ops-border"
                    />
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        placeholder="Keterangan foto (contoh: Email Notifikasi / Versi Patch)"
                        value={item.caption}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewEvidences((prev) => {
                            const copy = [...prev];
                            copy[idx].caption = val;
                            return copy;
                          });
                        }}
                        className="ops-input w-full h-8 px-2 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeNewEvidence(idx)}
                      className="text-red-400 hover:text-red-300 p-1 shrink-0"
                      title="Batal upload"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {newEvidences.length === 0 && (!initialItem?.evidences || initialItem.evidences.length === 0) && (
            <p className="text-xs text-ops-muted text-center py-2 italic">
              Belum ada foto bukti yang dipilih. Anda dapat mengupload screenshot email notifikasi atau popup versi aplikasi.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-ops-border">
          <ActionButton
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Batal
          </ActionButton>
          <ActionButton
            type="submit"
            variant="primary"
            isPending={isPending}
            disabled={isPending}
          >
            {isEdit ? "Simpan Perubahan" : "Tambah Advisory"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  );
}
