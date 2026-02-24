"use server";

import QRCode from "qrcode";
import { headers } from "next/headers";

/**
 * Generates a base64 image data URI for a QR code linking to the audit scanner page
 * @param deviceId The ID of the device to pre-fill
 */
export async function generateDeviceQR(deviceId: number) {
    try {
        const headersList = await headers();
        const host = headersList.get("host") || "localhost:3000";
        const protocol = host.includes("localhost") ? "http" : "https";

        // Define the exact scan action URL
        const scanUrl = `${protocol}://${host}/audit/scan?deviceId=${deviceId}`;

        // Generate QR code data URI
        const qrDataUrl = await QRCode.toDataURL(scanUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 300,
            color: {
                dark: '#0f172a', // slate-900
                light: '#ffffff'
            }
        });

        return { success: true, qrDataUrl, scanUrl };
    } catch (error) {
        console.error("Failed to generate QR Code:", error);
        return { success: false, message: "Failed to generate QR sequence" };
    }
}
