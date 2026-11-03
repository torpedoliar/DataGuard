
import Link from "next/link";
import { getSettings } from "@/actions/settings";
import { Shield, Github, Heart, Users, Lock, Server, Code2, Star, ExternalLink, Activity } from "lucide-react";
import versionData from "@/version.json";

export const metadata = {
    title: "About | DataGuard",
    description: "About DataGuard DC-Check System – Created by Team Operational Support SJA"
};

export default async function AboutPage() {
    const appSettings = await getSettings();

    const features = [
        { icon: <Server className="h-5 w-5" />, label: "Device Inventory", desc: "Manajemen inventaris perangkat data center" },
        { icon: <Activity className="h-5 w-5" />, label: "Checklist & Audit", desc: "Pencatatan kondisi perangkat secara berkala" },
        { icon: <Shield className="h-5 w-5" />, label: "Audit Log", desc: "Rekam jejak seluruh aktivitas sistem" },
        { icon: <Lock className="h-5 w-5" />, label: "Rack Management", desc: "Visualisasi layout rack data center" },
        { icon: <Code2 className="h-5 w-5" />, label: "Multi-Site", desc: "Dukungan pengelolaan multi lokasi data center" },
        { icon: <Users className="h-5 w-5" />, label: "User Management", desc: "Manajemen pengguna dengan role-based access" },
    ];

    return (
        <main className="mx-auto flex w-full max-w-3xl animate-enter flex-col gap-5 px-4 py-8 lg:px-6">

            {/* Hero */}
            <div className="flex flex-col items-center text-center">

                {/* ASCII Art Logo */}
                <div className="mb-8 overflow-x-auto">
                    <pre className="inline-block text-left font-mono text-[10px] sm:text-xs leading-tight text-ops-info drop-shadow-[0_0_8px_rgba(96,165,250,0.7)] select-none whitespace-pre">{`   _____ ____  ____  _______  __
  / ___// __ \\/ __ \\/ ____/ |/ /
 / /   / / / / / / / __/  |   / 
/ /___/ /_/ / /_/ / /___ /   |  
\\____/\\____/_____/_____//_/|_|  

    ____  ____                    __         
   / __ \\/ __ \\___  __________ _/ /_(_)___  ____  ____ _/ /
  / / / / /_/ / _ \\/ ___/ __ \`/ __/ / __ \\/ __ \\/ __ \`/ / 
 / /_/ / ____/  __/ /  / /_/ / /_/ / /_/ / / / / /_/ / /  
 \\____/_/    \\___/_/   \\__,_/\\__/_/\\____/_/ /_/\\__,_/_/   `}</pre>
                    <p className="mt-3 font-mono text-xs sm:text-sm tracking-[0.25em] text-ops-muted">
                        <span className="text-ops-info font-bold">[C]</span>ontrol{" "}
                        <span className="text-ops-info font-bold">[O]</span>ptimize{" "}
                        <span className="text-ops-info font-bold">[D]</span>eploy{" "}
                        <span className="text-ops-info font-bold">[E]</span>xecute{" "}
                        <span className="text-ops-info font-bold">[X]</span>system
                    </p>
                </div>

                <div className="inline-flex items-center justify-center mb-6">
                    {appSettings.logoPath ? (
                        <img src={appSettings.logoPath} alt="Logo" className="h-20 w-auto object-contain" />
                    ) : (
                        <div className="flex size-14 items-center justify-center rounded-xl border border-ops-border bg-ops-surface-raised text-ops-info">
                            <Shield className="size-7" />
                        </div>
                    )}
                </div>
                <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-ops-text">About {appSettings.appName}</h1>
                <p className="mt-1 text-sm text-ops-muted">Data center monitoring &amp; audit system</p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-sm border border-ops-border bg-ops-surface px-2.5 py-1 text-[13px] text-ops-muted">
                    <Star className="h-3.5 w-3.5" />
                    Version {versionData.version} — Released {versionData.releaseDate}
                </div>
            </div>


            {/* Credits Card */}
            <div className="ops-panel p-5">
                <div>
                    <h2 className="text-xl font-bold text-ops-text mb-6 flex items-center gap-2">
                        <Heart className="h-5 w-5 text-ops-danger" />
                        Credits
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Created By */}
                        <div className="ops-panel-subtle p-5">
                            <p className="mb-1 text-xs text-ops-muted">Created by</p>
                            <p className="text-base font-medium text-ops-text">Team Operational Support</p>
                            <p className="text-ops-info font-medium">SJA</p>
                            <p className="mt-2 text-[13px] text-ops-muted">
                                Tim yang berdedikasi membangun dan memelihara infrastruktur data center yang handal dan terdokumentasi dengan baik.
                            </p>
                        </div>

                        {/* Licensed By */}
                        <div className="ops-panel-subtle p-5">
                            <p className="mb-1 text-xs text-ops-muted">Licensed by</p>
                            <p className="flex items-center gap-2 text-base font-medium text-ops-text">
                                <Github className="size-4" aria-hidden />
                                Torpedoliar
                            </p>
                            <p className="mt-2 text-[13px] text-ops-muted">
                                Dikembangkan dan dirilis secara open-source untuk komunitas pengelola data center Indonesia.
                            </p>
                            <Link
                                href="https://github.com/torpedoliar"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-3 inline-flex items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-2.5 py-1.5 text-[13px] text-ops-text transition-colors hover:bg-ops-surface-raised"
                            >
                                <Github className="h-3.5 w-3.5" />
                                github.com/torpedoliar
                                <ExternalLink className="h-3 w-3 text-ops-muted " />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Repository */}
            <div className="ops-panel p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    <Code2 className="size-4 text-ops-info" aria-hidden />
                    Repository
                </h2>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex-1">
                        <p className="text-ops-muted text-sm mb-1">Source code tersedia publik di GitHub:</p>
                        <a
                            href={versionData.repository}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ops-info hover:text-ops-info text-sm font-mono break-all transition-colors"
                        >
                            {versionData.repository}
                        </a>
                    </div>
                    <Link
                        href={versionData.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ops-accent hover:bg-ops-accent-hover text-ops-accent-fg text-sm font-medium transition-colors"
                    >
                        <Github className="h-4 w-4" />
                        Lihat di GitHub
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </div>

            {/* Features */}
            <div className="ops-panel p-5">
                <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    <Star className="size-4 text-ops-warning" aria-hidden />
                    Fitur Utama
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {features.map((f, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-md border border-ops-border bg-ops-surface-raised/60 p-3">
                            <div className="shrink-0 rounded-md bg-ops-info-soft p-2 text-ops-info [&_svg]:size-4">
                                {f.icon}
                            </div>
                            <div>
                                <p className="text-[13px] font-medium text-ops-text">{f.label}</p>
                                <p className="mt-0.5 text-xs text-ops-muted">{f.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Changelog */}
            <div className="ops-panel p-5">
                <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ops-text">
                    Changelog v{versionData.version}
                </h2>
                <ul className="space-y-2">
                    {versionData.changelog.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-ops-muted">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-ops-accent shrink-0" />
                            {item}
                        </li>
                    ))}
                </ul>

                <div className="mt-4 border-t border-ops-border pt-3 text-center text-xs text-ops-muted">
                    Dibuat dengan <span className="text-ops-danger">♥</span> oleh Team Operational Support SJA · Licensed by Torpedoliar
                </div>
            </div>
        </main>
    );
}
