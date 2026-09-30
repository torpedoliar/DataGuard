import * as THREE from "three";
import { radialTexture } from "./textures";

// Shared, emissive (bloom picks them up). userData.shared tells useFade to
// leave them alone.
function led(color: string, intensity: number) {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, toneMapped: false });
    m.userData.shared = true;
    return m;
}

function pool() {
    const m = new THREE.MeshBasicMaterial({
        color: "#ef4444", alphaMap: radialTexture(), transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    m.userData.shared = true;
    return m;
}

export const sharedMaterials = {
    ok: led("#22c55e", 3),
    pending: led("#f59e0b", 2.5),
    error: led("#ef4444", 4),
    activity: led("#4ade80", 2),
    linkA: led("#22c55e", 2),
    linkB: led("#fbbf24", 2),
    storage: led("#60a5fa", 2.5),
    lcd: led("#7dd3fc", 1.2),
    pool: pool(),
};

export const ledMaterial = (status?: string) =>
    status === "NOT OK" ? sharedMaterials.error : status === "OK" ? sharedMaterials.ok : sharedMaterials.pending;

// Called every rendered frame by BlinkClock.
export function tickLeds(t: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    sharedMaterials.error.emissiveIntensity = 1 + 4 * pulse;
    sharedMaterials.pool.opacity = 0.25 + 0.3 * pulse;
    sharedMaterials.activity.emissiveIntensity = Math.random() > 0.35 ? 2 : 0.2;
    sharedMaterials.linkA.emissiveIntensity = Math.random() > 0.15 ? 2 : 0.1;
    sharedMaterials.linkB.emissiveIntensity = Math.random() > 0.5 ? 2 : 0.1;
}
