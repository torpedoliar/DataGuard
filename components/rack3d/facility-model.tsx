"use client";

import type { RackDevice } from "@/actions/rack-layout";
import { facilityDimensions } from "@/lib/facility-asset";
import { LeonardoModel, InRowModel } from "./pac-model";
import { HousingGrille } from "./housing-grille";
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
        <group position={topBlow ? [0, height / 2 + 0.001, 0] : [0, -height * 0.16, depth / 2 + 0.001]} rotation-x={topBlow ? -Math.PI / 2 : 0}>
            <HousingGrille width={width * 0.8} height={topBlow ? depth * 0.74 : height * 0.44} count={detailed ? 20 : 12} opacity={opacity} />
        </group>
        {detailed && <mesh position={[width * 0.4, 0, depth / 2 + 0.016]}>
            <boxGeometry args={[0.012, height * 0.12, 0.025]} />
            <meshStandardMaterial {...material} color="#29313a" />
        </mesh>}
    </group>;
}
