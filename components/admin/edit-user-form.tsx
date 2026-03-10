"use client";

import { updateUser } from "@/actions/users";
import { useActionState, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

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

export default function EditUserForm({ user, sites, onClose }: EditUserFormProps) {
    const [state, action, isPending] = useActionState(updateUser, undefined);
    const [role, setRole] = useState(user.role);

    // Create a set of assigned site IDs for easy checking
    const assignedSiteIds = new Set(user.sites?.map(s => s.id) || []);

    useEffect(() => {
        if (state?.success) {
            onClose();
        }
    }, [state?.success, onClose]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit User</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form action={action}>
                    <input type="hidden" name="id" value={user.id} />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Username
                            </label>
                            <input
                                name="username"
                                defaultValue={user.username}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Email
                            </label>
                            <input
                                name="email"
                                type="email"
                                defaultValue={user.email || ""}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Role
                            </label>
                            <select
                                name="role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as any)}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="staff">Staff</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">Superadmin</option>
                            </select>
                        </div>

                        {role !== "superadmin" && (
                            <div className="border border-slate-200 dark:border-slate-700 rounded-md p-4 bg-slate-50 dark:bg-slate-800/50">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                    Data Center Access (Sites)
                                </label>
                                <div className="grid gap-3 grid-cols-2">
                                    {sites.map((site) => (
                                        <label key={site.id} className="flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                name="siteIds"
                                                value={site.id}
                                                defaultChecked={assignedSiteIds.has(site.id)}
                                                className="mt-1 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm text-slate-700 dark:text-slate-300">
                                                {site.code}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {sites.length === 0 && (
                                    <p className="text-sm text-slate-500 italic">No sites available.</p>
                                )}
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                name="isActive"
                                id="isActive"
                                defaultChecked={user.isActive ?? true}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded"
                            />
                            <label htmlFor="isActive" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Active User
                            </label>
                        </div>
                    </div>

                    {state && typeof state === 'object' && 'errors' in state && (state as { errors?: Record<string, string[]> }).errors && (
                        <div className="mt-3 text-red-500 text-sm">
                            {Object.values((state as { errors: Record<string, string[]> }).errors).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state?.success && (
                        <div className="mt-3 text-red-500 text-sm">{state.message}</div>
                    )}

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="animate-spin h-4 w-4" />}
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
