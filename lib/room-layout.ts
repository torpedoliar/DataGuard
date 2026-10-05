import { z } from "zod";

const coordinate = z.number().finite().min(-1000).max(1000).nullable();
export const roomLayoutSchema = z.object({
    siteId: z.number().int().positive(),
    roomId: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    width: z.number().finite().positive().max(1000),
    depth: z.number().finite().positive().max(1000),
    height: z.number().finite().positive().max(100),
    acknowledgeEstimated: z.boolean().default(false),
    assets: z.array(z.object({
        key: z.string().regex(/^(rack|device):[1-9]\d*$/),
        x: coordinate,
        z: coordinate,
        rotation: z.number().finite().nullable(),
    }).superRefine((a, c) => {
        if ([a.x, a.z, a.rotation].some((n) => n === null) && [a.x, a.z, a.rotation].some((n) => n !== null)) {
            c.addIssue({ code: "custom", message: "Posisi harus lengkap atau Unplaced." });
        }
    })).max(1000),
}).superRefine((value, context) => {
    if (new Set(value.assets.map((a) => a.key)).size !== value.assets.length) {
        context.addIssue({ code: "custom", path: ["assets"], message: "Aset duplikat." });
    }
});

export type RoomLayoutInput = z.infer<typeof roomLayoutSchema>;
export interface Footprint {
    key: string;
    x: number;
    z: number;
    rotation: number;
    width: number;
    depth: number;
    height: number;
    estimated: boolean;
    footprintEstimated?: boolean;
    heightEstimated?: boolean;
}
export interface RoomSize { width: number; depth: number; height: number }
export interface Point { x: number; z: number }

export function footprintCorners(asset: Footprint): Point[] {
    const angle = asset.rotation * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
        const x = sx * asset.width / 2, z = sz * asset.depth / 2;
        return { x: Math.round((asset.x + x * cos + z * sin) * 1e9) / 1e9, z: Math.round((asset.z - x * sin + z * cos) * 1e9) / 1e9 };
    });
}

function overlaps(a: Point[], b: Point[]) {
    // Separating-axis test; touching edges are not overlapping interiors.
    for (const polygon of [a, b]) {
        for (let i = 0; i < polygon.length; i++) {
            const p = polygon[i], q = polygon[(i + 1) % polygon.length];
            const axis = { x: -(q.z - p.z), z: q.x - p.x };
            const project = (points: Point[]) => points.map((v) => v.x * axis.x + v.z * axis.z);
            const pa = project(a), pb = project(b);
            if (Math.max(...pa) <= Math.min(...pb) + 1e-8 || Math.max(...pb) <= Math.min(...pa) + 1e-8) return false;
        }
    }
    return true;
}

export function validateRoomLayout(room: RoomSize, assets: Footprint[]) {
    const errors: string[] = [], warnings: string[] = [];
    const corners = assets.map(footprintCorners);
    const add = (estimated: boolean, message: string) => (estimated ? warnings : errors).push(message);
    assets.forEach((asset, i) => {
        if (asset.x < 0 || asset.z < 0 || asset.x > room.width || asset.z > room.depth) errors.push(`${asset.key}: titik pusat di luar ruangan.`);
        if (corners[i].some((p) => p.x < -1e-8 || p.x > room.width + 1e-8 || p.z < -1e-8 || p.z > room.depth + 1e-8)) {
            add(asset.footprintEstimated ?? asset.estimated, `${asset.key}: footprint di luar ruangan.`);
        }
        if (asset.height > room.height) add(asset.heightEstimated ?? asset.estimated, `${asset.key}: tinggi melebihi ruangan.`);
        for (let j = 0; j < i; j++) {
            if (overlaps(corners[i], corners[j])) add((asset.footprintEstimated ?? asset.estimated) || (assets[j].footprintEstimated ?? assets[j].estimated), `${asset.key} bertumpuk dengan ${assets[j].key}.`);
        }
    });
    if (!Number.isFinite(room.width) || !Number.isFinite(room.depth) || !Number.isFinite(room.height) || room.width <= 0 || room.depth <= 0 || room.height <= 0) errors.push("Ukuran ruangan tidak valid.");
    if (assets.some((a) => a.estimated)) warnings.push("Ukuran model generik: clearance fisik belum terverifikasi.");
    return { errors, warnings };
}
