import { describe, expect, it } from "vitest";
import { resolveMatrix, applyUserOverrides } from "@/lib/permissions";
import { resolveSettings } from "@/features/owner/resolve";
import { capMakeupMode, normalizeMakeupSettings } from "./config";

describe("new makeup feature gates", () => {
  it("existing and new tenants both start off without changing other menu permissions", () => {
    for (const preset of ["chinsan", "generic"]) {
      const settings = resolveSettings({ preset }, { name: "합성 학원" });
      expect(settings.makeups).toEqual({ mode: "off", allowAdditional: false, pilotSubjects: ["math"] });
      const base = resolveMatrix([]), capped = capMakeupMode(base, settings.makeups.mode);
      expect(Object.values(capped.makeups)).toEqual(Array(9).fill("none"));
      expect(capped.attendance).toEqual(base.attendance);
      expect(capped.owner).toEqual(base.owner);
    }
  });
  it("personal and tenant grants cannot reopen the off feature", () => {
    const base = resolveMatrix([{ menu: "makeups", role: "viewer", access: "full" }]);
    const granted = applyUserOverrides(base, "test-user", "viewer", [{ userId: "test-user", menu: "makeups", access: "full" }]);
    expect(capMakeupMode(granted, "off").makeups.viewer).toBe("none");
    expect(capMakeupMode(granted, "draining").makeups.viewer).toBe("full");
  });
  it("corrupt configuration cannot activate a tenant", () => {
    for (const raw of [null, { mode: "on" }, { mode: "on", allowAdditional: "false", pilotSubjects: ["math"] },
      { mode: "on", allowAdditional: false, pilotSubjects: ["english"] },
      { mode: "on", allowAdditional: false, pilotSubjects: [] }]) {
      expect(normalizeMakeupSettings(raw).mode).toBe("off");
    }
    expect(normalizeMakeupSettings({ mode: "on", allowAdditional: false, pilotSubjects: ["math", "math"] }).pilotSubjects).toEqual(["math"]);
  });
});
