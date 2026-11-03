"use client";

import { createUser } from "@/actions/users";
import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";

type Site = { id: number; name: string; code: string };

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";
const fieldClass = "ops-input h-9 w-full px-3 text-sm";

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
        <div className="ops-panel p-5">
            <div className="mb-4 flex items-center gap-2">
                <UserPlus aria-hidden="true" className="size-4 text-ops-accent" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Add new user</h2>
            </div>

            <form ref={formRef} action={action} className="space-y-5">
                <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div className="lg:col-span-1">
                        <label htmlFor="new-user-username" className={labelClass}>
                            Username *
                        </label>
                        <input
                            id="new-user-username"
                            name="username"
                            required
                            placeholder="johndoe"
                            className={fieldClass}
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label htmlFor="new-user-email" className={labelClass}>
                            Email
                        </label>
                        <input
                            id="new-user-email"
                            name="email"
                            type="email"
                            placeholder="john@example.com"
                            className={fieldClass}
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label htmlFor="new-user-password" className={labelClass}>
                            Password *
                        </label>
                        <input
                            id="new-user-password"
                            name="password"
                            type="password"
                            required
                            placeholder="••••••••"
                            className={fieldClass}
                        />
                    </div>

                    <div className="lg:col-span-1">
                        <label htmlFor="new-user-role" className={labelClass}>
                            Role
                        </label>
                        <select
                            id="new-user-role"
                            name="role"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className={fieldClass}
                        >
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                            <option value="superadmin">Superadmin</option>
                        </select>
                    </div>
                </div>

                {role !== "superadmin" && (
                    <div className="rounded-md border border-ops-border bg-ops-surface-raised/40 p-4">
                        <p className="mb-3 text-[13px] font-medium text-ops-muted">
                            Data Center Access (Sites)
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                            {sites.map((site) => (
                                <label key={site.id} className="flex cursor-pointer items-start gap-2">
                                    <input
                                        type="checkbox"
                                        name="siteIds"
                                        value={site.id}
                                        className="mt-0.5 shrink-0 rounded border-ops-border-strong text-ops-info focus:ring-ops-accent"
                                    />
                                    <span className="text-sm text-ops-muted">
                                        {site.code} - {site.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                        {sites.length === 0 && (
                            <p className="text-sm italic text-ops-subtle">No sites available. Please create a site first.</p>
                        )}
                    </div>
                )}

                <div className="flex justify-end">
                    <ActionButton
                        type="submit"
                        isPending={isPending}
                        icon={<Plus aria-hidden="true" className="size-4" />}
                    >
                        {isPending ? null : "Add User"}
                    </ActionButton>
                </div>

            </form>

            {state?.errors && (
                <div className="mt-3 text-sm text-ops-danger">
                    {Object.values(state.errors).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-sm text-ops-danger">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-sm text-ops-success">
                    {state.message}
                </div>
            )}
        </div>
    );
}
