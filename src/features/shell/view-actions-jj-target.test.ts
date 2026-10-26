/**
 * '다른 강사 뷰' 대상 목록에 **JJ 보고서 담당**이 선다(원장 2026-10-26 *"강사뷰 전환에도 김동후가 떠야하지않나?"*).
 * 김동후는 강사 역할도 담임 반도 없지만 그날 JJ 교시 반을 원스크린에서 맡는다(delegation.ts) — 목록이 그 사람을 빠뜨렸다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  staff: [] as { id: string; display_name: string | null; system_role: string }[],
  classes: [] as { teacher_id: string | null }[],
  jjIds: [] as string[],
  settingsFail: false,
  call: 0,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "u-me", systemRole: "master", tenantId: "t1" }),
}));
vi.mock("@/lib/auth/view-mode", () => ({
  canUseTeacherView: async () => true,
  getShellView: async () => "admin",
  isFullShellRole: (r: string) => r !== "teacher" && r !== "student",
  VIEW_MODE_COOKIE: "eywa-view",
}));
vi.mock("@/lib/auth/view-as", () => ({
  canUseOtherTeacherView: async () => true,
  loadViewAsTarget: async () => null,
  VIEW_AS_COOKIE: "eywa-view-as",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
// 호출 순서 = 직원 → 반(view-actions의 Promise.all 순서).
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async () => (h.call++ === 0 ? h.staff : h.classes),
  fetchInChunks: async () => [],
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => {
    if (h.settingsFail) throw new Error("boom");
    return { permissions: { specialAccess: { jjReportManagerIds: h.jjIds } } };
  },
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));
vi.mock("@/features/class-sheets/server/access", () => ({ englishAssistantClassIdsOf: async () => [] }));
vi.mock("@/lib/auth/teacher-home", () => ({ teacherHomeForSubjects: async () => "/onescreen" }));
vi.mock("@/lib/auth/teacher-scope", () => ({ getTeacherScope: async () => ({ classIds: [], studentIds: [], subjects: [] }) }));

beforeEach(() => {
  h.call = 0;
  h.settingsFail = false;
  h.staff = [
    { id: "u-t", display_name: "박소선", system_role: "teacher" },
    { id: "u-jj", display_name: "김동후", system_role: "viewer" },
    { id: "u-desk", display_name: "오은진", system_role: "manager" },
  ];
  h.classes = [];
  h.jjIds = ["u-jj"];
});

async function list() {
  vi.resetModules();
  const { listTeacherViewTargets } = await import("./view-actions");
  return (await listTeacherViewTargets()).map((t) => t.name);
}

describe("'다른 강사 뷰' 대상 — JJ 보고서 담당", () => {
  it("강사 역할·담임 반이 없어도 JJ 보고서 담당이면 목록에 선다", async () => {
    expect(await list()).toEqual(["김동후", "박소선"]);
  });

  it("명단에 없는 사무실 직원은 그대로 빠진다", async () => {
    h.jjIds = [];
    expect(await list()).toEqual(["박소선"]);
  });

  it("설정을 못 읽어도 목록은 산다(JJ 갈래만 빈다)", async () => {
    h.settingsFail = true;
    expect(await list()).toEqual(["박소선"]);
  });
});
