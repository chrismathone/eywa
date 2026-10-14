import { describe, expect, it } from "vitest";
import { canEditEnrollmentDateClass, canEditEnrollmentDates } from "./date-access";
import { permissionsSchema } from "@/features/owner/settings-types";
import { permissionsCanonical } from "@/features/owner/permissions-canonical";
import { specialAccessTargets } from "@/features/owner/special-access";
import { prepareSectionForSave } from "@/features/owner/preset";

const id = "11111111-1111-4111-8111-111111111111";
describe("수강 날짜 수정 기능 지정", () => {
  it("원장은 지정 없이, 일반 직원은 지정해야 수정한다", () => {
    expect(canEditEnrollmentDates({ id, systemRole: "master" }, false, [])).toBe(true);
    expect(canEditEnrollmentDates({ id, systemRole: "admin" }, false, [])).toBe(false);
    expect(canEditEnrollmentDates({ id, systemRole: "teacher" }, false, [id])).toBe(true);
    expect(canEditEnrollmentDates({ id, systemRole: "viewer" }, false, [id])).toBe(true);
    expect(canEditEnrollmentDates({ id, systemRole: "student" }, false, [id])).toBe(false);
    expect(canEditEnrollmentDates({ id, systemRole: "admin" }, true, [])).toBe(true);
  });
  it("명단이 없거나 깨졌으면 지정되지 않은 것으로 본다", () => {
    for (const value of [null, undefined, id, {}, []]) expect(canEditEnrollmentDates({ id, systemRole: "admin" }, false, value)).toBe(false);
  });
  it("담당 범위는 날짜 칸에서도 유지한다", () => {
    expect(canEditEnrollmentDateClass({ allowed: true, classIds: ["own"] }, "own")).toBe(true);
    expect(canEditEnrollmentDateClass({ allowed: true, classIds: ["own"] }, "other")).toBe(false);
    expect(canEditEnrollmentDateClass({ allowed: false, classIds: null }, "own")).toBe(false);
    expect(canEditEnrollmentDateClass({ allowed: true, classIds: null }, "other")).toBe(true);
  });
  it("명단은 UUID·중복·상한을 검증하고 저장 기준 및 신규 직원 검증에 포함한다", () => {
    const base = permissionsSchema.parse({ overrides: [] });
    const next = permissionsSchema.parse({ overrides: [], specialAccess: { enrollmentDateEditorIds: [id] } });
    expect(permissionsCanonical(next)).not.toBe(permissionsCanonical(base));
    expect(specialAccessTargets(next.specialAccess, base.specialAccess).userIds).toEqual([id]);
    expect(specialAccessTargets(base.specialAccess, next.specialAccess).userIds).toEqual([]);
    for (const ids of [["wrong"], [id, id], Array.from({ length: 81 }, () => id)]) {
      expect(permissionsSchema.safeParse({ overrides: [], specialAccess: { enrollmentDateEditorIds: ids } }).success).toBe(false);
    }
  });
  it("새 칸을 모르는 예전 화면의 저장으로 명단이 지워지지 않는다", () => {
    const stored = { overrides: [], specialAccess: { enrollmentDateEditorIds: [id] } };
    const old = { overrides: [], specialAccess: { leaveAdjusterIds: [] } };
    const saved = prepareSectionForSave("chinsan", "permissions", old, permissionsSchema.parse(old), stored);
    expect((saved as typeof stored).specialAccess.enrollmentDateEditorIds).toEqual([id]);
  });
});
