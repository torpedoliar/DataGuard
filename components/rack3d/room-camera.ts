export type RoomView = "aisle" | "plan";

interface Footprint {
    x: number;
    z: number;
    radius: number;
    rotationY?: number;
}

// Compare projected silhouettes. Only equipment in front of a rack can
// obscure its face. Prefer a readable face when two views are equally clear.
export function aisleAngle(items: Footprint[]) {
    const racks = items.filter((item) => item.rotationY !== undefined);
    const front = racks[0]?.rotationY ?? 0;
    let best = front + 0.34;
    let lowest = Infinity;
    for (const offset of [0.34, -0.34, 0.62, -0.62, 0, Math.PI - 0.34, Math.PI + 0.34]) {
        const angle = front + offset;
        const sin = Math.sin(angle), cos = Math.cos(angle);
        let score = 0;
        for (const rack of racks) {
            score += 0.9 * (1 - Math.cos(angle - rack.rotationY!));
            for (const other of items) {
                const dx = other.x - rack.x, dz = other.z - rack.z;
                if (dx * sin + dz * cos <= 0.02) continue;
                const gap = Math.abs(dx * cos - dz * sin);
                score += Math.max(0, rack.radius + other.radius - gap) / rack.radius;
            }
        }
        if (score < lowest) { lowest = score; best = angle; }
    }
    return best;
}
