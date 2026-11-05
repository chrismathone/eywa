import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_STATUS_MENUS, LEGACY_STATUS_ROLES, studentStatusManagerIds, studentStatusRefreshRequired } from "./student-status-permissions";
import { canManageStudentStatus } from "@/features/students/status-access";
import { MENU_ACCESS, SYSTEM_ROLES } from "@/lib/permissions";
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
  it("옛 방식에서 막는 것은 상태 변경 권한을 넓히는 변경뿐이다(원장 2026-11-05 *\"원생목록 '읽기'에 굳이 그럴 필요가있어?\"*)", () => {
    const before = { overrides: [], userOverrides: [], specialAccess: {} };
    const ov = (...rows: { role: string; access: string }[]) => ({ ...before, overrides: rows.map((r) => ({ menu: "students", ...r })) });
    const uo = (...rows: { userId: string; access: string }[]) => ({ ...before, userOverrides: rows.map((r) => ({ menu: "students", ...r })) });
    // 통과 — 아르바이트·열람·강사 칸, '읽기'·'담당'·'없음', 사무실 역할을 좁히는 변경, 개인 '읽기'.
    for (const next of [ov({ role: "parttime", access: "readonly" }), ov({ role: "viewer", access: "none" }), ov({ role: "teacher", access: "readonly" }),
      ov({ role: "manager", access: "none" }), ov({ role: "admin", access: "readonly" }), ov({ role: "accountant", access: "none" }),
      uo({ userId: A, access: "readonly" }), uo({ userId: A, access: "none" })]) {
      expect(studentStatusRefreshRequired(next, before)).toBe(false);
    }
    // 막음 — 회계(기본 '읽기')를 '전체'로 · 좁혀 둔 실장 칸을 지워 기본 '전체'로 · 개인 '전체' · 개인 제한 줄을 지움.
    expect(studentStatusRefreshRequired(ov({ role: "accountant", access: "full" }), before)).toBe(true);
    expect(studentStatusRefreshRequired(before, ov({ role: "manager", access: "readonly" }))).toBe(true);
    expect(studentStatusRefreshRequired(uo({ userId: A, access: "full" }), before)).toBe(true);
    expect(studentStatusRefreshRequired(before, uo({ userId: A, access: "readonly" }))).toBe(true);
    // 좁히는 쪽으로 바꾸는 개인 줄(읽기 → 없음)은 통과 · 이미 '전체'였던 칸은 그대로 두면 통과.
    expect(studentStatusRefreshRequired(uo({ userId: A, access: "none" }), uo({ userId: A, access: "readonly" }))).toBe(false);
    expect(studentStatusRefreshRequired(ov({ role: "admin", access: "full" }), before)).toBe(false);
    // 같은 칸에 줄이 여럿이면 **마지막 줄**이 실효값(DB student_status_private.menu · 앱 권한 해석과 같다).
    const dup = ov({ role: "admin", access: "full" }, { role: "admin", access: "readonly" }); // 실효 = 읽기
    expect(studentStatusRefreshRequired(dup, dup)).toBe(false); // 🔴 그대로 두면 절대 막지 않는다(겹친 줄이 저장된 학원의 다른 저장이 막히면 안 된다)
    expect(studentStatusRefreshRequired(ov({ role: "admin", access: "full" }), dup)).toBe(true); // 읽기 → 전체
    expect(studentStatusRefreshRequired(ov({ role: "admin", access: "readonly" }, { role: "admin", access: "full" }), dup)).toBe(true); // 순서만 바꿔 전체
    const udup = uo({ userId: A, access: "full" }, { userId: A, access: "readonly" }); // 개인 실효 = 읽기
    expect(studentStatusRefreshRequired(udup, udup)).toBe(false);
    expect(studentStatusRefreshRequired(uo({ userId: A, access: "readonly" }, { userId: A, access: "full" }), udup)).toBe(true); // 순서만 바꿔 전체
    // 관리자 도구('admin' 메뉴) '전체'도 옛 방식의 상태 변경 자격이다(DB allowed()).
    expect(studentStatusRefreshRequired({ ...before, overrides: [{ menu: "admin", role: "accountant", access: "full" }] }, before)).toBe(true);
    // 실장은 원생 기본값이 이미 '전체'라 관리자 도구 '전체'를 더해도 넓어지지 않는다.
    expect(studentStatusRefreshRequired({ ...before, overrides: [{ menu: "admin", role: "manager", access: "full" }] }, before)).toBe(false);
    expect(studentStatusRefreshRequired({ ...before, userOverrides: [{ menu: "admin", userId: A, access: "full" }] }, before)).toBe(true);
    expect(studentStatusRefreshRequired({ ...before, overrides: [{ menu: "admin", role: "manager", access: "readonly" }] }, before)).toBe(false);
    // 전환 중이거나 이미 지정된 학원은 보지 않는다 · 원생 아닌 메뉴는 보지 않는다.
    const widen = ov({ role: "accountant", access: "full" });
    expect(studentStatusRefreshRequired({ ...widen, specialAccess: { studentStatusManagerIds: [] } }, before)).toBe(false);
    expect(studentStatusRefreshRequired(widen, { ...before, specialAccess: { studentStatusManagerIds: [] } })).toBe(false);
    expect(studentStatusRefreshRequired({ ...before, overrides: [{ menu: "classes", role: "accountant", access: "full" }] }, before)).toBe(false);
  });
  it("🔴 DB 트리거(s2_0025)가 같은 역할 목록·같은 기본값을 든다 — 한쪽만 바뀌면 화면은 통과시키는데 DB가 거절한다", () => {
    expect([...LEGACY_STATUS_ROLES]).toEqual(SYSTEM_ROLES.filter((r) => r !== "master" && canManageStudentStatus({ id: A, systemRole: r }, false, undefined)));
    const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "s2_0025_student_status_guard_narrow.sql"), "utf8");
    const defaults = JSON.parse(sql.match(/defaults constant jsonb:='([^']+)'/)![1]) as Record<string, Record<string, string>>;
    expect(defaults).toEqual(Object.fromEntries(LEGACY_STATUS_MENUS.map((m) => [m, Object.fromEntries(LEGACY_STATUS_ROLES.map((r) => [r, MENU_ACCESS[m][r]]))])));
    expect(sql).toContain(`foreach r in array array[${LEGACY_STATUS_ROLES.map((r) => `'${r}'`).join(",")}] loop`);
    expect(sql).toContain(`foreach m in array array[${LEGACY_STATUS_MENUS.map((m) => `'${m}'`).join(",")}] loop`);
    expect(sql).toContain(`x.value->>'menu' in (${LEGACY_STATUS_MENUS.map((m) => `'${m}'`).join(",")})`);
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
