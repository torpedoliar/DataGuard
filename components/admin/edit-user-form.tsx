"use client";

import { updateUser } from "@/actions/users";
import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

type Site = { id: number; name: string; code: string };

type User = {
    id: number;
    username: string;
    email: string | null;
    role: "superadmin" | "admin" | "staff";
    isActive: boolean | null;
    sites?: Site[];
};

interface EditUserFormProps {
    user: User;
    sites: Site[];
    onClose: () => void;
}

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";
const fieldClass = "ops-input h-9 w-full px-3 text-sm";

export default function EditUserForm({ user, sites, onClose }: EditUserFormProps) {
    const router = useRouter();
    const [state, action, isPending] = useActionState(updateUser, undefined);
    const [role, setRole] = useState(user.role);

    // Create a set of assigned site IDs for easy checking
    const assignedSiteIds = new Set(user.sites?.map(s => s.id) || []);

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, onClose, router]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] animate-scale-in">
                <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit User</h3>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form action={action} className="p-5">
                    <input type="hidden" name="id" value={user.id} />

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="edit-user-username" className={labelClass}>
                                Username
                            </label>
                            <input
                                id="edit-user-username"
                                name="username"
                                defaultValue={user.username}
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit-user-email" className={labelClass}>
                                Email
                            </label>
                            <input
                                id="edit-user-email"
                                name="email"
                                type="email"
                                defaultValue={user.email || ""}
                                className={fieldClass}
                            />
                        </div>

                        <div>
                            <label htmlFor="edit-user-role" className={labelClass}>
                                Role
                            </label>
                            <select
                                id="edit-user-role"
                                name="role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as User["role"])}
                                className={fieldClass}
                            >
                                <option value="staff">Staff</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">Superadmin</option>
                            </select>
                        </div>

                        {role !== "superadmin" && (
                            <div className="rounded-md border border-ops-border bg-ops-surface-raised/40 p-4">
                                <p className="mb-3 text-[13px] font-medium text-ops-muted">
                                    Data Center Access (Sites)
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    {sites.map((site) => (
                                        <label key={site.id} className="flex cursor-pointer items-start gap-2">
                                            <input
                                                type="checkbox"
                                                name="siteIds"
                                                value={site.id}
                                                defaultChecked={assignedSiteIds.has(site.id)}
                                                className="mt-0.5 shrink-0 rounded border-ops-border-strong text-ops-info focus:ring-ops-accent"
                                            />
                                            <span className="text-sm text-ops-muted">
                                                {site.code}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {sites.length === 0 && (
                                    <p className="text-sm italic text-ops-subtle">No sites available.</p>
                                )}
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                name="isActive"
                                id="isActive"
                                defaultChecked={user.isActive ?? true}
                                className="size-4 rounded border-ops-border-strong text-ops-info focus:ring-ops-accent"
                            />
                            <label htmlFor="isActive" className="text-sm font-medium text-ops-muted">
                                Active User
                            </label>
                        </div>
                    </div>

                    {state && typeof state === 'object' && 'errors' in state && (state as { errors?: Record<string, string[]> }).errors && (
                        <div className="mt-3 text-sm text-ops-danger">
                            {Object.values((state as { errors: Record<string, string[]> }).errors).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state?.success && (
                        <div className="mt-3 text-sm text-ops-danger">{state.message}</div>
                    )}

                    <div className="mt-6 flex gap-2">
                        <ActionButton
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            className="flex-1"
                        >
                            Cancel
                        </ActionButton>
                        <ActionButton
                            type="submit"
                            isPending={isPending}
                            className="flex-1"
                        >
                            Save Changes
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
