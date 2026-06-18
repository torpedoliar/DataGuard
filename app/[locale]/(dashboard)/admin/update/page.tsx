"use client";

import { useState, useEffect, useCallback } from "react";
import { checkSystemUpdate, VersionInfo } from "@/actions/update";
import { RefreshCw, Download, CheckCircle, ArrowUpCircle, GitBranch } from "lucide-react";

export default function SystemUpdatePage() {
    const [currentVersion, setCurrentVersion] = useState<VersionInfo | null>(null);
    const [latestVersion, setLatestVersion] = useState<VersionInfo | null>(null);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState("");

    const fetchCurrentVersion = useCallback(async () => {
        try {
            // Karena ini dari server actions, kita bisa langsung panggil fungsi sederhana
            // Mengambil current version untuk loading state awal.
            // Namun kita pakai checkSystemUpdate agar tahu apakah internet terhubung
            const data = await checkSystemUpdate();
            setCurrentVersion(data.current);
            setLatestVersion(data.latest);
            setUpdateAvailable(data.updateAvailable);
        } catch (error) {
            console.error("Failed to fetch version:", error);
            setErrorMsg("Gagal memuat info versi (Mungkin ada masalah pada file version.json lokal).");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const checkForUpdates = async () => {
        setIsChecking(true);
        setErrorMsg("");

        try {
            const data = await checkSystemUpdate();
            if (!data.current) {
                setErrorMsg("Gagal memuat local version.json.");
            } else if (!data.latest) {
                // If current exists but latest doesn't, we probably have no internet
                setCurrentVersion(data.current);
                setErrorMsg("Tidak dapat menghubungi server GitHub. Pastikan Anda memiliki koneksi internet.");
            } else {
                setCurrentVersion(data.current);
                setLatestVersion(data.latest);
                setUpdateAvailable(data.updateAvailable);
                // Kita gunakan HTML dialog native browser atau bisa diganti custom toast di kemudian hari
                if (data.updateAvailable) {
                    alert(`Update tersedia: v${data.latest.version}`);
                } else {
                    alert('Aplikasi sudah versi terbaru');
                }
            }
        } catch (error) {
            console.error("Check update error:", error);
            setErrorMsg("Terjadi kesalahan sistem saat mengecek pembaruan.");
        } finally {
            setIsChecking(false);
        }
    };

    useEffect(() => {
        fetchCurrentVersion();
    }, [fetchCurrentVersion]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-3 text-slate-400">Memuat informasi versi...</span>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <ArrowUpCircle className="w-7 h-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">System Update</h1>
                        <p className="text-slate-400">Kelola pembaruan aplikasi OTA (Over-The-Air)</p>
                    </div>
                </div>

                <button
                    onClick={checkForUpdates}
                    disabled={isChecking}
                    className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white border border-slate-700 hover:bg-slate-700 transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isChecking ? "animate-spin" : ""}`} />
                    Check for Updates
                </button>
            </div>

            {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3">
                    <span className="material-symbols-outlined shrink-0">error</span>
                    <p className="text-sm font-medium">{errorMsg}</p>
                </div>
            )}

            {/* Current Version Card */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-blue-400" />
                    Versi Saat Ini
                </h2>

                {currentVersion ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <p className="text-sm text-slate-500 mb-1">Versi Rilis</p>
                            <p className="text-3xl font-bold text-blue-400">v{currentVersion.version}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 mb-1">Tanggal Rilis</p>
                            <p className="font-medium text-slate-300">{currentVersion.releaseDate}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500 mb-1">Sumber Branch</p>
                            <p className="font-medium text-slate-300">{currentVersion.branch || "main"}</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-slate-500">Tidak dapat membaca informasi versi lokal.</p>
                )}

                {currentVersion?.changelog && currentVersion.changelog.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-slate-700/50">
                        <p className="text-sm font-medium text-slate-400 mb-3">Changelog Sistem:</p>
                        <ul className="list-disc list-inside text-sm text-slate-300 space-y-1.5 ml-1">
                            {currentVersion.changelog.map((item, i) => (
                                <li key={i}>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Update Available Card */}
            {updateAvailable && latestVersion && (
                <div className="bg-emerald-900/20 border-2 border-emerald-500/30 rounded-2xl p-6">
                    <div className="flex flex-col md:flex-row items-start gap-5">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                            <Download className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-xl font-bold text-emerald-400">Pembaruan Tersedia!</h3>
                            <p className="text-emerald-100/70 mt-1">
                                Versi terbaru aplikasi <strong>v{latestVersion.version}</strong> telah dirilis pada {latestVersion.releaseDate}.
                            </p>

                            {latestVersion.changelog && latestVersion.changelog.length > 0 && (
                                <div className="mt-4">
                                    <p className="text-sm text-emerald-300 font-semibold mb-2">Apa yang baru:</p>
                                    <ul className="list-disc list-inside text-sm text-emerald-200/80 space-y-1">
                                        {latestVersion.changelog.map((item, i) => (
                                            <li key={i}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="mt-6 p-5 bg-[#0b1120]/60 border border-emerald-500/20 rounded-xl">
                                <p className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                                    Untuk memperbarui sistem, masuk ke server Anda dan jalankan skrip berikut:
                                </p>
                                <div className="space-y-2 font-mono text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="text-slate-500 w-24">OS Windows</span>
                                        <code className="text-amber-400 bg-black/40 px-2 py-1 rounded">.\update.ps1</code>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-slate-500 w-24">OS Linux</span>
                                        <code className="text-emerald-400 bg-black/40 px-2 py-1 rounded">./update.sh</code>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* No Update Card */}
            {!updateAvailable && latestVersion && !isChecking && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-200">Aplikasi Sudah Mutakhir</h3>
                            <p className="text-sm text-slate-400 mt-0.5">
                                Anda sudah menggunakan versi terbaru (v{currentVersion?.version}). Sistem berjalan dengan aman dan stabil.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Instructions */}
            <div className="bg-slate-800/20 border border-slate-700/30 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Cara Kerja Pembaruan OTA (Over-The-Air)</h2>
                <div className="space-y-3 text-sm text-slate-400">
                    <p>
                        DC-Check dilengkapi skrip otomatisasi yang sangat aman dan dapat diandalkan untuk mengambil pembaharuan versi terbaru (OTA) langsung dari repositori Git proyek Anda tanpa memberhentikan sistem secara mendadak.
                    </p>
                    <p className="mt-4 text-slate-300 font-medium">Skrip akan bekerja secara berurutan:</p>
                    <ol className="list-decimal list-inside space-y-2 pl-2 text-slate-400">
                        <li>Melakukan Backup Database otomatis (via <code className="text-pink-400">pg_dump</code>).</li>
                        <li>Memastikan kode terbaru tertarik dari <code className="text-blue-400">git pull origin main</code>.</li>
                        <li>Melakukan *Build* container secara transparan di belakang layar (*Zero-downtime saat build*).</li>
                        <li>Mereset *Container Web* lama, dan menggantinya dengan yang baru dalam waktu &lt; 2 detik.</li>
                        <li>Menggunakan <code className="text-orange-400">drizzle push</code> untuk menerapkan jika ada skema tabel database terbaru.</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
