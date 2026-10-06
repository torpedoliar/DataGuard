import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === "function" ? value(hooks.values[i]) : value; }];
}, useEffect: () => {} }));
vi.mock("next/dynamic", () => ({ default: () => "scene" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/actions/room-layout", () => ({ getRoomLayout: vi.fn(), saveRoomLayout: mocks.save }));
import RoomLayoutEditor from "./room-layout-editor";

function nodes(tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
    return React.Children.toArray(tree).flatMap((child) => React.isValidElement(child) ? [child as React.ReactElement<Record<string, unknown>>, ...nodes((child.props as { children?: React.ReactNode }).children)] : []);
}
function render() { hooks.cursor = 0; return RoomLayoutEditor({ roomId: 1, onClose: mocks.close }); }
function footer() { return nodes(render().props.footer); }
const saveButton = () => footer().find((node) => node.type === "button" && node.props.children === "Simpan Layout")!;
beforeEach(() => {
    vi.clearAllMocks();
    hooks.values = [null, [], { width: 10, depth: 8, height: 3 }, null, false, false, true, false, false, ""];
    hooks.values[0] = { success: true, siteId: 7, room: { name: "Test room", layoutRevision: 0, layoutMode: "manual" }, assets: [], sourceRacks: [], sourceFacilities: [] };
    hooks.values[1] = [{ key: "rack:2", name: "Rack", kind: "rack", x: 2, z: 2, rotation: 0, width: 0.6, depth: 1.07, height: 2, estimated: true }];
});
describe("room layout save footer", () => {
    it("keeps confirmation and Save in the fixed footer and enables after acknowledgement", () => {
        expect(render().props.panelClassName).toContain("overflow-hidden");
        expect(saveButton().props.disabled).toBe(true);
        const checkbox = footer().find((node) => node.type === "input" && node.props.type === "checkbox")!;
        (checkbox.props.onChange as (e: unknown) => void)({ target: { checked: true } });
        expect(saveButton().props.disabled).toBe(false);
    });
    it("retains the draft and restores Save after server failure, then closes on success", async () => {
        hooks.values[7] = true;
        mocks.save.mockResolvedValueOnce({ success: false, message: "Layout changed" }).mockResolvedValueOnce({ success: true });
        await (saveButton().props.onClick as () => Promise<void>)();
        expect(mocks.close).not.toHaveBeenCalled();
        expect(hooks.values[9]).toBe("Layout changed");
        expect(saveButton().props.disabled).toBe(false);
        await (saveButton().props.onClick as () => Promise<void>)();
        expect(mocks.close).toHaveBeenCalledOnce();
    });
});
