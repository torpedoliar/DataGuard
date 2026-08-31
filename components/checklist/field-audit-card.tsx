"use client";

import { useState, useEffect, useImperativeHandle, forwardRef, useRef, type ComponentType } from "react";
import { Camera, CheckCircle, MapPin, Server, Upload, XCircle } from "lucide-react";
import clsx from "clsx";

type AuditStatus = "OK" | "NOT OK";

type FieldAuditCardProps = {
  device: {
    id: number;
    name: string;
    locationName: string | null;
  };
  isHighlighted?: boolean;
  onStatusChange?: (status: string, remarks?: string) => void;
  prefillStatus?: string;
  prefillRemarks?: string;
  // Finding #62: the card reports its selected evidence photo so ChecklistForm
  // can mirror it into the hidden all-devices input — switching category tabs
  // unmounts this card, and the file would otherwise be lost.
  onPhotoChange?: (file: File | null) => void;
};

export type ChecklistPhotoTarget = { files: FileList | null; value: string };

/**
 * Client-side size guard for evidence photos (finding #62/#60). A photo over
 * 10MB is rejected with the Indonesian alert the UI has always shown and the
 * input is cleared. Extracted so the behavior is unit-testable (the repo's
 * vitest environment is node — no DOM).
 */
export function handleChecklistPhotoFile(target: ChecklistPhotoTarget) {
  const file = target.files?.[0];
  if (file && file.size > 10 * 1024 * 1024) {
    alert("Ukuran file maksimal 10MB");
    target.value = "";
  }
}

const statusOptions: {
  value: AuditStatus;
  label: string;
  helper: string;
  icon: ComponentType<{ className?: string }>;
  selectedClass: string;
}[] = [
  {
    value: "OK",
    label: "OK",
    helper: "Normal",
    icon: CheckCircle,
    selectedClass: "border-emerald-400/60 bg-emerald-400/12 text-emerald-100 ring-1 ring-emerald-400/40",
  },
  {
    value: "NOT OK",
    label: "NOT OK",
    helper: "Needs attention",
    icon: XCircle,
    selectedClass: "border-red-400/60 bg-red-400/12 text-red-100 ring-1 ring-red-400/40",
  },
];

const FieldAuditCard = forwardRef<HTMLDivElement, FieldAuditCardProps>(
  ({ device, isHighlighted = false, onStatusChange, prefillStatus, prefillRemarks, onPhotoChange }, ref) => {
    // Start with prefilled values if provided (from localStorage)
    const [status, setStatus] = useState<AuditStatus>(
      (prefillStatus as AuditStatus) || "OK"
    );
    const [remarks, setRemarks] = useState(prefillRemarks ?? "");
    const needsEvidence = status === "NOT OK";
    // Two inputs (camera + file picker) share the form name `photo-<id>`;
    // clearing the other one on pick keeps exactly one submitted per device.
    const pickerRef = useRef<HTMLInputElement | null>(null);
    const cameraRef = useRef<HTMLInputElement | null>(null);

    // Sync to parent whenever status or remarks changes
    useEffect(() => {
      onStatusChange?.(status, remarks);
    }, [status, remarks, onStatusChange]);

    return (
      <section
        ref={ref}
        className={clsx(
          "rounded-md border bg-ops-surface-raised p-4 transition-colors",
          isHighlighted ? "border-ops-accent/70 shadow-[0_0_0_1px_rgba(93,212,180,0.18)]" : "border-ops-border",
        )}
      >
        {/* deviceId is submitted once for every device by the hidden all-devices
            block in ChecklistForm; this card must NOT add a duplicate, or
            formData.getAll("deviceId") yields the device twice → double entries. */}

        <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1fr)_minmax(280px,1fr)]">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ops-accent/12 text-ops-accent">
                <Server className="size-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-ops-text">{device.name}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ops-muted">
                  <MapPin className="size-3.5" />
                  <span className="truncate">{device.locationName || "No location"}</span>
                </p>
              </div>
            </div>
          </div>

          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Status for {device.name}</legend>
            {statusOptions.map((option) => {
              const Icon = option.icon;
              const selected = status === option.value;

              return (
                <label
                  key={option.value}
                  className={clsx(
                    "flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-md border px-2 py-3 text-center transition-colors",
                    selected
                      ? option.selectedClass
                      : "border-ops-border bg-ops-bg/45 text-ops-muted hover:border-ops-accent/45 hover:text-ops-text",
                  )}
                >
                  <input
                    type="radio"
                    name={`status-${device.id}`}
                    value={option.value}
                    className="sr-only"
                    checked={selected}
                    onChange={() => setStatus(option.value)}
                  />
                  <Icon className="size-5" />
                  <span className="mt-1 text-sm font-bold">{option.label}</span>
                  <span className="text-[11px] leading-tight opacity-80">{option.helper}</span>
                </label>
              );
            })}
          </fieldset>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">
                Remarks
              </span>
              <textarea
                name={`remarks-${device.id}`}
                placeholder="Add operational notes"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="ops-input w-full px-3 py-2 text-sm"
              />
            </label>

            {needsEvidence && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {/* capture="environment" = native rear camera on mobile.
                      On desktop it behaves like a normal file picker. */}
                  <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-ops-border bg-ops-bg/45 px-2 py-2 text-sm font-semibold text-ops-muted transition-colors hover:border-ops-accent/45 hover:text-ops-text">
                    <Camera className="size-4 shrink-0 text-ops-accent" />
                    Kamera
                    <input
                      type="file"
                      name={`photo-${device.id}`}
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      ref={cameraRef}
                      onChange={(event) => {
                        handleChecklistPhotoFile(event.target);
                        if (pickerRef.current) pickerRef.current.value = "";
                        onPhotoChange?.(event.target.files?.[0] ?? null);
                      }}
                    />
                  </label>
                  <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-md border border-ops-border bg-ops-bg/45 px-2 py-2 text-sm font-semibold text-ops-muted transition-colors hover:border-ops-accent/45 hover:text-ops-text">
                    <Upload className="size-4 shrink-0 text-ops-accent" />
                    Galeri
                    <input
                      type="file"
                      name={`photo-${device.id}`}
                      accept="image/*"
                      className="sr-only"
                      ref={pickerRef}
                      onChange={(inputEvent) => {
                        handleChecklistPhotoFile(inputEvent.target);
                        if (cameraRef.current) cameraRef.current.value = "";
                        onPhotoChange?.(inputEvent.target.files?.[0] ?? null);
                      }}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-ops-muted">
                  Foto evidence NOT OK — langsung dari kamera atau pilih dari galeri.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  },
);

FieldAuditCard.displayName = "FieldAuditCard";

export default FieldAuditCard;
