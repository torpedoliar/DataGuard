import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

// Ghost a whole rack (another rack is focused / the rack is filtered out).
// ponytail: mutates materials in place; a device whose own opacity prop
// changes while the rack is faded resets until the next fade toggle. Move
// to a context-driven opacity if that ever shows.
export function useFade(ref: RefObject<THREE.Object3D | null>, faded: boolean) {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        ref.current?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
                if (m.userData.shared) continue;
                m.userData.baseOpacity ??= m.opacity;
                m.userData.baseTransparent ??= m.transparent;
                m.transparent = faded || m.userData.baseTransparent;
                m.opacity = faded ? m.userData.baseOpacity * 0.15 : m.userData.baseOpacity;
                m.needsUpdate = true;
            }
        });
        invalidate();
    }, [faded, ref, invalidate]);
}
