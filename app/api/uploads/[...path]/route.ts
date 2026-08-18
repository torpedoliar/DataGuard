import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
    detectUploadType,
    getUploadExtension,
    getUploadMimeType,
    getUploadRoot,
} from "@/lib/upload";

const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
};

function errorResponse(message: string, status: number): NextResponse {
    return new NextResponse(message, {
        status,
        headers: {
            ...SECURITY_HEADERS,
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function safeContentDispositionName(name: string, fallbackExtension: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    return safeName || `upload.${fallbackExtension}`;
}

function isWithinUploadRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Support Next.js 15+ async params.
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    const { path: segments } = await params;

    if (
        !segments
        || segments.length === 0
        || segments.some((segment) => !segment || segment === ".." || segment === "." || segment.includes("/") || segment.includes("\\"))
    ) {
        return errorResponse("Invalid path", 400);
    }

    const uploadRoot = getUploadRoot();
    const filePath = path.resolve(uploadRoot, ...segments);
    if (!isWithinUploadRoot(uploadRoot, filePath)) {
        return errorResponse("Invalid path", 400);
    }

    try {
        const fileBuffer = await fs.readFile(filePath);
        const originalName = segments[segments.length - 1];
        const extension = path.extname(originalName).toLowerCase();

        // SVG uploads are no longer accepted for new files. Keep legacy SVG
        // records downloadable without ever returning them as executable inline
        // same-origin markup.
        if (extension === ".svg") {
            return new NextResponse(fileBuffer, {
                headers: {
                    ...SECURITY_HEADERS,
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": `attachment; filename="${safeContentDispositionName(originalName, "svg")}"`,
                    "Cache-Control": "no-store",
                },
            });
        }

        // Derive the response type from the stored bytes, not the extension.
        const detectedType = detectUploadType(fileBuffer);
        if (!detectedType) {
            return errorResponse("File Not Found", 404);
        }

        const contentType = getUploadMimeType(detectedType);
        return new NextResponse(fileBuffer, {
            headers: {
                ...SECURITY_HEADERS,
                "Content-Type": contentType,
                "Content-Disposition": `inline; filename="${safeContentDispositionName(originalName, getUploadExtension(detectedType))}"`,
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
            },
        });
    } catch {
        // Specifically returns standard 404 for Next/Image to handle smoothly.
        return errorResponse("File Not Found", 404);
    }
}
