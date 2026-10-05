import { useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

const loads = new Map<string, Promise<THREE.Texture>>();

function imageLoad(url: string) {
    let promise = loads.get(url);
    if (!promise) {
        promise = new THREE.TextureLoader().loadAsync(url).then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            return texture;
        });
        promise.catch(() => loads.delete(url));
        loads.set(url, promise);
    }
    return promise;
}

// Loads an uploaded image (brand logo, floor plan). A missing/broken file
// resolves to null so callers fall back to their procedural look.
export function useImageTexture(url: string | null): THREE.Texture | null {
    const invalidate = useThree((s) => s.invalidate);
    const [loaded, setLoaded] = useState<{ url: string; tex: THREE.Texture } | null>(null);

    useEffect(() => {
        if (!url) return;
        let alive = true;
        imageLoad(url).then((tex) => {
            if (!alive) return;
            setLoaded({ url, tex });
            invalidate();
        }).catch(() => {});
        return () => { alive = false; };
    }, [url, invalidate]);

    return url && loaded?.url === url ? loaded.tex : null;
}

export async function waitForImageTexture(url: string | null, timeout = 2000, signal?: AbortSignal): Promise<void> {
    if (!url || signal?.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
        await Promise.race([
            imageLoad(url).catch(() => {}),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, timeout); }),
            new Promise<void>((resolve) => { abort = resolve; signal?.addEventListener("abort", abort, { once: true }); }),
        ]);
    } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
    }
}
