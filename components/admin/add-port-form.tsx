"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPort, bulkAddPorts, downloadPortImportTemplate, importPortsFromXlsx } from "@/actions/network";
import {
    PORT_NAMING_TEMPLATES,
    BULK_PORT_NAMING_TEMPLATES,
    buildPortNameRange,
    formatPortName,
    isFiberNamingTemplate,
    type PortNamingTemplateId,
} from "@/lib/network-port-naming";
import { Download, Info, Layers, Loader2, Plus, Upload } from "lucide-react";
import ActionButton from "@/components/ui/action-button";

type Vlan = { id: number; vlanId: number; name: string };
type Device = { id: number; name: string; locationName: string | null };

const fieldClass = "ops-input h-9 w-full px-3 text-sm";
const labelClass = "mb-2 block text-xs font-medium text-ops-muted";

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
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isTemplateDownloading, startTemplateDownloadTransition] = useTransition();
    const [isImporting, startImportTransition] = useTransition();
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const [templateId, setTemplateId] = useState<PortNamingTemplateId>("custom");
    const [templateSlot, setTemplateSlot] = useState("1");
    const [templateSubslot, setTemplateSubslot] = useState("0");
    const [templatePort, setTemplatePort] = useState("1");
    const [portName, setPortName] = useState("");
    const [slotIndex, setSlotIndex] = useState("");
    const [macAddress, setMacAddress] = useState("");
    const [ipAddress, setIpAddress] = useState("");
    const [portMode, setPortMode] = useState("Access");
    const [vlanId, setVlanId] = useState("");
    const [trunkVlans, setTrunkVlans] = useState("");
    const [status, setStatus] = useState("Active");
    const [speed, setSpeed] = useState("1G");
    const [mediaType, setMediaType] = useState("Copper (RJ45)");
    const [mediaTypeTouched, setMediaTypeTouched] = useState(false);
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

    // Bulk fiber-style templates (Te/Fo/Hu) generate uplink interface names;
    // the faceplate routes fiber media into the uplink block, so default to
    // fiber unless the admin picked a media type explicitly.
    const isFiberTemplate = isBulk && isFiberNamingTemplate(effectiveTemplateId);
    const effectiveMediaType = isFiberTemplate && !mediaTypeTouched ? "Fiber (SFP/SFP+)" : mediaType;
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
                    // No portIndex here on purpose: a bulk range is numbered per
                    // block (Te1/0/1-4 are uplinks, not access slots 1-4), so the
                    // faceplate derives the slot from the name and media instead.
                    const ports = generatedPortNames.map((generatedPortName) => ({
                        deviceId,
                        portName: generatedPortName,
                        portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                        vlanId: vlanId ? Number.parseInt(vlanId, 10) : null,
                        trunkVlans: trunkVlans || null,
                        status: status as "Active" | "Inactive" | "Down",
                        speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                        mediaType: effectiveMediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                        description: description || null,
                    }));

                    await bulkAddPorts(ports);
                    setSuccess(`${ports.length} ports added successfully!`);
                } else {
                    await addPort({
                        deviceId,
                        portName: generatedPortNames[0],
                        portIndex: slotIndex.trim() === "" ? null : Number.parseInt(slotIndex, 10),
                        macAddress: macAddress || null,
                        ipAddress: ipAddress || null,
                        portMode: portMode as "Access" | "Trunk" | "Routed" | "LACP",
                        vlanId: vlanId ? Number.parseInt(vlanId, 10) : null,
                        trunkVlans: trunkVlans || null,
                        status: status as "Active" | "Inactive" | "Down",
                        speed: speed as "10/100M" | "1G" | "10G" | "25G" | "40G" | "100G" | "Auto",
                        mediaType: effectiveMediaType as "Copper (RJ45)" | "Fiber (SFP/SFP+)" | "Twinax (DAC)",
                        connectedToDeviceId: connectedToDeviceId ? Number.parseInt(connectedToDeviceId, 10) : null,
                        description: description || null,
                    });
                    setSuccess("Port definition added successfully!");
                }

                router.refresh();
                setPortName("");
                setSlotIndex("");
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
        <form onSubmit={handleSubmit} className="ops-panel p-6">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    <Plus className="size-4 text-ops-accent" />
                    Provision new port
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 text-[13px] font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:pointer-events-none disabled:opacity-55"
                    >
                        {isTemplateDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Download XLSX template
                    </button>
                    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 text-[13px] font-medium text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text has-[:disabled]:pointer-events-none has-[:disabled]:opacity-55">
                        {isImporting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
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
                        onClick={() => {
                            if (busy) return;
                            if (!isBulk) setMediaTypeTouched(false);
                            setIsBulk(!isBulk);
                        }}
                        className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-ops-border bg-ops-surface-raised px-3 transition-colors hover:bg-ops-surface-sunken"
                    >
                        <Layers className={`size-4 ${isBulk ? "text-ops-accent" : "text-ops-muted"}`} />
                        <span className="text-[13px] font-medium text-ops-muted">Bulk mode</span>
                        <div className={`relative h-4 w-8 rounded-full transition-colors ${isBulk ? "bg-ops-accent" : "bg-ops-surface-sunken"}`}>
                            <div className={`absolute top-0.5 size-3 rounded-full bg-ops-status-fg shadow-sm transition-all ${isBulk ? "left-4.5" : "left-0.5"}`} />
                        </div>
                    </div>
                </div>
            </div>

            {isBulk && (
                <div className="mb-6 flex gap-3 rounded-md border border-ops-accent/25 bg-ops-accent-soft px-3 py-2.5">
                    <Info className="mt-0.5 size-4 shrink-0 text-ops-accent" />
                    <p className="text-[13px] text-ops-accent">
                        <strong>Bulk mode active:</strong> Generates ports from selected naming template and numeric range. MAC, IP, and Topology settings are disabled.
                    </p>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-4 border-b border-ops-border pb-6 mb-6">
                <div>
                    <label className={labelClass}>
                        Naming Template
                    </label>
                    <select
                        value={effectiveTemplateId}
                        onChange={(e) => setTemplateId(e.target.value as PortNamingTemplateId)}
                        className={fieldClass}
                        disabled={busy}
                    >
                        {namingTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                    </select>
                </div>

                {selectedTemplate.needsSlot && (
                    <>
                        <div>
                            <label className={labelClass}>Slot</label>
                            <input
                                type="number"
                                value={templateSlot}
                                onChange={(e) => setTemplateSlot(e.target.value)}
                                className={fieldClass}
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Subslot</label>
                            <input
                                type="number"
                                value={templateSubslot}
                                onChange={(e) => setTemplateSubslot(e.target.value)}
                                className={fieldClass}
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
                            <label className={labelClass}>
                                Physical Interface
                            </label>
                            <input
                                type="text"
                                value={portName}
                                onChange={(e) => setPortName(e.target.value)}
                                className={fieldClass}
                                placeholder="e.g. Gi1/0/1 or eth0"
                                required
                                disabled={busy}
                            />
                        </div>
                    ) : (
                        <div>
                            <label className={labelClass}>
                                Port Number
                            </label>
                            <input
                                type="number"
                                value={templatePort}
                                onChange={(e) => setTemplatePort(e.target.value)}
                                className={fieldClass}
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                    )
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Start Range</label>
                            <input
                                type="number"
                                value={portStart}
                                onChange={(e) => setPortStart(e.target.value)}
                                className={fieldClass}
                                min="0"
                                required
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>End Range</label>
                            <input
                                type="number"
                                value={portEnd}
                                onChange={(e) => setPortEnd(e.target.value)}
                                className={fieldClass}
                                min="1"
                                required
                                disabled={busy}
                            />
                        </div>
                    </div>
                )}

                {!isBulk && (
                    <div>
                        <label className={labelClass}>
                            MAC Address
                        </label>
                        <input
                            type="text"
                            value={macAddress}
                            onChange={(e) => setMacAddress(e.target.value)}
                            className={fieldClass}
                            placeholder="00:1A:2B:3C:4D:5E"
                            disabled={busy}
                        />
                    </div>
                )}

                {!isBulk && (
                    <div>
                        <label htmlFor="add-port-slot" className={labelClass}>
                            Slot Faceplate
                        </label>
                        <input
                            id="add-port-slot"
                            type="number"
                            min="1"
                            value={slotIndex}
                            onChange={(e) => setSlotIndex(e.target.value)}
                            className={fieldClass}
                            placeholder="Auto dari nama port"
                            disabled={busy}
                        />
                    </div>
                )}
            </div>

            <div className="mb-6 rounded-md border border-ops-border bg-ops-surface-raised px-3 py-2.5 text-[13px] text-ops-muted">
                <span className="font-medium text-ops-text">Preview:</span> {isBulk ? bulkPortPreview || "Complete range/template fields" : singlePortPreview || "Complete interface fields"}
            </div>

            <div className="grid gap-6 md:grid-cols-4 border-b border-ops-border pb-6 mb-6">
                <div>
                    <label className={labelClass}>
                        Port Speed
                    </label>
                    <select value={speed} onChange={(e) => setSpeed(e.target.value)} className={fieldClass} disabled={busy}>
                        {["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div>
                    <label className={labelClass}>
                        Media Type
                    </label>
                    <select value={effectiveMediaType} onChange={(e) => { setMediaType(e.target.value); setMediaTypeTouched(true); }} className={fieldClass} disabled={busy}>
                        {["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label className={labelClass}>
                        Logical Config
                    </label>
                    <select value={portMode} onChange={(e) => setPortMode(e.target.value)} className={fieldClass} disabled={busy}>
                        {["Access", "Trunk", "Routed", "LACP"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label className={labelClass}>
                        Access / Native VLAN
                    </label>
                    <select value={vlanId} onChange={(e) => setVlanId(e.target.value)} className={fieldClass} disabled={busy}>
                        <option value="">-- No VLAN --</option>
                        {vlans.map(v => <option key={v.id} value={v.id}>{v.vlanId} - {v.name}</option>)}
                    </select>
                </div>
                {portMode === "Trunk" && (
                    <div>
                        <label className={labelClass}>
                            Allowed Trunk VLANs
                        </label>
                        <input type="text" value={trunkVlans} onChange={(e) => setTrunkVlans(e.target.value)} className={fieldClass} placeholder="e.g. 10,20,100-200" disabled={busy} />
                    </div>
                )}
                {portMode === "Routed" && !isBulk && (
                    <div>
                        <label className={labelClass}>
                            IP Address
                        </label>
                        <input type="text" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className={fieldClass} placeholder="e.g. 10.0.0.1/30" disabled={busy} />
                    </div>
                )}
            </div>

            <div className={`grid gap-6 ${isBulk ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
                {!isBulk && (
                    <div>
                        <label className={labelClass}>
                            Topology / Target Device
                        </label>
                        <select value={connectedToDeviceId} onChange={(e) => setConnectedToDeviceId(e.target.value)} className={fieldClass} disabled={busy}>
                            <option value="">-- No Connection --</option>
                            {otherDevices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.locationName || "-"})</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label className={labelClass}>
                        Link Status
                    </label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClass} flex items-center`} disabled={busy}>
                        <option value="Active">Active (Up)</option>
                        <option value="Inactive">Inactive (Admin Down)</option>
                        <option value="Down">Down (No Link)</option>
                    </select>
                </div>
                <div>
                    <label className={labelClass}>
                        Description
                    </label>
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} placeholder="Uplink to Core" disabled={busy} />
                </div>
            </div>

            {error && <p className="mt-4 whitespace-pre-line text-[13px] text-ops-danger">{error}</p>}
            {success && <p className="mt-4 text-[13px] text-ops-success">{success}</p>}

            <div className="mt-8 flex justify-end">
                <ActionButton type="submit" isPending={isPending} disabled={busy} icon={<Plus className="size-4" />}>
                    Add port
                </ActionButton>
            </div>
        </form>
    );
}

