"use client";

import { useState, useEffect, useCallback } from "react";
import { checkSystemUpdate, VersionInfo } from "@/actions/update";
import { RefreshCw, Download, CheckCircle, GitBranch, AlertCircle, Terminal } from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import ActionButton from "@/components/ui/action-button";

export default function SystemUpdatePage() {
    const [currentVersion, setCurrentVersion] = useState<VersionInfo | null>(null);
    const [latestVersion, setLatestVersion] = useState<VersionInfo | null>(null);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState("");
    const [notice, setNotice] = useState("");

    const fetchCurrentVersion = useCallback(async () => {
        try {
            const data = await checkSystemUpdate();
            setCurrentVersion(data.current);
            setLatestVersion(data.latest);
            setUpdateAvailable(data.updateAvailable);
        } catch (error) {
            console.error("Failed to fetch version:", error);
            setErrorMsg("Gagal memuat info versi (mungkin ada masalah pada file version.json lokal).");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const checkForUpdates = async () => {
        setIsChecking(true);
        setErrorMsg("");
        setNotice("");

        try {
            const data = await checkSystemUpdate();
            if (!data.current) {
                setErrorMsg("Gagal memuat local version.json.");
            } else if (!data.latest) {
                setCurrentVersion(data.current);
                setErrorMsg("Tidak dapat menghubungi server GitHub. Pastikan koneksi internet tersedia.");
            } else {
                setCurrentVersion(data.current);
                setLatestVersion(data.latest);
                setUpdateAvailable(data.updateAvailable);
                setNotice(
                    data.updateAvailable
                        ? `Versi v${data.latest.version} tersedia.`
                        : "Aplikasi sudah memakai versi terbaru.",
                );
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
            <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-8">
                <div className="flex items-center gap-3 text-sm text-ops-muted">
                    <RefreshCw className="size-4 animate-spin text-ops-info" />
                    Memuat informasi versi…
                </div>
                <div className="ops-panel space-y-3 p-5">
                    <div className="skeleton h-4 w-40" />
                    <div className="skeleton h-8 w-28" />
                    <div className="skeleton h-3 w-1/2" />
                </div>
            </main>
        );
    }

    return (
        <main className="mx-auto flex w-full max-w-5xl animate-enter flex-col gap-5 px-4 py-6 lg:px-8">
            <PageHeader
                eyebrow="Admin / System"
                title="System update"
                description="Kelola pembaruan aplikasi OTA (over-the-air)."
                actions={
                    <ActionButton
                        variant="secondary"
                        onClick={checkForUpdates}
                        isPending={isChecking}
                        icon={<RefreshCw />}
                    >
                        Check for updates
                    </ActionButton>
                }
            />

            {errorMsg && (
                <div role="alert" className="flex items-center gap-3 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                    <AlertCircle className="size-4 shrink-0" aria-hidden />
                    <p className="font-medium">{errorMsg}</p>
                </div>
            )}

            {notice && !errorMsg && (
                <div aria-live="polite" className="flex items-center gap-3 rounded-md border border-ops-info/25 bg-ops-info-soft px-3 py-2.5 text-[13px] text-ops-info">
                    <CheckCircle className="size-4 shrink-0" aria-hidden />
                    <p className="font-medium">{notice}</p>
                </div>
            )}

            <section className="ops-panel p-5">
                <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    <GitBranch className="size-4 text-ops-info" aria-hidden />
                    Versi saat ini
                </h2>

                {currentVersion ? (
                    <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                        <div>
                            <dt className="text-xs text-ops-muted">Versi rilis</dt>
                            <dd className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-ops-text tabular-nums">v{currentVersion.version}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-ops-muted">Tanggal rilis</dt>
                            <dd className="mt-1 text-sm font-medium text-ops-text tabular-nums">{currentVersion.releaseDate}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-ops-muted">Sumber branch</dt>
                            <dd className="mt-1 font-mono text-sm text-ops-text">{currentVersion.branch || "main"}</dd>
                        </div>
                    </dl>
                ) : (
                    <p className="text-sm text-ops-muted">Tidak dapat membaca informasi versi lokal.</p>
                )}

                {currentVersion?.changelog && currentVersion.changelog.length > 0 && (
                    <div className="mt-5 border-t border-ops-border pt-4">
                        <p className="mb-2 text-xs font-medium text-ops-muted">Changelog sistem</p>
                        <ul className="list-inside list-disc space-y-1 text-[13px] text-ops-muted">
                            {currentVersion.changelog.map((item, i) => (
                                <li key={i}>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            {updateAvailable && latestVersion && (
                <section className="ops-panel border-ops-success/25 p-5">
                    <div className="flex flex-col items-start gap-4 md:flex-row">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ops-success/25 bg-ops-success-soft text-ops-success">
                            <Download className="size-5" aria-hidden />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-[15px] font-semibold text-ops-success">Pembaruan tersedia</h3>
                            <p className="mt-1 text-sm text-ops-text">
                                Versi <strong className="tabular-nums">v{latestVersion.version}</strong> dirilis pada{" "}
                                <span className="tabular-nums">{latestVersion.releaseDate}</span>.
                            </p>

                            {latestVersion.changelog && latestVersion.changelog.length > 0 && (
                                <div className="mt-4">
                                    <p className="mb-2 text-xs font-medium text-ops-muted">Apa yang baru</p>
                                    <ul className="list-inside list-disc space-y-1 text-[13px] text-ops-muted">
                                        {latestVersion.changelog.map((item, i) => (
                                            <li key={i}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="mt-5 rounded-md border border-ops-border bg-ops-surface-sunken p-4">
                                <p className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ops-text">
                                    <Terminal className="size-4 text-ops-muted" aria-hidden />
                                    Jalankan skrip berikut di server:
                                </p>
                                <div className="space-y-2 font-mono text-[13px]">
                                    <div className="flex items-center gap-3">
                                        <span className="w-24 shrink-0 text-ops-muted">OS Windows</span>
                                        <code className="rounded-sm bg-ops-surface px-2 py-1 text-ops-warning">.\update.ps1</code>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="w-24 shrink-0 text-ops-muted">OS Linux</span>
                                        <code className="rounded-sm bg-ops-surface px-2 py-1 text-ops-success">./update.sh</code>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {!updateAvailable && latestVersion && !isChecking && (
                <section className="ops-panel p-5">
                    <div className="flex items-center gap-4">
                        <div className="flex size-10 items-center justify-center rounded-lg border border-ops-info/20 bg-ops-info-soft text-ops-info">
                            <CheckCircle className="size-5" aria-hidden />
                        </div>
                        <div>
                            <h3 className="text-[15px] font-semibold text-ops-text">Aplikasi sudah mutakhir</h3>
                            <p className="mt-0.5 text-sm text-ops-muted">
                                Menggunakan versi terbaru (v{currentVersion?.version}). Sistem berjalan aman dan stabil.
                            </p>
                        </div>
                    </div>
                </section>
            )}

            <section className="ops-panel p-5">
                <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    Cara kerja pembaruan OTA
                </h2>
                <div className="space-y-3 text-[13px] leading-relaxed text-ops-muted">
                    <p>
                        Skrip otomatisasi mengambil pembaruan versi terbaru langsung dari repositori Git proyek tanpa
                        memberhentikan sistem secara mendadak.
                    </p>
                    <p className="font-medium text-ops-text">Urutan kerja skrip:</p>
                    <ol className="list-inside list-decimal space-y-1.5 pl-1">
                        <li>Backup database otomatis via <code className="text-ops-info">pg_dump</code>.</li>
                        <li>Menarik kode terbaru dengan <code className="text-ops-info">git pull origin main</code>.</li>
                        <li>Build container di belakang layar (zero-downtime saat build).</li>
                        <li>Mengganti container web lama dalam waktu kurang dari 2 detik.</li>
                        <li>Menerapkan skema baru dengan <code className="text-ops-warning">drizzle push</code> bila ada.</li>
                    </ol>
                </div>
            </section>
        </main>
    );
}
