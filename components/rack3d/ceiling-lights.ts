import type { Bounds } from "./layout";
import type { Quality } from "./quality";

function centres(min: number, max: number, pitch: number, limit = Infinity) {
    const count = Math.max(1, Math.floor((max - min) / pitch));
    const samples = Math.min(count, limit);
    return Array.from({ length: samples }, (_, i) => {
        const index = Math.floor((i + 0.5) * count / samples);
        return min + (index + 0.5) * (max - min) / count;
    });
}

// Sample actual diffuser centres for illumination. A dense ceiling still
// uses at most six unshadowed local lights, independent of its fixture count.
export function ceilingLights(b: Bounds, quality?: Quality): [number, number][] {
    const xs = centres(b.minX, b.maxX, 1.8, quality === "low" ? 1 : quality === "medium" ? 2 : quality === "high" ? 3 : Infinity);
    const zs = centres(b.minZ, b.maxZ, 2.4, quality === "low" ? 1 : quality ? 2 : Infinity);
    return xs.flatMap((x) => zs.map((z): [number, number] => [x, z]));
}
