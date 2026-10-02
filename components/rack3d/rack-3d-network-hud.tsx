"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Loader2,
  Network,
  Server,
  Settings2,
  Unlink,
  X,
  Zap,
} from "lucide-react";
import type { RackDevice } from "@/actions/rack-layout";
import { getPortsByDevice, getVlans, updatePort } from "@/actions/network";
import { getDevices } from "@/actions/master-data";
import {
  buildFaceplate,
  faceplateSlotColors,
  type FaceplateConfigInput,
} from "@/lib/faceplate";

type PortRow = Awaited<ReturnType<typeof getPortsByDevice>>[number];
type VlanRow = Awaited<ReturnType<typeof getVlans>>[number];
type DeviceOption = Awaited<ReturnType<typeof getDevices>>[number];

interface Rack3DNetworkHudProps {
  device: RackDevice;
  onClose: () => void;
  onSelectPeer?: (deviceId: number) => void;
}

/**
 * Game-style 3D Network Documentation HUD.
 * Shows faceplate of Device A (Port A in GREEN) alongside peer Device B (Port B in CYAN),
 * and provides tactical topology link/unlink configuration directly in 3D mode.
 */
export function Rack3DNetworkHud({
  device,
  onClose,
  onSelectPeer,
}: Rack3DNetworkHudProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Port lists
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [selectedPortId, setSelectedPortId] = useState<number | null>(null);

  // Peer ports list
  const [rawPeerPorts, setRawPeerPorts] = useState<PortRow[]>([]);
  const [fetchedPeerDevId, setFetchedPeerDevId] = useState<string>("");

  // Reference data for topology config
  const [allDevices, setAllDevices] = useState<DeviceOption[]>([]);
  const [vlans, setVlans] = useState<VlanRow[]>([]);

  // Form states for Topology Config
  const [targetDeviceId, setTargetDeviceId] = useState<string>("");
  const [targetPortId, setTargetPortId] = useState<string>("");
  const [targetPortMode, setTargetPortMode] = useState<string>("Access");
  const [targetVlanId, setTargetVlanId] = useState<string>("");
  const [targetStatus, setTargetStatus] = useState<string>("Active");
  const [targetDescription, setTargetDescription] = useState<string>("");

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Load device ports
  useEffect(() => {
    let alive = true;
    getPortsByDevice(device.id)
      .then((data) => {
        if (!alive) return;
        setPorts(data);
        if (data.length > 0) {
          const firstConn = data.find((p) => p.connectedToDeviceId != null);
          setSelectedPortId((prev) => prev ?? (firstConn ? firstConn.id : data[0].id));
        }
      })
      .catch(() => {
        if (!alive) return;
        // Fallback to device.ports
        const fallback = (device.ports || []).map((p) => ({
          ...p,
          deviceId: device.id,
          macAddress: null,
          ipAddress: null,
          vlanId: null,
          vlanName: null,
          vlanNumber: null,
          trunkVlans: null,
          speed: null,
          connectedToDeviceName: null,
          connectedToPortName: "",
          description: null,
        })) as unknown as PortRow[];
        setPorts(fallback);
        if (fallback.length > 0) setSelectedPortId((prev) => prev ?? fallback[0].id);
      });

    return () => {
      alive = false;
    };
  }, [device.id, device.ports]);

  // Load devices and VLANs once for topology assignment
  useEffect(() => {
    let alive = true;
    Promise.all([getDevices(), getVlans()])
      .then(([devs, vls]) => {
        if (!alive) return;
        setAllDevices(devs);
        setVlans(vls);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const activePort = useMemo(
    () => ports.find((p) => p.id === selectedPortId) ?? ports[0] ?? null,
    [ports, selectedPortId],
  );

  // Render-phase sync when activePort changes
  const [prevActivePortId, setPrevActivePortId] = useState<number | null>(null);
  if (activePort && activePort.id !== prevActivePortId) {
    setPrevActivePortId(activePort.id);
    setTargetDeviceId(activePort.connectedToDeviceId ? String(activePort.connectedToDeviceId) : "");
    setTargetPortId(activePort.connectedToPortId ? String(activePort.connectedToPortId) : "");
    setTargetPortMode(activePort.portMode || "Access");
    setTargetVlanId(activePort.vlanId ? String(activePort.vlanId) : "");
    setTargetStatus(activePort.status || "Active");
    setTargetDescription(activePort.description || "");
    setFeedback(null);
  }

  // Derive peerDevice directly from targetDeviceId
  const peerDevice = useMemo(
    () => (targetDeviceId ? allDevices.find((d) => String(d.id) === targetDeviceId) ?? null : null),
    [targetDeviceId, allDevices],
  );

  // Fetch target device ports when targetDeviceId changes
  useEffect(() => {
    if (!targetDeviceId) return;

    let alive = true;
    getPortsByDevice(Number(targetDeviceId))
      .then((pList) => {
        if (!alive) return;
        setRawPeerPorts(pList);
        setFetchedPeerDevId(targetDeviceId);
      })
      .catch(() => {
        if (!alive) return;
        setRawPeerPorts([]);
        setFetchedPeerDevId(targetDeviceId);
      });

    return () => {
      alive = false;
    };
  }, [targetDeviceId]);

  const isPeerLoading = targetDeviceId !== "" && fetchedPeerDevId !== targetDeviceId;
  const peerPorts = useMemo(
    () => (targetDeviceId ? rawPeerPorts : []),
    [targetDeviceId, rawPeerPorts],
  );

  // Save topology configuration
  const handleSaveTopology = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePort) return;

    setFeedback(null);
    startTransition(async () => {
      try {
        const destDevId = targetDeviceId ? Number(targetDeviceId) : null;
        const destPortId = targetPortId ? Number(targetPortId) : null;
        const vId = targetVlanId ? Number(targetVlanId) : null;

        await updatePort(activePort.id, {
          deviceId: device.id,
          portMode: targetPortMode as "Access" | "Trunk" | "Routed" | "LACP",
          vlanId: vId,
          status: targetStatus as "Active" | "Inactive" | "Down",
          connectedToDeviceId: destDevId,
          connectedToPortId: destPortId,
          description: targetDescription || null,
        });

        // Refresh active device ports
        const updated = await getPortsByDevice(device.id);
        setPorts(updated);
        setFeedback({
          type: "success",
          message: `Koneksi topology ${activePort.portName} berhasil disimpan!`,
        });
        router.refresh();
      } catch (err: unknown) {
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : "Gagal menyimpan topology.",
        });
      }
    });
  };

  // Disconnect / Unlink topology
  const handleUnlink = async () => {
    if (!activePort) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        await updatePort(activePort.id, {
          deviceId: device.id,
          connectedToDeviceId: null,
          connectedToPortId: null,
        });

        const updated = await getPortsByDevice(device.id);
        setPorts(updated);
        setTargetDeviceId("");
        setTargetPortId("");
        setFeedback({
          type: "success",
          message: `Koneksi port ${activePort.portName} berhasil diputus.`,
        });
        router.refresh();
      } catch (err: unknown) {
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : "Gagal memutuskan koneksi.",
        });
      }
    });
  };

  // Device A Faceplate config
  const faceplateConfigA: FaceplateConfigInput = useMemo(
    () => ({
      portCount: device.faceplatePortCount,
      uplinkCount: device.faceplateUplinkCount,
      rows: device.faceplateRows,
      numbering: device.faceplateNumbering,
    }),
    [device],
  );

  const plateA = useMemo(
    () =>
      (device.faceplatePortCount ?? 0) > 0
        ? buildFaceplate<PortRow>(faceplateConfigA, ports)
        : null,
    [faceplateConfigA, ports, device.faceplatePortCount],
  );

  const plateB = useMemo(() => {
    if (!peerDevice) return null;
    const count = peerPorts.length > 0 ? peerPorts.length : 24;
    return buildFaceplate<PortRow>(
      { portCount: Math.min(count, 48), rows: 2, numbering: "zigzag" },
      peerPorts,
    );
  }, [peerDevice, peerPorts]);

  const stats = useMemo(() => {
    const total = ports.length;
    const active = ports.filter((p) => p.status === "Active").length;
    const trunk = ports.filter((p) => p.portMode === "Trunk").length;
    const connected = ports.filter((p) => p.connectedToDeviceId != null).length;
    return { total, active, trunk, connected };
  }, [ports]);

  const connectedTargetPort = peerPorts.find((p) => String(p.id) === targetPortId);

  return (
    <div className="absolute inset-x-2 sm:inset-x-4 top-14 bottom-4 z-30 flex flex-col rounded-2xl border border-cyan-500/40 bg-slate-950/92 shadow-[0_0_50px_rgba(6,182,212,0.25)] backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* ── TOP HUD SCI-FI HEADER ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/30 bg-gradient-to-r from-cyan-950/60 via-slate-900/80 to-slate-950/90 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
            <Network className="size-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-cyan-400 uppercase">
                ◈ TACTICAL NETWORK DOCUMENTATION // 3D HUD ◈
              </span>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-semibold text-emerald-400 border border-emerald-500/40">
                LIVE INTERFACE
              </span>
            </div>
            <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              <span>{device.name}</span>
              {device.ipAddress && (
                <span className="font-mono text-xs text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                  {device.ipAddress}
                </span>
              )}
            </h2>
          </div>
        </div>

        {/* Device Badges & Close Button */}
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 font-mono text-xs text-slate-300 bg-slate-900/80 border border-slate-700/60 px-3 py-1 rounded-lg">
            <span>Rack: <strong className="text-white">{device.rackName || "-"}</strong> (U{device.rackPosition})</span>
            <span>·</span>
            <span>{device.brandName || "Generic"}</span>
            <span>·</span>
            <span className="text-emerald-400">{stats.connected}/{stats.total} Linked</span>
          </div>

          <Link
            href={`/admin/devices/${device.id}/network`}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            title="Buka Halaman Dokumentasi Jaringan Penuh"
          >
            <span>Full Docs</span>
            <ExternalLink className="size-3.5" />
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup 3D Network HUD"
            className="flex size-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 text-slate-300 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* ── SCROLLABLE HUD BODY ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* BANNER NOTIFIKASI */}
        {feedback && (
          <div
            className={`rounded-lg border p-3 text-xs flex items-center justify-between font-mono animate-in slide-in-from-top-2 ${
              feedback.type === "success"
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                : "border-red-400/40 bg-red-500/15 text-red-300"
            }`}
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-400" />
              {feedback.message}
            </span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── SECTION 1: SIDE-BY-SIDE 3D FACEPLATES (PERANGKAT A & PERANGKAT B) ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* BOX PERANGKAT A (ORIGIN) */}
          <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-3.5 shadow-lg shadow-emerald-500/5 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <Server className="size-3.5" />
                  <span>PERANGKAT A: {device.name}</span>
                </h3>
              </div>
              <span className="font-mono text-[11px] text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded">
                Port Terpilih: <b>{activePort?.portName || `Slot ${activePort?.portIndex || 1}`}</b> (Hijau)
              </span>
            </div>

            {/* Faceplate Diagram Perangkat A */}
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5">
              {plateA ? (
                <svg
                  viewBox={`0 0 ${plateA.width} ${plateA.height}`}
                  className="w-full h-auto min-w-[320px]"
                  role="img"
                  aria-label="Faceplate Perangkat A"
                >
                  <rect
                    width={plateA.width}
                    height={plateA.height}
                    rx={3}
                    fill="#0a0f1d"
                    stroke="#1e293b"
                    strokeWidth={0.8}
                  />
                  {plateA.slots.map((slot) => {
                    const isSelected = activePort && slot.port?.id === activePort.id;
                    const c = faceplateSlotColors(slot.port);
                    return (
                      <g
                        key={slot.key}
                        className="cursor-pointer transition-transform hover:scale-105"
                        onClick={() => {
                          if (slot.port) setSelectedPortId(slot.port.id);
                        }}
                      >
                        <title>
                          {slot.port
                            ? `${slot.port.portName} · ${slot.port.status || "Active"}`
                            : `Slot ${slot.slotNumber} (Kosong)`}
                        </title>
                        <rect
                          x={slot.x}
                          y={slot.y}
                          width={slot.width}
                          height={slot.height}
                          rx={1.5}
                          fill={isSelected ? "#10b981" : c.fill}
                          stroke={isSelected ? "#34d399" : c.stroke}
                          strokeWidth={isSelected ? 1.5 : 0.7}
                          className={isSelected ? "filter drop-shadow-[0_0_8px_#10b981]" : ""}
                        />
                        <text
                          x={slot.x + slot.width / 2}
                          y={slot.y + slot.height / 2 + 1}
                          textAnchor="middle"
                          fontSize={6.5}
                          fontFamily="monospace"
                          fontWeight={isSelected ? 800 : 600}
                          fill={isSelected ? "#022c22" : c.label}
                          pointerEvents="none"
                        >
                          {slot.slotNumber}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5 py-2">
                  {ports.map((p, idx) => {
                    const isSelected = activePort?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPortId(p.id)}
                        className={`rounded px-1.5 py-1 text-center font-mono text-[10px] transition-all border ${
                          isSelected
                            ? "border-emerald-400 bg-emerald-400 text-emerald-950 font-bold shadow-[0_0_12px_#10b981]"
                            : p.connectedToDeviceId
                            ? "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60"
                            : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                        }`}
                        title={`${p.portName} - Klik untuk pilih`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quick Port Meta Details */}
            {activePort && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-slate-950/60 border border-emerald-500/20 px-3 py-1.5 rounded-lg text-emerald-100">
                <span className="text-emerald-300 font-bold">Port: {activePort.portName}</span>
                <span>Mode: <strong className="text-white">{activePort.portMode || "Access"}</strong></span>
                <span>VLAN: <strong className="text-white">{activePort.vlanNumber || "-"}</strong></span>
                <span className={`px-1.5 py-0.2 rounded font-bold ${activePort.status === "Active" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                  {activePort.status || "Active"}
                </span>
              </div>
            )}
          </div>

          {/* BOX PERANGKAT B (TARGET PEER / PERANGKAT UJUNG) */}
          <div className="rounded-xl border border-cyan-500/40 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-3.5 shadow-lg shadow-cyan-500/5 space-y-3">
            <div className="flex items-center justify-between border-b border-cyan-500/30 pb-2">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#06b6d4] animate-ping" />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                  <Cpu className="size-3.5" />
                  <span>PERANGKAT B (UJUNG): {peerDevice ? peerDevice.name : "BELUM TERHUBUNG"}</span>
                </h3>
              </div>
              {connectedTargetPort ? (
                <span className="font-mono text-[11px] text-cyan-300 bg-cyan-500/15 border border-cyan-500/40 px-2 py-0.5 rounded font-bold">
                  Port Tujuan: <b>{connectedTargetPort.portName}</b> (Cyan)
                </span>
              ) : (
                <span className="font-mono text-[10px] text-slate-400 italic">
                  Tanpa Koneksi
                </span>
              )}
            </div>

            {/* Faceplate Diagram Perangkat B */}
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5">
              {peerDevice ? (
                isPeerLoading ? (
                  <div className="py-6 text-center text-xs text-slate-400 font-mono flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin text-cyan-400" />
                    <span>Memuat antarmuka port Perangkat B…</span>
                  </div>
                ) : plateB ? (
                  <svg
                    viewBox={`0 0 ${plateB.width} ${plateB.height}`}
                    className="w-full h-auto min-w-[320px]"
                    role="img"
                    aria-label="Faceplate Perangkat B"
                  >
                    <rect
                      width={plateB.width}
                      height={plateB.height}
                      rx={3}
                      fill="#0a0f1d"
                      stroke="#1e293b"
                      strokeWidth={0.8}
                    />
                    {plateB.slots.map((slot) => {
                      const isTargetPort = String(slot.port?.id) === targetPortId;
                      const c = faceplateSlotColors(slot.port);
                      return (
                        <g
                          key={slot.key}
                          className="cursor-pointer transition-transform hover:scale-105"
                          onClick={() => {
                            if (slot.port) setTargetPortId(String(slot.port.id));
                          }}
                        >
                          <title>
                            {slot.port
                              ? `${slot.port.portName} · ${slot.port.status || "Active"}`
                              : `Slot ${slot.slotNumber}`}
                          </title>
                          <rect
                            x={slot.x}
                            y={slot.y}
                            width={slot.width}
                            height={slot.height}
                            rx={1.5}
                            fill={isTargetPort ? "#06b6d4" : c.fill}
                            stroke={isTargetPort ? "#67e8f9" : c.stroke}
                            strokeWidth={isTargetPort ? 1.5 : 0.7}
                            className={isTargetPort ? "filter drop-shadow-[0_0_8px_#06b6d4]" : ""}
                          />
                          <text
                            x={slot.x + slot.width / 2}
                            y={slot.y + slot.height / 2 + 1}
                            textAnchor="middle"
                            fontSize={6.5}
                            fontFamily="monospace"
                            fontWeight={isTargetPort ? 800 : 600}
                            fill={isTargetPort ? "#082f49" : c.label}
                            pointerEvents="none"
                          >
                            {slot.slotNumber}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5 py-2">
                    {peerPorts.map((p, idx) => {
                      const isTarget = String(p.id) === targetPortId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setTargetPortId(String(p.id))}
                          className={`rounded px-1.5 py-1 text-center font-mono text-[10px] transition-all border ${
                            isTarget
                              ? "border-cyan-400 bg-cyan-400 text-cyan-950 font-bold shadow-[0_0_12px_#06b6d4]"
                              : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                          }`}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="py-8 text-center text-xs text-slate-500 font-mono space-y-1">
                  <Unlink className="size-6 mx-auto opacity-40 text-slate-400" />
                  <p>Port {activePort?.portName || "-"} belum terhubung ke perangkat mana pun.</p>
                  <p className="text-[10px] text-slate-600">
                    Pilih Perangkat Tujuan dan Port Tujuan pada panel konfigurasi di bawah untuk membuat jalur kabel topology.
                  </p>
                </div>
              )}
            </div>

            {/* Peer Device Details Badge */}
            {peerDevice && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-slate-950/60 border border-cyan-500/20 px-3 py-1.5 rounded-lg text-cyan-100">
                <span className="text-cyan-300 font-bold">{peerDevice.name}</span>
                <span>Rack: <strong className="text-white">{peerDevice.rackName || "-"}</strong></span>
                <span>IP: <strong className="text-white">{peerDevice.ipAddress || "-"}</strong></span>
                {onSelectPeer && (
                  <button
                    type="button"
                    onClick={() => onSelectPeer(peerDevice.id)}
                    className="text-cyan-400 hover:text-cyan-200 underline text-[10px]"
                  >
                    Terbangkan 3D Kamera ke Perangkat Ini →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── SECTION 2: HOLOGRAPHIC TOPOLOGY BRIDGE INDICATOR ── */}
        <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-3 flex flex-wrap items-center justify-between gap-3 font-mono text-xs shadow-inner">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400">Jalur Topology:</span>
            <span className="inline-flex items-center gap-1 font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
              <span className="size-2 rounded-full bg-emerald-400" />
              {device.name} [{activePort?.portName || "-"}]
            </span>

            <ArrowRight className="size-4 text-cyan-400 animate-pulse" />

            {peerDevice && targetPortId ? (
              <span className="inline-flex items-center gap-1 font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
                <span className="size-2 rounded-full bg-cyan-400" />
                {peerDevice.name} [{connectedTargetPort ? connectedTargetPort.portName : `Port #${targetPortId}`}]
              </span>
            ) : (
              <span className="text-slate-500 italic">[Port belum ditautkan]</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Status Link:</span>
            <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${targetStatus === "Active" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
              {targetStatus}
            </span>
          </div>
        </div>

        {/* ── SECTION 3: TOPOLOGY CONFIG DECK (GAMING HUD CONTROLS) ── */}
        <form
          onSubmit={handleSaveTopology}
          className="rounded-xl border border-cyan-500/40 bg-slate-900/80 p-4 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-cyan-400" />
              <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                KONTROL DOKUMENTASI TOPOLOGY DARI MODE 3D
              </h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Konfigurasi langsung tersimpan ke sistem database DataGuard
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* 1. Pilih Perangkat Tujuan */}
            <label className="space-y-1 text-xs font-mono text-slate-300">
              <span>Perangkat Ujung Tujuan (Target Device):</span>
              <select
                value={targetDeviceId}
                onChange={(e) => {
                  setTargetDeviceId(e.target.value);
                  setTargetPortId("");
                }}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
              >
                <option value="">-- Pilih Perangkat Tujuan --</option>
                {allDevices
                  .filter((d) => d.id !== device.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.ipAddress ? `(${d.ipAddress})` : ""} · {d.locationName || "-"}
                    </option>
                  ))}
              </select>
            </label>

            {/* 2. Pilih Port Tujuan */}
            <label className="space-y-1 text-xs font-mono text-slate-300">
              <span>Port Tujuan pada Perangkat B:</span>
              <select
                value={targetPortId}
                onChange={(e) => setTargetPortId(e.target.value)}
                disabled={!targetDeviceId || isPeerLoading}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none disabled:opacity-50"
              >
                <option value="">
                  {isPeerLoading
                    ? "Memuat port…"
                    : peerPorts.length === 0
                    ? "-- Tidak ada port terdaftar --"
                    : "-- Pilih Port Target --"}
                </option>
                {peerPorts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.portName} {p.status ? `(${p.status})` : ""} {p.speed ? `· ${p.speed}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {/* 3. Port Mode */}
            <label className="space-y-1 text-xs font-mono text-slate-300">
              <span>Logical Config / Mode:</span>
              <select
                value={targetPortMode}
                onChange={(e) => setTargetPortMode(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
              >
                {["Access", "Trunk", "Routed", "LACP"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            {/* 4. VLAN Assignment */}
            <label className="space-y-1 text-xs font-mono text-slate-300">
              <span>Access / Native VLAN:</span>
              <select
                value={targetVlanId}
                onChange={(e) => setTargetVlanId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
              >
                <option value="">-- Tanpa VLAN --</option>
                {vlans.map((v) => (
                  <option key={v.id} value={v.id}>
                    VLAN {v.vlanId} - {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
            {/* Status Link */}
            <label className="space-y-1 text-xs font-mono text-slate-300">
              <span>Status Link:</span>
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
              >
                <option value="Active">🟢 Active (Up)</option>
                <option value="Inactive">⚫ Inactive (Admin Down)</option>
                <option value="Down">🔴 Down (No Link)</option>
              </select>
            </label>

            {/* Deskripsi Port / Label */}
            <label className="space-y-1 text-xs font-mono text-slate-300 sm:col-span-2 lg:col-span-3">
              <span>Deskripsi Jalur / Keterangan Link:</span>
              <input
                type="text"
                value={targetDescription}
                onChange={(e) => setTargetDescription(e.target.value)}
                placeholder="e.g. Uplink Core ke Distribution Port 6"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            {activePort?.connectedToDeviceId ? (
              <button
                type="button"
                onClick={handleUnlink}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/15 text-xs font-mono font-bold text-red-300 hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                <Unlink className="size-4" />
                <span>Putus Koneksi Topology</span>
              </button>
            ) : (
              <span className="text-[11px] font-mono text-slate-500 italic">
                Port belum memiliki link aktif
              </span>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-mono text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Tutup HUD
              </button>

              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg border border-cyan-400 bg-cyan-400 text-xs font-mono font-bold text-cyan-950 hover:bg-cyan-300 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4 fill-cyan-950 text-cyan-950" />
                )}
                <span>Simpan Konfigurasi Topology</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
