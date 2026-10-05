export type Quality = "high" | "medium" | "low";
export type QualitySetting = "auto" | Quality;

export const QUALITY_SETTINGS: QualitySetting[] = ["auto", "high", "medium", "low"];

export const QUALITY_LABELS: Record<QualitySetting, string> = {
    auto: "Auto",
    high: "High: soft shadows, AO, bloom",
    medium: "Medium: shadows, bloom",
    low: "Low: no shadows or effects",
};

export const PRESETS: Record<Quality, {
    shadows: boolean; softShadows: boolean; ao: boolean; bloom: boolean; dof: boolean; reflections: boolean; dpr: [number, number];
}> = {
    high: { shadows: true, softShadows: true, ao: true, bloom: true, dof: false, reflections: true, dpr: [1, 2] },
    medium: { shadows: true, softShadows: false, ao: false, bloom: true, dof: false, reflections: false, dpr: [1, 1.5] },
    low: { shadows: false, softShadows: false, ao: false, bloom: false, dof: false, reflections: false, dpr: [1, 1] },
};

// Renderer-string heuristic instead of detect-gpu (which downloads its
// benchmark table from a CDN — unavailable on the intranet).
const DISCRETE_GPU = /nvidia|geforce|quadro|radeon rx|radeon pro|arc a\d/i;
// CPU rasterisers (no GPU driver, RDP sessions, VMs): even Medium stutters.
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|basic render driver/i;

export function initialQuality(renderer: string, isMobile: boolean): Quality {
    if (isMobile || SOFTWARE_GPU.test(renderer)) return "low";
    return DISCRETE_GPU.test(renderer) ? "high" : "medium";
}

export const resolveQuality = (setting: QualitySetting, auto: Quality): Quality => (setting === "auto" ? auto : setting);

export const parseQualitySetting = (value: string | null): QualitySetting =>
    QUALITY_SETTINGS.includes(value as QualitySetting) ? (value as QualitySetting) : "auto";
