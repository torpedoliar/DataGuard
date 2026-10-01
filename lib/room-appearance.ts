import { z } from "zod";

export const WALLPAPERS = ["none", "brick", "acoustic", "concrete", "custom"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];
export const WALLPAPER_MODES = ["tile", "stretch"] as const;
export type WallpaperMode = (typeof WALLPAPER_MODES)[number];

export const LIGHT_PRESETS = [
    { name: "Cool white", color: "#e6eefc" },
    { name: "Warm", color: "#ffd9a8" },
    { name: "Blue NOC", color: "#7fb2ff" },
] as const;

export interface RoomAppearance {
    lightColor: string | null; // null = the theme's default lighting
    lightBrightness: number;   // 0..2, 1 = default
    wallpaper: Wallpaper;
    wallpaperPath: string | null; // only for "custom"
    wallpaperMode: WallpaperMode;
}

export const DEFAULT_APPEARANCE: RoomAppearance = {
    lightColor: null,
    lightBrightness: 1,
    wallpaper: "none",
    wallpaperPath: null,
    wallpaperMode: "tile",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

type Row = {
    lightColor?: string | null;
    lightBrightness?: number | null;
    wallpaper?: string | null;
    wallpaperPath?: string | null;
    wallpaperMode?: string | null;
};

// DB row (or nothing, for a rack without a location) to a safe appearance:
// anything unknown falls back to the default look.
export function resolveAppearance(row: Row | null | undefined): RoomAppearance {
    const known = (WALLPAPERS as readonly string[]).includes(row?.wallpaper ?? "") ? (row!.wallpaper as Wallpaper) : "none";
    const wallpaper = known === "custom" && !row?.wallpaperPath ? "none" : known;
    const b = row?.lightBrightness;
    return {
        lightColor: row?.lightColor && HEX.test(row.lightColor) ? row.lightColor : null,
        lightBrightness: typeof b === "number" && b >= 0 && b <= 2 ? b : 1,
        wallpaper,
        wallpaperPath: wallpaper === "custom" ? row?.wallpaperPath ?? null : null,
        wallpaperMode: row?.wallpaperMode === "stretch" ? "stretch" : "tile",
    };
}

export const appearanceFormSchema = z.object({
    lightColor: z.union([z.literal(""), z.string().regex(HEX)]).transform((v) => v || null),
    lightBrightness: z.coerce.number().min(0).max(2),
    wallpaper: z.enum(WALLPAPERS),
    wallpaperMode: z.enum(WALLPAPER_MODES),
});
