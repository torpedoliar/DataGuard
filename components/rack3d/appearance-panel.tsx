"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { updateRoomAppearance } from "@/actions/room-appearance";
import { LIGHT_PRESETS, WALLPAPERS, type RoomAppearance, type Wallpaper, type WallpaperMode } from "@/lib/room-appearance";

const WALL_LABEL: Record<Wallpaper, string> = {
    none: "Plain",
    brick: "Brick",
    acoustic: "Acoustic panel",
    concrete: "Concrete",
    custom: "Custom image",
};
const field = "h-8 w-full rounded-md border border-ops-border bg-ops-bg px-2 text-sm text-ops-text";

// Live-preview editor for one room's look; Save writes it to the location.
export function AppearancePanel({ locationId, value, onPreview, onSaved, onClose }: {
    locationId: number;
    value: RoomAppearance;
    onPreview: (a: RoomAppearance) => void;
    onSaved: (a: RoomAppearance) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(value);
    const [file, setFile] = useState<File | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

    const change = (patch: Partial<RoomAppearance>) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        onPreview(next);
    };
    const pickFile = (f: File | null) => {
        if (f && f.size > 5 * 1024 * 1024) {
            setError("Image file is too large. Maximum size is 5 MB.");
            return;
        }
        setError(null);
        const url = f ? URL.createObjectURL(f) : null;
        setFile(f);
        setBlobUrl(url);
        change({ wallpaper: "custom", wallpaperPath: url ?? value.wallpaperPath });
    };
    const save = async () => {
        setSaving(true);
        setError(null);
        const fd = new FormData();
        fd.set("lightColor", draft.lightColor ?? "");
        fd.set("lightBrightness", String(draft.lightBrightness));
        fd.set("wallpaper", draft.wallpaper);
        fd.set("wallpaperMode", draft.wallpaperMode);
        if (file && draft.wallpaper === "custom") fd.set("wallpaperFile", file);
        const res = await updateRoomAppearance(locationId, fd)
            .catch(() => ({ success: false as const, message: "Failed to save the room appearance." }));
        setSaving(false);
        if (res.success) onSaved(res.appearance);
        else setError(res.message);
    };

    return (
        <div role="dialog" aria-label="Room appearance" className="absolute right-3 top-14 z-20 w-72 space-y-3 rounded-xl border border-ops-border bg-ops-surface/95 p-4 text-sm shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-ops-text">Room appearance</h4>
                <button type="button" onClick={onClose} aria-label="Close appearance" className="text-ops-muted hover:text-ops-text"><X className="h-4 w-4" /></button>
            </div>

            <fieldset className="space-y-2">
                <legend className="mb-1 text-xs text-ops-muted">Light colour</legend>
                <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => change({ lightColor: null })} className={`rounded-md border px-2 py-1 text-xs ${draft.lightColor === null ? "border-ops-accent text-ops-accent" : "border-ops-border text-ops-text"}`}>Default</button>
                    {LIGHT_PRESETS.map((p) => (
                        <button key={p.color} type="button" onClick={() => change({ lightColor: p.color })} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${draft.lightColor === p.color ? "border-ops-accent text-ops-accent" : "border-ops-border text-ops-text"}`}>
                            <span className="size-3 rounded-full border border-black/10" style={{ backgroundColor: p.color }} /> {p.name}
                        </button>
                    ))}
                </div>
                <input type="color" aria-label="Custom light colour" value={draft.lightColor ?? "#e6eefc"} onChange={(e) => change({ lightColor: e.target.value })} className="h-8 w-full cursor-pointer rounded-md border border-ops-border bg-ops-bg" />
            </fieldset>

            <label className="block space-y-1">
                <span className="text-xs text-ops-muted">Brightness {Math.round(draft.lightBrightness * 100)}%</span>
                <input type="range" min={0} max={200} step={5} value={Math.round(draft.lightBrightness * 100)} onChange={(e) => change({ lightBrightness: Number(e.target.value) / 100 })} className="w-full" />
            </label>

            <label className="block space-y-1">
                <span className="text-xs text-ops-muted">Wallpaper</span>
                <select value={draft.wallpaper} onChange={(e) => {
                    const next = e.target.value as Wallpaper;
                    change({ wallpaper: next, wallpaperPath: next === "custom" ? blobUrl ?? value.wallpaperPath : null });
                }} className={field}>
                    {WALLPAPERS.map((w) => <option key={w} value={w}>{WALL_LABEL[w]}</option>)}
                </select>
            </label>

            {draft.wallpaper === "custom" && (
                <>
                    <div className="space-y-1">
                        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Wallpaper image" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="block w-full text-xs text-ops-muted file:mr-2 file:rounded file:border-0 file:bg-ops-accent/15 file:px-2 file:py-1 file:text-ops-accent" />
                        <p className="text-[10px] text-ops-muted">Max 5 MB (PNG, JPG, WebP)</p>
                    </div>
                    <label className="block space-y-1">
                        <span className="text-xs text-ops-muted">Fit</span>
                        <select value={draft.wallpaperMode} onChange={(e) => change({ wallpaperMode: e.target.value as WallpaperMode })} className={field}>
                            <option value="tile">Tile (repeat)</option>
                            <option value="stretch">Stretch (one image per wall)</option>
                        </select>
                    </label>
                </>
            )}

            {error && <p role="alert" className="text-xs text-ops-danger">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose} className="rounded-md border border-ops-border px-3 py-1.5 text-ops-text hover:bg-ops-bg">Cancel</button>
                <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-ops-accent px-3 py-1.5 font-medium text-white disabled:opacity-60">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                </button>
            </div>
        </div>
    );
}
