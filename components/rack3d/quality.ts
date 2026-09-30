export type Quality = "high" | "medium" | "low";
export type QualitySetting = "auto" | Quality;

export const PRESETS: Record<Quality, {
    shadows: boolean; softShadows: boolean; ao: boolean; bloom: boolean; dof: boolean; reflections: boolean; dpr: [number, number];
}> = {
    high: { shadows: true, softShadows: true, ao: true, bloom: true, dof: true, reflections: true, dpr: [1, 2] },
    medium: { shadows: true, softShadows: false, ao: false, bloom: true, dof: false, reflections: true, dpr: [1, 1.5] },
    low: { shadows: false, softShadows: false, ao: false, bloom: false, dof: false, reflections: false, dpr: [1, 1] },
};

// Renderer-string heuristic instead of detect-gpu (which downloads its
// benchmark table from a CDN — unavailable on the intranet).
const DISCRETE_GPU = /nvidia|geforce|quadro|radeon rx|radeon pro|arc a\d/i;

export function initialQuality(renderer: string, isMobile: boolean): Quality {
    if (isMobile) return "low";
    return DISCRETE_GPU.test(renderer) ? "high" : "medium";
}

export const stepDown = (q: Quality): Quality => (q === "high" ? "medium" : "low");

export const resolveQuality = (setting: QualitySetting, auto: Quality): Quality => (setting === "auto" ? auto : setting);
