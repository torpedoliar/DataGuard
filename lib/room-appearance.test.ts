import { describe, expect, it } from "vitest";
import { appearanceFormSchema, DEFAULT_APPEARANCE, resolveAppearance } from "./room-appearance";

describe("resolveAppearance", () => {
  it("defaults when the location has no settings (or no location at all)", () => {
    expect(resolveAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(resolveAppearance({})).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps valid stored values", () => {
    expect(resolveAppearance({ lightColor: "#ffd9a8", lightBrightness: 1.5, wallpaper: "custom", wallpaperPath: "/uploads/wallpapers/a.png", wallpaperMode: "stretch" }))
      .toEqual({ lightColor: "#ffd9a8", lightBrightness: 1.5, wallpaper: "custom", wallpaperPath: "/uploads/wallpapers/a.png", wallpaperMode: "stretch" });
  });

  it("falls back on junk: bad colour, brightness out of range, unknown wallpaper, custom without a file", () => {
    expect(resolveAppearance({ lightColor: "red", lightBrightness: 9, wallpaper: "marble", wallpaperMode: "x" })).toEqual(DEFAULT_APPEARANCE);
    expect(resolveAppearance({ wallpaper: "custom", wallpaperPath: null }).wallpaper).toBe("none");
    expect(resolveAppearance({ wallpaper: "brick", wallpaperPath: "/uploads/old.png" }).wallpaperPath).toBeNull();
  });
});

describe("appearanceFormSchema", () => {
  it("parses the form and maps an empty colour to the theme default", () => {
    expect(appearanceFormSchema.parse({ lightColor: "", lightBrightness: "1.25", wallpaper: "brick", wallpaperMode: "tile" }))
      .toEqual({ lightColor: null, lightBrightness: 1.25, wallpaper: "brick", wallpaperMode: "tile" });
  });

  it("rejects bad input", () => {
    expect(appearanceFormSchema.safeParse({ lightColor: "#12", lightBrightness: "1", wallpaper: "brick", wallpaperMode: "tile" }).success).toBe(false);
    expect(appearanceFormSchema.safeParse({ lightColor: "", lightBrightness: "3", wallpaper: "brick", wallpaperMode: "tile" }).success).toBe(false);
    expect(appearanceFormSchema.safeParse({ lightColor: "", lightBrightness: "1", wallpaper: "marble", wallpaperMode: "tile" }).success).toBe(false);
  });
});
