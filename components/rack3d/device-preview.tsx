"use client";

import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import type { RackDevice } from "@/actions/rack-layout";
import { waitForImageTexture } from "./use-image-texture";
import { DeviceModel } from "./device-model";

const InspectControls = lazy(() => import("./device-inspect-controls"));

export function Snapshot({ logo, onCapture }: { logo: string | null; onCapture: (url: string | null) => void }) {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        let alive = true;
        let frame = 0;
        let completion: ReturnType<typeof setTimeout> | undefined;
        const finish = (url: string | null) => {
            // Unmount Canvas outside its render/frame task.
            completion = setTimeout(() => { if (alive) onCapture(url); }, 0);
        };
        const controller = new AbortController();
        void waitForImageTexture(logo, 2000, controller.signal).then(() => {
            if (!alive) return;
            // Leave a full frame for the logo hook's React update before capture.
            frame = requestAnimationFrame(() => {
                if (!alive) return;
                frame = requestAnimationFrame(() => {
                    if (!alive) return;
                    try { gl.render(scene, camera); finish(gl.domElement.toDataURL("image/png")); }
                    catch { finish(null); }
                });
            });
        });
        return () => { alive = false; controller.abort(); cancelAnimationFrame(frame); clearTimeout(completion); };
    }, [gl, scene, camera, logo, onCapture]);
    return null;
}
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <p className="p-6 text-sm text-ops-muted">3D preview unavailable.</p> : this.props.children; }
}

export function previewVisualKey(device: RackDevice) {
    return JSON.stringify([device.id, device.name, device.categoryName, device.brandLogo, device.uHeight, device.status, device.isCritical, device.faceplatePortCount, device.faceplateUplinkCount, device.faceplateRows, device.faceplateNumbering, device.ports]);
}

export default function DevicePreview({ device }: { device: RackDevice }) {
    return <Preview key={previewVisualKey(device)} device={device} />;
}

function Preview({ device }: { device: RackDevice }) {
    const [inspect, setInspect] = useState(false);
    const [image, setImage] = useState<string | null | undefined>(undefined);
    const cameraDistance = Math.max(0.8, (device.uHeight || 1) * 0.06);
    return (
        <section aria-label="Device model" className="mb-4 overflow-hidden rounded-lg border border-ops-border bg-ops-bg">
            <div className="h-44">
                {inspect || image === undefined ? (
                    <PreviewBoundary>
                        <Canvas frameloop="demand" dpr={1} camera={{ position: [cameraDistance * 0.65, cameraDistance * 0.45, cameraDistance], fov: 40, near: 0.01, far: 10 }} gl={{ antialias: true }}>
                            <color attach="background" args={["#dfe3e7"]} />
                            <ambientLight intensity={1.2} /><hemisphereLight args={["#ffffff", "#7b838a", 1.4]} /><directionalLight position={[2, 3, 4]} intensity={2} />
                            <Environment resolution={128} frames={1}><Lightformer position={[0, 2, 1]} rotation-x={Math.PI / 2} scale={[3, 3, 1]} intensity={2} /><Lightformer position={[0, 1, 3]} scale={[3, 2, 1]} intensity={2} /></Environment>
                            <DeviceModel device={{ ...device, isMuted: false }} />
                            {inspect ? <Suspense fallback={null}><InspectControls /></Suspense> : <Snapshot logo={device.brandLogo} onCapture={setImage} />}
                        </Canvas>
                    </PreviewBoundary>
                ) : image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt={`Generic 3D model of ${device.name}`} className="h-full w-full object-contain" />
                ) : <p className="p-6 text-sm text-ops-muted">3D preview unavailable.</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-ops-border px-3 py-2">
                <span className="text-[10px] text-ops-muted">Generic model · not a device photograph</span>
                <button type="button" onClick={() => setInspect(!inspect)} aria-pressed={inspect} className="shrink-0 text-xs font-semibold text-ops-accent">{inspect ? "Close 3D" : "Inspect 3D"}</button>
            </div>
        </section>
    );
}
