import { describe, expect, it } from "vitest";
import { safeLoginNext } from "./login-next";

describe("login destination", () => {
  it.each(["/dashboard", "/attendance?view=live&date=2026-09-22", "/students/abc#notes", "/?section=guide"])("preserves a local destination: %s", (path) => {
    expect(safeLoginNext(path)).toBe(path);
  });

  it.each([
    undefined, null, ["/dashboard"], "", "https://example.com", "//example.com",
    "/\\example.com", "/%2fexample.com", "/%5cexample.com", "/\n/example.com",
    "/%0a/example.com", "/%00anything", "javascript:alert(1)", "/%zz",
    "/login", "/login?next=/dashboard", "/x/../login", "/%6cogin", "/login/",
  ])("rejects unsafe or looping destinations: %s", (path) => {
    expect(safeLoginNext(path)).toBeNull();
  });

  it("normalizes dot segments without discarding filters", () => {
    expect(safeLoginNext("/students/../attendance?view=live")).toBe("/attendance?view=live");
  });
});
