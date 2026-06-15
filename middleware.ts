import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { decrypt } from "@/lib/session";
import { verifyCsrfToken } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { routing } from "@/i18n/routing";

// 1. Specify protected and public routes
const protectedRoutes = ["/checklist", "/report", "/admin", "/grid", "/audit"];
const publicRoutes = ["/login"];

// Routes that bypass CSRF protection: health/metrics are public-ish probes,
// and /api/siem-ingest is an inbound channel from external sources.
const csrfExemptPrefixes = ["/api/health", "/api/metrics", "/api/siem-ingest"];

// next-intl middleware: locale detection + URL rewriting.
// Runs FIRST so downstream auth/rate-limit logic sees the resolved pathname
// (e.g. /admin not /id/admin) and existing route logic keeps working.
const intlMiddleware = createIntlMiddleware(routing);

function isCsrfExempt(path: string): boolean {
    return csrfExemptPrefixes.some((p) => path === p || path.startsWith(p + "/"));
}

function isStateChangingMethod(method: string): boolean {
    return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export default async function middleware(req: NextRequest) {
    // 0. i18n locale handling (cheap, no DB).
    // next-intl internally rewrites the URL (e.g. /en/admin -> /admin) and
    // sets response headers; for the default locale (id) it leaves the URL
    // unchanged under "as-needed" mode. We let it process, then continue.
    const intlResponse = intlMiddleware(req);

    // 1. Path resolution AFTER i18n processing.
    // Use the rewritten pathname (next-url header) so protected-route checks
    // don't need to know about locale prefixes.
    const rewrittenPath = intlResponse.headers.get("x-middleware-request-x-rewrite-pathname")
        ?? req.nextUrl.pathname;
    const path = rewrittenPath || req.nextUrl.pathname;
    const isProtectedRoute = protectedRoutes.some((route) => path.startsWith(route));
    const isPublicRoute = publicRoutes.includes(path);
    const isSelectSite = path === "/select-site";

    // 2. Rate limit POST /login per client IP (5/min).
    // Done before any DB work so it stays cheap.
    if (path === "/login" && req.method === "POST") {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
            || req.headers.get("x-real-ip")
            || "unknown";
        const rate = checkRateLimit("login-ip", ip, { windowMs: 60_000, max: 5 });
        if (!rate.allowed) {
            return new NextResponse(
                JSON.stringify({ message: "Terlalu banyak percobaan. Coba lagi nanti." }),
                {
                    status: 429,
                    headers: {
                        "content-type": "application/json",
                        "retry-after": String(Math.ceil(rate.resetMs / 1000)),
                    },
                },
            );
        }
    }

    // 3. Decrypt the session from the cookie
    const cookie = req.cookies.get("session")?.value;
    const session = await decrypt(cookie);

    // 4. Redirect to /login if the user is not authenticated
    if ((isProtectedRoute || isSelectSite) && !session?.userId) {
        return NextResponse.redirect(new URL("/login", req.nextUrl));
    }

    // 5. Redirect to /select-site if the user is authenticated but on login page
    if (isPublicRoute && session?.userId) {
        return NextResponse.redirect(new URL("/select-site", req.nextUrl));
    }

    // 6. If user tries to access a protected route but has no active site, send to /select-site
    if (isProtectedRoute && session?.userId && !session?.activeSiteId) {
        return NextResponse.redirect(new URL("/select-site", req.nextUrl));
    }

    // 7. Redirect root to /select-site
    if (path === "/") {
        if (session?.userId) {
            return NextResponse.redirect(new URL("/select-site", req.nextUrl));
        }
        return NextResponse.redirect(new URL("/login", req.nextUrl));
    }

    // 8. CSRF double-submit cookie check for /api/* state-changing requests.
    // The middleware matcher already excludes /api from auth-redirects, so
    // this is the dedicated CSRF gate for raw HTTP /api endpoints.
    if (path.startsWith("/api/") && isStateChangingMethod(req.method)) {
        if (!isCsrfExempt(path)) {
            const cookieToken = req.cookies.get("csrf")?.value;
            const headerToken = req.headers.get("x-csrf-token") ?? undefined;
            if (!verifyCsrfToken(cookieToken, headerToken)) {
                return new NextResponse(
                    JSON.stringify({ message: "CSRF token missing or invalid." }),
                    { status: 403, headers: { "content-type": "application/json" } },
                );
            }
        }
    }

    return intlResponse;
}

// Routes Middleware should not run on
export const config = {
    matcher: ["/((?!api|_next/static|_next/image|.*\\.png$|.*\\.ico$|.*\\.svg$|uploads).*)"],
};
