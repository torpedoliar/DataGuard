"use client";

import { createUser } from "@/actions/users";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, UserPlus } from "lucide-react";

type Site = { id: number; name: string; code: string };

export default function AddUserForm({ sites }: { sites: Site[] }) {
    const [state, action, isPending] = useActionState(createUser, undefined);
    const formRef = useRef<HTMLFormElement>(null);
    const router = useRouter();
    const [role, setRole] = useState("staff");

    useEffect(() => {
        if (state?.success) {
            formRef.current?.reset();
            router.refresh();
        }
    }, [state?.success, router]);

    return (
        <div className="bg-ops-surface p-6 rounded-lg shadow-sm border border-ops-border mb-8">
            <div className="flex items-center gap-2 mb-4">
                <UserPlus className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-ops-text">Add New User</h3>
            </div>

            <form ref={formRef} action={action} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-ops-muted mb-1">
                            Username *
                        </label>
                        <input
                            name="username"
                            required
                            placeholder="johndoe"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-ops-muted mb-1">
                            Email
                        </label>
                        <input
                            name="email"
                            type="email"
                            placeholder="john@example.com"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-ops-muted mb-1">
                            Password *
                        </label>
                        <input
                            name="password"
                            type="password"
                            required
                            placeholder="••••••••"
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-ops-muted mb-1">
                            Role
                        </label>
                        <select
                            name="role"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                        >
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                            <option value="superadmin">Superadmin</option>
                        </select>
                    </div>
                </div>

                {role !== "superadmin" && (
                    <div className="border border-ops-border rounded-md p-4 bg-ops-surface/50">
                        <label className="block text-sm font-medium text-ops-muted mb-3">
                            Data Center Access (Sites)
                        </label>
                        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                            {sites.map((site) => (
                                <label key={site.id} className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        name="siteIds"
                                        value={site.id}
                                        className="mt-1 shrink-0 rounded border-ops-border-strong text-ops-info focus:ring-ops-accent"
                                    />
                                    <span className="text-sm text-ops-muted">
                                        {site.code} - {site.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                        {sites.length === 0 && (
                            <p className="text-sm text-ops-subtle italic">No sites available. Please create a site first.</p>
                        )}
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-ops-accent text-ops-accent-fg px-4 py-2 rounded-md hover:bg-ops-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ops-accent flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                        Add User
                    </button>
                </div>

            </form>

            {state?.errors && (
                <div className="mt-3 text-ops-danger text-sm">
                    {Object.values(state.errors).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-ops-danger text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-ops-success text-sm">
                    {state.message}
                </div>
            )}
        </div>
    );
}
