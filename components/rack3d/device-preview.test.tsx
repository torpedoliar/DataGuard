import { afterEach, describe, expect, it, vi } from "vitest";
import type { RackDevice } from "@/actions/rack-layout";
const effect = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
const render = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useEffect: (run: () => (() => void)) => { effect.cleanup = run(); } }));
vi.mock("three", () => ({ TextureLoader: class { loadAsync = load; }, SRGBColorSpace: "srgb" }));
vi.mock("./device-model", () => ({ DeviceModel: () => null }));
vi.mock("@react-three/fiber", () => ({ Canvas: () => null, useThree: () => ({ gl: { render, domElement: { toDataURL: () => "data:image/png;base64,test" } }, scene: {}, camera: {} }) }));
import DevicePreview, { previewVisualKey, Snapshot } from "./device-preview";
const device = { id: 1, name: "Server", categoryName: "Server", uHeight: 1, brandLogo: null, ports: [] } as unknown as RackDevice;
afterEach(() => { effect.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("DevicePreview", () => {
    it("refreshes visual edits without a different id", () => {
        const key = previewVisualKey(device);
        const changes: Partial<RackDevice>[] = [{ name: "Renamed" }, { uHeight: 4 }, { brandLogo: "/logo.png" }, { status: "NOT OK" }, { categoryName: "Storage" }, { faceplatePortCount: 24 }];
        for (const change of changes) {
            const edited = { ...device, ...change };
            expect(previewVisualKey(edited)).not.toBe(key);
            expect(DevicePreview({ device: edited }).key).toBe(previewVisualKey(edited));
        }
        expect(previewVisualKey({ ...device, ipAddress: "192.0.2.1" })).toBe(key);
    });
    it("captures after a stalled logo to release the temporary canvas and cancels work on unmount", async () => {
        vi.useFakeTimers();
        load.mockReturnValue(new Promise(() => {}));
        const frames = new Map<number, FrameRequestCallback>();
        let next = 0;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
        const cancel = vi.fn((id: number) => frames.delete(id));
        vi.stubGlobal("cancelAnimationFrame", cancel);
        const capture = vi.fn();
        Snapshot({ logo: "/never-resolves", onCapture: capture });
        await vi.advanceTimersByTimeAsync(2000);
        expect(vi.getTimerCount()).toBe(0);
        expect(capture).not.toHaveBeenCalled();
        for (let i = 0; i < 2; i++) { const entries = [...frames]; frames.clear(); entries.forEach(([, callback]) => callback(0)); }
        expect(capture).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(capture).toHaveBeenCalledWith("data:image/png;base64,test");
        effect.cleanup?.();
        Snapshot({ logo: null, onCapture: capture });
        await Promise.resolve();
        expect(frames.size).toBe(1);
        effect.cleanup?.();
        expect(cancel).toHaveBeenCalled();
        expect(frames.size).toBe(0);
        Snapshot({ logo: null, onCapture: capture });
        await Promise.resolve();
        for (let i = 0; i < 2; i++) { const entries = [...frames]; frames.clear(); entries.forEach(([, callback]) => callback(0)); }
        effect.cleanup?.();
        await vi.advanceTimersByTimeAsync(0);
        expect(capture).toHaveBeenCalledTimes(1);
        Snapshot({ logo: "/another-stall", onCapture: capture });
        effect.cleanup?.();
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(frames.size).toBe(0);
    });
});
