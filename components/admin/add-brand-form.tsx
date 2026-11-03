"use client";

import { addBrand } from "@/actions/brands";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Upload, X } from "lucide-react";
import { useState } from "react";

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
        <div className="bg-ops-surface rounded-lg shadow-sm border border-ops-border p-6 sticky top-24">
            <h3 className="text-lg font-semibold text-ops-text mb-6">Create New Brand</h3>

            <form action={action} className="space-y-4">
                {state?.message && !state?.success && (
                    <div className="p-3 bg-ops-danger-soft text-ops-danger rounded-md text-sm border border-ops-danger dark:bg-ops-danger-soft dark:text-ops-danger">
                        {state.message}
                    </div>
                )}
                {state?.success && (
                    <div className="p-3 bg-ops-success-soft text-ops-success rounded-md text-sm border border-ops-success dark:bg-ops-success-soft dark:text-ops-success">
                        {state.message}
                    </div>
                )}

                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-ops-muted mb-1">
                        Brand Name *
                    </label>
                    <input
                        type="text"
                        name="name"
                        id="name"
                        required
                        placeholder="e.g. Cisco, Dell, APC"
                        className="w-full px-3 py-2 border border-ops-border-strong rounded-md bg-ops-surface text-ops-text focus:outline-none focus:ring-2 focus:ring-ops-accent"
                    />
                    {state?.errors?.name && (
                        <p className="mt-1 text-sm text-ops-danger">{state.errors.name[0]}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-ops-muted mb-2">
                        Brand Logo (Optional)
                    </label>

                    <div className="flex flex-col items-center justify-center border-2 border-dashed border-ops-border-strong rounded-lg p-4 bg-ops-surface/50 hover:bg-ops-surface-raised dark:hover:bg-ops-surface-raised transition-colors group relative">
                        {preview ? (
                            <div className="relative w-full flex flex-col items-center">
                                <img src={preview} alt="Brand Logo Preview" className="h-24 w-auto object-contain rounded mb-3 bg-white p-2 border border-ops-border" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPreview(null);
                                        if (fileInputRef.current) fileInputRef.current.value = "";
                                    }}
                                    className="absolute -top-2 w-6 h-6 -right-2 bg-ops-danger text-ops-status-fg rounded-full flex items-center justify-center shadow-md hover:bg-ops-danger transition-colors"
                                    title="Remove Image"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                                <span className="text-xs text-ops-subtle">Tap image or cross to change</span>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center pointer-events-none">
                                <div className="p-3 bg-ops-info-soft text-ops-info rounded-full mb-2">
                                    <Upload className="w-5 h-5" />
                                </div>
                                <p className="text-sm font-medium text-ops-muted">Click to upload logo</p>
                                <p className="text-xs text-ops-subtle mt-1">PNG, JPG or SVG up to 2MB</p>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            name="logo"
                            id="logo"
                            accept="image/*"
                            onChange={handleFileChange}
                            className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${preview ? "hidden" : "block"}`}
                        />
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ops-accent text-ops-accent-fg font-medium rounded-lg hover:bg-ops-accent-hover focus:outline-none focus:ring-2 focus:ring-ops-accent focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4" />
                                Create Brand
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
