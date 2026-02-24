"use client";

import { addCategory } from "@/actions/master-data";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Tag } from "lucide-react";

export default function AddCategoryForm() {
    const [state, action, isPending] = useActionState(addCategory, undefined);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            router.refresh();
        }
    }, [state?.success, router]);

    return (
        <div className="bg-white dark:bg-card-dark p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-8">
            <div className="flex items-center gap-2 mb-4">
                <Tag className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New Category</h3>
            </div>

            <form action={action} className="flex gap-4">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Category Name *
                    </label>
                    <input
                        name="name"
                        required
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
                            defaultValue="#3b82f6"
                            className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                        />
                    </div>
                </div>

                <div className="flex items-end">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="h-5 w-5" /> Add Category</>}
                    </button>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-red-500 text-sm">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-red-500 text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm">{state.message}</div>
            )}
        </div>
    );
}
