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
