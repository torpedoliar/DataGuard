"use client";

import { createUser } from "@/actions/users";
import { useActionState } from "react";
import { Loader2, Plus, UserPlus } from "lucide-react";

export default function AddUserForm() {
    const [state, action, isPending] = useActionState(createUser, undefined);

    return (
        <div className="bg-white dark:bg-card-dark p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-8">
            <div className="flex items-center gap-2 mb-4">
                <UserPlus className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New User</h3>
            </div>

            <form action={action} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Username *
                    </label>
                    <input
                        name="username"
                        required
                        placeholder="johndoe"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Email
                    </label>
                    <input
                        name="email"
                        type="email"
                        placeholder="john@example.com"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Password *
                    </label>
                    <input
                        name="password"
                        type="password"
                        required
                        placeholder="••••••••"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Role
                    </label>
                    <select
                        name="role"
                        defaultValue="staff"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                        <option value="superadmin">Superadmin</option>
                    </select>
                </div>

                <button
                    type="submit"
                    disabled={isPending}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    Add User
                </button>
            </form>

            {state?.errors && (
                <div className="mt-3 text-red-500 text-sm">
                    {Object.values(state.errors).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-red-500 text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm">
                    {state.message}
                </div>
            )}
        </div>
    );
}
