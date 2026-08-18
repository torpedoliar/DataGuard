"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { addDeviceGroup, deleteDeviceGroup, getGroupDevices, getGroupUsers, updateDeviceGroup, type DeviceGroupWithPics } from "@/actions/device-groups";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
import { DataTable, DataTableBody, DataTableEmpty, DataTableFrame, DataTableHead } from "@/components/ui/data-table";
import { Edit, Plus, Search, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

type DeviceOpt = { id: number; name: string; rackName: string | null };
type UserOpt = { id: number; username: string };

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function DeviceGroupsClient({ initialGroups }: { initialGroups: DeviceGroupWithPics[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [editing, setEditing] = useState<DeviceGroupWithPics | null>(null);
  const [creating, setCreating] = useState(false);
  const [devices, setDevices] = useState<DeviceOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const [state, action, isPending] = useActionState(
    editing ? updateDeviceGroup : addDeviceGroup,
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      setEditing(null);
      setCreating(false);
      router.refresh();
    }
  }, [state?.success, router]);

  useEffect(() => {
    getGroupDevices().then(setDevices);
    getGroupUsers().then(setUsers);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return groups.filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, query]);

  const deviceName = (id: number) => devices.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
          <input
            type="search"
            placeholder="Filter groups…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 bg-transparent text-sm text-ops-text outline-none placeholder:text-ops-muted"
          />
        </div>
        <ActionButton type="button" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setCreating(true); }}>
          New Group
        </ActionButton>
      </div>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-5 py-3">Group</th>
              <th className="px-5 py-3">Devices</th>
              <th className="px-5 py-3">PIC Owners</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={5} title="No PIC groups" description="Create a group, then bind devices to it." />
            ) : (
              filtered.map((group) => (
                <tr key={group.id} className="transition-colors hover:bg-ops-surface">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: group.color ?? "#3b82f6" }} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ops-text">{group.name}</p>
                        {group.description && <p className="truncate text-xs text-ops-muted">{group.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-ops-muted">
                    {group.deviceIds.length > 0
                      ? `${group.deviceIds.length} bound · ${group.deviceIds.slice(0, 3).map(deviceName).join(", ")}${group.deviceIds.length > 3 ? "…" : ""}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-sm text-ops-muted">
                    {group.ownerIds.length > 0
                      ? users.filter((u) => group.ownerIds.includes(u.id)).map((u) => u.username).join(", ")
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {group.isActive ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Inactive</StatusBadge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" title="Edit group"
                        onClick={() => { setEditing(group); setCreating(false); }}>
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton type="button" variant="danger" size="icon" title="Delete group"
                        onClick={() => {
                          if (confirm(`Delete group "${group.name}"? Devices stay, membership is removed.`)) {
                            deleteDeviceGroup(group.id).then(() => router.refresh());
                          }
                        }}>
                        <Trash2 className="size-4" />
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </DataTableBody>
        </DataTable>
      </DataTableFrame>

      {(creating || editing) && (
        <GroupModal
          group={editing}
          devices={devices}
          users={users}
          action={action}
          state={state}
          isPending={isPending}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function GroupModal({
  group, devices, users, action, state, isPending, onClose,
}: {
  group: DeviceGroupWithPics | null;
  devices: DeviceOpt[];
  users: UserOpt[];
  action: (formData: FormData) => void;
  state: { success?: boolean; message?: string; errors?: Record<string, string[]> } | undefined;
  isPending: boolean;
  onClose: () => void;
}) {
  const [selectedDevices, setSelectedDevices] = useState<Set<number>>(new Set(group?.deviceIds ?? []));
  const [selectedOwners, setSelectedOwners] = useState<Set<number>>(new Set(group?.ownerIds ?? []));
  const [deviceFilter, setDeviceFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  const toggle = (set: Set<number>, value: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const filteredDevices = devices.filter((d) => !deviceFilter || d.name.toLowerCase().includes(deviceFilter.toLowerCase()));
  const filteredUsers = users.filter((u) => !userFilter || u.username.toLowerCase().includes(userFilter.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-ops-border bg-ops-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-ops-border bg-ops-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-ops-accent/12 text-ops-accent">
              <Users className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ops-text">{group ? "Edit Group" : "New Group"}</h2>
              <p className="text-xs text-ops-muted">Bind devices to this group; owners inherit from it.</p>
            </div>
          </div>
          <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} title="Close">✕</ActionButton>
        </div>

        <form action={action} className="min-h-0 flex-1 overflow-y-auto">
          {group && <input type="hidden" name="id" value={group.id} />}

          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
            <label className="md:col-span-1">
              <span className={labelClass}>Group Name *</span>
              <input name="name" required defaultValue={group?.name ?? ""} className={fieldClass} placeholder="e.g. Cooling Team" />
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>Color</span>
              <input name="color" type="color" defaultValue={group?.color ?? "#3b82f6"} className="h-10 w-full cursor-pointer rounded-md border border-ops-border bg-ops-bg" />
            </label>
            <label className="md:col-span-2">
              <span className={labelClass}>Description</span>
              <textarea name="description" rows={2} defaultValue={group?.description ?? ""} className={fieldClass} placeholder="Optional note" />
            </label>

            {/* Device binding — bulk multi-select */}
            <div className="md:col-span-2">
              <span className={labelClass}>Bound Devices ({selectedDevices.size})</span>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input
                  type="search"
                  placeholder="Filter devices…"
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className={clsx(fieldClass, "pl-9")}
                />
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-ops-border bg-ops-bg/40 p-2">
                {filteredDevices.length === 0 && <p className="p-2 text-sm text-ops-muted">No devices match.</p>}
                {filteredDevices.map((device) => (
                  <label key={device.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ops-surface">
                    <input
                      type="checkbox"
                      name="deviceIds"
                      value={device.id}
                      checked={selectedDevices.has(device.id)}
                      onChange={() => toggle(selectedDevices, device.id, setSelectedDevices)}
                      className="accent-ops-accent"
                    />
                    <span className="truncate font-medium text-ops-text">{device.name}</span>
                    {device.rackName && <span className="ml-auto shrink-0 text-xs text-ops-muted">{device.rackName}</span>}
                  </label>
                ))}
              </div>
            </div>

            {/* Owner (PIC) assignment */}
            <div className="md:col-span-2">
              <span className={labelClass}>PIC Owners ({selectedOwners.size})</span>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input
                  type="search"
                  placeholder="Filter users…"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className={clsx(fieldClass, "pl-9")}
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-ops-border bg-ops-bg/40 p-2">
                {filteredUsers.length === 0 && <p className="p-2 text-sm text-ops-muted">No users match.</p>}
                {filteredUsers.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ops-surface">
                    <input
                      type="checkbox"
                      name="ownerIds"
                      value={user.id}
                      checked={selectedOwners.has(user.id)}
                      onChange={() => toggle(selectedOwners, user.id, setSelectedOwners)}
                      className="accent-ops-accent"
                    />
                    <span className="truncate font-medium text-ops-text">{user.username}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-ops-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-sm">
              {state?.errors && (
                <div className="text-red-300">
                  {Object.values(state.errors as Record<string, string[]>).flat().map((error, index) => <p key={index}>{error}</p>)}
                </div>
              )}
              {state?.message && !state.success && <p className="text-red-300">{state.message}</p>}
            </div>
            <div className="flex gap-2">
              <ActionButton type="button" variant="secondary" onClick={onClose}>Cancel</ActionButton>
              <ActionButton type="submit" isPending={isPending}>{group ? "Save Changes" : "Create Group"}</ActionButton>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
