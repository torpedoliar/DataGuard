import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export const FADE = 0.15;

// Scale one static cabinet material in or out of the ghosted state. Skips
// shared LED materials and materials whose opacity React drives (device
// parts, userData.ownFade): those fold the fade into their own opacity prop,
// so a filter change while faded can never be overwritten here.
export function applyFade(m: THREE.Material, faded: boolean) {
    if (m.userData.shared || m.userData.ownFade || !!m.userData.faded === faded) return;
    if (faded) {
        m.userData.wasTransparent = m.transparent;
        m.opacity *= FADE;
        m.transparent = true;
    } else {
        m.opacity = Math.min(1, m.opacity / FADE);
        m.transparent = m.userData.wasTransparent || m.opacity < 1;
    }
    m.userData.faded = faded;
    m.needsUpdate = true;
}

// Ghost a whole rack (another rack is focused / the rack is filtered out).
export function useFade(ref: RefObject<THREE.Object3D | null>, faded: boolean) {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        ref.current?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const m of ([] as THREE.Material[]).concat(mesh.material)) applyFade(m, faded);
        });
        invalidate();
    }, [faded, ref, invalidate]);
}
