"use client";

import { useActionState, useRef, useState } from "react";
import { importPortsFromFile, type PortImportResult } from "@/actions/network";
import { CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";

const initialState: PortImportResult = {
  success: false,
  inserted: 0,
  errors: [],
};

export default function ImportPortForm({ deviceId }: { deviceId: number }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, formAction, isPending] = useActionState(
    async (_prev: PortImportResult, formData: FormData) => {
      return await importPortsFromFile(deviceId, formData);
    },
    initialState,
  );

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
  };

  const handleReset = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="mt-8 bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileSpreadsheet className="h-5 w-5 text-teal-500" />
        <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
          Port Import Wizard
        </h3>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Upload a CSV or XLSX file with the standard port columns. The wizard validates VLAN IDs,
        port names, and enum values against this site&apos;s configuration before inserting.
      </p>

      <form action={formAction} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:border-teal-500 transition-colors">
            <UploadCloud className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
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
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear
            </button>
          )}
          <button
            type="submit"
            disabled={isPending || !file}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {isPending ? "Importing..." : "Import Ports"}
          </button>
        </div>

        {state.message && state.success && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/40 text-sm text-green-800 dark:text-green-200">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{state.message}</p>
              <p className="text-xs">{state.inserted} rows inserted.</p>
            </div>
          </div>
        )}

        {state.errors.length > 0 && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-sm text-red-800 dark:text-red-200">
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
