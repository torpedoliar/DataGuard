"use client";

import type { RackDevice } from "@/actions/rack-layout";
import { facilityDimensions } from "@/lib/facility-asset";
import { LeonardoModel, InRowModel } from "./pac-model";
import { ApcUpsModel } from "./ups-model";

export function FacilityModel({ device, detailed = false, opacity = 1, animateFans = false, cabinetOpen = false }: { device: RackDevice; detailed?: boolean; opacity?: number; animateFans?: boolean; cabinetOpen?: boolean }) {
    const { width, depth, height } = facilityDimensions({ assetType: device.assetType ?? "ups", facilitySpecs: device.facilitySpecs ?? null });
    const profile = device.facilitySpecs?.visualProfile;
    if (device.assetType === "ups" && profile === "apc-20kva") return <ApcUpsModel width={width} depth={depth} height={height} opacity={opacity} detailed={detailed} />;
    if (profile === "leonardo-tuar0611") return <LeonardoModel width={width} depth={depth} height={height} opacity={opacity} detailed={detailed} cabinetOpen={cabinetOpen} />;
    if (profile === "inrow-300") return <InRowModel width={width} depth={depth} height={height} opacity={opacity} detailed={detailed} animateFans={animateFans} />;
    const topBlow = device.assetType === "pac" && device.facilitySpecs?.subtype === "top-blow";
    const color = device.assetType === "ups" ? "#646c74" : "#858d95";
    const material = { color, metalness: 0.35, roughness: 0.6, transparent: opacity < 1, opacity, userData: { ownFade: true } };
    return <group>
        <mesh castShadow receiveShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial {...material} /></mesh>
        <mesh position={[0, -height / 2 + 0.04, 0]}><boxGeometry args={[width * 0.96, 0.08, depth * 0.96]} /><meshStandardMaterial {...material} color="#30363d" /></mesh>
        <mesh position={[0, height * 0.15, depth / 2 + 0.002]}><boxGeometry args={[width * 0.28, height * 0.06, 0.006]} /><meshStandardMaterial {...material} color="#20262d" /></mesh>
        {device.assetType === "pac" && <mesh position={topBlow ? [0, height / 2 + 0.003, 0] : [0, -height * 0.1, depth / 2 + 0.003]} rotation-x={topBlow ? -Math.PI / 2 : 0}><planeGeometry args={[width * 0.8, topBlow ? depth * 0.8 : height * 0.65]} /><meshStandardMaterial {...material} color="#343c43" /></mesh>}
        {detailed && <>{Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[0, -height * 0.28 + i * height * 0.055, depth / 2 + 0.007]}><boxGeometry args={[width * 0.75, 0.012, 0.012]} /><meshStandardMaterial {...material} color="#252d35" /></mesh>)}<mesh position={[width * 0.4, 0, depth / 2 + 0.016]}><boxGeometry args={[0.012, height * 0.12, 0.025]} /><meshStandardMaterial {...material} color="#29313a" /></mesh></>}
    </group>;
}
