import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Support Next.js 15+ async params
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: segments } = await params;

    if (!segments || segments.length === 0) {
        return new NextResponse("Invalid path", { status: 400 });
    }

    // Prevent Directory Traversal / LFI attacks
    for (const seg of segments) {
        if (seg === ".." || seg === "." || seg.includes("/") || seg.includes("\\")) {
            return new NextResponse("Invalid path", { status: 400 });
        }
    }

    // Resolve path directly to the public/uploads directory.
    // Works reliably in Dev mode and Production Standalone inside Docker (/app/public/uploads).
    const filePath = path.join(process.cwd(), "public", "uploads", ...segments);

    try {
        const fileBuffer = await fs.readFile(filePath);

        // Handle basic mime types for common image formatting
        const ext = path.extname(filePath).toLowerCase();
        let contentType = "application/octet-stream";
        if (ext === ".png") contentType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
        else if (ext === ".svg") contentType = "image/svg+xml";
        else if (ext === ".ico") contentType = "image/x-icon";
        else if (ext === ".gif") contentType = "image/gif";
        else if (ext === ".webp") contentType = "image/webp";

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
            },
        });
    } catch {
        // Specifically returns standard 404 for Next/Image to handle smoothly
        return new NextResponse("File Not Found", { status: 404 });
    }
}
