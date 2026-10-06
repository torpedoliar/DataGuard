import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: "", push: vi.fn(), refresh: vi.fn(), values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useEffect: () => {}, useRef: () => ({ current: {} }), useState: (initial: unknown) => {
    const i = state.cursor++; if (!(i in state.values)) state.values[i] = initial;
    return [state.values[i], (v: unknown) => { state.values[i] = typeof v === "function" ? v(state.values[i]) : v; }];
} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/admin", useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ push: state.push, refresh: state.refresh }) }));
vi.mock("./device-table", () => ({ default: "device-table" }));
vi.mock("./device-profile", () => ({ default: "device-profile" }));
vi.mock("./edit-device-form", () => ({ default: "edit-form" }));
vi.mock("./add-device-form", () => ({ default: "add-form" }));
import DeviceManagement from "./device-management";
import type { getDevices } from "@/actions/master-data";
const devices = [{ id: 42, name: "A" }, { id: 43, name: "B" }] as Awaited<ReturnType<typeof getDevices>>;
function find(node: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>> | undefined {
    for (const child of React.Children.toArray(node)) if (React.isValidElement(child)) {
        if (child.type === type) return child as React.ReactElement<Record<string, unknown>>;
        const hit = find((child.props as { children?: React.ReactNode }).children, type); if (hit) return hit;
    }
}
function render() { state.cursor = 0; return DeviceManagement({ devices, categories: [], brands: [], locations: [], canEdit: true }); }
beforeEach(() => { state.query = "deviceId=42&filter=network"; state.values = []; vi.clearAllMocks(); });
describe("profile selection lifecycle", () => {
    it("preserves locale and other URL parameters when selecting a peer", () => {
        const profile = find(render(), "device-profile")!;
        expect((profile.props.onSelectPeer as (id: number) => boolean)(43)).toBe(true);
        expect(state.push).toHaveBeenCalledWith("/en/admin?deviceId=43&filter=network", { scroll: false });
        expect((profile.props.onSelectPeer as (id: number) => boolean)(99)).toBe(false);
    });
    it("refetches same-ID profile by changing its key only after successful edit", () => {
        const before = find(render(), "device-profile")!;
        (before.props.onEdit as () => void)();
        const edit = find(render(), "edit-form")!;
        (edit.props.onSaved as () => void)();
        const after = find(render(), "device-profile")!;
        expect(after.key).not.toBe(before.key);
        expect(after.props.deviceId).toBe(42);
        expect(state.refresh).toHaveBeenCalled();
    });
    it("does not open a profile for malformed IDs", () => {
        state.query = "deviceId=42bad";
        expect(find(render(), "device-profile")).toBeUndefined();
    });
});
