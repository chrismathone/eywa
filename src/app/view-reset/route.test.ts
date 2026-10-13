// @vitest-environment node
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { VIEW_AS_COOKIE, VIEW_MODE_COOKIE } from "@/lib/auth/view-preference";

it("clears both view cookies without authentication, database or shell dependencies", () => {
  const response = GET(new NextRequest("https://www.aywa.co.kr/view-reset?next=https://example.com", {
    headers: { cookie: "eywa-view=teacher; eywa-view-as=stale-target; sb-auth-token=keep; eywa-theme=dark" },
  }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://www.aywa.co.kr/home");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.cookies.getAll()).toHaveLength(2);
  for (const name of [VIEW_MODE_COOKIE, VIEW_AS_COOKIE]) {
    expect(response.cookies.get(name)).toMatchObject({ name, value: "", path: "/", maxAge: 0, httpOnly: true });
  }
});
it("is repeatable when view cookies are already absent", () => {
  expect(GET(new NextRequest("http://localhost:3210/view-reset")).headers.get("location")).toBe("http://localhost:3210/home");
});
