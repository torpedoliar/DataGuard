import { useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

const loads = new Map<string, Promise<THREE.Texture>>();

// Loads an uploaded image (brand logo, floor plan). A missing/broken file
// resolves to null so callers fall back to their procedural look.
export function useImageTexture(url: string | null): THREE.Texture | null {
    const invalidate = useThree((s) => s.invalidate);
    const [loaded, setLoaded] = useState<{ url: string; tex: THREE.Texture } | null>(null);

    useEffect(() => {
        if (!url) return;
        let alive = true;
        let p = loads.get(url);
        if (!p) {
            p = new THREE.TextureLoader().loadAsync(url).then((t) => {
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = 8;
                return t;
            });
            p.catch(() => loads.delete(url));
            loads.set(url, p);
        }
        p.then((tex) => {
            if (!alive) return;
            setLoaded({ url, tex });
            invalidate();
        }).catch(() => {});
        return () => { alive = false; };
    }, [url, invalidate]);

    return url && loaded?.url === url ? loaded.tex : null;
}
