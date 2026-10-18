import { expect, it } from "vitest";
import { classGap } from "./class-gap";

it("aywa has a current math class but Today's Math doesn't → sync pending (an error if it lasts)", () => {
  expect(classGap({ linked: false, withdrawnAt: null, aywaMathClasses: ["중2A"] })).toEqual({ kind: "sync_pending", aywaClasses: ["중2A"], withdrawnAt: null });
  expect(classGap({ linked: true, withdrawnAt: "2026-09-30T15:00:00.000Z", aywaMathClasses: ["중2A"] }).kind).toBe("sync_pending");
});

it("no current math class in aywa → ended (linked before) or never in math", () => {
  expect(classGap({ linked: true, withdrawnAt: "2026-09-30T15:00:00.000Z", aywaMathClasses: [] })).toEqual({ kind: "ended", withdrawnAt: "2026-09-30T15:00:00.000Z" });
  expect(classGap({ linked: true, withdrawnAt: undefined, aywaMathClasses: [] })).toEqual({ kind: "ended", withdrawnAt: null });
  expect(classGap({ linked: false, withdrawnAt: null, aywaMathClasses: [] })).toEqual({ kind: "not_in_math" });
});

it("does not guess when the aywa lookup failed", () => {
  expect(classGap({ linked: true, withdrawnAt: null, aywaMathClasses: null })).toEqual({ kind: "unknown" });
});
