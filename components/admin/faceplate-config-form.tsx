"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeviceFaceplate } from "@/actions/network";
import {
    FACEPLATE_MAX_PORTS,
    FACEPLATE_MAX_UPLINKS,
    type FaceplateConfigInput,
} from "@/lib/faceplate";
import { ChevronDown, LayoutPanelTop, Loader2, Save } from "lucide-react";

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
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface shadow-sm">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
            >
                <span className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <LayoutPanelTop className="h-4 w-4 text-teal-500" />
                    Faceplate Layout
                    <span className="font-normal text-xs text-slate-500 dark:text-slate-400">
                        {isConfigured
                            ? `${config.portCount} port${(config.uplinkCount ?? 0) > 0 ? ` + ${config.uplinkCount} uplink` : ""}, ${config.rows ?? 2} baris`
                            : "belum diatur"}
                    </span>
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <form onSubmit={handleSubmit} className="border-t border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Preset:</span>
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => applyPreset(preset)}
                                disabled={isPending}
                                className="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                            <label htmlFor="faceplate-port-count" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
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
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">0 = tanpa faceplate</p>
                        </div>
                        <div>
                            <label htmlFor="faceplate-uplink-count" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
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
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">Blok terpisah di sisi kanan</p>
                        </div>
                        <div>
                            <label htmlFor="faceplate-rows" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Baris
                            </label>
                            <select
                                id="faceplate-rows"
                                value={rows}
                                onChange={(event) => setRows(event.target.value)}
                                disabled={isPending}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            >
                                <option value="1">1 baris</option>
                                <option value="2">2 baris</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="faceplate-numbering" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Urutan Nomor
                            </label>
                            <select
                                id="faceplate-numbering"
                                value={numbering}
                                onChange={(event) => setNumbering(event.target.value)}
                                disabled={isPending}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            >
                                <option value="zigzag">Zigzag (ganjil atas, genap bawah)</option>
                                <option value="sequential">Berurutan (baris atas dulu)</option>
                            </select>
                        </div>
                    </div>

                    {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
                    {success && <p className="mt-4 text-sm text-green-500">{success}</p>}

                    <div className="mt-4 flex justify-end">
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50"
                        >
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Simpan Layout
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
