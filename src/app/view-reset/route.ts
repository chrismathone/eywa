import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_COOKIE, VIEW_MODE_COOKIE } from "@/lib/auth/view-preference";

/** Emergency exit outside (shell): no page render, permission lookup or client JavaScript is required. */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/home", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  // Preserve the authenticated session and all other preferences. The next request resolves the actor's home.
  for (const name of [VIEW_MODE_COOKIE, VIEW_AS_COOKIE]) {
    response.cookies.set(name, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  }
  return response;
}
