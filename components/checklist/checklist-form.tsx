"use client";

import { useActionState, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { submitChecklist } from "@/actions/checklist";
import ActionButton from "@/components/ui/action-button";
import { CalendarDays, Clock3, Layers3, Send, Search } from "lucide-react";
import clsx from "clsx";
import FieldAuditCard from "./field-audit-card";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number };

const STORAGE_KEY = "checklist-audit-partial";

function readPartialDevices(): Record<string, { status: string; remarks: string }> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePartialDevices(partial: Record<string, { status: string; remarks: string }>) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
  } catch { /* storage full or private mode — silently skip */ }
}

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function ChecklistForm({
  categories,
  devices,
  prefillDeviceId,
}: {
  categories: Category[];
  devices: Device[];
  prefillDeviceId?: number;
}) {
  const [activeTab, setActiveTab] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState("");
  // Persist status/remarks per device so switching tabs never loses data
  const [auditData, setAuditData] = useState<Record<string, { status: string; remarks: string }>>(() =>
    readPartialDevices()
  );
  const [state, action, isPending] = useActionState(submitChecklist, undefined);

  // Sync to localStorage whenever auditData changes
  useEffect(() => {
    writePartialDevices(auditData);
  }, [auditData]);

  const updateDeviceStatus = useCallback((deviceId: number, status: string, remarks?: string) => {
    setAuditData((prev) => {
      const entry = prev[deviceId];
      // Only persist non-OK states or when remarks changed
      if (entry?.status === status && (status !== "OK" || entry.remarks === remarks)) return prev;
      return { ...prev, [deviceId]: { status, remarks: remarks ?? "" } };
    });
  }, []);

  // Finding #62: evidence photos survive tab switches. The card's file input
  // unmounts with the card, so selected files are mirrored into a hidden
  // file input per device in the all-devices block (it never unmounts).
  // type="file" inputs cannot be pre-filled; the DataTransfer assignment is
  // the only browser-sanctioned way to move the selected File across inputs.
  const photoInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const mirrorPhotoToHiddenInput = useCallback((deviceId: number, file: File | null) => {
    const input = photoInputs.current[deviceId];
    if (!input) return;
    try {
      const transfer = new DataTransfer();
      if (file) transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Unsupported browser: the visible card input (when mounted) still
      // submits its own selection, so evidence is only lost on tab switches.
    }
  }, []);

  const handleCardPhotoChange = useCallback((deviceId: number) => (file: File | null) => {
    mirrorPhotoToHiddenInput(deviceId, file);
  }, [mirrorPhotoToHiddenInput]);

  // All devices — render every card so switching tabs never loses data
  const visibleDevices = useMemo(() => {
    let result = devices;
    if (activeTab) result = result.filter((d) => d.categoryId === activeTab);
    if (filter) result = result.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));
    return result;
  }, [devices, activeTab, filter]);

  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const activeCategory = activeTab ? categories.find((c) => c.id === activeTab) : null;

  return (
    <form action={action} className="flex flex-col gap-5" suppressHydrationWarning>
      {/* Run metadata */}
      <section className="ops-panel overflow-hidden">
        <div className="border-b border-ops-border bg-ops-surface px-5 py-4">
          <h2 className="text-base font-bold text-ops-text">Audit Run</h2>
          <p className="mt-1 text-sm text-ops-muted">Set run metadata before checking devices.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label>
            <span className={labelClass}>Date</span>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <input type="date" name="checkDate" defaultValue={today} required className={clsx(fieldClass, "pl-9")} />
            </div>
          </label>
          <label>
            <span className={labelClass}>Time</span>
            <div className="relative">
              <Clock3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <input type="time" name="checkTime" defaultValue={now} required className={clsx(fieldClass, "pl-9")} />
            </div>
          </label>
          <label>
            <span className={labelClass}>Shift</span>
            <div className="relative">
              <Layers3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <select name="shift" className={clsx(fieldClass, "pl-9")}>
                <option value="Pagi">Pagi</option>
                <option value="Siang">Siang</option>
                <option value="Malam">Malam</option>
              </select>
            </div>
          </label>
        </div>
      </section>

      {/* Category filter tabs */}
      <section className="ops-panel overflow-hidden">
        <div className="border-b border-ops-border bg-ops-surface px-5 py-4">
          <h2 className="text-base font-bold text-ops-text">Filter by Category</h2>
          <p className="mt-1 text-sm text-ops-muted">All {devices.length} devices are auditable. Use tabs to filter.</p>
        </div>
        <div className="overflow-x-auto p-2">
          <nav className="flex min-w-max gap-1" aria-label="Device categories">
            <button
              type="button"
              onClick={() => setActiveTab(undefined)}
              className={clsx(
                "flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors",
                !activeTab
                  ? "bg-ops-accent text-slate-950"
                  : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
              )}
            >
              All
              <span className={clsx(
                "rounded-full px-2 py-0.5 text-[11px]",
                !activeTab ? "bg-slate-950/12 text-slate-950" : "bg-ops-bg text-ops-muted",
              )}>
                {devices.length}
              </span>
            </button>
            {categories.map((category) => {
              const count = devices.filter((d) => d.categoryId === category.id).length;
              const active = activeTab === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveTab(category.id)}
                  className={clsx(
                    "flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors",
                    active
                      ? "bg-ops-accent text-slate-950"
                      : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
                  )}
                >
                  {category.name}
                  <span className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    active ? "bg-slate-950/12 text-slate-950" : "bg-ops-bg text-ops-muted",
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
        {/* Search */}
        <div className="border-b border-ops-border px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
            <input
              type="search"
              placeholder="Filter devices by name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64 bg-transparent text-sm text-ops-text outline-none placeholder:text-ops-muted"
            />
          </div>
        </div>
      </section>

      {/* Device list — all visible devices render here, but ALL devices render hidden too */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ops-text">
            {activeCategory?.name ?? "All Devices"}
          </h2>
          <span className="text-sm text-ops-muted">
            {visibleDevices.length} of {devices.length} devices
          </span>
        </div>

        {/* Render visible devices normally */}
        <div className="space-y-3">
          {visibleDevices.map((device) => {
            const stored = auditData[device.id];
            return (
              <FieldAuditCard
                key={device.id}
                device={device}
                isHighlighted={prefillDeviceId === device.id}
                onStatusChange={(status, remarks) => updateDeviceStatus(device.id, status, remarks)}
                onPhotoChange={handleCardPhotoChange(device.id)}
                prefillStatus={stored?.status || "OK"}
                prefillRemarks={stored?.remarks || ""}
              />
            );
          })}

          {visibleDevices.length === 0 && (
            <div className="rounded-md border border-dashed border-ops-border px-5 py-10 text-center">
              <p className="font-semibold text-ops-text">No devices match your filter.</p>
              <p className="mt-1 text-sm text-ops-muted">Try changing the category or search term.</p>
            </div>
          )}
        </div>

        {/* Render ALL devices as hidden fields so submit picks up every device, even if filtered out */}
        <div className="hidden" aria-hidden="true">
          {devices.map((device) => {
            const stored = auditData[device.id];
            return (
              <div key={`hidden-${device.id}`}>
                <input type="hidden" name="deviceId" value={device.id} />
                <input type="hidden" name={`status-${device.id}`} value={stored?.status || "OK"} />
                <input type="hidden" name={`remarks-${device.id}`} value={stored?.remarks || ""} />
                {/* Finding #62: live file input (not type=hidden — file inputs
                    cannot be submitted hidden) that mirrors the selected photo
                    from the card, so evidence survives tab switches. Gated on
                    NOT OK like the visible card so OK devices never submit
                    photos. */}
                {stored?.status === "NOT OK" && (
                  <input
                    type="file"
                    name={`photo-${device.id}`}
                    accept="image/*"
                    className="hidden"
                    ref={(el) => {
                      photoInputs.current[device.id] = el;
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Sticky submit bar */}
      <div className="sticky bottom-3 z-20 rounded-md border border-ops-border bg-ops-bg/95 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.32)] backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">Summary</p>
            <p className="text-sm font-semibold text-ops-text">
              {devices.filter(d => auditData[d.id]?.status && auditData[d.id].status !== "OK").length} flagged · {devices.length} total
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {state?.message && (
              <p className={clsx("text-sm", state.success ? "text-emerald-300" : "text-red-300")}>
                {state.message}
              </p>
            )}
            {state?.success && <p className="text-sm text-emerald-300">Checklist submitted successfully.</p>}
            <ActionButton type="submit" isPending={isPending} icon={<Send className="size-4" />}>
              Submit Checklist
            </ActionButton>
          </div>
        </div>
      </div>
    </form>
  );
}
