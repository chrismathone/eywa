import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error: null }) } }),
}));
vi.mock("./env", () => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "test" }));

import { updateSession } from "./proxy";

describe("login return destination", () => {
  it("retains the classroom preview instead of returning to the default dashboard", async () => {
    const response = await updateSession(new NextRequest("http://localhost:3032/dashboard?view=rooms"));
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard?view=rooms");
    expect(location.searchParams.has("view")).toBe(false);
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
