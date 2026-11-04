import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ claims: vi.fn(async () => ({ data: null, error: null })) }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: auth.claims } }),
}));
vi.mock("./env", () => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "test" }));

import { updateSession } from "./proxy";

it("keeps the emergency exit reachable without checking a broken or absent session", async () => {
  auth.claims.mockClear();
  const response = await updateSession(new NextRequest("https://www.aywa.co.kr/view-reset"));
  expect(response.headers.get("location")).toBeNull();
  expect(auth.claims).not.toHaveBeenCalled();
  const protectedRoute = await updateSession(new NextRequest("https://www.aywa.co.kr/view-reset-settings"));
  expect(new URL(protectedRoute.headers.get("location")!).pathname).toBe("/login");
});

describe("login return destination", () => {
  it("retains the query instead of returning to the default dashboard", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3032/dashboard?subject=math"));
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard?subject=math");
    expect(location.searchParams.has("subject")).toBe(false);
  });

  it("preserves multiple encoded filters without turning them into login parameters", async () => {
    const path = "/students?tab=attendance&q=%EA%B9%80&status=enrolled";
    const response = await updateSession(new NextRequest(`http://localhost:3032${path}`));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe(path);
    expect([...location.searchParams.keys()]).toEqual(["next"]);
  });

  it("leaves the login page and its destination unchanged", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3032/login?next=%2Fdashboard%3Fview%3Drooms"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("공용 '링크 만료' 페이지는 비로그인 통과(원장 2026-10-01)", () => {
  it("🔴 쿠키 없는 학부모가 /expired를 열어도 로그인 화면으로 가지 않는다", async () => {
    for (const path of ["/expired", "/expired?kind=report", "/expired?kind=video", "/r/abc"]) {
      const response = await updateSession(new NextRequest(`http://localhost:3032${path}`));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("정확 매칭 — 비슷한 이름의 다른 경로는 그대로 로그인 게이트", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3032/expired-reports"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
});
