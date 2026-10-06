"use client";

import { useEffect, useRef, useState } from "react";
import { facilityLabel, facilityDimensions } from "@/lib/facility-asset";
import { getDeviceProfile } from "@/actions/device-profile";
import { useDeviceDrawer, AuditSection, IncidentsSection, SiemSection, ConnectionsSection } from "./device-drawer-sections";
import DeviceNetworkSummary from "./device-network-summary";
import DeviceHealthTrend from "./device-health-trend";
import DeviceLocationPreview from "./device-location-preview";
import ActionButton from "@/components/ui/action-button";
import PrintQRModal from "./print-qr-modal";
import DeleteDeviceModal from "./delete-device-modal";
import PhotoModal from "@/components/report/photo-modal";
import dynamic from "next/dynamic";
const DevicePreview = dynamic(() => import("@/components/rack3d/device-preview"), { ssr: false });
type Profile = NonNullable<Awaited<ReturnType<typeof getDeviceProfile>>>;

export default function DeviceProfile({ deviceId, revision, canEdit, onClose, onEdit, onSelectPeer, suppliedProfile, suppliedDrawer, suppliedNetwork }: { deviceId: number; revision: number; canEdit: boolean; onClose: () => void; onEdit: () => void; onSelectPeer: (id: number) => boolean; suppliedProfile?: Profile; suppliedDrawer?: Parameters<typeof useDeviceDrawer>[1]; suppliedNetwork?: React.ComponentProps<typeof DeviceNetworkSummary>["supplied"] }) {
    const [loaded, setLoaded] = useState<{ id: number; revision: number; data: Profile | null; error: boolean } | null>(null);
    const [qr, setQr] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [remote, setRemote] = useState(false);
    const [remotePort, setRemotePort] = useState("");
    const [retry, setRetry] = useState(0);
    const [location3d, setLocation3d] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [photo, setPhoto] = useState<string | null>(null);
    const [copyMessage, setCopyMessage] = useState("");
    const heading = useRef<HTMLHeadingElement>(null);
    const drawer = useDeviceDrawer(deviceId, suppliedDrawer);
    useEffect(() => { if (loaded?.data) heading.current?.focus({ preventScroll: true }); }, [loaded]);
    useEffect(() => {
        if (suppliedProfile) return;
        let alive = true;
        getDeviceProfile(deviceId).then((data) => { if (alive) setLoaded({ id: deviceId, revision, data, error: data === null }); }).catch(() => { if (alive) setLoaded({ id: deviceId, revision, data: null, error: true }); });
        return () => { alive = false; };
    }, [deviceId, revision, suppliedProfile, retry]);
    const profile = suppliedProfile ?? (loaded?.id === deviceId && loaded.revision === revision ? loaded.data : null);
    if (!profile) return <section className="rounded border border-ops-border p-5"><ActionButton variant="secondary" onClick={onClose}>Kembali</ActionButton>{loaded?.error && <ActionButton variant="secondary" onClick={() => { setLoaded(null); setRetry((value) => value + 1); }}>Coba Lagi</ActionButton>}<p role="status" className="mt-3">{loaded?.id === deviceId && loaded.error ? "Profil tidak tersedia atau gagal dimuat." : "Memuat profil…"}</p></section>;
    const d = profile.device;
    return <article className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-ops-accent">DEVICE PROFILE</p><h2 ref={heading} tabIndex={-1} className="text-xl font-bold text-ops-text">{d.name}</h2><p className="text-xs text-ops-muted">{d.categoryName} {d.isCritical ? "· Critical" : ""} · {d.ipAddress ?? "IP belum didokumentasikan"}</p></div><div className="flex flex-wrap gap-2">{canEdit && <ActionButton size="sm" onClick={onEdit}>Edit</ActionButton>}<ActionButton size="sm" variant="secondary" href={`/admin/devices/${d.id}/network`}>Network Docs</ActionButton><ActionButton size="sm" variant="secondary" onClick={() => setQr(true)}>QR</ActionButton>{d.ipAddress && <ActionButton size="sm" variant="secondary" onClick={() => setRemote(!remote)}>Remote</ActionButton>}<ActionButton size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopyMessage("Link disalin"); } catch { setCopyMessage("Gagal menyalin link"); } }}>Copy Link</ActionButton><ActionButton size="sm" variant="secondary" onClick={onClose}>Tutup</ActionButton></div></header>
        {remote && d.ipAddress && <div className="flex flex-wrap gap-2 rounded border border-ops-border p-3"><label className="text-xs">Port opsional<input aria-label="Remote port" type="number" min={1} max={65535} className="ops-input ml-2 w-24 p-2" value={remotePort} onChange={(event) => setRemotePort(event.target.value)} /></label>{["http", "https", "ssh", "telnet"].map((protocol) => <ActionButton key={protocol} size="sm" variant="secondary" disabled={!!remotePort && (!/^[1-9]\d*$/.test(remotePort) || Number(remotePort) > 65535)} href={`${protocol}://${d.ipAddress}${remotePort ? `:${remotePort}` : ""}`} target={protocol.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{protocol.toUpperCase()}</ActionButton>)}</div>}
        {copyMessage && <p role="status" className="text-xs">{copyMessage}</p>}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_minmax(0,1.3fr)]">
            <section className="rounded-lg border border-ops-border bg-ops-surface p-4 space-y-3"><h3 className="font-semibold">Identitas</h3>{d.photoPath ? <button type="button" aria-label="Perbesar foto device" onClick={() => setPhoto(d.photoPath)} className="block w-full">{/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.photoPath} alt={d.name} className="h-44 w-full rounded object-contain" /></button> : profile.visualDevice && !location3d ? <DevicePreview device={profile.visualDevice} /> : <p className="text-xs text-ops-muted">{location3d ? "Preview model dihentikan saat location 3D aktif." : "Belum ada foto/model terdokumentasi."}</p>}
            <dl className="space-y-2 text-sm">{[["Asset code", d.assetCode], ["Brand", d.brandName], ["Category", d.categoryName], ["Location", d.locationName], ["IP", d.ipAddress], ["PIC", drawer.loading ? "Memuat…" : drawer.error ? "Gagal memuat" : drawer.data?.picGroups.map((g) => g.name).join(", ")], ["Keterangan", d.description]].map(([label, value]) => <div key={label}><dt className="text-xs text-ops-muted">{label}</dt><dd className="break-words">{value || "-"}</dd></div>)}</dl>{d.assetType !== "standard" && <div className="space-y-1 border-t border-ops-border pt-3 text-xs"><p>{facilityLabel(d.assetType, d.facilitySpecs)}</p><p>Model: {d.facilitySpecs?.model ?? "Belum diketahui"}</p><p>Serial: {d.facilitySpecs?.serialNumber ?? "Belum diketahui"}</p><p>W/D/H (m): {facilityDimensions(d).width} / {facilityDimensions(d).depth} / {facilityDimensions(d).height}</p>{d.facilitySpecs?.subtype === "floor-standing" && <p>{d.facilitySpecs.capacityKva ?? "?"} kVA / {d.facilitySpecs.ratedKw ?? "?"} kW</p>}</div>}</section>
            <DeviceLocationPreview profile={profile} onViewChange={(view) => setLocation3d(view === "3d")} />
            <section className="rounded-lg border border-ops-border bg-ops-surface p-4">{profile.visualDevice ? <DeviceNetworkSummary device={profile.visualDevice} expanded supplied={suppliedNetwork} /> : <p className="text-sm"><a className="text-ops-accent underline" href={`/admin/devices/${d.id}/network`}>Buka dokumentasi network</a></p>}{drawer.data && <ConnectionsSection drawer={drawer.data} onSelectPeer={onSelectPeer} unavailablePeer={() => setCopyMessage("Peer tidak tersedia pada site aktif atau tidak dapat diakses.")} />}</section>
        </div>
        <details className="rounded-lg border border-ops-border bg-ops-surface p-4" onToggle={(event) => setHistoryOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Riwayat Audit / Incident / SIEM</summary>{historyOpen && <DeviceHealthTrend key={`${deviceId}:${revision}`} deviceId={deviceId} />}{drawer.loading ? <p>Memuat riwayat…</p> : drawer.error ? <p role="alert">Gagal memuat riwayat.</p> : drawer.data && <><AuditSection drawer={drawer.data} onPhoto={setPhoto} /><IncidentsSection drawer={drawer.data} /><SiemSection drawer={drawer.data} /></>}</details>
        {canEdit && <ActionButton size="sm" variant="danger" onClick={() => setDeleting(true)}>Hapus Device</ActionButton>}
        {deleting && <DeleteDeviceModal deviceId={d.id} deviceName={d.name} onClose={() => setDeleting(false)} onSuccess={onClose} />}
        {qr && <PrintQRModal deviceId={d.id} deviceName={d.name} onClose={() => setQr(false)} />}{photo && <PhotoModal photoPath={photo} deviceName={d.name} onClose={() => setPhoto(null)} />}
    </article>;
}
