"use client";

import { addCategory } from "@/actions/master-data";
import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Tag } from "lucide-react";

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

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
        <div className="ops-panel p-5">
            <div className="mb-4 flex items-center gap-2">
                <Tag aria-hidden="true" className="size-4 text-ops-accent" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Add new category</h2>
            </div>

            <form ref={formRef} action={action} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <label htmlFor="category-name" className={labelClass}>
                        Category Name *
                    </label>
                    <input
                        id="category-name"
                        name="name"
                        required
                        placeholder="e.g. Server, Network, Storage"
                        className="ops-input h-9 w-full px-3 text-sm"
                    />
                </div>

                <div className="w-24">
                    <label htmlFor="category-color" className={labelClass}>
                        Color
                    </label>
                    <div className="relative h-9 overflow-hidden rounded-md border border-ops-border-strong bg-ops-surface focus-within:ring-[3px] focus-within:ring-ops-accent/30">
                        <input
                            id="category-color"
                            type="color"
                            name="color"
                            defaultValue="#3b82f6"
                            className="absolute -left-2 -top-2 size-16 cursor-pointer"
                        />
                    </div>
                </div>

                <div className="flex items-end">
                    <ActionButton
                        type="submit"
                        isPending={isPending}
                        icon={<Plus aria-hidden="true" className="size-4" />}
                    >
                        {isPending ? null : "Add Category"}
                    </ActionButton>
                </div>
            </form>

            {state?.errors && (
                <div className="mt-3 text-sm text-ops-danger">
                    {Object.values(state.errors as Record<string, string[]>).flat().map((e, i) => (
                        <p key={i}>{e}</p>
                    ))}
                </div>
            )}
            {state?.message && !state.success && (
                <div className="mt-3 text-sm text-ops-danger">{state.message}</div>
            )}
            {state?.success && (
                <div className="mt-3 text-sm text-ops-success">{state.message}</div>
            )}
        </div>
    );
}
