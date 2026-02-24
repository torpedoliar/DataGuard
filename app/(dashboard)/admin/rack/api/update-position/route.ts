import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devices, racks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/session";
import { checkRackCollision } from "@/lib/rack-validation";

export async function POST(request: NextRequest) {
    const session = await verifySession();
    if (!session || session.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { deviceId, rackName, rackPosition, uHeight } = body;

        if (!deviceId) {
            return NextResponse.json({ error: "Device ID required" }, { status: 400 });
        }

        const deviceA = await db.query.devices.findFirst({
            where: eq(devices.id, deviceId)
        });

        if (!deviceA) {
            return NextResponse.json({ error: "Device not found" }, { status: 404 });
        }

        const newUHeight = uHeight !== undefined ? uHeight : (deviceA.uHeight || 1);

        let targetZone: string | null = null;
        if (rackName) {
            const targetRack = await db.query.racks.findFirst({
                where: eq(racks.name, rackName)
            });
            if (targetRack && targetRack.zone) {
                targetZone = targetRack.zone;
            }
        }

        // Standard position update checks if rack details are provided
        if (rackName && rackPosition) {
            const collisions = await checkRackCollision(
                rackName,
                rackPosition,
                newUHeight,
                deviceId
            );

            if (collisions.length > 0) {
                // If exactly ONE collision, try to perform a position SWAP
                if (collisions.length === 1 && deviceA.rackName && deviceA.rackPosition) {
                    const deviceB = collisions[0];

                    // Check if Device B fits into Device A's old spot
                    const bCollisions = await checkRackCollision(
                        deviceA.rackName,
                        deviceA.rackPosition,
                        deviceB.uHeight || 1,
                        deviceB.id
                    );

                    // We filter out deviceA because it's vacating this exact spot!
                    const realBCollisions = bCollisions.filter(c => c.id !== deviceA.id);

                    if (realBCollisions.length === 0) {
                        // Crucial final check: Will Device A and Device B overlap with EACH OTHER after the swap?
                        // This happens if A tries to take a slice of B's space while B doesn't fully move out of the way
                        const aNewStart = rackPosition;
                        const aNewEnd = rackPosition + newUHeight - 1;
                        const bNewStart = deviceA.rackPosition;
                        const bNewEnd = deviceA.rackPosition + (deviceB.uHeight || 1) - 1;

                        if (Math.max(aNewStart, bNewStart) <= Math.min(aNewEnd, bNewEnd)) {
                            return NextResponse.json({
                                error: `Cannot swap: The new positions would cause ${deviceA.name} and ${deviceB.name} to overlap.`
                            }, { status: 400 });
                        }

                        try {
                            await db.transaction(async (tx) => {
                                await tx.update(devices).set({
                                    rackName: rackName,
                                    rackPosition: rackPosition,
                                    uHeight: newUHeight,
                                    zone: targetZone
                                }).where(eq(devices.id, deviceA.id));

                                await tx.update(devices).set({
                                    rackName: deviceA.rackName,
                                    rackPosition: deviceA.rackPosition,
                                    zone: deviceA.zone
                                }).where(eq(devices.id, deviceB.id));
                            });
                            return NextResponse.json({ success: true, message: "Devices swapped successfully" });
                        } catch (err) {
                            console.error("Transaction failed during swap", err);
                            return NextResponse.json({ error: "Transaction failed during swap" }, { status: 500 });
                        }
                    } else {
                        return NextResponse.json({
                            error: `Cannot swap: Old slot is too small for ${deviceB.name}. Conflicts with ${realBCollisions.map(c => `${c.name} (U${c.rackPosition}${c.uHeight! > 1 ? `-U${c.rackPosition! + c.uHeight! - 1}` : ''})`).join(', ')}`
                        }, { status: 400 });
                    }
                }

                return NextResponse.json({
                    error: `Slot occupied by: ${collisions.map(c => `${c.name} (U${c.rackPosition}${c.uHeight! > 1 ? `-U${c.rackPosition! + c.uHeight! - 1}` : ''})`).join(", ")}`
                }, { status: 400 });
            }
        }

        // Standard update if no collisions or removing from a rack
        const updatePayload: Record<string, unknown> = {
            rackName: rackName || null,
            rackPosition: rackPosition || null,
            zone: targetZone
        };

        if (uHeight !== undefined) {
            updatePayload.uHeight = uHeight;
        }

        await db.update(devices).set(updatePayload).where(eq(devices.id, deviceId));

        return NextResponse.json({ success: true, message: "Device position updated" });
    } catch (error) {
        console.error("Failed to update device position:", error);
        return NextResponse.json({ error: "Failed to update device position" }, { status: 500 });
    }
}
