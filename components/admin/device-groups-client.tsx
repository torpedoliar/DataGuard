"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { addDeviceGroup, deleteDeviceGroup, getGroupDevices, getGroupUsers, updateDeviceGroup, type DeviceGroupWithPics } from "@/actions/device-groups";
import ActionButton from "@/components/ui/action-button";
import StatusBadge from "@/components/ui/status-badge";
import { DataTable, DataTableBody, DataTableEmpty, DataTableFrame, DataTableHead } from "@/components/ui/data-table";
import { Edit, Plus, Search, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import clsx from "clsx";

type DeviceOpt = { id: number; name: string; rackName: string | null };
type UserOpt = { id: number; username: string };

const fieldClass = "ops-input w-full px-3 py-2 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function DeviceGroupsClient({ initialGroups }: { initialGroups: DeviceGroupWithPics[] }) {
  const t = useTranslations("DeviceGroups");
  const [groups] = useState(initialGroups);
  const [editing, setEditing] = useState<DeviceGroupWithPics | null>(null);
  const [creating, setCreating] = useState(false);
  const [devices, setDevices] = useState<DeviceOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [query, setQuery] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  const [state, action, isPending] = useActionState(
    editing ? updateDeviceGroup : addDeviceGroup,
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(null);
      setCreating(false);
      setDeleteError(null);
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

  const deviceName = (id: number) => devices.find((d) => d.id === id)?.name ?? t("deviceFallback", { id });

  return (
    <div className="space-y-5">
      {deleteError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {deleteError}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
          <input
            type="search"
            placeholder={t("filterGroups")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 bg-transparent text-sm text-ops-text outline-none placeholder:text-ops-muted"
          />
        </div>
        <ActionButton type="button" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setCreating(true); setDeleteError(null); }}>
          {t("newGroup")}
        </ActionButton>
      </div>

      <DataTableFrame>
        <DataTable>
          <DataTableHead>
            <tr>
              <th className="px-5 py-3">{t("colGroup")}</th>
              <th className="px-5 py-3">{t("colDevices")}</th>
              <th className="px-5 py-3">{t("colOwners")}</th>
              <th className="px-5 py-3">{t("colStatus")}</th>
              <th className="px-5 py-3 text-right">{t("colActions")}</th>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {filtered.length === 0 ? (
              <DataTableEmpty colSpan={5} title={t("emptyTitle")} description={t("emptyDescription")} />
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
                      ? t("boundDevices", { count: group.deviceIds.length, names: group.deviceIds.slice(0, 3).map(deviceName).join(", ") }) + (group.deviceIds.length > 3 ? "…" : "")
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-sm text-ops-muted">
                    {group.ownerIds.length > 0
                      ? users.filter((u) => group.ownerIds.includes(u.id)).map((u) => u.username).join(", ")
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {group.isActive ? (
                      <StatusBadge tone="success">{t("active")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{t("inactive")}</StatusBadge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ActionButton type="button" variant="ghost" size="icon" title={t("editGroup")}
                        onClick={() => { setEditing(group); setCreating(false); setDeleteError(null); }}>
                        <Edit className="size-4 text-blue-300" />
                      </ActionButton>
                      <ActionButton type="button" variant="danger" size="icon" title={t("deleteGroup")}
                        onClick={() => {
                          if (confirm(t("deleteConfirm", { name: group.name }))) {
                            deleteDeviceGroup(group.id)
                              .then((result) => {
                                if (result && "success" in result && result.success) {
                                  setDeleteError(null);
                                  router.refresh();
                                } else {
                                  const message = result && "message" in result ? result.message ?? t("deleteFailed") : t("deleteFailed");
                                  setDeleteError(message);
                                }
                              })
                              .catch(() => setDeleteError(t("deleteFailed")));
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
  const t = useTranslations("DeviceGroups");
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
              <h2 className="text-lg font-bold text-ops-text">{group ? t("editTitle") : t("newTitle")}</h2>
              <p className="text-xs text-ops-muted">{t("modalDescription")}</p>
            </div>
          </div>
          <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} title={t("close")}>✕</ActionButton>
        </div>

        <form action={action} className="min-h-0 flex-1 overflow-y-auto">
          {group && <input type="hidden" name="id" value={group.id} />}

          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
            <label className="md:col-span-1">
              <span className={labelClass}>{t("groupName")}</span>
              <input name="name" required defaultValue={group?.name ?? ""} className={fieldClass} placeholder={t("groupNamePlaceholder")} />
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>{t("color")}</span>
              <input name="color" type="color" defaultValue={group?.color ?? "#3b82f6"} className="h-10 w-full cursor-pointer rounded-md border border-ops-border bg-ops-bg" />
            </label>
            <label className="md:col-span-2">
              <span className={labelClass}>{t("description")}</span>
              <textarea name="description" rows={2} defaultValue={group?.description ?? ""} className={fieldClass} placeholder={t("descriptionPlaceholder")} />
            </label>
            <label className="md:col-span-2 flex cursor-pointer items-center gap-2 rounded-md border border-ops-border bg-ops-bg/40 px-3 py-2">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={group?.isActive ?? true}
                className="accent-ops-accent"
              />
              <span className="text-sm font-medium text-ops-text">{t("isActiveLabel")}</span>
            </label>

            {/* Device binding — bulk multi-select */}
            <div className="md:col-span-2">
              <span className={labelClass}>{t("boundDevicesLabel", { count: selectedDevices.size })}</span>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input
                  type="search"
                  placeholder={t("filterDevices")}
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className={clsx(fieldClass, "pl-9")}
                />
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-ops-border bg-ops-bg/40 p-2">
                {filteredDevices.length === 0 && <p className="p-2 text-sm text-ops-muted">{t("noDevicesMatch")}</p>}
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
              <span className={labelClass}>{t("picOwnersLabel", { count: selectedOwners.size })}</span>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input
                  type="search"
                  placeholder={t("filterUsers")}
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className={clsx(fieldClass, "pl-9")}
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-ops-border bg-ops-bg/40 p-2">
                {filteredUsers.length === 0 && <p className="p-2 text-sm text-ops-muted">{t("noUsersMatch")}</p>}
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
              <ActionButton type="button" variant="secondary" onClick={onClose}>{t("cancel")}</ActionButton>
              <ActionButton type="submit" isPending={isPending}>{group ? t("saveChanges") : t("createGroup")}</ActionButton>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}