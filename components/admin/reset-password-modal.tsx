"use client";

import { adminResetPassword } from "@/actions/users";
import { useActionState, useEffect } from "react";
import { Loader2, X, Key } from "lucide-react";

type User = {
    id: number;
    username: string;
    role: string;
};

interface ResetPasswordModalProps {
    user: User;
    onClose: () => void;
}

export default function ResetPasswordModal({ user, onClose }: ResetPasswordModalProps) {
    const [state, action, isPending] = useActionState(adminResetPassword, undefined);

    useEffect(() => {
        if (state?.success) {
            alert(state.message);
            onClose();
        }
    }, [state?.success, state?.message, onClose]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <Key className="h-5 w-5 text-amber-500" />
                        Reset Password
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                    Resetting password for user: <strong className="text-slate-900 dark:text-white">{user.username}</strong>
                </div>

                <form action={action}>
                    <input type="hidden" name="id" value={user.id} />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                New Password
                            </label>
                            <input
                                name="newPassword"
                                type="password"
                                required
                                minLength={6}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                                placeholder="Min. 6 characters"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Confirm New Password
                            </label>
                            <input
                                name="confirmPassword"
                                type="password"
                                required
                                minLength={6}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                                placeholder="Re-type new password"
                            />
                        </div>
                    </div>

                    {state?.message && !state?.success && (
                        <div className="mt-4 p-3 bg-red-50 sm:text-sm text-red-500 dark:bg-red-900/20 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800/30">
                            {state.message}
                        </div>
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
                            className="flex-1 bg-amber-500 text-white px-4 py-2 rounded-md hover:bg-amber-600 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isPending && <Loader2 className="animate-spin h-4 w-4" />}
                            Apply Reset
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
