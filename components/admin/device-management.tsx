"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { getDevices, getCategories } from "@/actions/master-data";
import type { getBrands } from "@/actions/brands";
import type { getLocations } from "@/actions/locations";
import DeviceTable from "./device-table";
import DeviceProfile from "./device-profile";
import EditDeviceForm from "./edit-device-form";
import AddDeviceForm from "./add-device-form";
import { Modal } from "@/components/ui/modal";
import ActionButton from "@/components/ui/action-button";
import { parseDeviceProfileId } from "@/lib/device-profile-url";

export default function DeviceManagement({ devices, categories, brands, locations, canEdit }: {
    devices: Awaited<ReturnType<typeof getDevices>>; categories: Awaited<ReturnType<typeof getCategories>>;
    brands: Awaited<ReturnType<typeof getBrands>>; locations: Awaited<ReturnType<typeof getLocations>>; canEdit: boolean;
}) {
    const router = useRouter(), pathname = usePathname(), search = useSearchParams();
    const raw = search.get("deviceId");
    const selectedId = parseDeviceProfileId(raw);
    const selected = devices.find((d) => d.id === selectedId);
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [revision, setRevision] = useState(0);
    const listPosition = useRef({ y: 0, opener: null as HTMLElement | null });
    const restoreList = useRef(false);
    useEffect(() => {
        if (selectedId !== null || !restoreList.current) return;
        restoreList.current = false;
        const frame = requestAnimationFrame(() => {
            window.scrollTo({ top: listPosition.current.y });
            const target = document.querySelector<HTMLElement>(`[data-device-profile-id="${listPosition.current.opener?.dataset.deviceProfileId ?? ""}"]`);
            (target ?? listPosition.current.opener)?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [selectedId]);
    const [seenDevices, setSeenDevices] = useState(devices);
    if (seenDevices !== devices) {
        setSeenDevices(devices);
        setRevision((value) => value + 1);
    }
    const select = (id: number | null) => {
        if (selectedId === null && id !== null) listPosition.current = { y: window.scrollY, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
        if (id === null) restoreList.current = true;
        const query = new URLSearchParams(search.toString());
        if (id === null) query.delete("deviceId"); else query.set("deviceId", String(id));
        router.push(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
        setEditing(false);
    };
    return <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Device List ({devices.length})</h2>{canEdit && <ActionButton onClick={() => setAdding(true)}>Tambah Device</ActionButton>}</div>
        <div className={selectedId !== null ? "grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]" : ""}>
            <div className={selectedId !== null ? "hidden min-w-0 lg:block" : "min-w-0"}><DeviceTable devices={devices} brands={brands} locations={locations} canConvert={canEdit} selectedId={selectedId} onSelectDevice={(id) => select(id)} /></div>
            {selectedId !== null && <DeviceProfile key={`${selectedId}:${revision}`} deviceId={selectedId} revision={revision} canEdit={canEdit} onClose={() => { select(null); router.refresh(); }} onEdit={() => setEditing(true)} onSelectPeer={(id) => { if (!devices.some((d) => d.id === id)) return false; select(id); return true; }} />}
        </div>
        {editing && selected && canEdit && <EditDeviceForm key={selected.id} device={selected} brands={brands} locations={locations} onClose={() => setEditing(false)} onSaved={() => { setRevision((r) => r + 1); setEditing(false); router.refresh(); }} />}
        <Modal open={adding} title="Tambah Device" onClose={() => setAdding(false)} panelClassName="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-ops-border bg-ops-surface"><AddDeviceForm categories={categories} brands={brands} locations={locations} /></Modal>
    </section>;
}
