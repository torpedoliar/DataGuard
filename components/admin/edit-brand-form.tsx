"use client";

import { updateBrand } from "@/actions/brands";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Upload } from "lucide-react";

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

export default function EditBrandForm({ brand, onClose }: EditBrandFormProps) {
    const [state, action, isPending] = useActionState(updateBrand, undefined);
    const [preview, setPreview] = useState<string | null>(brand.logoPath);
    const [removeLogo, setRemoveLogo] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-card-dark w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Brand</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6">
                    <form action={action} className="space-y-4">
                        <input type="hidden" name="id" value={brand.id} />
                        <input type="hidden" name="removeLogo" value={removeLogo.toString()} />

                        {state?.message && !state?.success && (
                            <div className="p-3 bg-red-100/50 text-red-600 rounded-md text-sm border border-red-200 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400 mb-4">
                                {state.message}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Brand Name *
                            </label>
                            <input
                                name="name"
                                defaultValue={brand.name}
                                required
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {state?.errors?.name && (
                                <p className="mt-1 text-sm text-red-500">{state.errors.name[0]}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Brand Logo
                            </label>

                            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group relative">
                                {preview ? (
                                    <div className="relative w-full flex flex-col items-center">
                                        <div className="h-24 px-2 w-full flex items-center justify-center mb-3 bg-white rounded border border-slate-200">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={preview} alt="Brand Logo Preview" className="max-h-full max-w-full object-contain" />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleRemoveLogo}
                                            className="absolute -top-2 w-6 h-6 -right-2 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                                            title="Remove Image"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                        <span className="text-xs text-slate-500">Tap image or cross to change</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center pointer-events-none">
                                        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full mb-2">
                                            <Upload className="w-5 h-5" />
                                        </div>
                                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Click to upload logo</p>
                                        <p className="text-xs text-slate-500 mt-1">PNG, JPG or SVG up to 2MB</p>
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

                        <div className="pt-4 flex items-center justify-end gap-3 mt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isPending}
                                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isPending}
                                className="flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isPending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    "Save Changes"
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
