"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addPort, bulkAddPorts, downloadPortImportTemplate, importPortsFromXlsx } from "@/actions/network";
import {
    PORT_NAMING_TEMPLATES,
    BULK_PORT_NAMING_TEMPLATES,
    buildPortNameRange,
    formatPortName,
    type PortNamingTemplateId,
} from "@/lib/network-port-naming";
import { Download, Info, Layers, Loader2, Plus, Upload } from "lucide-react";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

function base64ToBlob(base64: string) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    return new Blob([new Uint8Array(byteNumbers)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function downloadXlsx(base64: string, filename: string) {
    const url = window.URL.createObjectURL(base64ToBlob(base64));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);
}

function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? "");
            resolve(result.includes(",") ? result.split(",")[1] : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export default function AddPortForm({
    deviceId,
    vlans,
    otherDevices
}: {
    deviceId: number;
    vlans: Vlan[];
    otherDevices: Device[];
}) {
    const [isPending, startTransition] = useTransition();
    const [isTemplateDownloading, startTemplateDownloadTransition] = useTransition();
    const [isImporting, startImportTransition] = useTransition();
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const [templateId, setTemplateId] = useState<PortNamingTemplateId>("custom");
    const [templateSlot, setTemplateSlot] = useState("1");
    const [templateSubslot, setTemplateSubslot] = useState("0");
    const [templatePort, setTemplatePort] = useState("1");
    const [portName, setPortName] = useState("");
    const [macAddress, setMacAddress] = useState("");
    const [ipAddress, setIpAddress] = useState("");
    const [portMode, setPortMode] = useState("Access");
    const [vlanId, setVlanId] = useState("");
    const [trunkVlans, setTrunkVlans] = useState("");
    const [status, setStatus] = useState("Active");
    const [speed, setSpeed] = useState("1G");
    const [mediaType, setMediaType] = useState("Copper (RJ45)");
    const [connectedToDeviceId, setConnectedToDeviceId] = useState("");
    const [description, setDescription] = useState("");

    const [isBulk, setIsBulk] = useState(false);
    const [portStart, setPortStart] = useState("1");
    const [portEnd, setPortEnd] = useState("24");

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const namingTemplates = isBulk ? BULK_PORT_NAMING_TEMPLATES : PORT_NAMING_TEMPLATES;
    const effectiveTemplateId = isBulk && templateId === "custom" ? "gigabit" : templateId;
    const selectedTemplate = namingTemplates.find((template) => template.id === effectiveTemplateId) ?? namingTemplates[0];
    const templateParams = useMemo(() => ({
        customName: portName,
        slot: templateSlot,
        subslot: templateSubslot,
        port: templatePort,
    }), [portName, templateSlot, templateSubslot, templatePort]);

    const singlePortPreview = useMemo(() => {
        try {
            return formatPortName(effectiveTemplateId, templateParams);
        } catch {
            return "";
        }
    }, [effectiveTemplateId, templateParams]);

    const bulkPortPreview = useMemo(() => {
        const start = Number.parseInt(portStart, 10);
        const end = Number.parseInt(portEnd, 10);
        try {
            const names = buildPortNameRange(effectiveTemplateId, templateParams, start, end);
            return names.length === 1 ? names[0] : `${names[0]} ... ${names[names.length - 1]}`;
        } catch {
            return "";
        }
    }, [effectiveTemplateId, templateParams, portStart, portEnd]);

    const handleDownloadTemplate = () => {
        setError(null);
        setSuccess(null);
        startTemplateDownloadTransition(async () => {
            try {
                const base64 = await downloadPortImportTemplate(deviceId);
                downloadXlsx(base64, `network-port-import-template-device-${deviceId}.xlsx`);
                setSuccess("Template XLSX port berhasil didownload.");
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal download template XLSX.");
            }
        });
    };

    const handleImportFile = (file: File | null) => {
        if (!file) return;
        setError(null);
        setSuccess(null);

        if (!file.name.toLowerCase().endsWith(".xlsx")) {
            setError("File import harus format .xlsx.");
            return;
        }

        startImportTransition(async () => {
            try {
                const base64 = await fileToBase64(file);
                const result = await importPortsFromXlsx(deviceId, base64);
                setSuccess(`${result.imported} ports berhasil diimport.`);
                if (importInputRef.current) importInputRef.current.value = "";
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal import port dari XLSX.");
            }
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        let generatedPortNames: string[];
        try {
            if (isBulk) {
                const start = Number.parseInt(portStart, 10);
                const end = Number.parseInt(portEnd, 10);
                generatedPortNames = buildPortNameRange(effectiveTemplateId, templateParams, start, end);
            } else {
                generatedPortNames = [formatPortName(effectiveTemplateId, templateParams)];
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Invalid port name template.");
            return;
        }

        startTransition(async () => {
            try {
                if (isBulk) {
                    const ports = generatedPortNames.map((generatedPortName) => ({
                        deviceId,
                        portName: generatedPortName,
                        portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                        vlanId: vlanId ? Number.parseInt(vlanId, 10) : null,
                        trunkVlans: trunkVlans || null,
                        status: status as "Active" | "Inactive" | "Down",
                        speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                        mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                        description: description || null,
                    }));

                    await bulkAddPorts(ports);
                    setSuccess(`${ports.length} ports added successfully!`);
                } else {
                    await addPort({
                        deviceId,
                        portName: generatedPortNames[0],
                        macAddress: macAddress || null,
                        ipAddress: ipAddress || null,
                        portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                        vlanId: vlanId ? Number.parseInt(vlanId, 10) : null,
                        trunkVlans: trunkVlans || null,
                        status: status as "Active" | "Inactive" | "Down",
                        speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                        mediaType: mediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                        connectedToDeviceId: connectedToDeviceId ? Number.parseInt(connectedToDeviceId, 10) : null,
                        description: description || null,
                    });
                    setSuccess("Port definition added successfully!");
                }

                setPortName("");
                setMacAddress("");
                setIpAddress("");
                setTrunkVlans("");
                setConnectedToDeviceId("");
                setDescription("");
                setTimeout(() => setSuccess(null), 3000);
            } catch (err: unknown) {
                const error = err as Error;
                setError(error.message || "Failed to add port(s).");
            }
        });
    };

    const busy = isPending || isTemplateDownloading || isImporting;

    return (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-card-dark rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <Plus className="h-5 w-5 text-teal-500" />
                    Provision New Port
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        disabled={busy}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                        {isTemplateDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Download XLSX Template
                    </button>
                    <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer has-[:disabled]:opacity-50 has-[:disabled]:cursor-not-allowed">
                        {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Import XLSX
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".xlsx"
                            className="hidden"
                            disabled={busy}
                            onChange={(event) => handleImportFile(event.target.files?.[0] ?? null)}
                        />
                    </label>
                    <div
                        onClick={() => !busy && setIsBulk(!isBulk)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
                    >
                        <Layers className={`h-4 w-4 ${isBulk ? "text-teal-500" : "text-slate-400"}`} />
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Bulk Mode</span>
                        <div className={`w-8 h-4 rounded-full relative transition-colors ${isBulk ? "bg-teal-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isBulk ? "left-4.5" : "left-0.5"}`} />
                        </div>
                    </div>
                </div>
            </div>

            {isBulk && (
                <div className="mb-6 p-4 bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-900/30 rounded-lg flex gap-3">
                    <Info className="h-5 w-5 text-teal-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-teal-800 dark:text-teal-200">
                        <strong>Bulk Mode Active:</strong> Generates ports from selected naming template and numeric range. MAC, IP, and Topology settings are disabled.
                    </p>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-4 border-b border-slate-200 dark:border-slate-700 pb-6 mb-6">
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Naming Template
                    </label>
                    <select
                        value={effectiveTemplateId}
                        onChange={(e) => setTemplateId(e.target.value as PortNamingTemplateId)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                        disabled={busy}
                    >
                        {namingTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                    </select>
                </div>

                {selectedTemplate.needsSlot && (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Slot</label>
                            <input
                                type="number"
                                value={templateSlot}
                                onChange={(e) => setTemplateSlot(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Subslot</label>
                            <input
                                type="number"
                                value={templateSubslot}
                                onChange={(e) => setTemplateSubslot(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                    </>
                )}

                {!isBulk ? (
                    selectedTemplate.id === "custom" ? (
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Physical Interface
                            </label>
                            <input
                                type="text"
                                value={portName}
                                onChange={(e) => setPortName(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                placeholder="e.g. Gi1/0/1 or eth0"
                                required
                                disabled={busy}
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Port Number
                            </label>
                            <input
                                type="number"
                                value={templatePort}
                                onChange={(e) => setTemplatePort(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                    )
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Start Range</label>
                            <input
                                type="number"
                                value={portStart}
                                onChange={(e) => setPortStart(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">End Range</label>
                            <input
                                type="number"
                                value={portEnd}
                                onChange={(e) => setPortEnd(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                                min="1"
                                required
                                disabled={busy}
                            />
                        </div>
                    </div>
                )}

                {!isBulk && (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                            MAC Address
                        </label>
                        <input
                            type="text"
                            value={macAddress}
                            onChange={(e) => setMacAddress(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white"
                            placeholder="00:1A:2B:3C:4D:5E"
                            disabled={busy}
                        />
                    </div>
                )}
            </div>

            <div className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Preview:</span> {isBulk ? bulkPortPreview || "Complete range/template fields" : singlePortPreview || "Complete interface fields"}
            </div>

            <div className="grid gap-6 md:grid-cols-4 border-b border-slate-200 dark:border-slate-700 pb-6 mb-6">
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Port Speed
                    </label>
                    <select value={speed} onChange={(e) => setSpeed(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" disabled={busy}>
                        {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Media Type
                    </label>
                    <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" disabled={busy}>
                        {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Logical Config
                    </label>
                    <select value={portMode} onChange={(e) => setPortMode(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" disabled={busy}>
                        {["Access", "Trunk", "Routed", "LACP"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Access / Native VLAN
                    </label>
                    <select value={vlanId} onChange={(e) => setVlanId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" disabled={busy}>
                        <option value="">-- No VLAN --</option>
                        {vlans.map(v => <option key={v.id} value={v.id}>{v.vlanId} - {v.name}</option>)}
                    </select>
                </div>
                {portMode === "Trunk" && (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                            Allowed Trunk VLANs
                        </label>
                        <input type="text" value={trunkVlans} onChange={(e) => setTrunkVlans(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" placeholder="e.g. 10,20,100-200" disabled={busy} />
                    </div>
                )}
                {portMode === "Routed" && !isBulk && (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                            IP Address
                        </label>
                        <input type="text" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" placeholder="e.g. 10.0.0.1/30" disabled={busy} />
                    </div>
                )}
            </div>

            <div className={`grid gap-6 ${isBulk ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
                {!isBulk && (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                            Topology / Target Device
                        </label>
                        <select value={connectedToDeviceId} onChange={(e) => setConnectedToDeviceId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" disabled={busy}>
                            <option value="">-- No Connection --</option>
                            {otherDevices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.locationName || "-"})</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Link Status
                    </label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white flex items-center" disabled={busy}>
                        <option value="Active">Active (Up)</option>
                        <option value="Inactive">Inactive (Admin Down)</option>
                        <option value="Down">Down (No Link)</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Description
                    </label>
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white" placeholder="Uplink to Core" disabled={busy} />
                </div>
            </div>

            {error && <p className="mt-4 whitespace-pre-line text-sm text-red-500">{error}</p>}
            {success && <p className="mt-4 text-sm text-green-500">{success}</p>}

            <div className="mt-8 flex justify-end">
                <button type="submit" disabled={busy} className="flex items-center gap-2 bg-teal-600 text-white px-6 py-2 rounded-md hover:bg-teal-700 transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50">
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add Port
                </button>
            </div>
        </form>
    );
}

