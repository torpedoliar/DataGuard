"use client";

import { useState, useTransition } from "react";
import {
    deleteReportSchedule,
    sendReportScheduleNow,
    toggleReportSchedule,
    type ReportScheduleItem,
} from "@/actions/report-schedules";
import ScheduleDialog from "./schedule-dialog";
import ActionButton from "@/components/ui/action-button";
import {
    AlertCircle,
    Calendar,
    CalendarClock,
    CheckCircle2,
    Clock,
    Edit,
    Mail,
    Plus,
    Send,
    Trash2,
    XCircle,
} from "lucide-react";

interface SchedulesTableProps {
    schedules: ReportScheduleItem[];
    canAdminister: boolean;
}

const DAY_NAMES: Record<number, string> = {
    0: "Minggu",
    1: "Senin",
    2: "Selasa",
    3: "Rabu",
    4: "Kamis",
    5: "Jumat",
    6: "Sabtu",
};

export default function SchedulesTable({ schedules, canAdminister }: SchedulesTableProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState<ReportScheduleItem | null>(null);
    const [executingId, setExecutingId] = useState<number | null>(null);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [isPending, startTransition] = useTransition();

    const handleSendNow = async (schedule: ReportScheduleItem) => {
        if (!confirm(`Kirim laporan "${schedule.name}" sekarang via email ke penerima?`)) {
            return;
        }

        setExecutingId(schedule.id);
        setFeedback(null);

        try {
            const res = await sendReportScheduleNow(schedule.id);
            if ("success" in res && res.success) {
                setFeedback({
                    type: "success",
                    text: res.message || "Laporan berhasil digenerate dan dikirim via email!",
                });
            } else {
                setFeedback({
                    type: "error",
                    text: ("error" in res && res.error) || ("message" in res && res.message) || "Gagal mengirim laporan.",
                });
            }
        } catch (err) {
            setFeedback({
                type: "error",
                text: err instanceof Error ? err.message : "Terjadi kesalahan saat memproses laporan.",
            });
        } finally {
            setExecutingId(null);
        }
    };

    const handleToggle = (id: number) => {
        startTransition(async () => {
            await toggleReportSchedule(id);
        });
    };

    const handleDelete = (schedule: ReportScheduleItem) => {
        if (!confirm(`Apakah Anda yakin ingin menghapus jadwal "${schedule.name}"?`)) {
            return;
        }
        startTransition(async () => {
            await deleteReportSchedule(schedule.id);
        });
    };

    const formatTiming = (schedule: ReportScheduleItem) => {
        if (schedule.frequency === "daily") {
            return `Setiap Hari @ ${schedule.runTime} WIB`;
        }
        if (schedule.frequency === "weekly") {
            const dayName = DAY_NAMES[schedule.dayOfWeek ?? 1] || "Senin";
            return `Setiap ${dayName} @ ${schedule.runTime} WIB`;
        }
        if (schedule.frequency === "monthly") {
            return `Setiap Tanggal ${schedule.dayOfMonth ?? 1} @ ${schedule.runTime} WIB`;
        }
        return `${schedule.frequency} @ ${schedule.runTime}`;
    };

    const formatDateTime = (date: Date | string | null | undefined) => {
        if (!date) return "-";
        return new Date(date).toLocaleString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-ops-text">Report Schedules</h1>
                    <p className="text-xs text-ops-muted mt-0.5">
                        Kelola jadwal pengiriman laporan otomatis harian, mingguan, dan bulanan via email.
                    </p>
                </div>
                {canAdminister && (
                    <ActionButton
                        type="button"
                        onClick={() => {
                            setEditingSchedule(null);
                            setDialogOpen(true);
                        }}
                        variant="primary"
                        icon={<Plus className="size-4" />}
                    >
                        Buat Jadwal Baru
                    </ActionButton>
                )}
            </div>

            {/* Alert / Feedback Notification */}
            {feedback && (
                <div
                    className={`flex items-center justify-between rounded-lg border p-4 text-xs font-medium ${
                        feedback.type === "success"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/30 bg-red-500/10 text-red-300"
                    }`}
                >
                    <div className="flex items-center gap-2">
                        {feedback.type === "success" ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                        ) : (
                            <AlertCircle className="size-4 shrink-0 text-red-400" />
                        )}
                        <span>{feedback.text}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-ops-muted hover:text-ops-text"
                    >
                        Tutup
                    </button>
                </div>
            )}

            {/* Table Container */}
            <div className="ops-panel overflow-hidden">
                {schedules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center">
                        <div className="flex size-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 mb-3">
                            <CalendarClock className="size-6" />
                        </div>
                        <h3 className="text-sm font-semibold text-ops-text">Belum ada Jadwal Report</h3>
                        <p className="text-xs text-ops-muted max-w-sm mt-1 mb-4">
                            Buat jadwal otomatis pertama Anda untuk mengirim laporan Audit Grid atau Incident ke tim operasi secara berkala.
                        </p>
                        {canAdminister && (
                            <ActionButton
                                type="button"
                                onClick={() => {
                                    setEditingSchedule(null);
                                    setDialogOpen(true);
                                }}
                                variant="primary"
                                icon={<Plus className="size-4" />}
                            >
                                Buat Jadwal Report
                            </ActionButton>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-ops-border bg-ops-surface/80 font-semibold uppercase tracking-wider text-ops-muted">
                                    <th className="px-5 py-3.5">Nama Jadwal & Tipe</th>
                                    <th className="px-4 py-3.5">Frekuensi & Jam</th>
                                    <th className="px-4 py-3.5">Jadwal Berikutnya</th>
                                    <th className="px-4 py-3.5">Penerima Email</th>
                                    <th className="px-4 py-3.5">Eksekusi Terakhir</th>
                                    <th className="px-4 py-3.5 text-center">Status</th>
                                    <th className="px-5 py-3.5 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ops-border font-medium">
                                {schedules.map((schedule) => {
                                    const isExecutingThis = executingId === schedule.id;
                                    const recipientEmails = schedule.recipients
                                        .split(/[,\n;]+/)
                                        .map((s) => s.trim())
                                        .filter(Boolean);

                                    return (
                                        <tr
                                            key={schedule.id}
                                            className="hover:bg-ops-surface/40 transition-colors"
                                        >
                                            {/* Name & Type */}
                                            <td className="px-5 py-3.5">
                                                <div className="font-bold text-ops-text text-sm">
                                                    {schedule.name}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/20">
                                                        {schedule.reportType === "audit_grid"
                                                            ? "Audit Grid (PDF)"
                                                            : schedule.reportType === "incidents"
                                                            ? "Incident Report"
                                                            : "Checklist Summary"}
                                                    </span>
                                                    {schedule.siteName && (
                                                        <span className="text-[11px] text-ops-muted">
                                                            · {schedule.siteName}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Frequency & Time */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1.5 text-ops-text">
                                                    <Calendar className="size-3.5 text-ops-muted" />
                                                    <span>{formatTiming(schedule)}</span>
                                                </div>
                                            </td>

                                            {/* Next Run */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1.5 text-ops-text">
                                                    <Clock className="size-3.5 text-indigo-400" />
                                                    <span>
                                                        {schedule.isActive
                                                            ? formatDateTime(schedule.nextRunAt)
                                                            : "Nonaktif"}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Recipients */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1 text-ops-text">
                                                    <Mail className="size-3.5 text-ops-muted" />
                                                    <span>{recipientEmails.length} Penerima</span>
                                                </div>
                                                <div className="mt-0.5 text-[11px] text-ops-muted truncate max-w-[180px]">
                                                    {recipientEmails.join(", ")}
                                                </div>
                                            </td>

                                            {/* Last Run Status */}
                                            <td className="px-4 py-3.5">
                                                {schedule.lastRunAt ? (
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            {schedule.lastRunStatus === "success" ? (
                                                                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                                                    <CheckCircle2 className="size-3.5" /> Berhasil
                                                                </span>
                                                            ) : (
                                                                <span
                                                                    className="inline-flex items-center gap-1 text-red-400 font-semibold cursor-help"
                                                                    title={schedule.lastRunError || "Gagal"}
                                                                >
                                                                    <XCircle className="size-3.5" /> Gagal
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-ops-muted mt-0.5">
                                                            {formatDateTime(schedule.lastRunAt)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-ops-muted">Belum pernah</span>
                                                )}
                                            </td>

                                            {/* Active Switch */}
                                            <td className="px-4 py-3.5 text-center">
                                                <button
                                                    type="button"
                                                    disabled={!canAdminister || isPending}
                                                    onClick={() => handleToggle(schedule.id)}
                                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                        schedule.isActive ? "bg-indigo-600" : "bg-ops-border"
                                                    }`}
                                                >
                                                    <span
                                                        className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                            schedule.isActive ? "translate-x-4" : "translate-x-0"
                                                        }`}
                                                    />
                                                </button>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-5 py-3.5 text-right">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {/* Send Now Button */}
                                                    <button
                                                        type="button"
                                                        disabled={isExecutingThis}
                                                        onClick={() => handleSendNow(schedule)}
                                                        title="Kirim laporan sekarang via email (Test Run)"
                                                        className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
                                                    >
                                                        <Send className={`size-3.5 ${isExecutingThis ? "animate-pulse" : ""}`} />
                                                        <span>{isExecutingThis ? "Mengirim..." : "Kirim Sekarang"}</span>
                                                    </button>

                                                    {canAdminister && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingSchedule(schedule);
                                                                    setDialogOpen(true);
                                                                }}
                                                                title="Edit Jadwal"
                                                                className="rounded-md p-1.5 text-ops-muted hover:bg-ops-surface hover:text-ops-text transition-colors"
                                                            >
                                                                <Edit className="size-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDelete(schedule)}
                                                                title="Hapus Jadwal"
                                                                className="rounded-md p-1.5 text-ops-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                                            >
                                                                <Trash2 className="size-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Dialog Modal */}
            <ScheduleDialog
                isOpen={dialogOpen}
                onClose={() => {
                    setDialogOpen(false);
                    setEditingSchedule(null);
                }}
                schedule={editingSchedule}
            />
        </div>
    );
}
