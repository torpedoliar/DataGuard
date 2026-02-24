"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, X } from "lucide-react";

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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-card-dark rounded-lg shadow-xl w-full max-w-md overflow-hidden relative">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Category</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        disabled={isPending}
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form action={action} className="p-4 space-y-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Category Name *
                            </label>
                            <input
                                name="name"
                                required
                                defaultValue={category.name}
                                placeholder="e.g. Server, Network, Storage"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="w-24">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Color
                            </label>
                            <div className="h-[42px] relative rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-primary">
                                <input
                                    type="color"
                                    name="color"
                                    defaultValue={category.color || "#3b82f6"}
                                    className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    {state?.errors && (
                        <div className="text-red-500 text-sm">
                            {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                                <p key={i}>{e}</p>
                            ))}
                        </div>
                    )}
                    {state?.message && !state.success && (
                        <div className="text-red-500 text-sm">{state.message}</div>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPending}
                            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 transition-colors text-sm font-medium"
                        >
                            {isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4" />}
                            {isPending ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
