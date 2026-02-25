"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSettings } from "@/actions/settings";
import Image from "next/image";

type SettingsData = {
    id: number;
    appName: string;
    logoPath: string | null;
    faviconPath: string | null;
};

export default function SettingsForm({ initialData }: { initialData: SettingsData }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialData.logoPath);
    const [removeLogo, setRemoveLogo] = useState(false);

    const [faviconFile, setFaviconFile] = useState<File | null>(null);
    const [faviconPreview, setFaviconPreview] = useState<string | null>(initialData.faviconPath);
    const [removeFavicon, setRemoveFavicon] = useState(false);

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                alert("Ukuran file maksimal 10MB");
                e.target.value = "";
                return;
            }
            setLogoFile(file);
            setLogoPreview(URL.createObjectURL(file));
            setRemoveLogo(false);
            setError(null);
            setSuccess(null);
        }
    };

    const handleRemoveLogo = () => {
        setLogoFile(null);
        setLogoPreview(null);
        setRemoveLogo(true);
        setError(null);
        setSuccess(null);
    };

    const handleFaviconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                alert("Ukuran file maksimal 10MB");
                e.target.value = "";
                return;
            }
            setFaviconFile(file);
            setFaviconPreview(URL.createObjectURL(file));
            setRemoveFavicon(false);
            setError(null);
            setSuccess(null);
        }
    };

    const handleRemoveFavicon = () => {
        setFaviconFile(null);
        setFaviconPreview(null);
        setRemoveFavicon(true);
        setError(null);
        setSuccess(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        const formData = new FormData(e.currentTarget);
        if (logoFile) formData.set("logo", logoFile);
        if (removeLogo) formData.set("removeLogo", "true");

        if (faviconFile) formData.set("favicon", faviconFile);
        if (removeFavicon) formData.set("removeFavicon", "true");

        startTransition(async () => {
            try {
                const response = await updateSettings(null, formData);
                if (response?.message && !response.success) {
                    setError(response.message);
                } else if (response?.success) {
                    setSuccess(response.message || "Pengaturan berhasil disimpan.");
                    router.refresh(); // Important: Refreshes Server Components (Layout/Navbar)
                }
            } catch (err) {
                setError("Terjadi kesalahan sistem saat menyimpan pengaturan.");
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50">
            {error && (
                <div className="p-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">error</span>
                    {error}
                </div>
            )}
            {success && (
                <div className="p-3 text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    {success}
                </div>
            )}

            <div className="space-y-4">
                {/* App Name */}
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5 shrink-0">
                        Nama Aplikasi
                    </label>
                    <input
                        type="text"
                        name="appName"
                        required
                        defaultValue={initialData.appName}
                        className="w-full h-10 px-3 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                        placeholder="e.g DataGuard"
                    />
                    <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">info</span>
                        Akan ditampilkan di tab browser dan Navbar utama.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-700/50">
                    {/* Logo Upload */}
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">
                            Logo Navbar
                        </label>
                        <div className="flex flex-col gap-3">
                            {logoPreview ? (
                                <div className="relative w-full h-24 bg-slate-900 rounded-lg border border-slate-700 flex flex-col items-center justify-center group overflow-hidden">
                                    <div className="relative w-auto h-12 flex items-center justify-center p-2 mb-2">
                                        <Image
                                            src={logoPreview}
                                            alt="Logo Preview"
                                            width={100}
                                            height={48}
                                            className="object-contain max-h-full max-w-full"
                                        />
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/80 to-transparent pt-4">
                                        <button
                                            type="button"
                                            onClick={handleRemoveLogo}
                                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                            Hapus Logo
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center w-full h-24 bg-slate-900 border border-slate-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-800 transition-colors">
                                    <div className="flex flex-col items-center justify-center pt-3 pb-4">
                                        <span className="material-symbols-outlined text-slate-400 mb-1">upload</span>
                                        <p className="text-xs text-slate-400">Pilih logo .png/.svg</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleLogoChange}
                                    />
                                </label>
                            )}
                            <p className="text-[11px] text-slate-500 leading-tight">
                                Disarankan gambar horizontal transparan (max 500x200px) untuk hasil optimal di Navbar.
                            </p>
                        </div>
                    </div>

                    {/* Favicon Upload */}
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">
                            Favicon (Tab Icon)
                        </label>
                        <div className="flex flex-col gap-3">
                            {faviconPreview ? (
                                <div className="relative w-full h-24 bg-slate-900 rounded-lg border border-slate-700 flex flex-col items-center justify-center group overflow-hidden">
                                    <div className="relative w-10 h-10 flex items-center justify-center p-1 mb-2 bg-white/5 rounded-md">
                                        <Image
                                            src={faviconPreview}
                                            alt="Favicon Preview"
                                            width={32}
                                            height={32}
                                            className="object-cover rounded-sm"
                                        />
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/80 to-transparent pt-4">
                                        <button
                                            type="button"
                                            onClick={handleRemoveFavicon}
                                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                            Hapus Favicon
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center w-full h-24 bg-slate-900 border border-slate-700 border-dashed rounded-lg cursor-pointer hover:bg-slate-800 transition-colors">
                                    <div className="flex flex-col items-center justify-center pt-3 pb-4">
                                        <span className="material-symbols-outlined text-slate-400 mb-1">upload</span>
                                        <p className="text-xs text-slate-400">Pilih ikon .ico/.png</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept=".ico,image/*"
                                        className="hidden"
                                        onChange={handleFaviconChange}
                                    />
                                </label>
                            )}
                            <p className="text-[11px] text-slate-500 leading-tight">
                                Disarankan gambar ratio 1:1 format <code>.ico</code> atau <code>.png</code> ukuran 32x32px minimum.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pt-4 border-t border-slate-700/50 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="h-10 px-5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {isPending ? (
                        <>
                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                            Menyimpan...
                        </>
                    ) : (
                        <>
                            <span className="material-symbols-outlined text-[18px]">save</span>
                            Simpan Pengaturan
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}
