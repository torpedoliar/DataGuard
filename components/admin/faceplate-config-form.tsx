"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeviceFaceplate } from "@/actions/network";
import {
    FACEPLATE_MAX_PORTS,
    FACEPLATE_MAX_UPLINKS,
    type FaceplateConfigInput,
} from "@/lib/faceplate";
import ActionButton from "@/components/ui/action-button";
import { ChevronDown, LayoutPanelTop, Save } from "lucide-react";

const PRESETS = [
    { label: "8 port", portCount: 8, uplinkCount: 0, rows: 1 },
    { label: "16 port", portCount: 16, uplinkCount: 0, rows: 2 },
    { label: "24 + 4 SFP", portCount: 24, uplinkCount: 4, rows: 2 },
    { label: "48 + 4 SFP", portCount: 48, uplinkCount: 4, rows: 2 },
] as const;

export default function FaceplateConfigForm({
    deviceId,
    config,
}: {
    deviceId: number;
    config: FaceplateConfigInput;
}) {
    const router = useRouter();
    const isConfigured = (config.portCount ?? 0) > 0;
    const [isOpen, setIsOpen] = useState(!isConfigured);
    const [isPending, startTransition] = useTransition();
    const [portCount, setPortCount] = useState(String(config.portCount ?? ""));
    const [uplinkCount, setUplinkCount] = useState(String(config.uplinkCount ?? 0));
    const [rows, setRows] = useState(String(config.rows ?? 2));
    const [numbering, setNumbering] = useState(config.numbering ?? "zigzag");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const applyPreset = (preset: (typeof PRESETS)[number]) => {
        setPortCount(String(preset.portCount));
        setUplinkCount(String(preset.uplinkCount));
        setRows(String(preset.rows));
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setSuccess(null);

        const parsedPorts = portCount.trim() === "" ? 0 : Number.parseInt(portCount, 10);
        const parsedUplinks = uplinkCount.trim() === "" ? 0 : Number.parseInt(uplinkCount, 10);

        if (!Number.isInteger(parsedPorts) || parsedPorts < 0 || parsedPorts > FACEPLATE_MAX_PORTS) {
            setError(`Jumlah port harus antara 0 dan ${FACEPLATE_MAX_PORTS}. Isi 0 untuk menonaktifkan faceplate.`);
            return;
        }
        if (!Number.isInteger(parsedUplinks) || parsedUplinks < 0 || parsedUplinks > FACEPLATE_MAX_UPLINKS) {
            setError(`Jumlah uplink harus antara 0 dan ${FACEPLATE_MAX_UPLINKS}.`);
            return;
        }

        startTransition(async () => {
            try {
                await updateDeviceFaceplate(deviceId, {
                    portCount: parsedPorts,
                    uplinkCount: parsedUplinks,
                    rows: Number.parseInt(rows, 10),
                    numbering,
                });
                router.refresh();
                setSuccess(parsedPorts === 0 ? "Faceplate dinonaktifkan." : "Layout faceplate disimpan.");
                setTimeout(() => setSuccess(null), 3000);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal menyimpan layout faceplate.");
            }
        });
    };

    return (
        <div className="ops-panel">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
            >
                <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    <LayoutPanelTop className="h-4 w-4 text-ops-accent" />
                    Faceplate Layout
                    <span className="text-xs font-normal text-ops-muted">
                        {isConfigured
                            ? `${config.portCount} port${(config.uplinkCount ?? 0) > 0 ? ` + ${config.uplinkCount} uplink` : ""}, ${config.rows ?? 2} baris`
                            : "belum diatur"}
                    </span>
                </span>
                <ChevronDown className={`size-4 text-ops-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <form onSubmit={handleSubmit} className="border-t border-ops-border p-5">
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="text-xs text-ops-muted">Preset:</span>
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => applyPreset(preset)}
                                disabled={isPending}
                                className="inline-flex h-7 items-center rounded-md border border-ops-border bg-ops-surface px-2.5 text-xs font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-55"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                            <label htmlFor="faceplate-port-count" className="mb-1.5 block text-xs font-medium text-ops-muted">
                                Jumlah Port
                            </label>
                            <input
                                id="faceplate-port-count"
                                type="number"
                                min={0}
                                max={FACEPLATE_MAX_PORTS}
                                value={portCount}
                                onChange={(event) => setPortCount(event.target.value)}
                                disabled={isPending}
                                placeholder="24"
                                className="ops-input h-9 w-full px-3 text-sm"
                            />
                            <p className="mt-1 text-[11px] text-ops-muted">0 = tanpa faceplate</p>
                        </div>
                        <div>
                            <label htmlFor="faceplate-uplink-count" className="mb-1.5 block text-xs font-medium text-ops-muted">
                                Port Uplink (SFP)
                            </label>
                            <input
                                id="faceplate-uplink-count"
                                type="number"
                                min={0}
                                max={FACEPLATE_MAX_UPLINKS}
                                value={uplinkCount}
                                onChange={(event) => setUplinkCount(event.target.value)}
                                disabled={isPending}
                                className="ops-input h-9 w-full px-3 text-sm"
                            />
                            <p className="mt-1 text-[11px] text-ops-muted">Blok terpisah di sisi kanan</p>
                        </div>
                        <div>
                            <label htmlFor="faceplate-rows" className="mb-1.5 block text-xs font-medium text-ops-muted">
                                Baris
                            </label>
                            <select
                                id="faceplate-rows"
                                value={rows}
                                onChange={(event) => setRows(event.target.value)}
                                disabled={isPending}
                                className="ops-input h-9 w-full px-3 text-sm"
                            >
                                <option value="1">1 baris</option>
                                <option value="2">2 baris</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="faceplate-numbering" className="mb-1.5 block text-xs font-medium text-ops-muted">
                                Urutan Nomor
                            </label>
                            <select
                                id="faceplate-numbering"
                                value={numbering}
                                onChange={(event) => setNumbering(event.target.value)}
                                disabled={isPending}
                                className="ops-input h-9 w-full px-3 text-sm"
                            >
                                <option value="zigzag">Zigzag (ganjil atas, genap bawah)</option>
                                <option value="sequential">Berurutan (baris atas dulu)</option>
                            </select>
                        </div>
                    </div>

                    {error && <p className="mt-4 text-[13px] text-ops-danger">{error}</p>}
                    {success && <p className="mt-4 text-[13px] text-ops-success">{success}</p>}

                    <div className="mt-4 flex justify-end">
                        <ActionButton type="submit" isPending={isPending} icon={<Save className="size-4" />}>
                            Simpan Layout
                        </ActionButton>
                    </div>
                </form>
            )}
        </div>
    );
}
