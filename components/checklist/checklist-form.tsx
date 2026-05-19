"use client";

import { useActionState, useState } from "react";
import { submitChecklist } from "@/actions/checklist";
import ActionButton from "@/components/ui/action-button";
import { CalendarDays, Clock3, Layers3, Send } from "lucide-react";
import clsx from "clsx";
import FieldAuditCard from "./field-audit-card";

type Category = { id: number; name: string };
type Device = { id: number; name: string; locationName: string | null; categoryId: number };

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
  const filteredDevices = prefillDeviceId ? devices.filter((device) => device.id === prefillDeviceId) : devices;
  const targetCategory = prefillDeviceId ? filteredDevices[0]?.categoryId : categories[0]?.id;
  const [activeTab, setActiveTab] = useState<number | undefined>(targetCategory ?? categories[0]?.id);
  const [state, action, isPending] = useActionState(submitChecklist, undefined);

  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const activeCategory = categories.find((category) => category.id === activeTab);
  const visibleDevices = filteredDevices.filter((device) => device.categoryId === activeTab);

  return (
    <form action={action} className="flex flex-col gap-5" suppressHydrationWarning>
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

      <section className="ops-panel overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-ops-border bg-ops-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-ops-text">Device Categories</h2>
            <p className="text-sm text-ops-muted">{filteredDevices.length} devices available for this audit.</p>
          </div>
          {prefillDeviceId && (
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-accent">
              QR prefilled
            </span>
          )}
        </div>
        <div className="overflow-x-auto p-2">
          <nav className="flex min-w-max gap-1" aria-label="Device categories">
            {categories.map((category) => {
              const count = filteredDevices.filter((device) => device.categoryId === category.id).length;
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
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ops-text">{activeCategory?.name ?? "No Category"}</h2>
            <p className="text-sm text-ops-muted">{visibleDevices.length} visible devices in current category.</p>
          </div>
        </div>

        <div className="space-y-3">
          {visibleDevices.map((device) => (
            <FieldAuditCard key={device.id} device={device} isHighlighted={prefillDeviceId === device.id} />
          ))}

          {visibleDevices.length === 0 && (
            <div className="rounded-md border border-dashed border-ops-border px-5 py-10 text-center">
              <p className="font-semibold text-ops-text">No devices in this category.</p>
              <p className="mt-1 text-sm text-ops-muted">Choose another category or scan a device QR code.</p>
            </div>
          )}
        </div>
      </section>

      <div className="sticky bottom-3 z-20 rounded-md border border-ops-border bg-ops-bg/95 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.32)] backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">Current category</p>
            <p className="text-sm font-semibold text-ops-text">
              {visibleDevices.length} of {filteredDevices.length} devices visible
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
