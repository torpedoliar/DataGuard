import { afterEach, describe, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("three", () => ({ TextureLoader: class { loadAsync = load; }, SRGBColorSpace: "srgb" }));
import { waitForImageTexture } from "./use-image-texture";
afterEach(() => { vi.useRealTimers(); load.mockReset(); });
describe("preview image readiness", () => {
    it("waits only for its own logo, not an unrelated pending image", async () => {
        load.mockImplementation((url: string) => url === "/unrelated" ? new Promise(() => {}) : Promise.resolve({}));
        void waitForImageTexture("/unrelated");
        await expect(waitForImageTexture("/ready-logo")).resolves.toBeUndefined();
    });
    it("bounds a stalled logo load and tolerates failed or absent logos", async () => {
        vi.useFakeTimers();
        load.mockReturnValue(new Promise(() => {}));
        const ready = waitForImageTexture("/stalled-logo", 100);
        await vi.advanceTimersByTimeAsync(100);
        await expect(ready).resolves.toBeUndefined();
        load.mockRejectedValue(new Error("missing"));
        await expect(waitForImageTexture("/missing-logo")).resolves.toBeUndefined();
        await expect(waitForImageTexture(null)).resolves.toBeUndefined();
    });
});
