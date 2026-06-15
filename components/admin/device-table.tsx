"use client";

import { takeoutFromRack, toggleDeviceStatus } from "@/actions/master-data";
import ActionButton from "@/components/ui/action-button";
import DataToolbar from "@/components/ui/data-toolbar";
import IconButton from "@/components/ui/icon-button";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFrame,
  DataTableHead,
} from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import PhotoModalTrigger from "@/components/report/photo-modal-trigger";
import { type UiTone } from "@/lib/ui/status";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Edit,
  Filter,
  Globe,
  MonitorPlay,
  Network,
  PackageOpen,
  Phone,
  Power,
  QrCode,
  Search,
  Shield,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import DeleteDeviceModal from "./delete-device-modal";
import EditDeviceForm from "./edit-device-form";
import PrintQRModal from "./print-qr-modal";

type Device = {
  id: number;
  name: string;
  assetCode: string | null;
  brandId: number | null;
  brandName: string | null;
  brandLogo: string | null;
  categoryName: string | null;
  locationId: number | null;
  locationName: string | null;
  photoPath: string | null;
  rackName: string | null;
  rackPosition: number | null;
  uHeight: number | null;
  zone: string | null;
  categoryId: number;
  ipAddress: string | null;
  description: string | null;
  isActive: boolean | null;
};

type Brand = {
  id: number;
  name: string;
  logoPath: string | null;
  createdAt: Date | null;
};

type Location = {
  id: number;
  name: string;
};

type SortConfig = { key: keyof Device; direction: "asc" | "desc" } | null;

const fieldClass = "ops-input h-9 px-3 text-sm";

function getActiveTone(isActive: boolean): UiTone {
  return isActive ? "success" : "danger";
}

export default function DeviceTable({
  devices,
  brands,
  locations,
}: {
  devices: Device[];
  brands: Brand[];
  locations: Location[];
}) {
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);
  const [printingDevice, setPrintingDevice] = useState<Device | null>(null);
  const [manageDevice, setManageDevice] = useState<Device | null>(null);
  const [customPort, setCustomPort] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedRack, setSelectedRack] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const racksPerPage = 5;

  const handleDeleteSuccess = () => {
    setDeletingDevice(null);
    router.refresh();
  };

  const handleToggleStatus = (deviceId: number) => {
    startTransition(async () => {
      const result = await toggleDeviceStatus(deviceId);
      if (!result.success) alert(result.message);
    });
  };

  const handleTakeout = (device: Device) => {
    if (!confirm(`Take out "${device.name}" from ${device.rackName} U${device.rackPosition}? This will clear its rack position.`)) return;
    startTransition(async () => {
      const result = await takeoutFromRack(device.id);
      if (!result.success) alert(result.message);
    });
  };

  const handleSort = (key: keyof Device) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const getSortIcon = (key: keyof Device) => {
    if (!sortConfig || sortConfig.key !== key) return <ArrowUpDown className="size-3.5 text-slate-600" />;
    return sortConfig.direction === "asc"
      ? <ArrowUp className="size-3.5 text-ops-accent" />
      : <ArrowDown className="size-3.5 text-ops-accent" />;
  };

  const uniqueCategories = Array.from(new Set(devices.map((device) => device.categoryName).filter(Boolean))).sort() as string[];
  const uniqueBrands = Array.from(new Set(devices.map((device) => device.brandName).filter(Boolean))).sort() as string[];
  const uniqueRacks = Array.from(new Set(devices.map((device) => device.rackName).filter(Boolean))).sort() as string[];

  const filteredDevices = devices.filter((device) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery ||
      device.name.toLowerCase().includes(query) ||
      (device.assetCode && device.assetCode.toLowerCase().includes(query)) ||
      (device.ipAddress && device.ipAddress.toLowerCase().includes(query));
    const matchesCategory = !selectedCategory || device.categoryName === selectedCategory;
    const matchesBrand = !selectedBrand || device.brandName === selectedBrand;
    const matchesRack = !selectedRack || device.rackName === selectedRack;
    const matchesStatus = !selectedStatus ||
      (selectedStatus === "active" && device.isActive !== false) ||
      (selectedStatus === "inactive" && device.isActive === false);

    return matchesSearch && matchesCategory && matchesBrand && matchesRack && matchesStatus;
  });

  const sortedDevices = [...filteredDevices].sort((a, b) => {
    if (!sortConfig) return 0;
    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;
    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const groups: Record<string, Device[]> = {};
  sortedDevices.forEach((device) => {
    const rackName = device.rackName || "Unassigned / Direct Placement";
    if (!groups[rackName]) groups[rackName] = [];
    groups[rackName].push(device);
  });

  const groupEntries = Object.entries(groups).sort((a, b) => {
    if (a[0] === "Unassigned / Direct Placement") return 1;
    if (b[0] === "Unassigned / Direct Placement") return -1;
    return a[0].localeCompare(b[0]);
  });

  const resetFilters = () => {
    setSearchQuery("");
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedRack("");
    setSelectedStatus("");
    setSortConfig(null);
    setCurrentPage(1);
  };

  const hasFilters = searchQuery || selectedCategory || selectedBrand || selectedRack || selectedStatus;

  const totalRacks = groupEntries.length;
  const totalPages = Math.ceil(totalRacks / racksPerPage);
  const startIndex = (currentPage - 1) * racksPerPage;
  const paginatedGroupEntries = groupEntries.slice(startIndex, startIndex + racksPerPage);

  return (
    <div className="space-y-4">
      {devices.length > 0 && (
        <DataToolbar>
          <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
              <input
                type="text"
                placeholder="Search by device name, asset code, or IP address..."
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setCurrentPage(1); }}
                className={`${fieldClass} w-full pl-9 pr-8`}
              />
              {searchQuery && (
                <IconButton
                  icon={<X aria-hidden="true" className="size-3.5" />}
                  label="Clear search"
                  onClick={() => { setSearchQuery(""); setCurrentPage(1); }}
                />
              )}
            </div>

            <div className="flex w-full items-center gap-2.5 overflow-x-auto pb-1 xl:w-auto xl:pb-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">
                <Filter className="size-3.5" />
                Filters
              </div>
              <select value={selectedCategory} onChange={(event) => { setSelectedCategory(event.target.value); setCurrentPage(1); }} className={`${fieldClass} min-w-36`}>
                <option value="">All Categories</option>
                {uniqueCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select value={selectedBrand} onChange={(event) => { setSelectedBrand(event.target.value); setCurrentPage(1); }} className={`${fieldClass} min-w-36`}>
                <option value="">All Brands</option>
                {uniqueBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              <select value={selectedRack} onChange={(event) => { setSelectedRack(event.target.value); setCurrentPage(1); }} className={`${fieldClass} min-w-36`}>
                <option value="">All Racks</option>
                {uniqueRacks.map((rack) => <option key={rack} value={rack}>{rack}</option>)}
              </select>
              <select value={selectedStatus} onChange={(event) => { setSelectedStatus(event.target.value); setCurrentPage(1); }} className={`${fieldClass} min-w-32`}>
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {hasFilters && (
                <ActionButton type="button" variant="ghost" size="sm" onClick={resetFilters} icon={<X className="size-3.5" />}>
                  Reset
                </ActionButton>
              )}
            </div>
          </div>
        </DataToolbar>
      )}

      <DataTableFrame>
        <DataTable className="whitespace-nowrap">
          <DataTableHead>
            <tr>
              <SortableHead label="Device Name" onClick={() => handleSort("name")} icon={getSortIcon("name")} />
              <SortableHead label="Asset Code" onClick={() => handleSort("assetCode")} icon={getSortIcon("assetCode")} />
              <SortableHead label="Brand" onClick={() => handleSort("brandName")} icon={getSortIcon("brandName")} />
              <SortableHead label="Category" onClick={() => handleSort("categoryName")} icon={getSortIcon("categoryName")} />
              <SortableHead label="Location" onClick={() => handleSort("locationName")} icon={getSortIcon("locationName")} />
              <SortableHead label="Rack" onClick={() => handleSort("rackName")} icon={getSortIcon("rackName")} />
              <SortableHead label="IP Address" onClick={() => handleSort("ipAddress")} icon={getSortIcon("ipAddress")} />
              <th className="px-5 py-3 text-center">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {sortedDevices.length === 0 ? (
              <DataTableEmpty
                colSpan={9}
                title={devices.length === 0 ? "No devices found" : "No devices match the current filters"}
                description={devices.length === 0 ? "Add a device above to start inventory management." : "Reset filters or adjust the search query."}
              />
            ) : (
              paginatedGroupEntries.map(([rackName, rackDevices]) => (
                <Fragment key={rackName}>
                  <tr className="bg-ops-surface">
                    <td colSpan={9} className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-md bg-blue-400/12 text-blue-200">
                          <PackageOpen className="size-3.5" />
                        </span>
                        <span className="text-xs font-bold uppercase tracking-[0.08em] text-slate-300">{rackName}</span>
                        <span className="text-[11px] text-ops-muted">({rackDevices.length} devices)</span>
                      </div>
                    </td>
                  </tr>
                  {rackDevices.map((device) => {
                    const isActive = device.isActive !== false;
                    const isInRack = !!device.rackName;
                    const showTakeout = !isActive && isInRack;

                    return (
                      <tr key={device.id} className={clsx("transition-colors hover:bg-ops-surface", !isActive && "opacity-65")}>
                        <td className="px-5 py-3 font-semibold text-ops-text">
                          <div className="flex items-center gap-2">
                            {!isActive && <span className="size-2 rounded-full bg-red-400" title="Inactive" />}
                            <span className={clsx(!isActive && "line-through text-ops-muted")}>{device.name}</span>
                            {device.photoPath && <PhotoModalTrigger photoPath={device.photoPath} deviceName={device.name} />}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {device.assetCode ? (
                            <span className="rounded-md border border-ops-border bg-ops-bg px-2 py-0.5 font-mono text-xs text-slate-300">{device.assetCode}</span>
                          ) : (
                            <span className="text-ops-muted">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-300">
                          {device.brandLogo ? (
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={device.brandLogo} alt={device.brandName || "Brand"} className="h-5 w-auto rounded bg-white p-0.5 object-contain" />
                              <span>{device.brandName}</span>
                            </div>
                          ) : device.brandName ? (
                            <span>{device.brandName}</span>
                          ) : (
                            <span className="text-ops-muted">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-ops-muted">{device.categoryName || "-"}</td>
                        <td className="px-5 py-3 text-ops-muted">{device.locationName || "-"}</td>
                        <td className="px-5 py-3 text-ops-muted">
                          {device.rackName ? (
                            <div className="flex items-center gap-2">
                              <span className="rounded-md border border-ops-border bg-ops-bg px-2 py-0.5 font-mono text-xs text-slate-300">
                                U{device.rackPosition}
                              </span>
                              {showTakeout && (
                                <ActionButton
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleTakeout(device)}
                                  disabled={isPending}
                                  aria-label="Take out from rack"
                                  title="Take out from rack"
                                >
                                  <PackageOpen aria-hidden="true" className="size-4 text-amber-300" />
                                </ActionButton>
                              )}
                            </div>
                          ) : (
                            <span className="text-ops-muted">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {device.ipAddress ? (
                            <span className="rounded-md border border-ops-border bg-ops-bg px-2 py-0.5 font-mono text-xs text-slate-300">{device.ipAddress}</span>
                          ) : (
                            <span className="text-ops-muted">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <button type="button" onClick={() => handleToggleStatus(device.id)} disabled={isPending} aria-label={`${isActive ? "Deactivate" : "Activate"} ${device.name}`} title={`Click to ${isActive ? "deactivate" : "activate"}`}>
                            <StatusBadge tone={getActiveTone(isActive)} dot>
                              <Power className="size-3" />
                              {isActive ? "Active" : "Inactive"}
                            </StatusBadge>
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            {device.ipAddress && (
                              <ActionButton type="button" variant="ghost" size="icon" onClick={() => setManageDevice(device)} aria-label="Manage device remotely" title="Manage device remotely">
                                <MonitorPlay aria-hidden="true" className="size-4 text-indigo-300" />
                              </ActionButton>
                            )}
                            <ActionButton href={`/admin/devices/${device.id}/network`} variant="ghost" size="icon" aria-label="Network ports" title="Network ports">
                              <Network aria-hidden="true" className="size-4 text-teal-300" />
                            </ActionButton>
                            <ActionButton type="button" variant="ghost" size="icon" onClick={() => setPrintingDevice(device)} aria-label="Print QR" title="Print QR">
                              <QrCode aria-hidden="true" className="size-4" />
                            </ActionButton>
                            <ActionButton type="button" variant="ghost" size="icon" onClick={() => setEditingDevice(device)} aria-label="Edit" title="Edit">
                              <Edit aria-hidden="true" className="size-4 text-blue-300" />
                            </ActionButton>
                            <ActionButton type="button" variant="danger" size="icon" onClick={() => setDeletingDevice(device)} aria-label="Delete" title="Delete">
                              <Trash2 aria-hidden="true" className="size-4" />
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))
            )}
          </DataTableBody>
        </DataTable>
      </DataTableFrame>

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-md border border-ops-border bg-ops-surface px-5 py-3">
          <div className="text-sm text-ops-muted">
            Showing <span className="font-medium text-ops-text">{startIndex + 1}</span> to{" "}
            <span className="font-medium text-ops-text">{Math.min(startIndex + racksPerPage, totalRacks)}</span> of{" "}
            <span className="font-medium text-ops-text">{totalRacks}</span> racks
          </div>
          <div className="flex items-center gap-2">
            <ActionButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              icon={<ChevronLeft className="size-4" />}
            >
              Previous
            </ActionButton>
            <div className="px-2 text-sm font-medium text-ops-text">
              Page {currentPage} of {totalPages}
            </div>
            <ActionButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ChevronRight className="ml-1 size-4" />
            </ActionButton>
          </div>
        </div>
      )}

      {editingDevice && (
        <EditDeviceForm device={editingDevice} onClose={() => setEditingDevice(null)} brands={brands} locations={locations} />
      )}
      {deletingDevice && (
        <DeleteDeviceModal deviceId={deletingDevice.id} deviceName={deletingDevice.name} onClose={() => setDeletingDevice(null)} onSuccess={handleDeleteSuccess} />
      )}
      {printingDevice && (
        <PrintQRModal deviceId={printingDevice.id} deviceName={printingDevice.name} onClose={() => setPrintingDevice(null)} />
      )}
      {manageDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setManageDevice(null); setCustomPort(""); }}>
          <div className="w-full max-w-sm overflow-hidden rounded-md border border-ops-border bg-ops-surface-raised shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ops-border bg-ops-surface px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-ops-text">Manage Device</h3>
                <p className="mt-0.5 text-xs text-ops-muted">{manageDevice.name} ({manageDevice.ipAddress})</p>
              </div>
              <ActionButton type="button" variant="ghost" size="icon" onClick={() => { setManageDevice(null); setCustomPort(""); }} aria-label="Close" title="Close">
                <X aria-hidden="true" className="size-4" />
              </ActionButton>
            </div>
            <div className="space-y-4 p-5">
              <label>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted">Custom Port</span>
                <input
                  type="text"
                  placeholder="e.g. 8080 or 2222"
                  value={customPort}
                  onChange={(event) => setCustomPort(event.target.value)}
                  className={`${fieldClass} w-full`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <RemoteLink href={`http://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ""}`} icon={<Globe className="size-5" />} label="HTTP Web" />
                <RemoteLink href={`https://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ""}`} icon={<Shield className="size-5" />} label="HTTPS Web" />
                <RemoteLink href={`ssh://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ""}`} icon={<Terminal className="size-5" />} label="SSH Access" />
                <RemoteLink href={`telnet://${manageDevice.ipAddress}${customPort ? `:${customPort}` : ""}`} icon={<Phone className="size-5" />} label="Telnet" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHead({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <th className="px-5 py-3 text-left">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 focus:outline-none">
        {label}
        {icon}
      </button>
    </th>
  );
}

function RemoteLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-ops-border bg-ops-bg p-4 text-slate-300 transition-colors hover:border-ops-accent/50 hover:text-[#b7f5e4]"
    >
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-[0.08em]">{label}</span>
    </a>
  );
}
