import * as THREE from "three";

// Canvas-generated textures, created once per key. No image files and no
// network: everything is drawn at runtime.
const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = false) {
    const hit = cache.get(key);
    if (hit) return hit;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext("2d")!);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, tex);
    return tex;
}

// Clone so each consumer can set its own repeat without touching the cache.
export function repeated(tex: THREE.Texture, x: number, y: number) {
    const t = tex.clone();
    t.repeat.set(x, y);
    t.needsUpdate = true;
    return t;
}

// Alpha map: white = metal, black = hole. 16 x 16 hex-staggered holes per
// repeat, ~55% open area like a real perforated rack door.
export const perforationTexture = () => make("perf", 256, 256, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#000";
    for (let row = 0; row < 16; row++) {
        for (let col = 0; col <= 16; col++) {
            const x = col * 16 + (row % 2 ? 8 : 0);
            const y = row * 16 + 8;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i + Math.PI / 6;
                ctx.lineTo(x + 7.2 * Math.cos(a), y + 7.2 * Math.sin(a));
            }
            ctx.fill();
        }
    }
});

// One raised-floor tile per repeat: flat panel, bevelled edge, faint speckle.
export const floorTileTexture = (dark: boolean) => make(`tile-${dark}`, 256, 256, (ctx) => {
    ctx.fillStyle = dark ? "#2a2f36" : "#9aa1a9";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(${dark ? "255,255,255" : "0,0,0"},${Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    ctx.strokeStyle = dark ? "#14171b" : "#6b7280";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 250);
    ctx.strokeStyle = dark ? "#3a414a" : "#c3c8ce";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 240, 240);
}, true);

// Perforated airflow tile (cold aisle).
export const perforatedTileTexture = (dark: boolean) => make(`perf-tile-${dark}`, 256, 256, (ctx) => {
    ctx.drawImage(floorTileTexture(dark).image as HTMLCanvasElement, 0, 0);
    ctx.fillStyle = dark ? "#07090c" : "#3f454d";
    for (let y = 22; y < 240; y += 12) for (let x = 22; x < 240; x += 12) {
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
    }
}, true);

// Alpha map for vent grilles: white slots on black.
export const ventTexture = () => make("vent", 128, 128, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#fff";
    for (let y = 6; y < 128; y += 10) for (let x = 6; x < 128; x += 30) ctx.fillRect(x, y, 22, 4);
});

// Alpha map for a 19" rail: three square holes per U (texture = 1U tall).
export const railTexture = () => make("rail", 32, 96, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 32, 96);
    ctx.fillStyle = "#000";
    for (const y of [10, 42, 74]) ctx.fillRect(10, y, 12, 12);
});

// Soft radial falloff (alpha) for the red fault light pool on the floor.
export const radialTexture = () => make("radial", 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "#fff");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
});

// Printed label (device tag / rack sign / U number). System font: no
// webfont download. One texture per distinct text, so labels are refcounted
// and disposed with their last user instead of living in `cache` forever.
const labels = new Map<string, { tex: THREE.CanvasTexture; users: number }>();

function drawLabel(text: string, bg: string, fg: string, w: number, h: number) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.round(h * 0.56)}px ui-sans-serif, system-ui, 'Segoe UI', sans-serif`;
    ctx.textBaseline = "middle";
    let s = text;
    while (s.length > 1 && ctx.measureText(s).width > w - 12) s = s.slice(0, -1);
    ctx.fillText(s === text ? s : `${s.slice(0, -1)}…`, 6, h / 2 + 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

export function acquireLabel(text: string, bg: string, fg = "#f8fafc", w = 256, h = 32) {
    const key = `${w}x${h}:${bg}:${fg}:${text}`;
    let hit = labels.get(key);
    if (!hit) {
        hit = { tex: drawLabel(text, bg, fg, w, h), users: 0 };
        labels.set(key, hit);
    }
    hit.users++;
    return {
        tex: hit.tex,
        release: () => {
            const e = labels.get(key);
            if (!e || --e.users > 0) return;
            e.tex.dispose();
            labels.delete(key);
        },
    };
}

export const liveLabelCount = () => labels.size;
