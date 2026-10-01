export const screenshotFooter = (room: string, site: string, at: Date) =>
    `${room} · ${site} · ${at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

export function screenshotName(room: string, at: Date) {
    const slug = room.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
    return `rack3d-${slug}-${at.toISOString().slice(0, 16).replace(/[-:T]/g, "")}.png`;
}

// Canvas PNG + a footer bar (room, site, time) as evidence for reports.
export async function downloadWithFooter(dataUrl: string, footer: string, filename: string) {
    try {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const bar = Math.max(28, Math.round(img.height * 0.05));
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height + bar;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, img.height, img.width, bar);
        ctx.fillStyle = "#f8fafc";
        ctx.font = `600 ${Math.round(bar * 0.45)}px ui-sans-serif, system-ui, 'Segoe UI', sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(footer, Math.round(bar * 0.4), img.height + bar / 2);
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = filename;
        a.click();
    } catch (err) {
        console.error("Failed to generate or download screenshot with footer:", err);
    }
}
