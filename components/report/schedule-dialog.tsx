"use client";

import { useActionState, useEffect, useState } from "react";
import { createReportSchedule, updateReportSchedule, type ReportScheduleItem } from "@/actions/report-schedules";
import ActionButton from "@/components/ui/action-button";
import { CalendarClock, Check, X } from "lucide-react";

interface ScheduleDialogProps {
    isOpen: boolean;
    onClose: () => void;
    schedule?: ReportScheduleItem | null;
}

const DAYS_OF_WEEK = [
    { value: 1, label: "Senin" },
    { value: 2, label: "Selasa" },
    { value: 3, label: "Rabu" },
    { value: 4, label: "Kamis" },
    { value: 5, label: "Jumat" },
    { value: 6, label: "Sabtu" },
    { value: 0, label: "Minggu" },
];

export default function ScheduleDialog({ isOpen, onClose, schedule }: ScheduleDialogProps) {
    const isEdit = Boolean(schedule);
    const updateActionWithId = schedule ? updateReportSchedule.bind(null, schedule.id) : null;
    const actionToUse = isEdit && updateActionWithId ? updateActionWithId : createReportSchedule;

    const [state, action, isPending] = useActionState(actionToUse, undefined);

    const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(
        (schedule?.frequency as "daily" | "weekly" | "monthly") || "weekly"
    );

    useEffect(() => {
        if (state?.success) {
            onClose();
        }
    }, [state, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="relative w-full max-w-xl rounded-xl border border-ops-border bg-ops-surface shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-ops-border bg-ops-panel px-6 py-4">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                            <CalendarClock className="size-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-ops-text">
                                {isEdit ? "Edit Jadwal Report" : "Buat Jadwal Report Otomatis"}
                            </h2>
                            <p className="text-xs text-ops-muted">
                                Kirim laporan Audit & Kepatuhan via email secara berkala
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-ops-muted hover:bg-ops-surface hover:text-ops-text transition-colors"
                    >
                        <X className="size-5" />
                    </button>
                </div>

                {/* Form */}
                <form action={action} className="flex flex-col gap-4 p-6 text-sm">
                    {state?.message && !state.success && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                            {state.message}
                        </div>
                    )}

                    {/* Schedule Name */}
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                            Nama Jadwal Laporan *
                        </label>
                        <input
                            type="text"
                            name="name"
                            defaultValue={schedule?.name || ""}
                            placeholder="Contoh: Weekly DC Sepanjang Audit Grid"
                            required
                            className="ops-input w-full px-3 py-2 text-sm"
                        />
                    </div>

                    {/* Report Type & Frequency */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                Jenis Report *
                            </label>
                            <select
                                name="reportType"
                                defaultValue={schedule?.reportType || "audit_grid"}
                                className="ops-input w-full px-3 py-2 text-sm"
                            >
                                <option value="audit_grid">Audit Grid Report (PDF Dashboard)</option>
                                <option value="incidents">Incident Summary Report</option>
                                <option value="daily_checklist">Daily Checklist Compliance</option>
                            </select>
                        </div>

                        <div>
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                Frekuensi Pengiriman *
                            </label>
                            <select
                                name="frequency"
                                value={frequency}
                                onChange={(e) => setFrequency(e.target.value as "daily" | "weekly" | "monthly")}
                                className="ops-input w-full px-3 py-2 text-sm"
                            >
                                <option value="daily">Harian (Daily)</option>
                                <option value="weekly">Mingguan (Weekly)</option>
                                <option value="monthly">Bulanan (Monthly)</option>
                            </select>
                        </div>
                    </div>

                    {/* Day & Time settings */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-ops-border bg-ops-panel/50 p-3.5">
                        {frequency === "weekly" && (
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                    Hari Eksekusi
                                </label>
                                <select
                                    name="dayOfWeek"
                                    defaultValue={schedule?.dayOfWeek ?? 1}
                                    className="ops-input w-full px-3 py-2 text-sm"
                                >
                                    {DAYS_OF_WEEK.map((d) => (
                                        <option key={d.value} value={d.value}>
                                            Setiap {d.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {frequency === "monthly" && (
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                    Tanggal Eksekusi
                                </label>
                                <select
                                    name="dayOfMonth"
                                    defaultValue={schedule?.dayOfMonth ?? 1}
                                    className="ops-input w-full px-3 py-2 text-sm"
                                >
                                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                                        <option key={day} value={day}>
                                            Tanggal {day} setiap bulan
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className={frequency === "daily" ? "sm:col-span-2" : ""}>
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                Jam Eksekusi (WIB) *
                            </label>
                            <input
                                type="time"
                                name="runTime"
                                defaultValue={schedule?.runTime || "08:00"}
                                required
                                className="ops-input w-full px-3 py-2 text-sm"
                            />
                        </div>
                    </div>

                    {/* Target Email Recipients */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider text-ops-muted">
                                Target Alamat Email Penerima *
                            </label>
                            <span className="text-[11px] text-ops-muted">Pisahkan dengan koma / baris baru</span>
                        </div>
                        <textarea
                            name="recipients"
                            defaultValue={schedule?.recipients || ""}
                            rows={3}
                            placeholder="manager@santos.co.id, it-ops@santos.co.id"
                            required
                            className="ops-input w-full px-3 py-2 text-sm font-mono"
                        />
                    </div>

                    {/* Custom Email Subject */}
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ops-muted">
                            Custom Subject Email (Opsional)
                        </label>
                        <input
                            type="text"
                            name="emailSubject"
                            defaultValue={schedule?.emailSubject || ""}
                            placeholder="Default: [{frequency} REPORT] Data Center Audit Grid — {siteName}"
                            className="ops-input w-full px-3 py-2 text-sm"
                        />
                        <p className="mt-1 text-[11px] text-ops-muted">
                            Token: <code>{`{reportName}`}</code>, <code>{`{siteName}`}</code>, <code>{`{frequency}`}</code>, <code>{`{startDate}`}</code>, <code>{`{endDate}`}</code>
                        </p>
                    </div>

                    {/* Checkbox Options */}
                    <div className="flex flex-wrap gap-4 pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-ops-text">
                            <input
                                type="checkbox"
                                name="includePdf"
                                value="true"
                                defaultChecked={schedule ? schedule.includePdf : true}
                                className="size-4 rounded border-ops-border text-indigo-600 focus:ring-indigo-500"
                            />
                            Lampirkan File PDF Eksekutif
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-ops-text">
                            <input
                                type="checkbox"
                                name="includeSummaryHtml"
                                value="true"
                                defaultChecked={schedule ? schedule.includeSummaryHtml : true}
                                className="size-4 rounded border-ops-border text-indigo-600 focus:ring-indigo-500"
                            />
                            Sertakan Ringkasan KPI di Body Email
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-ops-text">
                            <input
                                type="checkbox"
                                name="isActive"
                                value="true"
                                defaultChecked={schedule ? schedule.isActive : true}
                                className="size-4 rounded border-ops-border text-indigo-600 focus:ring-indigo-500"
                            />
                            Aktifkan Jadwal Ini
                        </label>
                    </div>

                    {/* Footer Actions */}
                    <div className="mt-4 flex items-center justify-end gap-3 border-t border-ops-border pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="ops-button-secondary px-4 py-2 text-xs font-semibold"
                        >
                            Batal
                        </button>
                        <ActionButton
                            type="submit"
                            isPending={isPending}
                            variant="primary"
                            icon={<Check className="size-4" />}
                        >
                            {isEdit ? "Simpan Perubahan" : "Buat Jadwal"}
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
