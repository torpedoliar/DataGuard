
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
        <div className="max-w-4xl mx-auto px-5 py-12">

            {/* Hero */}
            <div className="text-center mb-12">

                {/* ASCII Art Logo */}
                <div className="mb-8 overflow-x-auto">
                    <pre className="inline-block text-left font-mono text-[10px] sm:text-xs leading-tight text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.7)] select-none whitespace-pre">{`   _____ ____  ____  _______  __
  / ___// __ \\/ __ \\/ ____/ |/ /
 / /   / / / / / / / __/  |   / 
/ /___/ /_/ / /_/ / /___ /   |  
\\____/\\____/_____/_____//_/|_|  

    ____  ____                    __         
   / __ \\/ __ \\___  __________ _/ /_(_)___  ____  ____ _/ /
  / / / / /_/ / _ \\/ ___/ __ \`/ __/ / __ \\/ __ \\/ __ \`/ / 
 / /_/ / ____/  __/ /  / /_/ / /_/ / /_/ / / / / /_/ / /  
 \\____/_/    \\___/_/   \\__,_/\\__/_/\\____/_/ /_/\\__,_/_/   `}</pre>
                    <p className="mt-3 font-mono text-xs sm:text-sm tracking-[0.25em] text-slate-300">
                        <span className="text-blue-400 font-bold">[C]</span>ontrol{" "}
                        <span className="text-blue-400 font-bold">[O]</span>ptimize{" "}
                        <span className="text-blue-400 font-bold">[D]</span>eploy{" "}
                        <span className="text-blue-400 font-bold">[E]</span>xecute{" "}
                        <span className="text-blue-400 font-bold">[X]</span>system
                    </p>
                </div>

                <div className="inline-flex items-center justify-center mb-6">
                    {appSettings.logoPath ? (
                        <img src={appSettings.logoPath} alt="Logo" className="h-20 w-auto object-contain" />
                    ) : (
                        <div className="size-20 rounded-2xl bg-gradient-to-br from-blue-500/30 to-indigo-600/30 border border-blue-500/30 flex items-center justify-center">
                            <Shield className="h-10 w-10 text-blue-400" />
                        </div>
                    )}
                </div>
                <h1 className="text-4xl font-bold text-white mb-2">{appSettings.appName}</h1>
                <p className="text-slate-400 text-lg mb-4">Data Center Monitoring &amp; Audit System</p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm">
                    <Star className="h-3.5 w-3.5" />
                    Version {versionData.version} — Released {versionData.releaseDate}
                </div>
            </div>


            {/* Credits Card */}
            <div className="bg-gradient-to-br from-[#111827] to-[#0f172a] border border-slate-700/50 rounded-2xl p-8 mb-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 pointer-events-none" />

                <div className="relative">
                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                        <Heart className="h-5 w-5 text-red-400" />
                        Credits
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Created By */}
                        <div className="bg-slate-800/40 rounded-xl p-5 border border-slate-700/40">
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Created by</p>
                            <p className="text-white font-semibold text-lg">Team Operational Support</p>
                            <p className="text-blue-400 font-medium">SJA</p>
                            <p className="text-slate-400 text-sm mt-2">
                                Tim yang berdedikasi membangun dan memelihara infrastruktur data center yang handal dan terdokumentasi dengan baik.
                            </p>
                        </div>

                        {/* Licensed By */}
                        <div className="bg-slate-800/40 rounded-xl p-5 border border-slate-700/40">
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Licensed by</p>
                            <p className="text-white font-semibold text-lg flex items-center gap-2">
                                <Github className="h-5 w-5" />
                                Torpedoliar
                            </p>
                            <p className="text-slate-400 text-sm mt-2 mb-3">
                                Dikembangkan dan dirilis secara open-source untuk komunitas pengelola data center Indonesia.
                            </p>
                            <Link
                                href="https://github.com/torpedoliar"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors"
                            >
                                <Github className="h-3.5 w-3.5" />
                                github.com/torpedoliar
                                <ExternalLink className="h-3 w-3 text-slate-400" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Repository */}
            <div className="bg-[#111827] border border-slate-800/70 rounded-xl p-6 mb-8">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Code2 className="h-5 w-5 text-blue-400" />
                    Repository
                </h2>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex-1">
                        <p className="text-slate-300 text-sm mb-1">Source code tersedia publik di GitHub:</p>
                        <a
                            href={versionData.repository}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 text-sm font-mono break-all transition-colors"
                        >
                            {versionData.repository}
                        </a>
                    </div>
                    <Link
                        href={versionData.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                    >
                        <Github className="h-4 w-4" />
                        Lihat di GitHub
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </div>

            {/* Features */}
            <div className="bg-[#111827] border border-slate-800/70 rounded-xl p-6 mb-8">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Star className="h-5 w-5 text-amber-400" />
                    Fitur Utama
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {features.map((f, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
                            <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400 shrink-0">
                                {f.icon}
                            </div>
                            <div>
                                <p className="text-white text-sm font-medium">{f.label}</p>
                                <p className="text-slate-400 text-xs mt-0.5">{f.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Changelog */}
            <div className="bg-[#111827] border border-slate-800/70 rounded-xl p-6">
                <h2 className="text-lg font-bold text-white mb-4">
                    Changelog v{versionData.version}
                </h2>
                <ul className="space-y-2">
                    {versionData.changelog.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                            {item}
                        </li>
                    ))}
                </ul>

                <div className="mt-6 pt-4 border-t border-slate-800/70 text-center text-xs text-slate-600">
                    Dibuat dengan <span className="text-red-500">♥</span> oleh Team Operational Support SJA · Licensed by Torpedoliar
                </div>
            </div>
        </div>
    );
}
