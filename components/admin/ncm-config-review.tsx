"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileCheck,
  FileText,
  Filter,
  GitCompareArrows,
  Mail,
  MessageSquare,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import ActionButton from "@/components/ui/action-button";
import {
  addNcmReviewNoteAction,
  getNcmComplianceAction,
  getNcmReviewDetail,
  getNcmReviewNotesAction,
  getNcmReviewRollbackAction,
  promoteNcmReviewAction,
  runNcmReviewCycleAction,
  sendNcmReviewReminderAction,
  startNcmReviewAction,
  updateNcmReviewStatusAction,
} from "@/actions/ncm";

type Row = Record<string, unknown>;

function pick(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDING",
  in_review: "IN REVIEW",
  approved: "APPROVED",
  flagged: "FLAGGED",
  dismissed: "DISMISSED",
};

const inputClass = "h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-white";

type DiffCategory = "all" | "vlan" | "interface" | "security" | "system";
type DiffViewStyle = "side-by-side" | "unified";

interface SideBySideLine {
  lineA: number | null;
  textA: string;
  lineB: number | null;
  textB: string;
  type: "equal" | "delete" | "insert" | "replace";
  category: DiffCategory;
}

function classifyLine(text: string): DiffCategory {
  const lower = text.toLowerCase().trim();
  if (lower.includes("vlan")) return "vlan";
  if (
    lower.startsWith("interface ") ||
    lower.startsWith("switchport ") ||
    lower.startsWith("ip address ") ||
    lower.startsWith("shutdown") ||
    lower.startsWith("no shutdown") ||
    lower.startsWith("speed ") ||
    lower.startsWith("duplex ") ||
    lower.startsWith("spanning-tree ")
  )
    return "interface";
  if (
    lower.includes("access-list") ||
    lower.includes("acl") ||
    lower.includes("radius") ||
    lower.includes("tacacs") ||
    lower.includes("aaa ") ||
    lower.includes("crypto ") ||
    lower.includes("ssh ") ||
    lower.includes("password ") ||
    lower.includes("secret ") ||
    lower.includes("snmp-server community")
  )
    return "security";
  if (
    lower.startsWith("hostname ") ||
    lower.startsWith("ntp ") ||
    lower.startsWith("clock ") ||
    lower.startsWith("service ") ||
    lower.startsWith("logging ") ||
    lower.startsWith("banner ")
  )
    return "system";
  return "all";
}

function parseUnifiedDiffToSideBySide(rawDiff: string, hideNoise: boolean): SideBySideLine[] {
  const lines = rawDiff.split("\n");
  const rows: SideBySideLine[] = [];
  let lineA = 1;
  let lineB = 1;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("---") || line.startsWith("+++")) {
      i++;
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      lineA = parseInt(hunkMatch[1], 10);
      lineB = parseInt(hunkMatch[2], 10);
      i++;
      continue;
    }

    if (line.startsWith("-")) {
      const deletes: string[] = [];
      while (i < lines.length && lines[i].startsWith("-")) {
        deletes.push(lines[i].slice(1));
        i++;
      }
      const inserts: string[] = [];
      while (i < lines.length && lines[i].startsWith("+")) {
        inserts.push(lines[i].slice(1));
        i++;
      }

      const maxLen = Math.max(deletes.length, inserts.length);
      for (let k = 0; k < maxLen; k++) {
        const delText = deletes[k] ?? "";
        const insText = inserts[k] ?? "";

        if (hideNoise) {
          const checkNoise = (delText + " " + insText).toLowerCase();
          if (
            checkNoise.includes("ntp clock-period") ||
            checkNoise.includes("uptime") ||
            checkNoise.includes("last configuration change") ||
            checkNoise.includes("nvram config last updated")
          ) {
            if (k < deletes.length) lineA++;
            if (k < inserts.length) lineB++;
            continue;
          }
        }

        const cat = classifyLine(delText || insText);

        if (k < deletes.length && k < inserts.length) {
          rows.push({
            lineA: lineA++,
            textA: delText,
            lineB: lineB++,
            textB: insText,
            type: "replace",
            category: cat,
          });
        } else if (k < deletes.length) {
          rows.push({
            lineA: lineA++,
            textA: delText,
            lineB: null,
            textB: "",
            type: "delete",
            category: cat,
          });
        } else {
          rows.push({
            lineA: null,
            textA: "",
            lineB: lineB++,
            textB: insText,
            type: "insert",
            category: cat,
          });
        }
      }
      continue;
    }

    if (line.startsWith("+")) {
      const insText = line.slice(1);
      if (
        !hideNoise ||
        (!insText.toLowerCase().includes("ntp clock-period") &&
          !insText.toLowerCase().includes("last configuration change"))
      ) {
        rows.push({
          lineA: null,
          textA: "",
          lineB: lineB++,
          textB: insText,
          type: "insert",
          category: classifyLine(insText),
        });
      } else {
        lineB++;
      }
      i++;
      continue;
    }

    if (line.startsWith(" ")) {
      const eqText = line.slice(1);
      rows.push({
        lineA: lineA++,
        textA: eqText,
        lineB: lineB++,
        textB: eqText,
        type: "equal",
        category: classifyLine(eqText),
      });
      i++;
      continue;
    }

    i++;
  }
  return rows;
}

function summaryText(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "text diff only";
  const parts: string[] = [];
  const added = summary.vlans_added as number[] | undefined;
  const removed = summary.vlans_removed as number[] | undefined;
  const changed = summary.ports_changed as string[] | undefined;
  if (added?.length) parts.push(`VLAN +${added.join(",")}`);
  if (removed?.length) parts.push(`VLAN -${removed.join(",")}`);
  if (changed?.length) parts.push(`${changed.length} port(s) changed (${changed.slice(0, 5).join(", ")})`);
  if (summary.hostname_changed) parts.push("hostname changed");
  return parts.join(" · ") || "text diff only";
}

export function NcmConfigReview({
  reviews,
  baselines,
  switches,
  initialSelectedId,
}: {
  reviews: Row[];
  baselines: Row[];
  switches: Row[];
  initialSelectedId?: number | null;
}) {
  const router = useRouter();

  const [complianceData, setComplianceData] = useState<Row | null>(null);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [isTriggeringCycle, setIsTriggeringCycle] = useState(false);
  const [cycleResult, setCycleResult] = useState<Row | null>(null);
  const [cycleModalOpen, setCycleModalOpen] = useState(false);

  // Filters & selection
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<number | null>(initialSelectedId ?? null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Diff inspection settings
  const [viewStyle, setViewStyle] = useState<DiffViewStyle>("side-by-side");
  const [activeCategory, setActiveCategory] = useState<DiffCategory>("all");
  const [hideNoise, setHideNoise] = useState(false);

  // Notes thread
  const [notes, setNotes] = useState<Row[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Action states & Modals
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteReviewId, setPromoteReviewId] = useState<number | null>(null);
  const [promoteReason, setPromoteReason] = useState("");
  const [promoteComment, setPromoteComment] = useState("");
  const [isPromoting, setIsPromoting] = useState(false);

  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackScript, setRollbackScript] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [flagIncidentRef, setFlagIncidentRef] = useState("");

  const switchMap = useMemo(() => {
    return new Map(switches.map((s) => [pick(s, "id", "switch_id", "switchId"), s]));
  }, [switches]);

  // Load compliance overview
  useEffect(() => {
    let cancelled = false;
    setLoadingCompliance(true);
    getNcmComplianceAction()
      .then((res) => {
        if (!cancelled && !("message" in res)) setComplianceData(res as Row);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingCompliance(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update selected if initialSelectedId changes
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selected) {
      setSelected(initialSelectedId);
    }
  }, [initialSelectedId]);

  // Fetch diff when a review is selected
  useEffect(() => {
    if (selected === null) {
      setDiff(null);
      setDiffError(null);
      setNotes([]);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setDiffError(null);
    setLoadingDiff(true);

    getNcmReviewDetail(selected)
      .then((res) => {
        if (cancelled) return;
        if (res.message) {
          setDiffError(res.message);
        } else {
          setDiff(res.diff || "(diff kosong / tidak ada perubahan)");
        }
      })
      .catch((err) => {
        if (!cancelled) setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    // Also load review notes
    getNcmReviewNotesAction(selected)
      .then((res) => {
        if (!cancelled && Array.isArray(res)) setNotes(res as Row[]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectedReview = useMemo(() => {
    return reviews.find((r) => Number(pick(r, "id", "review_id")) === selected) ?? null;
  }, [reviews, selected]);

  const parsedDiffRows = useMemo(() => {
    if (!diff) return [];
    return parseUnifiedDiffToSideBySide(diff, hideNoise);
  }, [diff, hideNoise]);

  const isCleanMatch = useMemo(() => {
    if (diff === null) return false;
    return !diff.trim() || diff === "(diff kosong / tidak ada perubahan)" || parsedDiffRows.every((r) => r.type === "equal");
  }, [diff, parsedDiffRows]);

  const filteredDiffRows = useMemo(() => {
    if (activeCategory === "all") return parsedDiffRows;
    return parsedDiffRows.filter((r) => r.type !== "equal" && r.category === activeCategory);
  }, [parsedDiffRows, activeCategory]);

  const filteredReviews = useMemo(() => {
    if (!statusFilter) return reviews;
    return reviews.filter((r) => (pick(r, "status") || "pending") === statusFilter);
  }, [reviews, statusFilter]);

  async function handleSendReminder() {
    if (!window.confirm("Kirim email reminder status review pending & gap baseline ke administrator sekarang?")) return;
    setIsSendingReminder(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await sendNcmReviewReminderAction();
      if (res.success) {
        setActionSuccess(res.message);
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingReminder(false);
    }
  }

  async function handleTriggerCycle() {
    if (!window.confirm("Jalankan siklus review sekarang untuk seluruh switch? Semua switch yang identik dengan baseline akan di-reset siklusnya, dan hasil audit akan dikirim via email.")) return;
    setIsTriggeringCycle(true);
    setActionError(null);
    try {
      const res = await runNcmReviewCycleAction();
      if (res.success) {
        setCycleResult(res.data as Row);
        setCycleModalOpen(true);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTriggeringCycle(false);
    }
  }

  async function handleStartReview(reviewId: number) {
    setActionError(null);
    try {
      const res = await startNcmReviewAction(reviewId);
      if (res.success) {
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDecideStatus(reviewId: number, status: string, defaultComment?: string) {
    if (status === "flagged") {
      setPromoteReviewId(reviewId);
      setFlagIncidentRef("");
      setRollbackModalOpen(true);
      setRollbackLoading(true);
      try {
        const res = await getNcmReviewRollbackAction(reviewId);
        setRollbackScript(typeof res === "string" ? res : (res as Row).message ? String((res as Row).message) : "");
      } catch {
        setRollbackScript("! Failed to fetch rollback script from server.");
      } finally {
        setRollbackLoading(false);
      }
      return;
    }

    const comment =
      window.prompt(
        status === "approved"
          ? `Konfirmasi Approve untuk review #${reviewId}? Masukkan catatan / justifikasi verifikasi:`
          : `Keputusan ${status} untuk review #${reviewId}? (opsional, catatan bisa ditambah di thread)`,
        defaultComment ?? "",
      ) ?? undefined;

    if (comment === undefined) return;

    setActionError(null);
    try {
      const res = await updateNcmReviewStatusAction(reviewId, status, comment || defaultComment, true);
      if (res.success) {
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function openPromoteModal(reviewId: number) {
    setPromoteReviewId(reviewId);
    setPromoteReason("");
    setPromoteComment("");
    setPromoteModalOpen(true);
    setActionError(null);
  }

  async function handlePromoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteReviewId || !promoteReason.trim()) return;
    setIsPromoting(true);
    setActionError(null);
    try {
      const res = await promoteNcmReviewAction(promoteReviewId, promoteReason.trim(), promoteComment.trim() || undefined);
      if (res.success) {
        setPromoteModalOpen(false);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPromoting(false);
    }
  }

  async function handleFlagSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteReviewId) return;
    const comment = flagIncidentRef.trim()
      ? `[FLAGGED - Remediation Required] ${flagIncidentRef.trim()}`
      : "[FLAGGED - Remediation Required] Unapproved drift";
    setActionError(null);
    try {
      const res = await updateNcmReviewStatusAction(promoteReviewId, "flagged", comment, false);
      if (res.success) {
        setRollbackModalOpen(false);
        router.refresh();
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddNote(reviewId: number) {
    const text = noteDraft.trim();
    if (!text) return;
    setIsAddingNote(true);
    setActionError(null);
    try {
      const res = await addNcmReviewNoteAction(reviewId, text);
      if (res.success) {
        setNoteDraft("");
        const refreshedNotes = await getNcmReviewNotesAction(reviewId);
        if (Array.isArray(refreshedNotes)) setNotes(refreshedNotes as Row[]);
      } else {
        setActionError(res.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAddingNote(false);
    }
  }

  // Stats calculation
  const totalSwitches = Number(complianceData?.switches_total ?? switches.length);
  const withBaseline = Number(complianceData?.switches_with_baseline ?? baselines.length);
  const coverage = totalSwitches > 0 ? Math.round((withBaseline / totalSwitches) * 100) : 0;
  const pendingCount = Number(complianceData?.reviews_pending ?? reviews.filter((r) => (pick(r, "status") || "pending") === "pending").length);
  const flaggedCount = Number(complianceData?.reviews_flagged ?? reviews.filter((r) => pick(r, "status") === "flagged").length);
  const missingSwitches = (complianceData?.switches_missing_baseline as string[]) || [];
  const staleBaselines = (complianceData?.baselines_stale as string[]) || [];

  return (
    <div className="space-y-4">
      {/* 1. COMPLIANCE PANEL (ISO 27001 A.8.9) */}
      <section className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-ops-accent" />
              <h3 className="text-base font-bold text-white">Compliance Overview (ISO 27001 A.8.9)</h3>
            </div>
            <p className="mt-1 text-xs text-ops-muted max-w-3xl">
              Setiap switch memiliki golden baseline; setiap perbedaan (drift) membuka tiket review di sini.
              Menyediakan bukti kepatuhan manajemen konfigurasi dan audit jejak operasional.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              ISO 27001 Active
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <div className="text-2xl font-bold font-mono text-ops-accent">{coverage}%</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Baseline Coverage</div>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <div className="text-2xl font-bold font-mono text-amber-400">{pendingCount}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Reviews Pending</div>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <div className="text-2xl font-bold font-mono text-red-400">{flaggedCount}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Flagged Drift</div>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <div className="text-2xl font-bold font-mono text-slate-300">{missingSwitches.length}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Without Baseline</div>
          </div>
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
            <div className="text-2xl font-bold font-mono text-sky-400">{staleBaselines.length}</div>
            <div className="mt-1 text-xs uppercase tracking-wider text-ops-muted">Reminder Due</div>
          </div>
        </div>

        {missingSwitches.length > 0 && (
          <p className="text-xs text-amber-300/90 bg-amber-400/10 border border-amber-400/20 rounded p-2.5">
            Switch belum memiliki baseline: <strong>{missingSwitches.join(", ")}</strong>. Deteksi drift tidak aktif pada switch tersebut sampai baseline dibuat.
          </p>
        )}

        {staleBaselines.length > 0 && (
          <p className="text-xs text-sky-300/90 bg-sky-400/10 border border-sky-400/20 rounded p-2.5">
            Review berkala jatuh tempo: <strong>{staleBaselines.join(", ")}</strong>. Buka sesi review untuk switch tersebut untuk re-attestasi dan reset siklus.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              type="button"
              variant="secondary"
              isPending={isSendingReminder}
              onClick={handleSendReminder}
              title="Kirim email reminder status review pending & gap baseline ke administrator sekarang"
            >
              <Mail className="size-4 text-sky-400" />
              Kirim Reminder Email
            </ActionButton>
          </div>
          <ActionButton
            type="button"
            isPending={isTriggeringCycle}
            onClick={handleTriggerCycle}
            className="bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 font-bold"
            title="Bandingkan seluruh switch ke baseline sekarang, reset siklus periode, dan kirim email hasil review"
          >
            <Sparkles className="size-4 text-amber-400" />
            Jalankan Siklus Review Sekarang (All Switches)
          </ActionButton>
        </div>
      </section>

      {/* BANNER NOTIFIKASI ERROR / SUCCESS */}
      {actionSuccess && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300 flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)}><X className="size-4" /></button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300 flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}><X className="size-4" /></button>
        </div>
      )}

      {/* 2. FILTER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-ops-muted" />
          <span className="text-xs font-semibold text-white">Filter Status Review:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-white"
          >
            <option value="">Semua Status ({reviews.length})</option>
            <option value="pending">Pending</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <span className="text-xs text-ops-muted">
          Menampilkan {filteredReviews.length} dari {reviews.length} tiket review
        </span>
      </div>

      {/* 3. REVIEWS TABLE */}
      <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-ops-muted">
              <th className="py-2.5 px-3">ID</th>
              <th className="py-2.5 px-3">Switch</th>
              <th className="py-2.5 px-3">Dibuat</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Reviewer</th>
              <th className="py-2.5 px-3">Ringkasan Perubahan</th>
              <th className="py-2.5 px-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredReviews.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-ops-muted">
                  Tidak ada review yang cocok dengan filter.
                </td>
              </tr>
            )}
            {filteredReviews.map((r) => {
              const id = Number(pick(r, "id", "review_id", "reviewId"));
              const swId = pick(r, "switch_id", "switchId");
              const sw = switchMap.get(swId);
              const switchName = pick(r, "switch_name", "switchName") || (sw ? pick(sw, "name", "hostname") : "") || `#${swId}`;
              const status = pick(r, "status", "state") || "pending";
              const reviewerName = pick(r, "reviewed_by_name", "reviewedByName");
              const starterName = pick(r, "started_by_name", "startedByName");
              const diffSum = (r.diff_summary as Record<string, unknown>) || {};
              const isCurrentSelected = selected === id;

              return (
                <tr key={id} className={`border-t border-slate-800 transition-colors ${isCurrentSelected ? "bg-ops-accent/10" : "hover:bg-slate-800/40"}`}>
                  <td className="py-2.5 px-3 font-mono font-medium text-white">#{id}</td>
                  <td className="py-2.5 px-3 font-semibold text-white">{switchName}</td>
                  <td className="py-2.5 px-3 text-slate-300 text-xs">{formatDate(pick(r, "created_at", "createdAt"))}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        status === "flagged"
                          ? "border-red-400/25 bg-red-400/10 text-red-300"
                          : status === "approved"
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                          : status === "in_review"
                          ? "border-sky-400/25 bg-sky-400/10 text-sky-300"
                          : "border-amber-400/25 bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {STATUS_LABEL[status] ?? status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {reviewerName ? (
                      <span className="font-semibold text-amber-400 text-xs">{reviewerName}</span>
                    ) : starterName ? (
                      <span className="text-sky-400 text-xs italic">in review: {starterName}</span>
                    ) : (
                      <span className="text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-300 max-w-xs truncate" title={JSON.stringify(diffSum)}>
                    {summaryText(diffSum)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <ActionButton
                        size="sm"
                        variant={isCurrentSelected ? "primary" : "secondary"}
                        onClick={() => setSelected(isCurrentSelected ? null : id)}
                      >
                        <GitCompareArrows className="size-3.5" />
                        {isCurrentSelected ? "Tutup Diff" : "Diff"}
                      </ActionButton>

                      {status === "pending" ? (
                        <ActionButton
                          size="sm"
                          variant="secondary"
                          onClick={() => handleStartReview(id)}
                          title="Ambil review ini untuk dikerjakan"
                        >
                          <Play className="size-3.5 text-sky-400" />
                          Mulai Review
                        </ActionButton>
                      ) : status === "in_review" ? (
                        <>
                          <ActionButton
                            size="sm"
                            onClick={() => openPromoteModal(id)}
                            className="bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                            title="Setujui dan jadikan backup ini sebagai Golden Baseline baru"
                          >
                            ★ Promote
                          </ActionButton>
                          <ActionButton
                            size="sm"
                            variant="secondary"
                            onClick={() => handleDecideStatus(id, "approved", "Approve drift operasional, pertahankan baseline lama")}
                            title="Setujui perubahan ini tetapi pertahankan baseline lama"
                          >
                            ✓ Keep Old
                          </ActionButton>
                          <ActionButton
                            size="sm"
                            variant="danger"
                            onClick={() => handleDecideStatus(id, "flagged")}
                            title="Tandai pelanggaran konfigurasi & tampilkan instruksi rollback"
                          >
                            Flag
                          </ActionButton>
                        </>
                      ) : (
                        <span className="text-xs text-ops-muted italic">{pick(r, "comment") ? "has note" : "selesai"}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 4. DIFF INSPECTOR & ACTION PANEL (IDENTIK DENGAN NCM) */}
      {selected !== null && (
        <section className="rounded-xl border border-slate-700 bg-slate-950/80 shadow-xl overflow-hidden space-y-0">
          {/* Header Panel */}
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/90 p-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-ops-accent uppercase">
                <GitCompareArrows className="size-4" />
                <span>REVIEW #{selected} · {pick(selectedReview || {}, "switch_name", "switchName") || `#${pick(selectedReview || {}, "switch_id")}`} · DIFF &amp; INSPECTION</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-ops-muted">
                <span>Golden Baseline: <strong className="font-mono text-slate-200">#{pick(selectedReview || {}, "baseline_backup_id", "baseline_id") || "?"}</strong></span>
                <span>Detected Backup: <strong className="font-mono text-slate-200">#{pick(selectedReview || {}, "backup_id")}</strong></span>
                {pick(selectedReview || {}, "reviewed_by_name") ? (
                  <span>Reviewer: <strong className="text-amber-400">{pick(selectedReview || {}, "reviewed_by_name")}</strong> ({formatDate(pick(selectedReview || {}, "reviewed_at"))})</span>
                ) : pick(selectedReview || {}, "started_by_name") ? (
                  <span>In Review by: <strong className="text-sky-400">{pick(selectedReview || {}, "started_by_name")}</strong> ({formatDate(pick(selectedReview || {}, "started_at"))})</span>
                ) : (
                  <span>Status: <strong className="text-amber-400 uppercase">{pick(selectedReview || {}, "status")}</strong></span>
                )}
                {pick(selectedReview || {}, "comment") && (
                  <span>Catatan: <em className="text-slate-300">&quot;{pick(selectedReview || {}, "comment")}&quot;</em></span>
                )}
              </div>
            </div>

            {/* Quick action buttons in header */}
            <div className="flex items-center gap-2">
              {pick(selectedReview || {}, "status") === "pending" ? (
                <ActionButton size="sm" onClick={() => handleStartReview(selected)}>
                  <Play className="size-3.5" />
                  Mulai Review
                </ActionButton>
              ) : pick(selectedReview || {}, "status") === "in_review" ? (
                <>
                  {isCleanMatch ? (
                    <ActionButton
                      size="sm"
                      onClick={() => handleDecideStatus(selected, "approved", "Konfirmasi sesuai: konfigurasi identik dengan baseline (tanpa drift)")}
                      className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                    >
                      ✓ Konfirmasi Sesuai (Attest Clean &amp; Reset Siklus)
                    </ActionButton>
                  ) : (
                    <>
                      <ActionButton
                        size="sm"
                        onClick={() => openPromoteModal(selected)}
                        className="bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                      >
                        ★ Approve &amp; Promote to Baseline
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDecideStatus(selected, "approved", "Approve drift operasional, pertahankan baseline lama")}
                      >
                        ✓ Approve &amp; Pertahankan Baseline Lama
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="danger"
                        onClick={() => handleDecideStatus(selected, "flagged")}
                      >
                        Flag &amp; Remediate
                      </ActionButton>
                    </>
                  )}
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md border border-slate-700 bg-slate-800 p-1.5 text-slate-400 hover:text-white"
                title="Tutup inspeksi diff"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {/* Clean Match Banner */}
          {isCleanMatch && (
            <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                  <CheckCircle2 className="size-5 text-emerald-400" />
                  Konfigurasi 100% Identik (Tidak Ada Drift)
                </h4>
                <p className="mt-1 text-xs text-slate-300">
                  Konfigurasi backup terakhir switch ini sesuai sepenuhnya dengan Golden Baseline. Tidak ada perubahan konfigurasi yang memerlukan remedi.
                </p>
              </div>
              {pick(selectedReview || {}, "status") === "in_review" && (
                <ActionButton
                  type="button"
                  onClick={() => handleDecideStatus(selected, "approved", "Konfirmasi sesuai: konfigurasi identik dengan baseline (tanpa drift)")}
                  className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30 font-bold"
                >
                  ✓ Konfirmasi Sesuai (Attest Clean &amp; Reset Siklus)
                </ActionButton>
              )}
            </div>
          )}

          {/* Smart Diff Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/40 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ops-muted uppercase tracking-wider text-[10px]">View:</span>
              <button
                type="button"
                onClick={() => setViewStyle("side-by-side")}
                className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${viewStyle === "side-by-side" ? "bg-ops-accent text-slate-950 font-bold" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                Side-by-Side Split
              </button>
              <button
                type="button"
                onClick={() => setViewStyle("unified")}
                className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${viewStyle === "unified" ? "bg-ops-accent text-slate-950 font-bold" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                Unified Raw
              </button>
              <label className="ml-3 flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs">
                <input
                  type="checkbox"
                  checked={hideNoise}
                  onChange={(e) => setHideNoise(e.target.checked)}
                  className="size-3.5 rounded border-slate-700"
                />
                Hide Noise (NTP/Uptime)
              </label>
            </div>

            {viewStyle === "side-by-side" && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-ops-muted uppercase tracking-wider text-[10px]">Filter:</span>
                {(
                  [
                    ["all", "All Changes"],
                    ["vlan", "VLANs"],
                    ["interface", "Interfaces"],
                    ["security", "Security & AAA"],
                    ["system", "System/Host"],
                  ] as const
                ).map(([cat, label]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${activeCategory === cat ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold" : "bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {diffError && <p className="p-4 text-sm text-red-400">{diffError}</p>}
          {loadingDiff && <p className="p-6 text-center text-sm text-ops-muted">Memuat perbandingan diff dari NCM…</p>}

          {/* Unified Raw View */}
          {diff !== null && !loadingDiff && viewStyle === "unified" && (
            <pre className="max-h-[500px] overflow-auto p-4 font-mono text-xs text-slate-300 whitespace-pre leading-relaxed">
              {diff}
            </pre>
          )}

          {/* Side-by-Side Split View */}
          {diff !== null && !loadingDiff && viewStyle === "side-by-side" && (
            <div className="overflow-x-auto max-h-[540px]">
              {/* Diff Pane Headers */}
              <div className="grid grid-cols-2 border-b border-slate-800 bg-slate-900/80 text-[11px] font-mono font-bold uppercase tracking-wider text-ops-muted">
                <div className="py-2 px-3 border-r border-slate-800 text-slate-300 flex items-center justify-between">
                  <span>Golden Baseline (Target State)</span>
                  <span className="text-[10px] text-slate-500">Kiri</span>
                </div>
                <div className="py-2 px-3 text-slate-300 flex items-center justify-between">
                  <span>Current Running Config (Detected State)</span>
                  <span className="text-[10px] text-slate-500">Kanan</span>
                </div>
              </div>

              <div className="font-mono text-xs">
                {filteredDiffRows.map((row, idx) => {
                  let bgClassA = "";
                  let bgClassB = "";
                  if (row.type === "delete") {
                    bgClassA = "bg-red-500/20 text-red-200";
                    bgClassB = "bg-slate-900/30 text-slate-600";
                  } else if (row.type === "insert") {
                    bgClassA = "bg-slate-900/30 text-slate-600";
                    bgClassB = "bg-emerald-500/20 text-emerald-200";
                  } else if (row.type === "replace") {
                    bgClassA = "bg-amber-500/20 text-amber-200";
                    bgClassB = "bg-emerald-500/20 text-emerald-200";
                  } else {
                    bgClassA = "text-slate-300";
                    bgClassB = "text-slate-300";
                  }

                  return (
                    <div key={idx} className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] border-b border-slate-900/60 hover:bg-slate-800/20">
                      <span className="py-1 px-2 text-right text-slate-500 select-none bg-slate-950/40 border-r border-slate-800/80">
                        {row.lineA ?? ""}
                      </span>
                      <pre className={`py-1 px-2.5 whitespace-pre-wrap break-words border-r border-slate-800/80 m-0 ${bgClassA}`}>
                        {row.textA}
                      </pre>
                      <span className="py-1 px-2 text-right text-slate-500 select-none bg-slate-950/40 border-r border-slate-800/80">
                        {row.lineB ?? ""}
                      </span>
                      <pre className={`py-1 px-2.5 whitespace-pre-wrap break-words m-0 ${bgClassB}`}>
                        {row.textB}
                      </pre>
                    </div>
                  );
                })}
                {filteredDiffRows.length === 0 && (
                  <p className="p-6 text-center text-sm text-ops-muted">
                    Tidak ada perbedaan konfigurasi pada kategori filter ini.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Audit Notes Thread */}
          <div className="border-t border-slate-800 bg-slate-900/40 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
              <MessageSquare className="size-4 text-ops-accent" />
              <span>Audit Notes &amp; Evidence Trail ({notes.length})</span>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {notes.length === 0 && (
                <p className="text-xs text-ops-muted italic">Belum ada catatan audit pada tiket review ini.</p>
              )}
              {notes.map((n, i) => (
                <div key={i} className="rounded border border-slate-800 bg-slate-950/60 p-2.5 border-l-2 border-l-ops-accent text-xs">
                  <div className="flex items-center justify-between text-ops-muted text-[11px] pb-1">
                    <span className="font-semibold text-slate-200">{pick(n, "author_name", "authorName") || `User #${pick(n, "author_id", "authorId") || "?"}`}</span>
                    <span>{formatDate(pick(n, "created_at", "createdAt"))}</span>
                  </div>
                  <p className="text-slate-300 whitespace-pre-wrap mt-0.5">{pick(n, "body")}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <textarea
                rows={2}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Tambah catatan audit (mis. konfirmasi NOC, referensi tiket, justifikasi teknis)…"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white placeholder:text-slate-500 focus:border-ops-accent focus:outline-none"
              />
              <ActionButton
                type="button"
                variant="secondary"
                isPending={isAddingNote}
                disabled={!noteDraft.trim()}
                onClick={() => handleAddNote(selected)}
                className="shrink-0"
              >
                Kirim Catatan
              </ActionButton>
            </div>
          </div>
        </section>
      )}

      {/* MODAL 1: APPROVE & PROMOTE TO BASELINE */}
      {promoteModalOpen && promoteReviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setPromoteModalOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="size-5 text-amber-400" />
                Approve &amp; Promote to Golden Baseline
              </h3>
              <button type="button" onClick={() => setPromoteModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Aksi ini akan menyetujui drift (status <strong>APPROVED</strong>) dan memperbarui golden baseline switch dengan konfigurasi ini secara atomik. Siklus review berkala akan di-reset (diperpanjang 6 bulan).
            </p>

            <form onSubmit={handlePromoteSubmit} className="space-y-3">
              <label className="block space-y-1 text-xs font-medium text-slate-300">
                <span>Change Request ID / Justifikasi Otorisasi (Wajib ISO 27001) *</span>
                <input
                  type="text"
                  required
                  value={promoteReason}
                  onChange={(e) => setPromoteReason(e.target.value)}
                  placeholder="e.g. CR-2026-089: Penambahan VLAN 20 server finance"
                  className={inputClass}
                  autoFocus
                />
              </label>

              <label className="block space-y-1 text-xs font-medium text-slate-300">
                <span>Catatan Operasional Tambahan (Opsional)</span>
                <textarea
                  rows={3}
                  value={promoteComment}
                  onChange={(e) => setPromoteComment(e.target.value)}
                  placeholder="Catatan verifikasi atau referensi teknis…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white placeholder:text-slate-500 focus:border-ops-accent focus:outline-none"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <ActionButton type="button" variant="ghost" onClick={() => setPromoteModalOpen(false)}>
                  Batal
                </ActionButton>
                <ActionButton
                  type="submit"
                  isPending={isPromoting}
                  disabled={!promoteReason.trim()}
                  className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-bold"
                >
                  Konfirmasi &amp; Jadikan Baseline Baru
                </ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: FLAG & ROLLBACK REMEDIATION GUIDANCE */}
      {rollbackModalOpen && promoteReviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setRollbackModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-red-400 flex items-center gap-2">
                <AlertTriangle className="size-5 text-red-400" />
                Flag Unapproved Drift &amp; Rollback Guidance
              </h3>
              <button type="button" onClick={() => setRollbackModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Drift ini akan ditandai sebagai <strong>FLAGGED</strong> (temuan perubahan tidak terotorisasi untuk ISO 27001). Berikut adalah instruksi rollback CLI otomatis untuk remedi mengembalikan switch ke baseline.
            </p>

            <label className="block space-y-1 text-xs font-medium text-slate-300">
              <span>Incident / Violation Reference (Opsional)</span>
              <input
                type="text"
                value={flagIncidentRef}
                onChange={(e) => setFlagIncidentRef(e.target.value)}
                placeholder="e.g. INC-2026-401: Unauthorized VLAN creation on Core Switch"
                className={inputClass}
              />
            </label>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-ops-muted mb-1">
                Remediation CLI Rollback Script:
              </div>
              {rollbackLoading ? (
                <p className="p-4 text-center text-xs text-ops-muted bg-slate-950 rounded">Membuat script rollback…</p>
              ) : (
                <pre className="max-h-52 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-300">
                  {rollbackScript || "! Tidak ada script rollback yang tersedia."}
                </pre>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(rollbackScript);
                  alert("Script rollback berhasil disalin ke clipboard!");
                }}
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                <Copy className="size-3.5" />
                Salin Script Rollback
              </button>
              <div className="flex items-center gap-2">
                <ActionButton type="button" variant="ghost" onClick={() => setRollbackModalOpen(false)}>
                  Batal
                </ActionButton>
                <ActionButton
                  type="button"
                  variant="danger"
                  onClick={handleFlagSubmit}
                >
                  Konfirmasi &amp; Tandai FLAGGED
                </ActionButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CYCLE ATTESTATION RESULT */}
      {cycleModalOpen && cycleResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setCycleModalOpen(false)}>
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400" />
                Siklus Review Fleet Selesai
              </h3>
              <button type="button" onClick={() => setCycleModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-sm text-slate-200 font-semibold">{pick(cycleResult, "message")}</p>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded border border-slate-800 bg-slate-950 p-3 text-center">
                <div className="text-xl font-bold font-mono text-white">{pick(cycleResult, "total_checked")}</div>
                <div className="text-[11px] text-ops-muted">Total Diperiksa</div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 p-3 text-center">
                <div className="text-xl font-bold font-mono text-emerald-400">{pick(cycleResult, "clean_count")}</div>
                <div className="text-[11px] text-ops-muted">Clean Attested</div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 p-3 text-center">
                <div className="text-xl font-bold font-mono text-amber-400">{pick(cycleResult, "drift_count")}</div>
                <div className="text-[11px] text-ops-muted">Review Baru</div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <ActionButton type="button" onClick={() => setCycleModalOpen(false)}>
                Tutup Ringkasan
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
