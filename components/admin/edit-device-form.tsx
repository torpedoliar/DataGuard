"use client";

import { getCategories, updateDevice } from "@/actions/master-data";
import { getOccupiedSlots, getRacks } from "@/actions/rack-management";
import ActionButton from "@/components/ui/action-button";
import FormSection from "@/components/ui/form-section";
import { Server, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import DeviceHealthTrend from "./device-health-trend";

type Category = {
  id: number;
  name: string;
};

type Brand = {
  id: number;
  name: string;
  logoPath: string | null;
  createdAt: Date | null;
};

type Device = {
  id: number;
  name: string;
  assetCode: string | null;
  brandId: number | null;
  brandName: string | null;
  brandLogo: string | null;
  categoryId: number;
  locationId: number | null;
  locationName: string | null;
  photoPath: string | null;
  zone: string | null;
  rackName: string | null;
  rackPosition: number | null;
  uHeight: number | null;
  ipAddress: string | null;
  description: string | null;
};

type Location = {
  id: number;
  name: string;
};

interface EditDeviceFormProps {
  device: Device;
  onClose: () => void;
  brands: Brand[];
  locations: Location[];
}

type Rack = {
  id: number;
  name: string;
  zone: string | null;
  totalU: number | null;
  locationId: number | null;
  locationName: string | null;
};

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function EditDeviceForm({ device, onClose, brands, locations }: EditDeviceFormProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<Record<number, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>(device.categoryId?.toString() || "");
  const [selectedRack, setSelectedRack] = useState<string>(device.rackName || "");
  const [selectedPosition, setSelectedPosition] = useState<string>(device.rackPosition?.toString() || "");
  const [state, action, isPending] = useActionState(updateDevice, undefined);
  const router = useRouter();

  useEffect(() => {
    getCategories().then(setCategories);
    getRacks().then(setRacks);
  }, []);

  useEffect(() => {
    if (selectedRack) {
      getOccupiedSlots(selectedRack, device.id).then(setOccupiedSlots);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOccupiedSlots({});
    }
  }, [selectedRack, device.id]);

  const selectedRackData = racks.find((rack) => rack.name === selectedRack);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      onClose();
    }
  }, [state?.success, onClose, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-ops-border bg-ops-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-ops-border bg-ops-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-ops-accent/12 text-[#b7f5e4]">
              <Server className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ops-text">Edit Device</h2>
              <p className="text-xs text-ops-muted">{device.name}</p>
            </div>
          </div>
          <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="size-4" />
          </ActionButton>
        </div>

        <form action={action} className="min-h-0 flex-1 overflow-y-auto">
          <input type="hidden" name="id" value={device.id} />

          <div className="p-5">
            <DeviceHealthTrend deviceId={device.id} />
          </div>

          <FormSection
            title="Device Details"
            description="Update inventory metadata, rack placement, and photo evidence."
            className="rounded-none border-x-0 border-b-0"
            footer={
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  {state?.errors && (
                    <div className="text-sm text-red-300">
                      {Object.values(state.errors as Record<string, string[]>).flat().map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                  {state?.message && !state.success && <p className="text-sm text-red-300">{state.message}</p>}
                </div>
                <div className="flex gap-2">
                  <ActionButton type="button" variant="secondary" onClick={onClose}>
                    Cancel
                  </ActionButton>
                  <ActionButton type="submit" isPending={isPending}>
                    Save Changes
                  </ActionButton>
                </div>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label>
                <span className={labelClass}>Device Name *</span>
                <input name="name" defaultValue={device.name} required className={fieldClass} />
              </label>

              <label>
                <span className={labelClass}>Kode Asset</span>
                <input
                  name="assetCode"
                  defaultValue={device.assetCode || ""}
                  placeholder="e.g. AST-CORE-001"
                  className={`${fieldClass} font-mono uppercase`}
                />
              </label>

              <label>
                <span className={labelClass}>Brand</span>
                <select name="brandId" defaultValue={device.brandId || ""} className={fieldClass}>
                  <option value="">-- No Brand --</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </label>

              <label>
                <span className={labelClass}>Category *</span>
                <select
                  name="categoryId"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  required
                  className={fieldClass}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>

              <label>
                <span className={labelClass}>Zone</span>
                <input name="zone" defaultValue={device.zone || ""} placeholder="e.g. Zone A" className={fieldClass} />
              </label>

              <label className="md:col-span-2">
                <span className={labelClass}>Location *</span>
                <select name="locationId" defaultValue={device.locationId?.toString() || ""} required className={fieldClass}>
                  <option value="">Select location</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>

              <div className="border-t border-ops-border pt-5 md:col-span-2">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ops-text">
                  <Server className="size-4 text-ops-accent" />
                  Rack Position
                </h3>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  <label>
                    <span className={labelClass}>Rack Name</span>
                    <select
                      name="rackName"
                      value={selectedRack}
                      onChange={(event) => {
                        setSelectedRack(event.target.value);
                        setSelectedPosition("");
                      }}
                      className={fieldClass}
                    >
                      <option value="">-- No Rack --</option>
                      {racks.map((rack) => (
                        <option key={rack.id} value={rack.name}>
                          {rack.name} {rack.zone ? `(${rack.zone})` : ""} - {rack.totalU || 42}U
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className={labelClass}>U Position</span>
                    <select
                      name="rackPosition"
                      value={selectedPosition}
                      onChange={(event) => setSelectedPosition(event.target.value)}
                      className={fieldClass}
                      disabled={!selectedRack}
                    >
                      <option value="">-- Select U --</option>
                      {selectedRackData && Array.from({ length: selectedRackData.totalU || 42 }, (_, index) => index + 1).map((u) => {
                        const occupyingDevice = occupiedSlots[u];
                        const isOccupied = !!occupyingDevice;
                        return (
                          <option key={u} value={u} disabled={isOccupied}>
                            U{u} {isOccupied ? `(Occupied by ${occupyingDevice})` : "(Available)"}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  <label>
                    <span className={labelClass}>U Height</span>
                    <select name="uHeight" defaultValue={device.uHeight || 1} className={fieldClass}>
                      <option value="0.5">0.5U</option>
                      <option value="1">1U</option>
                      <option value="2">2U</option>
                      <option value="3">3U</option>
                      <option value="4">4U</option>
                      <option value="5">5U</option>
                      <option value="6">6U</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="border-t border-ops-border pt-5 md:col-span-2">
                <span className={labelClass}>Device Photo</span>
                {device.photoPath && (
                  <div className="mb-3 flex items-start gap-4 rounded-md border border-ops-border bg-ops-surface p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={device.photoPath} alt="Current device photo" className="h-20 w-auto rounded object-cover" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-ops-text">Current Photo</p>
                      <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-red-300">
                        <input type="checkbox" name="deletePhoto" className="rounded border-ops-border bg-ops-bg" />
                        Remove this photo
                      </label>
                    </div>
                  </div>
                )}
                <input
                  type="file"
                  name="photo"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file && file.size > 10 * 1024 * 1024) {
                      alert("Ukuran file maksimal 10MB");
                      event.target.value = "";
                    }
                  }}
                  className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-ops-surface file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ops-text"
                />
                <p className="mt-1 text-xs text-ops-muted">Uploading a new photo will replace the current one.</p>
              </div>

              <label>
                <span className={labelClass}>IP Address</span>
                <input name="ipAddress" defaultValue={device.ipAddress || ""} placeholder="e.g. 192.168.1.100" className={`${fieldClass} font-mono`} />
              </label>

              <label>
                <span className={labelClass}>Keterangan</span>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={device.description || ""}
                  placeholder="Catatan atau keterangan tambahan..."
                  className={fieldClass}
                />
              </label>
            </div>
          </FormSection>
        </form>
      </div>
    </div>
  );
}
