// Real-world scale: 1 unit = 1 metre.
export const U = 0.04445;          // one rack unit (1.75")
export const RACK_W = 0.6;
export const RACK_D = 1.07;
export const PLINTH = 0.1;         // base below U1
export const TOP = 0.03;           // roof above the top U
export const AISLE = 1.2;
export const SLOT_PITCH = RACK_W;
export const ROW_PITCH = RACK_D + AISLE;
export const TILE = 0.6;           // raised-floor tile
export const ROOM_MARGIN = 2;
export const ROOM_HEIGHT = 3.2;
export const FACE_W = 0.44;        // 19" equipment face width
export const FRONT_Z = RACK_D / 2 - 0.1; // mounting rail plane, door sits in front of it
export const SLIDE = 0.3;          // selected device pulled out on its rails

export const rackHeight = (totalU: number) => totalU * U + PLINTH + TOP;
export const uToY = (u: number) => PLINTH + (u - 1) * U; // bottom edge of slot u

/**
 * Camera and group transform for the peer rack miniature (peer-rack-mini.tsx).
 *
 * The opening view has to show the whole rack with margin on its own — the card
 * is small and the user can orbit and zoom, so a framing that merely keeps the
 * ends inside the viewport reads as cropped. Reproducing the transform here
 * (rather than inlining it in the R3F component, which no test in this repo can
 * render) is what lets constants.test.ts assert the whole rack stays on screen.
 */

export const peerRackFraming = (totalU: number) => {
    const scale = Math.min(1 / Math.max(rackHeight(totalU), 1), 1);
    return {
        scale,
        offsetY: -(rackHeight(totalU) * scale) / 2,
        // 1.8x the original framing: a 42U rack is 2 m tall, and the near-axis
        // view needs the extra distance so the ends sit inside 80% of the frame
        // instead of touching it.
        camera: [0.85 * 1.8, 0.2 * 1.8, 1.15 * 1.8] as [number, number, number],
        fov: 34,
        // Closest the user may zoom. Measured from the look-at point; kept past
        // the scaled rack's radius so the camera cannot enter the chassis.
        minDistance: 0.7,
    };
};
