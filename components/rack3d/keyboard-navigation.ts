export function navigationKey(key: string) {
    return ["w", "a", "s", "d", "q", "e", "arrowleft", "arrowright", "arrowup", "arrowdown", "+", "=", "-", "home"].includes(key.toLowerCase());
}
export function navigationStep(keys: ReadonlySet<string>, delta: number) {
    const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
    const x = axis("d", "a"), y = axis("e", "q"), z = axis("w", "s");
    const length = Math.max(1, Math.hypot(x, y, z));
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const distance = dt * (keys.has("shift") ? 4 : 1.5);
    return { x: x / length * distance, y: y / length * distance, z: z / length * distance,
        yaw: axis("arrowright", "arrowleft") * dt, pitch: axis("arrowdown", "arrowup") * dt,
        zoom: (Number(keys.has("+")) + Number(keys.has("=")) - Number(keys.has("-"))) * distance };
}
