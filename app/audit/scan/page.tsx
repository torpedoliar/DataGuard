import { redirect } from "next/navigation";
import QRScannerClient from "./scanner-client";
import { verifySession } from "@/lib/session";

export default async function ScanPage(props: { searchParams: Promise<{ deviceId?: string }> }) {
    const session = await verifySession();
    if (!session) redirect("/login");

    const searchParams = await props.searchParams;

    // Intercept native mobile camera scans 
    // e.g., if iPhone Camera reads `.../audit/scan?deviceId=5`
    // It opens this route directly. We immediately redirect to the Audit form.
    if (searchParams?.deviceId) {
        redirect(`/audit/new?deviceId=${searchParams.deviceId}`);
    }

    return <QRScannerClient />;
}
