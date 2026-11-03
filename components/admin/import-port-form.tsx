"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importPortsFromFile, type PortImportResult } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { CheckCircle2, FileSpreadsheet, UploadCloud, XCircle } from "lucide-react";

const initialState: PortImportResult = {
  success: false,
  inserted: 0,
  errors: [],
};

export default function ImportPortForm({ deviceId }: { deviceId: number }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, formAction, isPending] = useActionState(
    async (_prev: PortImportResult, formData: FormData) => {
      return await importPortsFromFile(deviceId, formData);
    },
    initialState,
  );

  useEffect(() => {
    if (state.success) {
      router.refresh();
    }
  }, [state.success, router]);

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
  };

  const handleReset = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="ops-panel mt-8 p-6">
      <div className="mb-4 flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-ops-accent" />
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
          Port import wizard
        </h3>
      </div>

      <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-ops-muted">
        Upload a CSV or XLSX file with the standard port columns. The wizard validates VLAN IDs,
        port names, and enum values against this site&apos;s configuration before inserting.
      </p>

      <form action={formAction} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-ops-border-strong px-3 py-2 transition-colors hover:border-ops-accent hover:bg-ops-surface-raised">
            <UploadCloud className="size-4 text-ops-muted" />
            <span className="truncate text-[13px] text-ops-muted">
              {file ? file.name : "Choose a .csv or .xlsx file"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              accept=".csv,.xlsx"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
              disabled={isPending}
              aria-label="Choose a CSV or XLSX file to import"
              className="hidden"
            />
          </label>
          {file && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isPending}
              className="text-xs text-ops-muted transition-colors hover:text-ops-text"
            >
              Clear
            </button>
          )}
          <ActionButton type="submit" isPending={isPending} disabled={!file} icon={<UploadCloud className="size-4" />}>
            Import ports
          </ActionButton>
        </div>

        {state.message && state.success && (
          <div className="flex items-start gap-2 rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{state.message}</p>
              <p className="text-xs">{state.inserted} rows inserted.</p>
            </div>
          </div>
        )}

        {state.errors.length > 0 && (
          <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <XCircle className="size-4 shrink-0" />
              Import failed ({state.errors.length} issue{state.errors.length === 1 ? "" : "s"}):
            </div>
            <ul className="list-disc pl-6 space-y-0.5 text-xs">
              {state.errors.slice(0, 25).map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
              {state.errors.length > 25 && (
                <li>... and {state.errors.length - 25} more</li>
              )}
            </ul>
          </div>
        )}
      </form>
    </div>
  );
}
