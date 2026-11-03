"use client";

import { addCategory } from "@/actions/master-data";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Tag } from "lucide-react";

export default function AddCategoryForm() {
    const [state, action, isPending] = useActionState(addCategory, undefined);
    const formRef = useRef<HTMLFormElement>(null);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            formRef.current?.reset();
            router.refresh();
        }
    }, [state?.success, router]);

    return (
        <div className="bg-ops-surface p-6 rounded-lg shadow-sm border border-ops-border mb-8">
            <div className="flex items-center gap-2 mb-4">
                <Tag className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-ops-text">Add New Category</h3>
            </div>

            <form ref={formRef} action={action} className="flex gap-4">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Category Name *
                    </label>
                    <input
                        name="name"
                        required
                        placeholder="e.g. Server, Network, Storage"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                </div>

                <div className="w-24">
                    <label className="block text-sm font-medium text-ops-muted mb-1">
                        Color
                    </label>
                    <div className="h-[42px] relative rounded-md border border-ops-border-strong overflow-hidden bg-ops-surface focus-within:ring-2 focus-within:ring-ops-accent focus-within:border-primary">
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
                        className="bg-ops-accent text-ops-accent-fg px-6 py-2 rounded-md hover:bg-ops-accent-hover flex items-center gap-2 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin h-5 w-5" /> : <><Plus className="h-5 w-5" /> Add Category</>}
                    </button>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-ops-danger text-sm">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-ops-danger text-sm">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-ops-success text-sm">{state.message}</div>
            )}
        </div>
    );
}
