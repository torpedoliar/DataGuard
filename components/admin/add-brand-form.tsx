"use client";

import { addBrand } from "@/actions/brands";
import ActionButton from "@/components/ui/action-button";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, X } from "lucide-react";
import { useState } from "react";

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

export default function AddBrandForm() {
    const [state, action, isPending] = useActionState(addBrand, undefined);
    const [preview, setPreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    useEffect(() => {
        if (state?.success) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPreview(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            router.refresh();
        }
    }, [state?.success, router]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) { // 2MB limit
                alert("File size should not exceed 2MB");
                e.target.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        } else {
            setPreview(null);
        }
    };

    return (
        <div className="ops-panel sticky top-24 p-5">
            <h2 className="mb-5 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Create new brand</h2>

            <form action={action} className="space-y-4">
                {state?.message && !state?.success && (
                    <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                        {state.message}
                    </div>
                )}
                {state?.success && (
                    <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">
                        {state.message}
                    </div>
                )}

                <div>
                    <label htmlFor="name" className={labelClass}>
                        Brand Name *
                    </label>
                    <input
                        type="text"
                        name="name"
                        id="name"
                        required
                        placeholder="e.g. Cisco, Dell, APC"
                        className="ops-input h-9 w-full px-3 text-sm"
                    />
                    {state?.errors?.name && (
                        <p className="mt-1 text-sm text-ops-danger">{state.errors.name[0]}</p>
                    )}
                </div>

                <div>
                    <label htmlFor="logo" className={labelClass}>
                        Brand Logo (Optional)
                    </label>

                    <div className="group relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-ops-border-strong bg-ops-surface-raised/40 p-4 transition-colors hover:bg-ops-surface-raised">
                        {preview ? (
                            <div className="relative flex w-full flex-col items-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={preview} alt="Brand Logo Preview" className="mb-3 h-24 w-auto rounded border border-ops-border bg-ops-surface object-contain p-2" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPreview(null);
                                        if (fileInputRef.current) fileInputRef.current.value = "";
                                    }}
                                    className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-ops-danger text-ops-status-fg shadow-md transition-colors hover:bg-ops-danger"
                                    title="Remove Image"
                                    aria-label="Remove image"
                                >
                                    <X aria-hidden="true" className="size-3" />
                                </button>
                                <span className="text-xs text-ops-subtle">Tap image or cross to change</span>
                            </div>
                        ) : (
                            <div className="pointer-events-none flex flex-col items-center">
                                <div className="mb-2 rounded-full bg-ops-info-soft p-3 text-ops-info">
                                    <Upload aria-hidden="true" className="size-5" />
                                </div>
                                <p className="text-sm font-medium text-ops-muted">Click to upload logo</p>
                                <p className="mt-1 text-xs text-ops-subtle">PNG, JPG or SVG up to 2MB</p>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            name="logo"
                            id="logo"
                            accept="image/*"
                            onChange={handleFileChange}
                            className={`absolute inset-0 h-full w-full cursor-pointer opacity-0 ${preview ? "hidden" : "block"}`}
                        />
                    </div>
                </div>

                <div className="pt-1">
                    <ActionButton
                        type="submit"
                        isPending={isPending}
                        icon={<Plus aria-hidden="true" className="size-4" />}
                        className="w-full"
                    >
                        {isPending ? "Saving..." : "Create Brand"}
                    </ActionButton>
                </div>
            </form>
        </div>
    );
}
