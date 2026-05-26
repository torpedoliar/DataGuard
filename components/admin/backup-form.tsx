"use client";

import ActionButton from "@/components/ui/action-button";
import { useState } from "react";

export default function BackupForm() {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [mode, setMode] = useState<"wipe" | "append">("wipe");

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Backup gagal" }));
        throw new Error(body.message ?? "Backup gagal");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dccheck-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Backup gagal");
    }
    finally {
      setDownloading(false);
    }
  }

  async function handleRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRestoring(true);
    setRestoreMessage(null);
    setRestoreError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("mode", mode);
    try {
      const response = await fetch("/api/admin/restore", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Restore gagal");
      const warnings: string[] = Array.isArray(body.warnings) ? body.warnings : [];
      setRestoreMessage(`Restore berhasil dalam mode ${body.mode}.${warnings.length ? ` Peringatan: ${warnings.join("; ")}` : ""}`);
      form.reset();
    }
    catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Restore gagal");
    }
    finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
        <h2 className="text-sm font-semibold text-white">Backup</h2>
        <p className="mt-1 text-xs text-slate-400">Hasil download adalah ZIP berisi <code>dump.dump</code> dan folder <code>uploads/</code>.</p>
        <div className="mt-4 flex items-center gap-3">
          <ActionButton type="button" isPending={downloading} onClick={handleDownload}>
            Generate Backup
          </ActionButton>
          {downloadError && <span className="text-sm text-red-300">{downloadError}</span>}
        </div>
      </section>

      <form onSubmit={handleRestore} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Restore</h2>
        <p className="text-xs text-slate-400">
          Upload ZIP yang dihasilkan dari halaman backup. Mode wipe akan menghapus skema yang ada terlebih dahulu.
        </p>
        <label className="block text-sm font-medium text-slate-300">
          Archive
          <input type="file" name="archive" accept=".zip" required className="mt-1 block w-full text-sm text-slate-200" />
        </label>
        <label className="block text-sm font-medium text-slate-300">
          Mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value === "append" ? "append" : "wipe")}
            className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          >
            <option value="wipe">Wipe &amp; restore</option>
            <option value="append">Append only</option>
          </select>
        </label>
        <ActionButton type="submit" isPending={restoring}>
          Restore
        </ActionButton>
        {restoreMessage && (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">
            {restoreMessage}
          </div>
        )}
        {restoreError && (
          <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
            {restoreError}
          </div>
        )}
      </form>
    </div>
  );
}
