"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Vector3 } from "three";

// Screen-space overlays only: no transform/occlusion or renderer-owned DOM roots.
export function ScreenHtml({ children, position, center = false, style, zIndexRange = [40, 0] }: {
    children: ReactNode;
    position?: [number, number, number];
    center?: boolean;
    style?: CSSProperties;
    zIndexRange?: [number, number];
}) {
    const group = useRef<Group>(null);
    const root = useRef<ReturnType<typeof createRoot> | null>(null);
    const { gl } = useThree();
    const container = useRef<HTMLDivElement | null>(null);
    const [point] = useState(() => new Vector3());
    useEffect(() => {
        const element = document.createElement("div");
        container.current = element;
        const current = createRoot(element);
        root.current = current;
        element.style.position = "absolute";
        element.style.top = "0";
        element.style.left = "0";
        element.style.display = "none";
        gl.domElement.parentNode?.appendChild(element);
        return () => {
            element.remove();
            root.current = null;
            // React DOM must finish cleanup outside the R3F commit.
            setTimeout(() => current.unmount(), 0);
        };
    }, [gl]);
    useEffect(() => {
        if (container.current) container.current.style.pointerEvents = style?.pointerEvents ?? "auto";
        root.current?.render(<div style={{ ...style, transform: center ? "translate(-50%, -50%)" : undefined }}>{children}</div>);
    }, [gl, children, center, style]);
    useFrame(({ camera, size }) => {
        const element = container.current;
        if (!group.current || !element) return;
        group.current.getWorldPosition(point);
        const distance = point.distanceTo(camera.position);
        point.project(camera);
        element.style.display = point.z >= -1 && point.z <= 1 ? "block" : "none";
        element.style.transform = `translate3d(${(point.x + 1) * size.width / 2}px,${(1 - point.y) * size.height / 2}px,0)`;
        const ratio = (distance - camera.near) / (camera.far - camera.near);
        element.style.zIndex = String(Math.round(zIndexRange[0] + ratio * (zIndexRange[1] - zIndexRange[0])));
    });
    return <group ref={group} position={position} />;
}
