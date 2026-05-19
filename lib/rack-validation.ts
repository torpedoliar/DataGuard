import { db } from "../db";
import { devices } from "../db/schema";
import { eq, and, ne, isNotNull } from "drizzle-orm";

/**
 * Checks if a proposed device placement overlaps with any existing devices in the same rack.
 *
 * @param rackName The name of the rack
 * @param rackPosition The starting U position (bottom-up, 1-42)
 * @param uHeight The height of the device in U (default 1)
 * @param excludeDeviceId Optional ID of a device to exclude from the check (e.g., when updating an existing device)
 * @returns Array of colliding devices. Empty array means no collision.
 */
export type RackRange = {
    rackPosition: number;
    uHeight: number | null;
};

export function rackRangesOverlap(proposed: RackRange, existing: RackRange): boolean {
    const proposedStart = proposed.rackPosition;
    const proposedEnd = proposed.rackPosition + (proposed.uHeight || 1) - 1;
    const existingStart = existing.rackPosition;
    const existingEnd = existing.rackPosition + (existing.uHeight || 1) - 1;

    return Math.max(proposedStart, existingStart) <= Math.min(proposedEnd, existingEnd);
}

export async function checkRackCollision(
    siteId: number,
    rackName: string,
    rackPosition: number,
    uHeight: number = 1,
    excludeDeviceId?: number
) {
    // A proposed placement occupies the interval [rackPosition, rackPosition + uHeight - 1]
    const proposedStart = rackPosition;
    const proposedEnd = rackPosition + uHeight - 1;

    // Fetch all existing devices in the exact same rack
    // We only care about devices that HAVE a rack position
    const conditions = [
        eq(devices.siteId, siteId),
        eq(devices.rackName, rackName),
        isNotNull(devices.rackPosition)
    ];

    if (excludeDeviceId) {
        conditions.push(ne(devices.id, excludeDeviceId));
    }

    const rackDevices = await db.query.devices.findMany({
        where: and(...conditions),
        columns: {
            id: true,
            name: true,
            rackPosition: true,
            uHeight: true,
        }
    });

    const collisions = [];

    for (const existingDevice of rackDevices) {
        if (rackRangesOverlap(
            { rackPosition: proposedStart, uHeight },
            { rackPosition: existingDevice.rackPosition!, uHeight: existingDevice.uHeight }
        )) {
            collisions.push(existingDevice);
        }
    }

    return collisions;
}
