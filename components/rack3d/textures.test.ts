import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { repeated } from "./textures";

describe("repeated", () => {
    it("sets RepeatWrapping so tiled textures repeat instead of stretching edge pixels", () => {
        const src = new THREE.Texture(); // TextureLoader default: ClampToEdgeWrapping
        const t = repeated(src, 4, 2);
        expect(t.wrapS).toBe(THREE.RepeatWrapping);
        expect(t.wrapT).toBe(THREE.RepeatWrapping);
        expect(t.repeat.x).toBe(4);
        expect(t.repeat.y).toBe(2);
    });
});
