"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendTelegramTestMessage, updateSettings } from "@/actions/settings";
import Image from "next/image";

type SettingsData = {
    id: number;
    appName: string;
    logoPath: string | null;
    faviconPath: string | null;
    activeSiteName: string | null;
    activeSiteTelegramChatId: string | null;
    telegramAlertTemplate: string;
    telegramBotConfigured: boolean;
};

const telegramTemplateTokens = [
    "siteName",
    "siteCode",
    "checker",
    "shift",
    "checkDate",
    "checkTime",
    "deviceName",
    "deviceAssetCode",
    "deviceStatus",
    "deviceLocation",
    "deviceCategory",
    "deviceBrand",
    "deviceZone",
    "deviceRack",
    "deviceIp",
    "deviceDescription",
    "deviceRemarks",
    "incidentId",
];

export default function SettingsForm({ initialData }: { initialData: SettingsData }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isTestingTelegram, startTelegramTestTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [telegramTestResult, setTelegramTestResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialData.logoPath);
    const [removeLogo, setRemoveLogo] = useState(false);

    const [faviconFile, setFaviconFile] = useState<File | null>(null);
    const [faviconPreview, setFaviconPreview] = useState<string | null>(initialData.faviconPath);
    const [removeFavicon, setRemoveFavicon] = useState(false);
    const [telegramTemplate, setTelegramTemplate] = useState(initialData.telegramAlertTemplate);
    const [telegramTestChatId, setTelegramTestChatId] = useState(initialData.activeSiteTelegramChatId || "");

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
            } catch {
                setError("Terjadi kesalahan sistem saat menyimpan pengaturan.");
            }
        });
    };

    const handleTelegramTest = () => {
        setTelegramTestResult(null);

        const formData = new FormData();
        formData.set("telegramTestChatId", telegramTestChatId);
        formData.set("telegramAlertTemplate", telegramTemplate);

        startTelegramTestTransition(async () => {
            try {
                const response = await sendTelegramTestMessage(null, formData);
                setTelegramTestResult({
                    type: response?.success ? "success" : "error",
                    message: response?.message || "Tidak ada respons dari Telegram.",
                });
            } catch {
                setTelegramTestResult({
                    type: "error",
                    message: "Terjadi kesalahan sistem saat mengirim test Telegram.",
                });
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50">
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

            <div className="pt-6 border-t border-slate-700/50 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-white">Telegram Alert</h2>
                        <p className="mt-1 text-xs text-slate-400">
                            Template ini dipakai saat perangkat berstatus Warning atau Error.
                        </p>
                    </div>
                    <span className={`inline-flex h-7 w-fit items-center gap-2 rounded-full border px-3 text-xs font-medium ${initialData.telegramBotConfigured
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : "border-amber-400/25 bg-amber-400/10 text-amber-300"
                        }`}>
                        <span className="material-symbols-outlined text-[16px]">
                            {initialData.telegramBotConfigured ? "check_circle" : "warning"}
                        </span>
                        {initialData.telegramBotConfigured ? "Bot token aktif" : "Bot token belum aktif"}
                    </span>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        Template Pesan Perangkat
                    </label>
                    <textarea
                        name="telegramAlertTemplate"
                        value={telegramTemplate}
                        onChange={(event) => setTelegramTemplate(event.target.value)}
                        rows={13}
                        maxLength={4000}
                        className="w-full resize-y rounded-lg bg-slate-950 border border-slate-700 px-3 py-3 font-mono text-xs leading-relaxed text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span>Markdown Telegram didukung.</span>
                        <span>{telegramTemplate.length}/4000</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {telegramTemplateTokens.map((token) => (
                        <button
                            key={token}
                            type="button"
                            onClick={() => setTelegramTemplate((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}{${token}}`)}
                            className="h-7 rounded-md border border-slate-700 bg-slate-900 px-2.5 font-mono text-[11px] text-slate-300 hover:border-blue-400/60 hover:text-white transition-colors"
                        >
                            {`{${token}}`}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                    <label>
                        <span className="block text-sm font-medium text-slate-300 mb-1.5">
                            Chat ID Telegram Site Aktif
                        </span>
                        <input
                            type="text"
                            name="activeSiteTelegramChatId"
                            defaultValue={initialData.activeSiteTelegramChatId || ""}
                            className="w-full h-10 px-3 rounded-lg bg-slate-900 border border-slate-700 font-mono text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                            placeholder="-1001234567890"
                        />
                        <p className="text-xs text-slate-500 mt-1.5">
                            Dipakai untuk alert checklist di {initialData.activeSiteName || "site aktif"}.
                        </p>
                    </label>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">
                            Test Chat ID
                        </label>
                        <input
                            type="text"
                            value={telegramTestChatId}
                            onChange={(event) => setTelegramTestChatId(event.target.value)}
                            className="w-full h-10 px-3 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                            placeholder="-1001234567890"
                        />
                        <p className="text-xs text-slate-500 mt-1.5">
                            Untuk test cepat; otomatis memakai Chat ID site aktif jika tersedia.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleTelegramTest}
                        disabled={isTestingTelegram}
                        className="h-10 px-4 rounded-lg border border-slate-600 text-sm font-medium text-slate-100 hover:border-blue-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isTestingTelegram ? (
                            <>
                                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                Mengirim...
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined text-[18px]">send</span>
                                Kirim Test
                            </>
                        )}
                    </button>
                </div>

                {telegramTestResult && (
                    <div className={`p-3 text-sm rounded-lg border flex items-center gap-2 ${telegramTestResult.type === "success"
                        ? "text-emerald-300 bg-emerald-400/10 border-emerald-400/20"
                        : "text-red-300 bg-red-400/10 border-red-400/20"
                        }`}>
                        <span className="material-symbols-outlined text-[18px]">
                            {telegramTestResult.type === "success" ? "check_circle" : "error"}
                        </span>
                        {telegramTestResult.message}
                    </div>
                )}
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
