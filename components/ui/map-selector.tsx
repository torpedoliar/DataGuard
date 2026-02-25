"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { switchSite } from "@/actions/auth";

export interface SiteMarker {
    id: number;
    name: string;
    code: string;
    address: string | null;
    latitude: number;
    longitude: number;
}

interface MapSelectorProps {
    sites: SiteMarker[];
    username: string;
    appName: string;
}

// Convert lat/lng to SVG coordinates
// Based on MapSVG geoViewBox: 95.220250 7.356505 141.009728 -10.946766
// SVG dimensions: 792.546 x 316.664
function geoToSvg(lat: number, lng: number): { x: number; y: number } {
    const minLng = 95.22025;
    const maxLng = 141.009728;
    const minLat = -10.946766;
    const maxLat = 7.356505;

    const svgWidth = 792.546;
    const svgHeight = 316.664;

    const x = ((lng - minLng) / (maxLng - minLng)) * svgWidth;
    const y = ((maxLat - lat) / (maxLat - minLat)) * svgHeight;

    return { x, y };
}

export default function MapSelector({ sites, username, appName }: MapSelectorProps) {
    const mapRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const [hoveredSite, setHoveredSite] = useState<SiteMarker | null>(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [selectedSite, setSelectedSite] = useState<SiteMarker | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [stars, setStars] = useState<{ x: number; y: number; size: number; delay: number; opacity: number }[]>([]);

    // Generate stars on mount (client-only)
    useEffect(() => {
        const generated = Array.from({ length: 120 }, () => ({
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: Math.random() * 2 + 0.5,
            delay: Math.random() * 4,
            opacity: Math.random() * 0.6 + 0.2,
        }));
        setStars(generated);
    }, []);

    const handleSiteClick = async (site: SiteMarker) => {
        if (isTransitioning) return;
        setSelectedSite(site);
        setIsTransitioning(true);
        setHoveredSite(null);

        // Start zoom animation
        const svgCoords = geoToSvg(site.latitude, site.longitude);
        if (mapRef.current) {
            const rect = mapRef.current.getBoundingClientRect();
            const percentX = (svgCoords.x / 792.546) * 100;
            const percentY = (svgCoords.y / 316.664) * 100;
            mapRef.current.style.transformOrigin = `${percentX}% ${percentY}%`;
            mapRef.current.style.transform = "scale(6)";
            mapRef.current.style.opacity = "0";
        }

        // Wait for animation, then switch site & redirect
        setTimeout(async () => {
            await switchSite(site.id);
            router.push("/checklist");
        }, 900);
    };

    const handleMouseMove = (e: React.MouseEvent, site: SiteMarker) => {
        setTooltipPos({ x: e.clientX, y: e.clientY });
        setHoveredSite(site);
    };

    return (
        <div className="min-h-screen bg-[#060e1f] flex flex-col items-center justify-center relative overflow-hidden select-none">
            {/* Animated star field */}
            <div className="absolute inset-0 pointer-events-none">
                {stars.map((star, i) => (
                    <div
                        key={i}
                        className="absolute rounded-full bg-white animate-twinkle"
                        style={{
                            left: `${star.x}%`,
                            top: `${star.y}%`,
                            width: star.size,
                            height: star.size,
                            opacity: star.opacity,
                            animationDelay: `${star.delay}s`,
                        }}
                    />
                ))}
            </div>

            {/* Ambient glow behind map */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[400px] bg-blue-600/5 rounded-full blur-[120px]" />
                <div className="absolute top-1/3 left-1/3 w-[400px] h-[300px] bg-cyan-500/5 rounded-full blur-[100px]" />
            </div>

            {/* Header */}
            <div className="relative z-10 text-center mb-8">
                <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                    {appName}
                </h1>
                <p className="text-slate-400 text-sm mt-2">
                    Selamat datang, <span className="text-cyan-400 font-semibold">{username}</span>. Pilih lokasi Data Center Anda.
                </p>
            </div>

            {/* Map container */}
            <div
                ref={mapRef}
                className="relative z-10 w-full max-w-[1000px] mx-auto px-4"
                style={{
                    transition: "transform 0.9s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.9s ease",
                    willChange: "transform, opacity",
                }}
            >
                {/* SVG Map as Image with dark-theme styling */}
                <div className="relative w-full" style={{ aspectRatio: "792.546 / 316.664" }}>
                    <img
                        src="/indonesia-map.svg"
                        alt="Peta Indonesia"
                        className="w-full h-full object-contain pointer-events-none"
                        style={{
                            filter: "invert(0.7) sepia(0.15) saturate(0.6) hue-rotate(180deg) brightness(0.55) contrast(1.1)",
                            opacity: 0.6,
                        }}
                        draggable={false}
                    />

                    {/* Site markers overlay */}
                    {sites.map((site) => {
                        const svgCoords = geoToSvg(site.latitude, site.longitude);
                        const percentX = (svgCoords.x / 792.546) * 100;
                        const percentY = (svgCoords.y / 316.664) * 100;

                        return (
                            <button
                                key={site.id}
                                className="absolute group"
                                style={{
                                    left: `${percentX}%`,
                                    top: `${percentY}%`,
                                    transform: "translate(-50%, -50%)",
                                    zIndex: hoveredSite?.id === site.id ? 30 : 20,
                                }}
                                onClick={() => handleSiteClick(site)}
                                onMouseMove={(e) => handleMouseMove(e, site)}
                                onMouseLeave={() => setHoveredSite(null)}
                            >
                                {/* Outer glow ring */}
                                <span className="absolute inset-0 -m-4 rounded-full bg-cyan-400/10 animate-ping-slow" />
                                <span className="absolute inset-0 -m-3 rounded-full bg-cyan-400/15 animate-pulse" />

                                {/* Marker dot */}
                                <span className="relative block size-4 rounded-full bg-gradient-to-br from-cyan-300 to-blue-500 shadow-[0_0_12px_rgba(34,211,238,0.6)] group-hover:shadow-[0_0_24px_rgba(34,211,238,0.9)] transition-shadow cursor-pointer ring-2 ring-cyan-400/30 group-hover:ring-cyan-400/60 group-hover:scale-125 transition-all duration-200" />

                                {/* Site code label */}
                                <span className="absolute left-1/2 -translate-x-1/2 -bottom-5 text-[10px] font-bold text-cyan-300/80 whitespace-nowrap tracking-wider font-mono">
                                    {site.code}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Floating tooltip */}
            {hoveredSite && !isTransitioning && (
                <div
                    className="fixed z-50 pointer-events-none"
                    style={{
                        left: tooltipPos.x + 16,
                        top: tooltipPos.y - 12,
                    }}
                >
                    <div className="bg-slate-900/95 backdrop-blur-xl border border-cyan-500/20 rounded-xl px-4 py-3 shadow-2xl shadow-cyan-500/10 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
                            <span className="text-white font-bold text-sm">{hoveredSite.name}</span>
                        </div>
                        <div className="text-[10px] text-cyan-400 font-mono mb-1">{hoveredSite.code}</div>
                        {hoveredSite.address && (
                            <p className="text-[11px] text-slate-400 leading-tight">{hoveredSite.address}</p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-500">
                            <span className="material-symbols-outlined text-[12px]">mouse</span>
                            Klik untuk masuk
                        </div>
                    </div>
                </div>
            )}

            {/* Transition overlay */}
            {isTransitioning && selectedSite && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060e1f]/80 backdrop-blur-lg animate-fadeIn">
                    <div className="text-center">
                        <div className="relative inline-flex items-center justify-center mb-6">
                            <span className="absolute size-20 rounded-full border-2 border-cyan-500/30 animate-ping" />
                            <span className="absolute size-14 rounded-full border border-cyan-400/50 animate-pulse" />
                            <span className="material-symbols-outlined text-4xl text-cyan-400 animate-pulse">
                                dns
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-white mb-1">Memasuki {selectedSite.name}</h2>
                        <p className="text-sm text-cyan-400 font-mono">{selectedSite.code}</p>
                        <div className="mt-4 flex items-center justify-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0s]" />
                            <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.15s]" />
                            <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.3s]" />
                        </div>
                    </div>
                </div>
            )}

            {/* Footer hint */}
            {!isTransitioning && sites.length > 0 && (
                <div className="relative z-10 mt-8 text-center">
                    <p className="text-xs text-slate-600 flex items-center justify-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px]">touch_app</span>
                        Klik titik lokasi pada peta untuk masuk ke Data Center
                    </p>
                </div>
            )}

            {/* No sites message */}
            {!isTransitioning && sites.length === 0 && (
                <div className="relative z-10 mt-8 text-center bg-slate-800/50 border border-slate-700/50 rounded-xl px-6 py-4 max-w-md mx-auto">
                    <span className="material-symbols-outlined text-3xl text-amber-400 mb-2">location_off</span>
                    <p className="text-sm text-slate-300 mb-1">Belum ada site dengan koordinat.</p>
                    <p className="text-xs text-slate-500">Hubungi administrator untuk menambahkan koordinat Latitude & Longitude pada Site Management.</p>
                </div>
            )}

            <style jsx>{`
                @keyframes twinkle {
                    0%, 100% { opacity: 0.2; }
                    50% { opacity: 0.8; }
                }
                .animate-twinkle {
                    animation: twinkle 3s ease-in-out infinite;
                }
                @keyframes ping-slow {
                    0% { transform: scale(1); opacity: 0.4; }
                    75%, 100% { transform: scale(2.5); opacity: 0; }
                }
                .animate-ping-slow {
                    animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.3s ease;
                }
            `}</style>
        </div>
    );
}
