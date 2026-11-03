"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePort } from "@/actions/network";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { AlertTriangle, X } from "lucide-react";

type Port = { id: number; portName: string };

export default function DeletePortModal({ port, onClose }: { port: Port; onClose: () => void }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    useModalDismiss(onClose, true, !isPending);

    const handleDelete = () => {
        setError(null);
        startTransition(async () => {
            try {
                await deletePort(port.id);
                router.refresh();
                onClose();
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Gagal menghapus port.");
            }
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-lg border border-ops-border bg-ops-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-ops-border p-4">
                    <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                        <AlertTriangle className="size-4 text-ops-danger" />
                        Delete port
                    </h2>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} disabled={isPending} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <div className="p-5">
                    <p className="text-[13px] text-ops-muted">
                        Are you sure you want to completely remove the configuration for physical port <span className="font-semibold text-ops-text">{port.portName}</span>?
                        Any topology links terminating at this port will be severed automatically.
                    </p>

                    {error && (
                        <div className="mt-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                            {error}
                        </div>
                    )}

                    <div className="mt-6 flex justify-end gap-3">
                        <ActionButton type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                            Cancel
                        </ActionButton>
                        <ActionButton type="button" variant="danger" onClick={handleDelete} isPending={isPending}>
                            Delete
                        </ActionButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
