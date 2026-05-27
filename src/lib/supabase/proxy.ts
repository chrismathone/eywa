import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap auth gate — just checks if a Supabase auth cookie exists.
 * The (shell) layout still calls supabase.auth.getUser() for the real
 * verification + tenant lookup, so an invalid/expired cookie still
 * results in a /login bounce; this middleware is only there to avoid
 * rendering the full app shell when there's no session at all.
 *
 * We previously tried server-side getUser() here, but on Vercel +
 * Next.js 16 + @supabase/ssr 0.10.x the cookie-format ('base64-...'
 * prefix) didn't round-trip cleanly through the middleware adapter,
 * which caused a login → /login loop. Pushing the check into the
 * layout (where the cookies adapter is the same as data queries)
 * sidesteps the mismatch.
 */

// Paths that the marketing landing serves — accessible without auth
const PUBLIC_PATHS = new Set(["/"]);

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith("/login");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname === "/favicon.ico";

  if (isAuthRoute || isPublicAsset) {
    return NextResponse.next({ request });
  }

  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  // Public routes (marketing landing) — let everyone through.
  // Logged-in users on "/" still see the landing here; client-side redirect
  // to /dashboard can be added later if desired.
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next({ request });
  }

  if (!hasAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
