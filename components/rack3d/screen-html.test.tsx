import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, unmount: vi.fn(), remove: vi.fn(), render: vi.fn() }));
vi.mock("react", async (original) => ({
    ...await original<typeof import("react")>(),
    useRef: () => {
        const box = { current: null as unknown };
        return box;
    },
    useState: (init: () => unknown) => [typeof init === "function" ? init() : init],
    useEffect: (run: () => (() => void) | undefined) => { const cleanup = run(); if (cleanup) state.cleanup = cleanup; },
}));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: state.render, unmount: state.unmount }) }));
vi.mock("@react-three/fiber", () => ({ useThree: () => ({ gl: { domElement: { parentNode: { appendChild: vi.fn() } } } }), useFrame: () => {} }));
import { ScreenHtml } from "./screen-html";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("ScreenHtml cleanup", () => {
    it("detaches DOM immediately but unmounts its React root outside the renderer commit", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("document", { createElement: () => ({ style: {}, remove: state.remove }) });
        ScreenHtml({ children: "Peer card", center: true, style: { pointerEvents: "none" } });
        state.cleanup?.();
        expect(state.remove).toHaveBeenCalledOnce();
        expect(state.unmount).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(state.unmount).toHaveBeenCalledOnce();
    });
});
