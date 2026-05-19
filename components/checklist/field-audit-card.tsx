"use client";

import { useState, type ComponentType } from "react";
import { AlertTriangle, CheckCircle, MapPin, Server, Upload, XCircle } from "lucide-react";
import clsx from "clsx";

type AuditStatus = "OK" | "Warning" | "Error";

type FieldAuditCardProps = {
  device: {
    id: number;
    name: string;
    locationName: string | null;
  };
  isHighlighted?: boolean;
};

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
    value: "Warning",
    label: "Warning",
    helper: "Needs attention",
    icon: AlertTriangle,
    selectedClass: "border-amber-400/60 bg-amber-400/12 text-amber-100 ring-1 ring-amber-400/40",
  },
  {
    value: "Error",
    label: "Error",
    helper: "Escalate",
    icon: XCircle,
    selectedClass: "border-red-400/60 bg-red-400/12 text-red-100 ring-1 ring-red-400/40",
  },
];

export default function FieldAuditCard({ device, isHighlighted = false }: FieldAuditCardProps) {
  const [status, setStatus] = useState<AuditStatus>("OK");
  const needsEvidence = status === "Warning" || status === "Error";

  return (
    <section
      className={clsx(
        "rounded-md border bg-ops-surface-raised p-4 transition-colors",
        isHighlighted ? "border-ops-accent/70 shadow-[0_0_0_1px_rgba(93,212,180,0.18)]" : "border-ops-border",
      )}
    >
      <input type="hidden" name="deviceId" value={device.id} />

      <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1fr)_minmax(280px,1fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ops-accent/12 text-[#b7f5e4]">
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

        <fieldset className="grid grid-cols-3 gap-2">
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
              className="ops-input w-full px-3 py-2 text-sm"
            />
          </label>

          {needsEvidence && (
            <label className="flex items-center gap-3 rounded-md border border-dashed border-ops-border bg-ops-bg/45 px-3 py-2 text-sm text-ops-muted">
              <Upload className="size-4 shrink-0 text-ops-accent" />
              <input
                type="file"
                name={`photo-${device.id}`}
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && file.size > 10 * 1024 * 1024) {
                    alert("Ukuran file maksimal 10MB");
                    event.target.value = "";
                  }
                }}
                className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-ops-surface file:px-3 file:py-2 file:text-xs file:font-semibold file:text-ops-text"
              />
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
