"use client";

import { addDevice } from "@/actions/master-data";
import { getOccupiedSlots, getRacks } from "@/actions/rack-management";
import ActionButton from "@/components/ui/action-button";
import FormSection from "@/components/ui/form-section";
import { Plus, Server } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import clsx from "clsx";

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

type Rack = {
  id: number;
  name: string;
  zone: string | null;
  totalU: number | null;
  locationId: number | null;
  locationName: string | null;
};

type Location = {
  id: number;
  name: string;
};

const EMPTY_FORM = {
  name: "",
  assetCode: "",
  brandId: "",
  categoryId: "",
  rackName: "",
  rackPosition: "",
  uHeight: "1",
  locationId: "",
  zone: "",
  ipAddress: "",
  description: "",
};

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function AddDeviceForm({
  categories,
  brands,
  locations,
}: {
  categories: Category[];
  brands: Brand[];
  locations: Location[];
}) {
  const [racks, setRacks] = useState<Rack[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);

  const [state, action, isPending] = useActionState(async (prevState: unknown, formData: FormData) => {
    const result = await addDevice(prevState, formData);
    if (result?.success) {
      setForm(EMPTY_FORM);
      setOccupiedSlots({});
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    }
    return result;
  }, undefined);

  const setField = (field: keyof typeof EMPTY_FORM) => (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleRackChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const rackName = event.target.value;
    const rack = racks.find((item) => item.name === rackName);

    setForm((previous) => ({
      ...previous,
      rackName,
      rackPosition: "",
      zone: rack ? rack.zone ?? previous.zone : "",
      locationId: rack?.locationId ? rack.locationId.toString() : "",
    }));

    if (rack) {
      setOccupiedSlots(await getOccupiedSlots(rack.name));
    } else {
      setOccupiedSlots({});
    }
  };

  useEffect(() => {
    getRacks().then(setRacks);
  }, []);

  const selectedRackData = racks.find((rack) => rack.name === form.rackName);

  return (
    <form action={action}>
      <FormSection
        title="Add New Device"
        description="Register device identity, placement, network address, and optional evidence photo."
        footer={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              {state?.errors && (
                <div className="text-sm text-red-300">
                  {Object.values(state.errors as Record<string, string[]>).flat().map((error, index) => <p key={index}>{error}</p>)}
                </div>
              )}
              {state?.message && (
                <p className={clsx("text-sm", state.success ? "text-emerald-300" : "text-red-300")}>{state.message}</p>
              )}
            </div>
            <ActionButton type="submit" isPending={isPending} icon={<Plus className="size-4" />}>
              Add Device
            </ActionButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <label>
            <span className={labelClass}>Device Name *</span>
            <input
              name="name"
              required
              value={form.name}
              onChange={setField("name")}
              placeholder="e.g. Server APP-01"
              className={fieldClass}
            />
          </label>

          <label>
            <span className={labelClass}>Kode Asset</span>
            <input
              name="assetCode"
              value={form.assetCode}
              onChange={setField("assetCode")}
              placeholder="e.g. AST-CORE-001"
              className={`${fieldClass} font-mono uppercase`}
            />
          </label>

          <label>
            <span className={labelClass}>Brand</span>
            <select name="brandId" value={form.brandId} onChange={setField("brandId")} className={fieldClass}>
              <option value="">-- No Brand --</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </label>

          <label>
            <span className={labelClass}>Category *</span>
            <select name="categoryId" required value={form.categoryId} onChange={setField("categoryId")} className={fieldClass}>
              <option value="">Select category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>

          <div className="border-t border-ops-border pt-5 md:col-span-2 xl:col-span-3">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ops-text">
              <Server className="size-4 text-ops-accent" />
              Rack Selection
            </h3>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <label>
                <span className={labelClass}>Select Rack</span>
                <select name="rackName" value={form.rackName} onChange={handleRackChange} className={fieldClass}>
                  <option value="">-- No Rack --</option>
                  {racks.map((rack) => (
                    <option key={rack.id} value={rack.name}>
                      {rack.name} {rack.zone ? `(${rack.zone})` : ""} - {rack.totalU || 42}U
                    </option>
                  ))}
                </select>
                {racks.length === 0 && (
                  <a href="/admin/rack-manage" className="mt-1 inline-flex text-xs font-semibold text-[#b7f5e4] hover:text-ops-accent">
                    Manage racks first
                  </a>
                )}
              </label>

              <label>
                <span className={labelClass}>U Position</span>
                <select
                  name="rackPosition"
                  value={form.rackPosition}
                  onChange={setField("rackPosition")}
                  className={fieldClass}
                  disabled={!form.rackName}
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
                <select name="uHeight" value={form.uHeight} onChange={setField("uHeight")} className={fieldClass}>
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

          <label>
            <span className={labelClass}>Location {form.rackName ? "(from rack)" : "*"}</span>
            <select
              name="locationId"
              required={!form.rackName}
              value={form.locationId}
              onChange={setField("locationId")}
              className={fieldClass}
            >
              <option value="">Select location</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>

          <label>
            <span className={labelClass}>Zone {form.rackName ? "(from rack)" : ""}</span>
            <input
              name="zone"
              value={form.zone}
              onChange={setField("zone")}
              placeholder={form.rackName ? "Auto-filled from rack" : "e.g. Zone A"}
              className={fieldClass}
            />
          </label>

          <label>
            <span className={labelClass}>IP Address</span>
            <input
              name="ipAddress"
              value={form.ipAddress}
              onChange={setField("ipAddress")}
              placeholder="e.g. 192.168.1.100"
              className={`${fieldClass} font-mono`}
            />
          </label>

          <label>
            <span className={labelClass}>Device Photo</span>
            <input
              ref={fileInputRef}
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
          </label>

          <label className="md:col-span-2">
            <span className={labelClass}>Keterangan</span>
            <textarea
              name="description"
              rows={3}
              value={form.description}
              onChange={setField("description")}
              placeholder="Catatan atau keterangan tambahan..."
              className={fieldClass}
            />
          </label>
        </div>
      </FormSection>
    </form>
  );
}
