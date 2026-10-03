import { describe, expect, it } from "vitest";
import { nextPermissionAccess } from "./permission-edit";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { MENU_KEYS, SYSTEM_ROLES, isPermissionLocked, type Access } from "@/lib/permissions";

describe("permission edit cycle", () => {
  it("skips none for master settings and returns to full", () => {
    for (const menu of SETTINGS_ROLE_KEYS) {
      let current: Access = "full";
      current = nextPermissionAccess(menu, "master", current); expect(current).toBe("scoped");
      current = nextPermissionAccess(menu, "master", current); expect(current).toBe("readonly");
      current = nextPermissionAccess(menu, "master", current); expect(current).toBe("full");
    }
  });
  it("never chooses a locked value; wholly locked roles remain unchanged", () => {
    const values: Access[] = ["full", "scoped", "readonly", "none"];
    for (const menu of MENU_KEYS) for (const role of SYSTEM_ROLES) for (const current of values) {
      const next = nextPermissionAccess(menu, role, current);
      if (values.every((value) => isPermissionLocked(menu, role, value))) expect(next).toBe(current);
      else expect(isPermissionLocked(menu, role, next)).toBe(false);
    }
  });
});
