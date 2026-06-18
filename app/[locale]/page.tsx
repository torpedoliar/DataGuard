import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";

/**
 * Per-locale root. The middleware at `/` already short-circuits to
 * `/login` or `/select-site` before this page is reached; this is a
 * defensive fallback in case a request ever gets through.
 */
export default async function LocaleHome() {
    const session = await verifySession();
    if (!session) redirect("/login");
    redirect("/select-site");
}
