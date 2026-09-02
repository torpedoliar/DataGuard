"use server";

import { db } from "@/db";
import { reportSchedules, sites } from "@/db/schema";
import { requireActiveSiteAction, requireActiveSiteAdminAction } from "@/lib/action-auth";
import { logAudit } from "@/lib/audit";
import { fetchRawGridExportDataForSite } from "@/actions/grid";
import { getAuditGridPdfBuffer, type RawGridExportData } from "@/lib/grid-pdf";
import { sendChecklistPicEmail } from "@/lib/email";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calculateNextRun, type ReportScheduleItem } from "@/lib/report-schedules";

const ScheduleFormSchema = z.object({
    name: z.string().trim().min(3, "Schedule name must be at least 3 characters").max(100),
    reportType: z.enum(["audit_grid", "incidents", "daily_checklist"]),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    dayOfWeek: z.coerce.number().min(0).max(6).default(1),
    dayOfMonth: z.coerce.number().min(1).max(31).default(1),
    runTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:mm)"),
    recipients: z.string().trim().min(5, "At least one valid recipient email is required"),
    emailSubject: z.string().trim().max(200).optional(),
    includePdf: z.coerce.boolean().default(true),
    includeSummaryHtml: z.coerce.boolean().default(true),
    isActive: z.coerce.boolean().default(true),
});

export async function getReportSchedules(): Promise<ReportScheduleItem[]> {
    const auth = await requireActiveSiteAction();
    if (!auth.ok) return [];

    const rows = await db.select({
        id: reportSchedules.id,
        siteId: reportSchedules.siteId,
        name: reportSchedules.name,
        reportType: reportSchedules.reportType,
        frequency: reportSchedules.frequency,
        dayOfWeek: reportSchedules.dayOfWeek,
        dayOfMonth: reportSchedules.dayOfMonth,
        runTime: reportSchedules.runTime,
        recipients: reportSchedules.recipients,
        emailSubject: reportSchedules.emailSubject,
        includePdf: reportSchedules.includePdf,
        includeSummaryHtml: reportSchedules.includeSummaryHtml,
        isActive: reportSchedules.isActive,
        lastRunAt: reportSchedules.lastRunAt,
        nextRunAt: reportSchedules.nextRunAt,
        lastRunStatus: reportSchedules.lastRunStatus,
        lastRunError: reportSchedules.lastRunError,
        createdAt: reportSchedules.createdAt,
        updatedAt: reportSchedules.updatedAt,
        siteName: sites.name,
    })
    .from(reportSchedules)
    .leftJoin(sites, eq(reportSchedules.siteId, sites.id))
    .where(eq(reportSchedules.siteId, auth.activeSiteId))
    .orderBy(desc(reportSchedules.createdAt));

    return rows;
}

export async function createReportSchedule(prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const parsed = ScheduleFormSchema.safeParse({
        name: formData.get("name"),
        reportType: formData.get("reportType"),
        frequency: formData.get("frequency"),
        dayOfWeek: formData.get("dayOfWeek"),
        dayOfMonth: formData.get("dayOfMonth"),
        runTime: formData.get("runTime"),
        recipients: formData.get("recipients"),
        emailSubject: formData.get("emailSubject") || undefined,
        includePdf: formData.get("includePdf") === "true" || formData.get("includePdf") === "on",
        includeSummaryHtml: formData.get("includeSummaryHtml") === "true" || formData.get("includeSummaryHtml") === "on",
        isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
    });

    if (!parsed.success) {
        return { message: parsed.error.issues[0]?.message ?? "Invalid form input" };
    }

    const val = parsed.data;
    // Normalize emails
    const emailList = val.recipients
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes("@"));

    if (emailList.length === 0) {
        return { message: "Harap masukkan minimal satu alamat email yang valid." };
    }

    const nextRunAt = calculateNextRun(val.frequency, val.runTime, val.dayOfWeek, val.dayOfMonth);

    try {
        const [inserted] = await db.insert(reportSchedules).values({
            siteId: auth.activeSiteId,
            name: val.name,
            reportType: val.reportType,
            frequency: val.frequency,
            dayOfWeek: val.dayOfWeek,
            dayOfMonth: val.dayOfMonth,
            runTime: val.runTime,
            recipients: emailList.join(", "),
            emailSubject: val.emailSubject || null,
            includePdf: val.includePdf,
            includeSummaryHtml: val.includeSummaryHtml,
            isActive: val.isActive,
            nextRunAt,
        }).returning();

        await logAudit({
            action: "CREATE",
            entity: "report_schedule",
            entityId: inserted.id,
            entityName: val.name,
            detail: `Created ${val.frequency} schedule for ${val.reportType} report`,
        });

        revalidatePath("/report/schedules");
        return { success: true };
    } catch (error) {
        console.error("Failed to create report schedule", error);
        return { message: "Gagal membuat jadwal report. Periksa log database." };
    }
}

export async function updateReportSchedule(id: number, prevState: unknown, formData: FormData) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const parsed = ScheduleFormSchema.safeParse({
        name: formData.get("name"),
        reportType: formData.get("reportType"),
        frequency: formData.get("frequency"),
        dayOfWeek: formData.get("dayOfWeek"),
        dayOfMonth: formData.get("dayOfMonth"),
        runTime: formData.get("runTime"),
        recipients: formData.get("recipients"),
        emailSubject: formData.get("emailSubject") || undefined,
        includePdf: formData.get("includePdf") === "true" || formData.get("includePdf") === "on",
        includeSummaryHtml: formData.get("includeSummaryHtml") === "true" || formData.get("includeSummaryHtml") === "on",
        isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
    });

    if (!parsed.success) {
        return { message: parsed.error.issues[0]?.message ?? "Invalid form input" };
    }

    const val = parsed.data;
    const emailList = val.recipients
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes("@"));

    if (emailList.length === 0) {
        return { message: "Harap masukkan minimal satu alamat email yang valid." };
    }

    const nextRunAt = calculateNextRun(val.frequency, val.runTime, val.dayOfWeek, val.dayOfMonth);

    try {
        await db.update(reportSchedules).set({
            name: val.name,
            reportType: val.reportType,
            frequency: val.frequency,
            dayOfWeek: val.dayOfWeek,
            dayOfMonth: val.dayOfMonth,
            runTime: val.runTime,
            recipients: emailList.join(", "),
            emailSubject: val.emailSubject || null,
            includePdf: val.includePdf,
            includeSummaryHtml: val.includeSummaryHtml,
            isActive: val.isActive,
            nextRunAt,
            updatedAt: new Date(),
        }).where(and(eq(reportSchedules.id, id), eq(reportSchedules.siteId, auth.activeSiteId)));

        await logAudit({
            action: "UPDATE",
            entity: "report_schedule",
            entityId: id,
            entityName: val.name,
            detail: `Updated schedule: ${val.frequency} ${val.runTime}`,
        });

        revalidatePath("/report/schedules");
        return { success: true };
    } catch (error) {
        console.error("Failed to update report schedule", error);
        return { message: "Gagal memperbarui jadwal report." };
    }
}

export async function toggleReportSchedule(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const schedule = await db.query.reportSchedules.findFirst({
        where: and(eq(reportSchedules.id, id), eq(reportSchedules.siteId, auth.activeSiteId)),
    });
    if (!schedule) return { message: "Schedule not found" };

    const nextActive = !schedule.isActive;
    const nextRunAt = nextActive
        ? calculateNextRun(schedule.frequency, schedule.runTime, schedule.dayOfWeek, schedule.dayOfMonth)
        : null;

    await db.update(reportSchedules).set({
        isActive: nextActive,
        nextRunAt,
        updatedAt: new Date(),
    }).where(eq(reportSchedules.id, id));

    revalidatePath("/report/schedules");
    return { success: true };
}

export async function deleteReportSchedule(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    await db.delete(reportSchedules)
        .where(and(eq(reportSchedules.id, id), eq(reportSchedules.siteId, auth.activeSiteId)));

    revalidatePath("/report/schedules");
    return { success: true };
}

/**
 * Execute a report schedule (generates PDF, renders HTML body, sends email).
 * Used both by the UI "Send Now" button and by the background scheduler worker.
 */
export async function executeReportSchedule(scheduleId: number, options?: { isManual?: boolean }) {
    const schedule = await db.query.reportSchedules.findFirst({
        where: eq(reportSchedules.id, scheduleId),
        with: { site: true },
    });

    if (!schedule) {
        return { success: false, error: "Jadwal report tidak ditemukan" };
    }

    const recipients = schedule.recipients
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes("@"));

    if (recipients.length === 0) {
        return { success: false, error: "Tidak ada alamat email penerima yang terdaftar." };
    }

    const siteId = schedule.siteId;
    if (!siteId) {
        return { success: false, error: "Site belum dikaitkan dengan jadwal ini." };
    }

    // Determine Date Bounds
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    let startDateStr = todayStr;

    if (schedule.frequency === "daily") {
        // Last 1-2 days
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        startDateStr = d.toISOString().split("T")[0];
    } else if (schedule.frequency === "weekly") {
        // Last 7 days
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        startDateStr = d.toISOString().split("T")[0];
    } else if (schedule.frequency === "monthly") {
        // Last 30 days
        const d = new Date(today);
        d.setDate(d.getDate() - 29);
        startDateStr = d.toISOString().split("T")[0];
    }

    try {
        const gridExportData = await fetchRawGridExportDataForSite(siteId, startDateStr, todayStr);
        if (!gridExportData || gridExportData.gridData.length === 0) {
            return { success: false, error: "Tidak ada data audit untuk rentang tanggal ini." };
        }

        const siteName = gridExportData.siteName || schedule.site?.name || "Data Center";

        // 1. Generate Executive PDF Attachment
        const pdfBuffer = getAuditGridPdfBuffer(gridExportData as RawGridExportData, {
            siteName,
            statusFilter: "All",
        });

        // 2. Build Subject
        const defaultSubject = `[${schedule.frequency.toUpperCase()} REPORT] Data Center Audit Grid — ${siteName} (${startDateStr} s/d ${todayStr})`;
        const subject = schedule.emailSubject?.trim()
            ? schedule.emailSubject
                .replace(/{reportName}/gi, schedule.name)
                .replace(/{siteName}/gi, siteName)
                .replace(/{frequency}/gi, schedule.frequency)
                .replace(/{startDate}/gi, startDateStr)
                .replace(/{endDate}/gi, todayStr)
            : defaultSubject;

        // 3. Compose Rich Executive HTML Email Body
        const kpis = gridExportData.kpis;
        const passRate = kpis.totalChecks > 0 ? Math.round((kpis.okChecks / kpis.totalChecks) * 100) : 100;

        const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 24px 0; margin: 0; color: #0f172a;">
          <table align="center" width="640" cellpadding="0" cellspacing="0" style="max-width: 640px; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
            <!-- Header Banner -->
            <tr>
              <td style="background-color: #0f172a; padding: 24px 28px; border-bottom: 3px solid #4f46e5;">
                <div style="font-size: 11px; font-weight: bold; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase;">
                  ${siteName} · AUTOMATED ${schedule.frequency.toUpperCase()} DISPATCH
                </div>
                <div style="font-size: 20px; font-weight: bold; color: #ffffff; margin-top: 6px;">
                  ${schedule.name}
                </div>
                <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">
                  Periode Laporan: <strong>${startDateStr}</strong> s/d <strong>${todayStr}</strong>
                </div>
              </td>
            </tr>

            <!-- Executive KPI Cards -->
            <tr>
              <td style="padding: 24px 28px 12px 28px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="32%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-top: 3px solid #4f46e5; padding: 12px; border-radius: 6px; text-align: center;">
                      <div style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">MONITORED DEVICES</div>
                      <div style="font-size: 22px; font-weight: bold; color: #0f172a; margin-top: 4px;">${kpis.totalDevices}</div>
                      <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Total Unit</div>
                    </td>
                    <td width="2%"></td>
                    <td width="32%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-top: 3px solid #10b981; padding: 12px; border-radius: 6px; text-align: center;">
                      <div style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">OK CHECKS</div>
                      <div style="font-size: 22px; font-weight: bold; color: #10b981; margin-top: 4px;">${kpis.okChecks}</div>
                      <div style="font-size: 10px; color: #10b981; margin-top: 2px;">${passRate}% Pass Rate</div>
                    </td>
                    <td width="2%"></td>
                    <td width="32%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-top: 3px solid ${kpis.notOkChecks > 0 ? "#ef4444" : "#64748b"}; padding: 12px; border-radius: 6px; text-align: center;">
                      <div style="font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase;">NOT OK CHECKS</div>
                      <div style="font-size: 22px; font-weight: bold; color: ${kpis.notOkChecks > 0 ? "#ef4444" : "#0f172a"}; margin-top: 4px;">${kpis.notOkChecks}</div>
                      <div style="font-size: 10px; color: ${kpis.notOkChecks > 0 ? "#ef4444" : "#64748b"}; margin-top: 2px;">${kpis.devicesWithIssue} Device Issue</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Notice & Details -->
            <tr>
              <td style="padding: 12px 28px 24px 28px;">
                <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px 16px; font-size: 13px; color: #1e3a8a; line-height: 1.5;">
                  📎 <strong>Dokumen Terlampir:</strong> Laporan Audit Grid lengkap dalam format PDF eksekutif berkualitas tinggi telah dilampirkan pada email ini (grafik kepatuhan harian, matriks perangkat per tanggal, status auditor, dan telemetri suhu ruangan).
                </div>

                <div style="margin-top: 20px; font-size: 12px; color: #64748b; line-height: 1.6;">
                  Laporan ini digenerate secara otomatis oleh sistem <strong>DC-Check / DataGuard Operations</strong> berdasarkan jadwal <em>${schedule.frequency}</em> yang dikonfigurasi.
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: #f8fafc; padding: 14px 28px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
                Generated on ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · DataGuard Audit Platform
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;

        const textBody = `[${schedule.name}] Laporan audit ${siteName} periode ${startDateStr} s/d ${todayStr}. Total perangkat: ${kpis.totalDevices}, OK: ${kpis.okChecks}, NOT OK: ${kpis.notOkChecks}. Silakan unduh file PDF terlampir.`;

        // 4. Send Email via SMTPS
        const sendResult = await sendChecklistPicEmail(
            recipients,
            subject,
            htmlBody,
            textBody,
            schedule.includePdf
                ? [{
                    filename: `Audit_Grid_${siteName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${startDateStr}_to_${todayStr}.pdf`,
                    content: pdfBuffer,
                    contentType: "application/pdf",
                }]
                : [],
        );

        if (!sendResult.success) {
            throw new Error(sendResult.error || "SMTP send failed");
        }

        // 5. Update Schedule Run Metadata
        const nextRunAt = !options?.isManual
            ? calculateNextRun(schedule.frequency, schedule.runTime, schedule.dayOfWeek, schedule.dayOfMonth)
            : schedule.nextRunAt;

        await db.update(reportSchedules).set({
            lastRunAt: new Date(),
            lastRunStatus: "success",
            lastRunError: null,
            nextRunAt,
            updatedAt: new Date(),
        }).where(eq(reportSchedules.id, schedule.id));

        return {
            success: true,
            message: `Laporan berhasil dikirimkan ke ${recipients.length} alamat email.`,
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Execute report schedule error:", error);

        await db.update(reportSchedules).set({
            lastRunAt: new Date(),
            lastRunStatus: "error",
            lastRunError: errorMsg,
            updatedAt: new Date(),
        }).where(eq(reportSchedules.id, schedule.id));

        return { success: false, error: `Gagal mengirimkan report: ${errorMsg}` };
    }
}

export async function sendReportScheduleNow(id: number) {
    const auth = await requireActiveSiteAdminAction();
    if (!auth.ok) return { message: auth.message };

    const result = await executeReportSchedule(id, { isManual: true });
    revalidatePath("/report/schedules");
    return result;
}
