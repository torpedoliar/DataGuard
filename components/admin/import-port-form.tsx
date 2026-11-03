"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importPortsFromFile, type PortImportResult } from "@/actions/network";
import { CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";

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
    <div className="mt-8 bg-ops-surface rounded-lg shadow-sm border border-ops-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileSpreadsheet className="h-5 w-5 text-ops-accent" />
        <h3 className="text-lg font-semibold text-ops-text">
          Port Import Wizard
        </h3>
      </div>

      <p className="text-sm text-ops-subtle dark:text-ops-muted mb-4">
        Upload a CSV or XLSX file with the standard port columns. The wizard validates VLAN IDs,
        port names, and enum values against this site&apos;s configuration before inserting.
      </p>

      <form action={formAction} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-ops-border-strong rounded-md cursor-pointer hover:border-ops-accent transition-colors">
            <UploadCloud className="h-4 w-4 text-ops-muted" />
            <span className="text-sm text-ops-muted truncate">
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
              className="text-xs text-ops-subtle hover:text-ops-muted dark:hover:text-ops-text"
            >
              Clear
            </button>
          )}
          <button
            type="submit"
            disabled={isPending || !file}
            className="flex items-center gap-2 bg-ops-accent text-ops-accent-fg px-4 py-2 rounded-md hover:bg-ops-accent-hover transition focus:outline-none focus:ring-2 focus:ring-ops-accent focus:ring-offset-2 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {isPending ? "Importing..." : "Import Ports"}
          </button>
        </div>

        {state.message && state.success && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-ops-success-soft border border-ops-success/40 text-sm text-ops-success">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{state.message}</p>
              <p className="text-xs">{state.inserted} rows inserted.</p>
            </div>
          </div>
        )}

        {state.errors.length > 0 && (
          <div className="p-3 rounded-md bg-ops-danger-soft border border-ops-danger/40 text-sm text-ops-danger">
            <div className="flex items-center gap-2 mb-1 font-medium">
              <XCircle className="h-4 w-4 shrink-0" />
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
