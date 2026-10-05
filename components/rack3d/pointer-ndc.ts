export interface ClientRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Pointer position in normalized device coordinates (-1..1) relative to the
// element that is actually on screen. R3F's default derives this from
// `offsetX`/`offsetY`, which are measured against `event.target` — and a click
// that lands on a DOM overlay inside the canvas (the hologram card, a tooltip
// wrapper) reports offsets against that overlay, not against the canvas. The
// ray then leaves the cursor and selects whatever device happens to sit at the
// wrong spot. `clientX`/`clientY` are viewport-absolute, so subtracting the
// canvas rect gives the cursor position regardless of which element was the target.
export function pointerNdc(clientX: number, clientY: number, rect: ClientRect): [number, number] {
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return [x * 2 - 1, -(y * 2 - 1)];
}
