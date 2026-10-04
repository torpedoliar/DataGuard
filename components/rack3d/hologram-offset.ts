/**
 * Placement of two device holograms that would otherwise overlap.
 *
 * Two 1U devices next to each other are only a few pixels apart on screen while
 * the card is ~260 px tall, so the cards are pushed apart with a CSS
 * translateY. The offset is applied in screen space (inside the drei <Html>),
 * not as a world position, so it stays put while the camera orbits.
 */

export type HologramAnchor = {
    locationName: string | null;
    rackName: string | null;
    /** 1-based rack slot; 0 / negative / null all mean "unknown". */
    u: number | null;
};

export type HologramOffsets = { base: number; peer: number };

/** ponytail: 9rem covers a ~260px card; if the card grows taller, measure it. */
const SHIFT = 9;

/** Racks start at U1, so 0 and negatives carry no position information. */
function unit(u: number | null): number | null {
    return u != null && u > 0 ? u : null;
}

export function hologramStagger(base: HologramAnchor, peer: HologramAnchor): HologramOffsets {
    // Only two devices that can actually land on top of each other need a shift:
    // same room, same rack, known rack name.
    if (base.rackName == null || peer.rackName == null) return { base: 0, peer: 0 };
    if (base.locationName !== peer.locationName) return { base: 0, peer: 0 };
    if (base.rackName !== peer.rackName) return { base: 0, peer: 0 };

    const bu = unit(base.u);
    const pu = unit(peer.u);

    // Unknown U counts as "above": an unpositioned device may sit anywhere, and
    // keeping the pair separated is better than stacking two cards.
    if (bu == null && pu == null) return { base: -SHIFT, peer: SHIFT };
    if (bu == null) return { base: -SHIFT, peer: SHIFT };
    if (pu == null) return { base: SHIFT, peer: -SHIFT };
    if (Math.abs(bu - pu) >= 4) return { base: 0, peer: 0 };

    return bu < pu ? { base: SHIFT, peer: -SHIFT } : { base: -SHIFT, peer: SHIFT };
}
