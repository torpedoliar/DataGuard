"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { acquireLabel } from "./textures";

// Refcounted label texture for one text. Acquires in an effect (StrictMode
// safe: acquire/release always pair) so the first frame renders without the
// map and the label pops in on the next demand frame.
export function useLabelTexture(text: string, bg: string, fg = "#f8fafc", w = 256, h = 32) {
    const invalidate = useThree((s) => s.invalidate);
    const [tex, setTex] = useState<THREE.Texture | null>(null);

    useEffect(() => {
        const entry = acquireLabel(text, bg, fg, w, h);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot publish of the synchronously acquired texture; release pairs in cleanup
        setTex(entry.tex);
        invalidate();
        return () => entry.release();
    }, [text, bg, fg, w, h, invalidate]);

    return tex;
}
