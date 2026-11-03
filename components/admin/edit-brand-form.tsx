"use client";

import { updateBrand } from "@/actions/brands";
import ActionButton from "@/components/ui/action-button";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";

type Brand = {
    id: number;
    name: string;
    logoPath: string | null;
    createdAt: Date | null;
};

interface EditBrandFormProps {
    brand: Brand;
    onClose: () => void;
}

const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-muted";

export default function EditBrandForm({ brand, onClose }: EditBrandFormProps) {
    const [state, action, isPending] = useActionState(updateBrand, undefined);
    const [preview, setPreview] = useState<string | null>(brand.logoPath);
    const [removeLogo, setRemoveLogo] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    useModalDismiss(onClose, true, !isPending);

    useEffect(() => {
        if (state?.success) {
            router.refresh();
            onClose();
        }
    }, [state?.success, router, onClose]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) { // 10MB limit
                alert("Ukuran file maksimal 10MB");
                e.target.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result as string);
                setRemoveLogo(false);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveLogo = () => {
        setPreview(null);
        setRemoveLogo(true);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] animate-scale-in">
                <div className="flex items-center justify-between border-b border-ops-border px-5 py-4">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Edit Brand</h3>
                    <ActionButton type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" title="Close">
                        <X aria-hidden="true" className="size-4" />
                    </ActionButton>
                </div>

                <div className="p-5">
                    <form action={action} className="space-y-4">
                        <input type="hidden" name="id" value={brand.id} />
                        <input type="hidden" name="removeLogo" value={removeLogo.toString()} />

                        {state?.message && !state?.success && (
                            <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                                {state.message}
                            </div>
                        )}

                        <div>
                            <label htmlFor="edit-brand-name" className={labelClass}>
                                Brand Name *
                            </label>
                            <input
                                id="edit-brand-name"
                                name="name"
                                defaultValue={brand.name}
                                required
                                className="ops-input h-9 w-full px-3 text-sm"
                            />
                            {state?.errors?.name && (
                                <p className="mt-1 text-sm text-ops-danger">{state.errors.name[0]}</p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="edit-brand-logo" className={labelClass}>
                                Brand Logo
                            </label>

                            <div className="group relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-ops-border-strong bg-ops-surface-raised/40 p-4 transition-colors hover:bg-ops-surface-raised">
                                {preview ? (
                                    <div className="relative flex w-full flex-col items-center">
                                        <div className="mb-3 flex h-24 w-full items-center justify-center rounded border border-ops-border bg-ops-surface px-2">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={preview} alt="Brand Logo Preview" className="max-h-full max-w-full object-contain" />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleRemoveLogo}
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
                                    id="edit-brand-logo"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className={`absolute inset-0 h-full w-full cursor-pointer opacity-0 ${preview ? "hidden" : "block"}`}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
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
                            >
                                {isPending ? "Saving..." : "Save Changes"}
                            </ActionButton>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
