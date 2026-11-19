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

// Surface detail is shared by every copy of a part. Small repeated holes
// and fasteners therefore cost no additional triangles in a populated room.
type HardwareFinish = "cabinet" | "carrier" | "copper" | "cage" | "guard" | "blank" | "controller";
export const hardwareTexture = (part: HardwareFinish) => make(`hardware-${part}`, 256, 256, (ctx) => {
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
    };
    const screw = (x: number, y: number) => {
        ctx.fillStyle = "#929c9e";
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        rect(x - 1.5, y - 0.5, 3, 1, "#30363a");
    };
    if (part === "blank") {
        rect(0, 0, 256, 256, "#29323a");
        rect(0, 0, 256, 5, "#475159");
        rect(0, 244, 256, 12, "#10161b");
        for (const x of [5, 251]) rect(x - 1, 104, 2, 48, "#555f66");
        return;
    }
    if (part === "controller") {
        rect(0, 0, 256, 256, "#252e34");
        rect(7, 15, 242, 226, "#58747a");
        rect(15, 28, 226, 200, "#243f47");
        for (const x of [32, 45, 58]) rect(x, 48, 7, 12, "#95bbc2");
        rect(32, 85, 192, 3, "#67939a");
        for (let i = 0; i < 3; i++) {
            rect(32, 110 + i * 30, 12, 12, "#86aab0");
            rect(57, 114 + i * 30, 88 - i * 18, 5, "#7a9ea4");
        }
        return;
    }
    if (part === "guard") {
        ctx.strokeStyle = "#90999c";
        ctx.lineWidth = 2.6;
        for (const radius of [38, 61, 84, 109, 119]) {
            ctx.beginPath();
            ctx.arc(128, 128, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (let i = 0; i < 4; i++) {
            ctx.save();
            ctx.translate(128, 128);
            ctx.rotate(Math.PI / 4 + i * Math.PI / 2);
            rect(29, -2, 95, 4, "#73818a");
            ctx.restore();
        }
        return;
    }
    if (part === "cabinet") {
        rect(0, 0, 256, 256, "#d8dcdf");
        for (const y of [7, 130]) {
            rect(8, y, 240, 116, "#738088");
            rect(10, y + 1, 236, 113, "#bec6ca");
            for (const x of [18, 238]) screw(x, y + 7);
            rect(110, y + 6, 36, 8, "#515c62");
            rect(113, y + 9, 30, 3, "#899399");
        }
        return;
    }
    if (part === "carrier") {
        rect(0, 0, 256, 256, "#303a40");
        rect(7, 8, 242, 239, "#576067");
        rect(12, 13, 232, 228, "#283239");
        for (let y = 26; y < 171; y += 20) {
            for (let x = 24; x < 221; x += 22) rect(x + (y % 40 ? 0 : 7), y, 12, 9, "#0d1418");
        }
        rect(21, 183, 214, 32, "#151d21");
        rect(24, 185, 152, 8, "#859095");
        rect(201, 183, 28, 19, "#94785e");
        return;
    }
    rect(0, 0, 256, 256, "#849097");
    rect(9, 12, 238, 229, "#303b42");
    rect(18, 24, 220, 194, "#10191e");
    if (part === "copper") {
        rect(76, 187, 104, 47, "#11191e");
        for (let i = 0; i < 8; i++) {
            rect(38 + i * 24, 32, 7, 65, "#af9260");
            rect(38 + i * 24, 32, 3, 48, "#dbc292");
        }
    } else {
        rect(28, 33, 200, 13, "#66727a");
        rect(31, 188, 194, 14, "#a3acb0");
        for (let i = 0; i < 6; i++) rect(38 + i * 32, 174, 12, 22, "#515b61");
    }
}, true);

// Clone so each consumer can set its own repeat without touching the cache.
export function repeated(tex: THREE.Texture, x: number, y: number) {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
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
    ctx.fillStyle = dark ? "#2a2f36" : "#849098";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(${dark ? "255,255,255" : "0,0,0"},${((i * 37 % 101) / 101) * 0.05})`;
        ctx.fillRect((i * 73 % 256), (i * 151 % 256), 2, 2);
    }
    ctx.strokeStyle = dark ? "#14171b" : "#6b7280";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 253, 253);
    ctx.strokeStyle = dark ? "#3a414a" : "#c3c8ce";
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 248, 248);
    for (const x of [12, 244]) for (const y of [12, 244]) {
        ctx.fillStyle = dark ? "#1c2429" : "#647078";
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
}, true);

// Stamped service cover, visible as the selected chassis leaves the cabinet.
export const chassisCoverTexture = () => make("service-cover", 384, 640, (ctx) => {
    ctx.fillStyle = "#829099";
    ctx.fillRect(0, 0, 384, 640);
    ctx.strokeStyle = "#677780";
    ctx.strokeRect(8, 9, 368, 622);
    for (const offset of [30, 206]) {
        for (let y = 360; y < 575; y += 9) {
            ctx.fillStyle = "#50606a";
            ctx.fillRect(offset, y, 147, 3);
            ctx.fillStyle = "#b5bfc3";
            ctx.fillRect(offset, y + 3, 147, 1);
        }
    }
    for (const x of [15, 369]) for (const y of [18, 318, 622]) {
        ctx.fillStyle = "#58656d";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#b8c2c6";
        ctx.fillRect(x - 2, y, 4, 1);
    }
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

// Wall finishes, one repeat ≈ 1 m (512 px). Drawn once and cached.
export const wallpaperTexture = (kind: "brick" | "acoustic" | "concrete") => make(`wall-${kind}`, 512, 512, (ctx) => {
    if (kind === "brick") {
        ctx.fillStyle = "#c9c2b8"; // mortar
        ctx.fillRect(0, 0, 512, 512);
        const bw = 128;
        const bh = 42;
        for (let row = 0; row * bh < 512; row++) {
            for (let col = -1; col * bw < 512; col++) {
                const x = col * bw + (row % 2 ? bw / 2 : 0);
                const s = 150 + Math.floor(Math.random() * 30);
                ctx.fillStyle = `rgb(${s},${Math.floor(s * 0.48)},${Math.floor(s * 0.36)})`;
                ctx.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
            }
        }
    } else if (kind === "acoustic") {
        ctx.fillStyle = "#2f3642";
        ctx.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 256) {
            for (let x = 0; x < 512; x += 256) {
                ctx.fillStyle = (x + y) % 512 ? "#44515a" : "#414e57";
                ctx.fillRect(x + 2, y + 2, 252, 252);
                ctx.fillStyle = "rgba(0,0,0,0.25)";
                for (let i = 0; i < 18; i++) ctx.fillRect(x + 8 + i * 14, y + 6, 3, 244);
            }
        }
    } else {
        ctx.fillStyle = "#8d9196";
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 4000; i++) {
            const g = 110 + Math.random() * 60;
            ctx.fillStyle = `rgba(${g},${g},${g + 4},0.35)`;
            ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
        }
        ctx.strokeStyle = "rgba(60,62,66,0.5)";
        ctx.lineWidth = 2;
        for (const y of [0, 256]) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(512, y);
            ctx.stroke();
        }
        ctx.fillStyle = "rgba(50,52,56,0.6)"; // form-tie holes
        for (const y of [64, 192, 320, 448]) for (const x of [64, 192, 320, 448]) {
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}, true);

export const floorBumpTexture = () => make("tile-bump", 256, 256, (ctx) => {
    ctx.fillStyle = "#c4c4c4";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#242424";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 252);
    ctx.strokeStyle = "#929292";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 244, 244);
});
