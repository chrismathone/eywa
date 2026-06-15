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

/**
 * Stage Manager가 메뉴를 임베드할 때 붙이는 ?embed=1을 x-embed 요청 헤더로 승격.
 * (shell)/layout이 await headers()로 읽어 사이드바/헤더 없는 크롬리스로 렌더한다.
 * 레이아웃은 searchParams를 못 받으므로 헤더가 정답(Next16 문서 권장).
 */
function nextWithEmbed(request: NextRequest) {
  if (request.nextUrl.searchParams.get("embed") === "1") {
    const headers = new Headers(request.headers);
    headers.set("x-embed", "1");
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next({ request });
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith("/login");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";
  // /api/* 라우트 (webhook 포함)는 자체 인증 (시크릿 헤더 등) 사용 — middleware 통과
  const isApiRoute = pathname.startsWith("/api/");

  if (isAuthRoute || isPublicAsset || isApiRoute) {
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

  return nextWithEmbed(request);
}
