"use client";

import { useRef, useState, type MouseEvent } from "react";
import { switchSite } from "@/actions/auth";
import { MapPin, MousePointer2, Server } from "lucide-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

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
  // N50: optional pre-selection. When set, this site is shown as "current
  // selection" but the user still has to click to enter — we never auto-navigate
  // from a multi-site map to avoid surprising users.
  defaultSelectedId?: number | null;
}

// Convert lat/lng to SVG coordinates.
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

export default function MapSelector({ sites, username, appName, defaultSelectedId = null }: MapSelectorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [hoveredSite, setHoveredSite] = useState<SiteMarker | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedSite, setSelectedSite] = useState<SiteMarker | null>(
    defaultSelectedId != null ? sites.find((s) => s.id === defaultSelectedId) ?? null : null,
  );
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleSiteClick = async (site: SiteMarker) => {
    if (isTransitioning) return;
    setSelectedSite(site);
    setIsTransitioning(true);
    setHoveredSite(null);

    const svgCoords = geoToSvg(site.latitude, site.longitude);
    if (mapRef.current) {
      const percentX = (svgCoords.x / 792.546) * 100;
      const percentY = (svgCoords.y / 316.664) * 100;
      mapRef.current.style.transformOrigin = `${percentX}% ${percentY}%`;
      mapRef.current.style.transform = "scale(2.4)";
      mapRef.current.style.opacity = "0.18";
    }

    window.setTimeout(async () => {
      await switchSite(site.id);
      router.push("/checklist");
    }, 420);
  };

  const handleMouseMove = (event: MouseEvent, site: SiteMarker) => {
    setTooltipPos({ x: event.clientX, y: event.clientY });
    setHoveredSite(site);
  };

  return (
    <div className="relative flex min-h-dvh select-none flex-col overflow-hidden bg-ops-bg text-ops-text">
      <div aria-hidden className="ops-grid-bg pointer-events-none absolute inset-0 opacity-60" />
      <header className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-5 pb-3 pt-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-ops-accent text-ops-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">
              <Server className="size-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{appName}</h1>
              <p className="text-sm text-ops-muted">Welcome back, <span className="font-medium text-ops-text">{username}</span></p>
            </div>
          </div>
          <p className="max-w-2xl text-[15px] text-ops-muted">Choose a data center to open its workspace.</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-1.5 text-[13px] text-ops-muted">
          <MapPin className="size-4 text-ops-accent" />
          <span className="font-medium tabular-nums text-ops-text">{sites.length}</span> mapped {sites.length === 1 ? "site" : "sites"}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-10">
        <div
          ref={mapRef}
          className="relative mx-auto w-full max-w-[1080px]"
          style={{
            transition: "transform 420ms cubic-bezier(0.2, 0, 0, 1), opacity 420ms ease",
            willChange: "transform, opacity",
          }}
        >
          <div className="relative w-full" style={{ aspectRatio: "792.546 / 316.664" }}>
            {/* Land is painted from the theme token through the SVG as a mask, so
                the map reads cleanly in both light and dark mode. */}
            <div
              role="img"
              aria-label="Peta Indonesia"
              className="h-full w-full bg-ops-border-strong"
              style={{
                maskImage: "url(/indonesia-map.svg)",
                WebkitMaskImage: "url(/indonesia-map.svg)",
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskPosition: "center",
              }}
            />

            {sites.map((site) => {
              const svgCoords = geoToSvg(site.latitude, site.longitude);
              const percentX = (svgCoords.x / 792.546) * 100;
              const percentY = (svgCoords.y / 316.664) * 100;
              const active = hoveredSite?.id === site.id;
              const isPreset = defaultSelectedId === site.id;

              return (
                <button
                  key={site.id}
                  type="button"
                  aria-label={`Select ${site.name}`}
                  className="absolute flex size-9 items-center justify-center rounded-full"
                  style={{
                    left: `${percentX}%`,
                    top: `${percentY}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: active ? 30 : 20,
                  }}
                  onClick={() => handleSiteClick(site)}
                  onMouseMove={(event) => handleMouseMove(event, site)}
                  onMouseLeave={() => setHoveredSite(null)}
                >
                  <span
                    className={clsx(
                      "absolute size-9 rounded-full border transition-[transform,background-color,border-color] duration-200",
                      active
                        ? "scale-110 border-ops-accent bg-ops-accent/20"
                        : isPreset
                          ? "border-ops-accent/70 bg-ops-accent/12"
                          : "border-ops-accent/40 bg-ops-surface/70",
                    )}
                  />
                  <span aria-hidden className="absolute size-9 animate-ping rounded-full bg-ops-accent/15 [animation-duration:2.4s]" />
                  <span
                    className={clsx(
                      "relative size-3 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ops-accent)_25%,transparent)] transition-transform",
                      active
                        ? "scale-125 bg-ops-accent"
                        : isPreset
                          ? "scale-110 bg-ops-accent"
                          : "bg-ops-accent",
                    )}
                  />
                  <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border border-ops-border bg-ops-surface/95 px-1.5 py-0.5 font-mono text-[11px] font-medium text-ops-text shadow-[var(--shadow-raised)]">
                    {site.code}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!isTransitioning && sites.length > 0 && (
          <div className="relative z-10 mt-8 inline-flex animate-enter items-center gap-2 rounded-md border border-ops-border bg-ops-surface px-3 py-2 text-[13px] text-ops-muted">
            <MousePointer2 className="size-4 text-ops-accent" />
            Click a map marker to enter the data center.
          </div>
        )}

        {!isTransitioning && sites.length === 0 && (
          <div className="relative z-10 mt-8 max-w-md rounded-lg border border-ops-warning/25 bg-ops-warning-soft px-5 py-4 text-center">
            <MapPin className="mx-auto mb-2 size-6 text-ops-warning" />
            <p className="text-sm font-semibold text-ops-text">No sites with coordinates.</p>
            <p className="mt-1 text-xs text-ops-muted">Add latitude and longitude in Site Management.</p>
          </div>
        )}
      </main>

      {hoveredSite && !isTransitioning && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 12,
          }}
        >
          <div className="min-w-[220px] animate-scale-in rounded-lg border border-ops-border bg-ops-surface px-3.5 py-3 shadow-[var(--shadow-overlay)]">
            <div className="mb-1 flex items-center gap-2">
              <span className="size-2 rounded-full bg-ops-accent" />
              <span className="text-sm font-semibold text-ops-text">{hoveredSite.name}</span>
            </div>
            <div className="mb-1 font-mono text-[11px] text-ops-muted">{hoveredSite.code}</div>
            {hoveredSite.address && <p className="text-xs leading-snug text-ops-muted">{hoveredSite.address}</p>}
          </div>
        </div>
      )}

      {isTransitioning && selectedSite && (
        <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ops-bg/90 backdrop-blur-sm">
          <div className="text-center">
            <div className="mx-auto mb-5 flex size-12 animate-scale-in items-center justify-center rounded-lg border border-ops-accent/30 bg-ops-accent-soft text-ops-accent">
              <Server className="size-6" />
            </div>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-ops-text">Opening {selectedSite.name}</h2>
            <p className="mt-1 font-mono text-[13px] text-ops-muted">{selectedSite.code}</p>
          </div>
        </div>
      )}
    </div>
  );
}
