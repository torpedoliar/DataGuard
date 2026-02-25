import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/lib/session";

// 1. Specify protected and public routes
const protectedRoutes = ["/checklist", "/report", "/admin", "/grid", "/audit"];
const publicRoutes = ["/login"];

export default async function middleware(req: NextRequest) {
    // 2. Check if the current route is protected or public
    const path = req.nextUrl.pathname;
    const isProtectedRoute = protectedRoutes.some((route) => path.startsWith(route));
    const isPublicRoute = publicRoutes.includes(path);
    const isSelectSite = path === "/select-site";

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

    return NextResponse.next();
}

// Routes Middleware should not run on
export const config = {
    matcher: ["/((?!api|_next/static|_next/image|.*\\.png$|.*\\.ico$|.*\\.svg$|uploads).*)"],
};
