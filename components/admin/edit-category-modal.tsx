"use client";

import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, X } from "lucide-react";

interface Category {
    id: number;
    name: string;
    color: string | null;
}

interface EditCategoryModalProps {
    category: Category;
    onClose: () => void;
    editAction: (id: number, prevState: unknown, formData: FormData) => Promise<{ success?: boolean; message?: string; errors?: Record<string, string[]> }>;
}

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

export default function EditCategoryModal({ category, onClose, editAction }: EditCategoryModalProps) {
    const editCategoryWithId = editAction.bind(null, category.id);
    const [state, action, isPending] = useActionState(editCategoryWithId, undefined);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, router, onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
            <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] animate-scale-in">
                <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit Category</h3>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} disabled={isPending} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <form action={action} className="space-y-4 p-5">
                    <div className="flex gap-4">
                        <div className="min-w-0 flex-1">
                            <label htmlFor="edit-category-name" className={labelClass}>
                                Category Name *
                            </label>
                            <input
                                id="edit-category-name"
                                name="name"
                                required
                                defaultValue={category.name}
                                placeholder="e.g. Server, Network, Storage"
                                className="ops-input h-9 w-full px-3 text-sm"
                            />
                        </div>

                        <div className="w-24">
                            <label htmlFor="edit-category-color" className={labelClass}>
                                Color
                            </label>
                            <div className="relative h-9 overflow-hidden rounded-md border border-ops-border-strong bg-ops-surface focus-within:ring-[3px] focus-within:ring-ops-accent/30">
                                <input
                                    id="edit-category-color"
                                    type="color"
                                    name="color"
                                    defaultValue={category.color || "#3b82f6"}
                                    className="absolute -left-2 -top-2 size-16 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    {state?.errors && (
                        <div className="text-sm text-ops-danger">
                            {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state.success && (
                        <div className="text-sm text-ops-danger">{state.message}</div>
                    )}

                    <div className="flex justify-end gap-2 border-t border-ops-border pt-4">
                        <ActionButton
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            disabled={isPending}
                        >
                            Cancel
                        </ActionButton>
                        <ActionButton
                            type="submit"
                            isPending={isPending}
                            icon={<Save aria-hidden="true" className="size-4" />}
                        >
                            {isPending ? "Saving..." : "Save Changes"}
                        </ActionButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
