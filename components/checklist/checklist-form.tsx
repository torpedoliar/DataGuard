"use client";

import { useActionState, useEffect, useMemo, useState, useCallback, useRef, useTransition } from "react";
import { submitChecklist, getAuditEntryByDate } from "@/actions/checklist";
import ActionButton from "@/components/ui/action-button";
import { selectScopeDevices, sortRacksByLayout, type AuditScopeMode } from "@/lib/checklist-scope";
import { CalendarDays, ChevronDown, Clock3, Layers3, Server, Send, Search, Thermometer } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import FieldAuditCard from "./field-audit-card";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number; rackName: string | null; rackPosition: number | null; locationId: number | null };
type Rack = { id: number; name: string; zone: string | null };
export type MeasuredLocation = { id: number; name: string; tempC: number | null; tempThresholdC: number | null };

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
  racks,
  measuredLocations,
  prefillDeviceId,
  existingTodayEntry,
}: {
  categories: Category[];
  devices: Device[];
  racks: Rack[];
  measuredLocations: MeasuredLocation[];
  prefillDeviceId?: number;
  existingTodayEntry?: { id: number; checkDate: string; checkTime: string; shift: string; checker: string } | null;
}) {
  // Scope mode: "category" tab filters the view AND the submit; "rack" adds
  // a rack-walk tab set. "All" submits every device.
  const [scopeMode, setScopeMode] = useState<AuditScopeMode>("category");
  const [activeTab, setActiveTab] = useState<number | undefined>(undefined);
  // Multi-select: each rack tab toggles; the union of selected racks is the
  // submit scope. Empty selection = All.
  const [activeRacks, setActiveRacks] = useState<string[]>([]);
  // <details> element for the rack dropdown — closed after picking "All racks".
  const rackDropdown = useRef<HTMLDetailsElement | null>(null);
  // Room temperature readings (°C) keyed by location id, for rooms the admin
  // configured with a threshold. Submitted with the checklist.
  const [roomTemps, setRoomTemps] = useState<Record<number, string>>({});
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

  // Clear partial audit data upon successful submit
  useEffect(() => {
    if (state?.success) {
      try {
        if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
      } catch { /* skip */ }
    }
  }, [state?.success]);

  // Close rack dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rackDropdown.current && !rackDropdown.current.contains(event.target as Node)) {
        rackDropdown.current.removeAttribute("open");
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const updateDeviceStatus = useCallback((deviceId: number, status: string, remarks?: string) => {
    setAuditData((prev) => {
      const entry = prev[deviceId];
      // Only persist non-OK states or when remarks changed
      if (entry?.status === status && (status !== "OK" || entry.remarks === remarks)) return prev;
      return { ...prev, [deviceId]: { status, remarks: remarks ?? "" } };
    });
  }, []);

  // Finding #62: evidence photos survive tab/scope switches. The selected
  // File is kept in a ref (a type="file" value cannot be restored from state),
  // and the hidden input re-hydrates from it on every mount — so a scope
  // switch that unmounts and remounts the hidden input never loses the file.
  const photoFiles = useRef<Record<number, File | null>>({});
  const photoInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const setDevicePhoto = useCallback((deviceId: number, file: File | null) => {
    photoFiles.current[deviceId] = file;
    const input = photoInputs.current[deviceId];
    if (!input) return;
    try {
      const transfer = new DataTransfer();
      if (file) transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Unsupported browser: remounting the input re-hydrates from the ref,
      // but an in-DOM input without DataTransfer support just keeps the file
      // the user picked in the currently-mounted card.
    }
  }, []);

  const handleCardPhotoChange = useCallback((deviceId: number) => (file: File | null) => {
    setDevicePhoto(deviceId, file);
  }, [setDevicePhoto]);

  // Submit scope = the active tab (category or rack); "All" submits every
  // device. Scope devices are also rendered as the hidden inputs, so only
  // in-scope devices reach the server. Rack mode orders devices the way the
  // DC is walked (zone → rack → U position).
  const scopedDevices = useMemo(
    () => selectScopeDevices(devices, racks, scopeMode, { categoryId: activeTab, rackNames: activeRacks }),
    [devices, racks, scopeMode, activeTab, activeRacks],
  );
  const visibleDevices = useMemo(() => {
    if (!filter) return scopedDevices;
    return scopedDevices.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));
  }, [scopedDevices, filter]);

  const sortedRacks = useMemo(() => sortRacksByLayout(racks), [racks]);
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const [checkDate, setCheckDate] = useState(today);
  const [existingDateEntry, setExistingDateEntry] = useState(existingTodayEntry);
  const [, startCheckDateTransition] = useTransition();

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setCheckDate(newDate);
    if (!newDate) {
      setExistingDateEntry(null);
      return;
    }
    startCheckDateTransition(async () => {
      const entry = await getAuditEntryByDate(newDate);
      setExistingDateEntry(entry);
    });
  };

  const activeCategory = scopeMode === "category" && activeTab ? categories.find((c) => c.id === activeTab) : null;
  const hasDevices = devices.length > 0;

  return (
    <form action={action} className="flex flex-col gap-5" suppressHydrationWarning>
      {existingDateEntry && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-100">
                Audit tanggal ({existingDateEntry.checkDate}) sudah tercatat oleh <span className="underline">{existingDateEntry.checker}</span> ({existingDateEntry.checkTime}, Shift {existingDateEntry.shift}).
              </p>
              <p className="mt-1 text-xs text-amber-200/80">
                Submisi perangkat di bawah akan otomatis memperbarui audit tanggal ini tanpa menghasilkan auditor ganda.
              </p>
            </div>
            <Link
              href={`/report/edit/${existingDateEntry.id}`}
              className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-400/50 bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-400/30 transition-colors"
            >
              Edit Form Audit ({existingDateEntry.checkDate})
            </Link>
          </div>
        </div>
      )}

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
              <input
                type="date"
                name="checkDate"
                value={checkDate}
                onChange={handleDateChange}
                required
                className={clsx(fieldClass, "pl-9")}
              />
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

        {/* Room temperature inputs — for rooms the admin configured with a
            threshold. Optional per reading; readings above threshold+3 are
            flagged server-side as a NOT-OK item ("Ruangan <name>") that joins
            the normal alert/incident flow. */}
        {measuredLocations.length > 0 && (
          <div className="border-t border-ops-border p-5">
            <div className="mb-3 flex items-center gap-2">
              <Thermometer className="size-4 text-ops-accent" />
              <h3 className="text-sm font-bold text-ops-text">Suhu Ruangan (°C)</h3>
              <span className="text-xs text-ops-muted">— opsional; batas normal tiap ruang di tanda kurung</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {measuredLocations.map((location) => {
                const value = roomTemps[location.id] ?? "";
                const threshold = location.tempThresholdC ?? 27;
                const overThreshold = value !== "" && Number(value) > threshold;
                const overIncident = value !== "" && Number(value) > threshold + 3;
                return (
                  <label key={location.id} className="block">
                    <span className="mb-1 block truncate text-xs font-semibold text-ops-muted" title={location.name}>
                      {location.name} <span className="font-normal opacity-70">(≤ {threshold}°C)</span>
                    </span>
                    <div className="relative">
                      <Thermometer className={clsx(
                        "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2",
                        overIncident ? "text-red-400" : overThreshold ? "text-amber-400" : "text-ops-muted",
                      )} />
                      <input
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        name={`roomTemp-${location.id}`}
                        value={value}
                        onChange={(event) =>
                          setRoomTemps((prev) => ({ ...prev, [location.id]: event.target.value }))
                        }
                        placeholder="—"
                        className={clsx(
                          fieldClass,
                          "pl-9 pr-8",
                          overIncident && "border-red-400/60 ring-1 ring-red-400/40",
                          overThreshold && !overIncident && "border-amber-400/60",
                        )}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ops-muted">°C</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Scope tabs — the active tab defines WHICH devices get submitted.
          Category mode filters by device category; Rack mode walks racks in
          layout order (zone → name) and U position within a rack. */}
      {/* No overflow-hidden here: the By Rack dropdown opens downward and
          would otherwise be clipped by the panel. The header advertises its
          own rounded top corner in place of the panel clip. */}
      <section className="ops-panel">
        <div className="rounded-t-[16px] border-b border-ops-border bg-ops-surface px-5 py-4">
          <h2 className="text-base font-bold text-ops-text">Audit Scope</h2>
          <p className="mt-1 text-sm text-ops-muted">
            Only devices in the active tab are submitted. &quot;All&quot; submits every device.
          </p>
        </div>
        {/* Mode switch */}
        <div className="flex gap-2 border-b border-ops-border px-5 py-3">
          {(["category", "rack"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setScopeMode(mode);
                setActiveTab(undefined);
                if (mode === "rack" && sortedRacks.length > 0) {
                  setActiveRacks([sortedRacks[0].name]);
                } else {
                  setActiveRacks([]);
                }
              }}
              className={clsx(
                "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors",
                scopeMode === mode
                  ? "bg-ops-accent/15 text-ops-accent ring-1 ring-ops-accent/40"
                  : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
              )}
            >
              {mode === "category" ? <Layers3 className="size-4" /> : <Server className="size-4" />}
              {mode === "category" ? "By Category" : "By Rack"}
            </button>
          ))}
        </div>
        {scopeMode === "category" ? (
          <div className="overflow-x-auto p-2">
            <nav className="flex min-w-max gap-1" aria-label="Device categories">
              <button
                type="button"
                onClick={() => setActiveTab(undefined)}
                className={clsx(
                  "flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors",
                  activeTab === undefined
                    ? "bg-ops-accent text-slate-950"
                    : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
                )}
              >
                All
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    activeTab === undefined ? "bg-slate-950/12 text-slate-950" : "bg-ops-bg text-ops-muted",
                  )}
                >
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
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        active ? "bg-slate-950/12 text-slate-950" : "bg-ops-bg text-ops-muted",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        ) : (
          <div className="relative px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <details ref={rackDropdown} className="group relative w-full max-w-md">
                <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-ops-border bg-ops-surface-raised px-3 text-sm font-semibold text-ops-text hover:border-ops-accent/50 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 items-center gap-2">
                    <Server className="size-4 shrink-0 text-ops-accent" />
                    <span className="truncate">
                      {activeRacks.length === 0
                        ? `All racks (${devices.length} devices)`
                        : activeRacks.length === 1
                          ? `${activeRacks[0]} (${devices.filter((d) => (d.rackName ?? "").toLowerCase() === activeRacks[0].toLowerCase()).length} devices)`
                          : `${activeRacks.length} racks selected`}
                    </span>
                  </div>
                  <ChevronDown className="size-4 shrink-0 text-ops-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 overflow-y-auto rounded-md border border-ops-border bg-ops-surface shadow-[0_16px_48px_rgba(0,0,0,0.5)] divide-y divide-ops-border/40">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRacks([]);
                      rackDropdown.current?.removeAttribute("open");
                    }}
                    className={clsx(
                      "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                      activeRacks.length === 0
                        ? "bg-ops-accent/15 text-ops-accent font-bold"
                        : "text-ops-muted hover:bg-ops-surface-raised hover:text-ops-text",
                    )}
                  >
                    <span>All racks</span>
                    <span className="rounded-full bg-ops-bg px-2 py-0.5 text-[11px] font-mono">{devices.length}</span>
                  </button>
                  <div className="p-1 space-y-0.5">
                    {sortedRacks.map((rack) => {
                      const count = devices.filter(
                        (d) => (d.rackName ?? "").toLowerCase() === rack.name.toLowerCase(),
                      ).length;
                      const active = activeRacks.includes(rack.name);
                      return (
                        <button
                          key={rack.id}
                          type="button"
                          onClick={() =>
                            setActiveRacks((prev) =>
                              prev.includes(rack.name)
                                ? prev.filter((name) => name !== rack.name)
                                : [...prev, rack.name],
                            )
                          }
                          className={clsx(
                            "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-ops-accent/15 text-ops-accent font-semibold"
                              : "text-ops-text hover:bg-ops-surface-raised",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={active}
                              readOnly
                              className="size-4 rounded border-ops-border accent-[#5eead4] pointer-events-none"
                              tabIndex={-1}
                            />
                            <span className="truncate">{rack.name}</span>
                            {rack.zone && (
                              <span className="shrink-0 rounded bg-ops-bg px-1.5 py-0.5 text-[10px] font-semibold text-ops-muted">
                                {rack.zone}
                              </span>
                            )}
                          </span>
                          <span className="rounded-full bg-ops-bg px-2 py-0.5 text-[11px] font-mono text-ops-muted">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {sortedRacks.length === 0 && (
                    <p className="px-3 py-3 text-sm text-ops-muted">No racks defined for this site.</p>
                  )}
                </div>
              </details>

              {activeRacks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveRacks([])}
                  className="rounded-md border border-ops-border bg-ops-surface-raised px-2.5 py-1.5 text-xs font-semibold text-ops-muted hover:border-ops-accent/50 hover:text-ops-accent transition-colors"
                >
                  Reset ({activeRacks.length} selected)
                </button>
              )}
            </div>
          </div>
        )}
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

      {/* Device list — visible cards render for the filtered scope; the hidden
          block renders the full submit scope (search filter does not shrink it) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ops-text">
            {activeCategory?.name
              ?? (activeRacks.length === 1 ? activeRacks[0] : null)
              ?? (activeRacks.length > 1 ? `${activeRacks.length} racks` : null)
              ?? "All Devices"}
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
              <p className="font-semibold text-ops-text">
                {filter ? "No devices match your filter." : "No devices in this scope."}
              </p>
              <p className="mt-1 text-sm text-ops-muted">
                {filter ? "Try changing the search term." : 'Try another tab, or use "All".'}
              </p>
            </div>
          )}
        </div>

        {/* Hidden inputs for the SUBMIT SCOPE only (the active tab's devices).
            Out-of-scope devices are never sent, so a partial audit submits
            only what was audited. Search filter does NOT shrink scope — those
            inputs stay so a filtered-out device is still submitted. */}
        <div className="hidden" aria-hidden="true">
          {scopedDevices.map((device) => {
            const stored = auditData[device.id];
            return (
              <div key={`hidden-${device.id}`}>
                <input type="hidden" name="deviceId" value={device.id} />
                <input type="hidden" name={`status-${device.id}`} value={stored?.status || "OK"} />
                <input type="hidden" name={`remarks-${device.id}`} value={stored?.remarks || ""} />
                {/* Finding #62: live file input (not type=hidden — file inputs
                    cannot be submitted hidden) that mirrors the selected photo
                    from the ref, so evidence survives scope switches (the
                    input unmounts/remounts). Gated on NOT OK like the visible
                    card so OK devices never submit photos. */}
                {stored?.status === "NOT OK" && (
                  <input
                    type="file"
                    name={`photo-${device.id}`}
                    accept="image/*"
                    className="hidden"
                    ref={(el) => {
                      photoInputs.current[device.id] = el;
                      // Re-hydrate: type="file" values cannot survive a
                      // remount from markup, so re-assign from the ref.
                      if (el && photoFiles.current[device.id]) {
                        try {
                          const transfer = new DataTransfer();
                          transfer.items.add(photoFiles.current[device.id]!);
                          el.files = transfer.files;
                        } catch { /* no DataTransfer support: skip */ }
                      }
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
              {scopedDevices.filter(d => auditData[d.id]?.status === "NOT OK").length} flagged · {scopedDevices.length} in scope
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {state?.message && (
              <p className={clsx("text-sm", state.success ? "text-emerald-300" : "text-red-300")}>
                {state.message}
              </p>
            )}
            {state?.success && <p className="text-sm text-emerald-300">Checklist submitted successfully.</p>}
            <ActionButton
              type="submit"
              isPending={isPending}
              disabled={!hasDevices || scopedDevices.length === 0}
              icon={<Send className="size-4" />}
            >
              Submit {scopedDevices.length} Devices ({
                scopeMode === "category"
                  ? (activeCategory?.name ?? "All Categories")
                  : (activeRacks.length === 1 ? `Rack: ${activeRacks[0]}` : activeRacks.length > 1 ? `${activeRacks.length} Racks` : "All Racks")
              })
            </ActionButton>
          </div>
        </div>
      </div>
    </form>
  );
}
