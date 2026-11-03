"use client";

import { adminResetPassword } from "@/actions/users";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
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

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";
const fieldClass = "ops-input h-9 w-full px-3 text-sm";

export default function ResetPasswordModal({ user, onClose }: ResetPasswordModalProps) {
    const [state, action, isPending] = useActionState(adminResetPassword, undefined);
    useModalDismiss(onClose, true, !isPending);

    useEffect(() => {
        if (state?.success) {
            alert(state.message);
            onClose();
        }
    }, [state?.success, state?.message, onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] animate-scale-in">
                <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                    <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        <Key aria-hidden="true" className="size-4 text-ops-warning" />
                        Reset Password
                    </h3>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <div className="px-5 pt-4 text-sm text-ops-muted">
                    Resetting password for user: <strong className="font-semibold text-ops-text">{user.username}</strong>
                </div>

                <form action={action} className="p-5">
                    <input type="hidden" name="id" value={user.id} />

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="reset-new-password" className={labelClass}>
                                New Password
                            </label>
                            <input
                                id="reset-new-password"
                                name="newPassword"
                                type="password"
                                required
                                minLength={6}
                                className={fieldClass}
                                placeholder="Min. 6 characters"
                            />
                        </div>

                        <div>
                            <label htmlFor="reset-confirm-password" className={labelClass}>
                                Confirm New Password
                            </label>
                            <input
                                id="reset-confirm-password"
                                name="confirmPassword"
                                type="password"
                                required
                                minLength={6}
                                className={fieldClass}
                                placeholder="Re-type new password"
                            />
                        </div>
                    </div>

                    {state?.message && !state?.success && (
                        <div className="mt-4 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                            {state.message}
                        </div>
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
                        <button
                            type="submit"
                            disabled={isPending}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3.5 text-sm font-medium text-ops-warning transition-colors hover:border-ops-warning/45 hover:bg-ops-warning/15 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ops-accent/30 disabled:pointer-events-none disabled:opacity-55"
                        >
                            {isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                            Apply Reset
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
