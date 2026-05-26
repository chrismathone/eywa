import { describe, expect, it } from "vitest";
import { canAccess, accessLevel } from "@/lib/permissions";

describe("permissions matrix", () => {
  it("master can access every menu", () => {
    const menus = [
      "dashboard",
      "timetable",
      "attendance",
      "classes",
      "students",
      "enrollment",
      "consultations",
      "withdrawals",
      "staff",
      "billing",
      "meetings",
      "help",
    ] as const;

    for (const menu of menus) {
      expect(canAccess("master", menu)).toBe(true);
      expect(accessLevel("master", menu)).toBe("full");
    }
  });

  it("teacher cannot access enrollment or billing", () => {
    expect(canAccess("teacher", "enrollment")).toBe(false);
    expect(canAccess("teacher", "billing")).toBe(false);
  });

  it("accountant has full billing access but no enrollment", () => {
    expect(accessLevel("accountant", "billing")).toBe("full");
    expect(canAccess("accountant", "enrollment")).toBe(false);
  });

  it("counselor leads enrollment pipeline", () => {
    expect(accessLevel("counselor", "enrollment")).toBe("full");
    expect(accessLevel("counselor", "consultations")).toBe("full");
  });
});
