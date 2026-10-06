// Decorative speed, not measured RPM. Cap delta so resuming a hidden tab
// cannot jump through a long elapsed interval.
export function fanRotation(angle: number, delta: number, enabled: boolean, hidden: boolean, reducedMotion: boolean) {
    return enabled && !hidden && !reducedMotion ? (angle + Math.min(Math.max(delta, 0), 0.05) * 1.2) % (Math.PI * 2) : angle;
}
