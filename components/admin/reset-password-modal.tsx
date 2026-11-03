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
            <div className="bg-ops-surface rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-ops-text flex items-center gap-2">
                        <Key className="h-5 w-5 text-ops-warning" />
                        Reset Password
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-ops-muted hover:text-ops-muted dark:hover:text-ops-muted"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mb-4 text-sm text-ops-muted">
                    Resetting password for user: <strong className="text-ops-text">{user.username}</strong>
                </div>

                <form action={action}>
                    <input type="hidden" name="id" value={user.id} />

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                New Password
                            </label>
                            <input
                                name="newPassword"
                                type="password"
                                required
                                minLength={6}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-warning"
                                placeholder="Min. 6 characters"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ops-muted mb-1">
                                Confirm New Password
                            </label>
                            <input
                                name="confirmPassword"
                                type="password"
                                required
                                minLength={6}
                                className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-warning"
                                placeholder="Re-type new password"
                            />
                        </div>
                    </div>

                    {state?.message && !state?.success && (
                        <div className="mt-4 p-3 bg-ops-danger-soft sm:text-sm text-ops-danger dark:bg-ops-danger-soft dark:text-ops-danger rounded-md border border-ops-danger/30">
                            {state.message}
                        </div>
                    )}

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-ops-border-strong rounded-md text-ops-muted hover:bg-ops-surface dark:hover:bg-ops-surface-raised"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 bg-ops-warning text-ops-status-fg px-4 py-2 rounded-md hover:bg-ops-warning flex items-center justify-center gap-2 disabled:opacity-50"
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
