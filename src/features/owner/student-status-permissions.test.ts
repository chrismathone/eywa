import { describe, expect, it } from "vitest";
import { studentStatusManagerIds, studentStatusRefreshRequired } from "./student-status-permissions";
import { resolveSettings } from "./resolve";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { permissionsSchema } from "./settings-types";
import { permissionsCanonical } from "./permissions-canonical";
import { prepareSectionForSave } from "./preset";
import { diffSettingsSection } from "./settings-diff";
import { specialAccessTargets } from "./special-access";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const permissions = (specialAccess = {}) => permissionsSchema.parse({ overrides: [], specialAccess });
describe("student status permission storage", () => {
  it("only raw absence inherits; malformed explicit values revoke", () => {
    expect(studentStatusManagerIds({})).toBeUndefined();
    for (const value of [null, [], "bad", [A, A], [A, 7]]) expect(studentStatusManagerIds({ studentStatusManagerIds: value })).toEqual([]);
    expect(studentStatusManagerIds({ studentStatusManagerIds: [A] })).toEqual([A]);
  });
  it("defaults revoke for new tenants while existing raw absence remains legacy", () => {
    for (const value of [DEFAULT_SETTINGS, GENERIC_SETTINGS]) expect(value.permissions.specialAccess.studentStatusManagerIds).toEqual([]);
    for (const preset of ["generic", "chinsan"]) {
      expect(resolveSettings({ preset }, { name: "" }).permissions.specialAccess.studentStatusManagerIds).toBeUndefined();
      for (const value of [null, [], [A, 7]]) expect(resolveSettings({ preset, permissions: { specialAccess: { studentStatusManagerIds: value } } }, { name: "" }).permissions.specialAccess.studentStatusManagerIds).toEqual([]);
    }
  });
  it("unrelated old saves preserve absence, named assignments, and explicit revocations", () => {
    for (const special of [{}, { studentStatusManagerIds: [] }, { studentStatusManagerIds: [A] }]) {
      const stored = { overrides: [], specialAccess: special };
      const input = { overrides: [], specialAccess: { leaveAdjusterIds: [B] } };
      const result = prepareSectionForSave("generic", "permissions", input, permissionsSchema.parse(input), stored) as { specialAccess: Record<string, unknown> };
      expect(result.specialAccess.studentStatusManagerIds).toEqual(special.studentStatusManagerIds);
      expect(Object.hasOwn(result.specialAccess, "studentStatusManagerIds")).toBe(Object.hasOwn(special, "studentStatusManagerIds"));
    }
  });
  it("legacy menu changes require explicit transition; unrelated menu saves do not", () => {
    const before = { overrides: [], userOverrides: [], specialAccess: {} };
    const next = { ...before, overrides: [{ menu: "students", role: "manager", access: "none" }] };
    expect(studentStatusRefreshRequired(next, before)).toBe(true);
    expect(studentStatusRefreshRequired({ ...next, specialAccess: { studentStatusManagerIds: [] } }, before)).toBe(false);
    expect(studentStatusRefreshRequired({ ...next, overrides: [{ menu: "classes", role: "manager", access: "none" }] }, before)).toBe(false);
    expect(studentStatusRefreshRequired(next, { ...before, specialAccess: { studentStatusManagerIds: [] } })).toBe(false);
  });
  it("canonical tokens distinguish legacy, explicit empty, and named assignments", () => {
    const values = [permissions(), permissions({ studentStatusManagerIds: [] }), permissions({ studentStatusManagerIds: [A] })];
    expect(new Set(values.map(permissionsCanonical)).size).toBe(3);
    expect(permissionsCanonical(permissions({ studentStatusManagerIds: [A, B] }))).toBe(permissionsCanonical(permissions({ studentStatusManagerIds: [B, A] })));
  });
  it("new targets, duplicate validation, and audit diff include the new permission", () => {
    const next = permissions({ studentStatusManagerIds: [A] });
    expect(specialAccessTargets(next.specialAccess, {}).userIds).toContain(A);
    expect(permissionsSchema.safeParse({ overrides: [], specialAccess: { studentStatusManagerIds: [A, A] } }).success).toBe(false);
    expect(diffSettingsSection("permissions", permissions(), permissions({ studentStatusManagerIds: [] })).changes.some((r) => r.label.includes("원생 상태 변경"))).toBe(true);
  });
});
