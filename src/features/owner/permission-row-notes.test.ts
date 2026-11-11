/**
 * 역할·권한 표의 줄 글(`ROW_NOTE`)이 말하는 조건을 **문 함수를 실제로 돌려** 맞춘다(2026-11-11 · Codex 리뷰 반영).
 * 글의 문장만 잠그면 문이 바뀌어도 통과한다 — 홍보·마케팅 줄은 "행사 자료를 옮겨 둔 학원에서만 · 보기 = 수납관리 권한도 함께 ·
 * 저장 = 원장·관리자 + 두 권한 모두 쓰기"라고 적는다. 문(`archiveGate`)을 권한 표 한 벌로 돌려 그 말이 사실인지 본다.
 * 관찰 기록 줄(경영 분석·지식그래프 · 업무 작성센터)도 문(`knowledgeAccess`)을 돌려 맞춘다 — '전체'를 주면 모든 직원의 관찰 기록이 열린다.
 * 조직·OKR · 업무 작성센터 문서 · 경영 분석 화면의 조건은 permission-rows.test.ts가 서버 문의 역할 목록·판정 식과 맞춘다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessLevel, canAccess, canWrite, MENU_LABEL, resolveMatrix, type AccessMatrix, type MenuKey, type PermissionOverride, type SystemRole } from "@/lib/permissions";

const m = vi.hoisted(() => ({ user: null as null | { id: string; tenantId: string; systemRole: string }, matrix: null as unknown }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canAccessTenant: async (role: SystemRole, menu: MenuKey) => canAccess(role, menu, m.matrix as AccessMatrix),
  canWriteTenant: async (role: SystemRole, menu: MenuKey) => canWrite(role, menu, m.matrix as AccessMatrix),
  canManageTenant: async (role: SystemRole, menu: MenuKey) => accessLevel(role, menu, m.matrix as AccessMatrix) === "full",
}));
// 메뉴 문(menuGate)은 실제 함수를 돌린다 — 그 아래(운영 계정 여부 · 보기 차단)만 평범한 값으로 둔다.
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: async () => null }));
vi.mock("@/features/student-contribution/server/fact-access", () => ({ readableFactStudents: async () => null }));
vi.mock("@/features/student-contribution/server/live-context", () => ({ unavailableSection: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("이 시험은 DB를 읽지 않는다"); } }));

import { archiveGate } from "@/features/marketing-archive/server";
import { knowledgeAccess } from "@/features/academy-knowledge/server-records";
import { ARCHIVE_TENANT } from "@/features/marketing-archive/model";
import { ROW_NOTE } from "./permission-row-notes";

const OTHER_TENANT = "00000000-0000-4000-8000-0000000000aa";
const as = (role: SystemRole, tenantId: string, overrides: PermissionOverride[]) => {
  m.user = { id: "00000000-0000-4000-8000-000000000001", tenantId, systemRole: role };
  m.matrix = resolveMatrix(overrides);
};
const cells = (role: SystemRole, marketing: PermissionOverride["access"], billing: PermissionOverride["access"]): PermissionOverride[] => [
  { menu: "marketing", role, access: marketing },
  { menu: "billing", role, access: billing },
];
const opens = () => archiveGate().then(() => true, () => false);
const saves = () => archiveGate(true).then(() => true, () => false);

beforeEach(() => { m.user = null; m.matrix = resolveMatrix([]); });

describe("홍보·마케팅 줄 글 = 문(archiveGate)이 실제로 하는 일", () => {
  it("🔴 행사 자료를 옮겨 둔 학원에서만 열린다 — 그 밖의 학원은 원장이 두 권한을 다 가져도 열리지 않는다", async () => {
    expect(ROW_NOTE.marketing).toContain("행사 자료를 옮겨 둔 학원에서만 열리고, 그 밖의 학원에서는 이 칸을 열어도 화면이 열리지 않습니다");
    as("master", OTHER_TENANT, []);
    expect(await opens()).toBe(false);
    expect(await saves()).toBe(false);
    as("admin", OTHER_TENANT, cells("admin", "full", "full"));
    expect(await opens()).toBe(false);
    as("master", ARCHIVE_TENANT, []);
    expect(await opens()).toBe(true);
    expect(await saves()).toBe(true);
  });

  it("🔴 보려면 수납관리 권한이 함께 있어야 한다 — 홍보·마케팅만 열어서는 안 열린다", async () => {
    expect(ROW_NOTE.marketing).toContain("권한이 함께 있어야 하고");
    as("manager", ARCHIVE_TENANT, cells("manager", "full", "none"));
    expect(await opens()).toBe(false);
    as("manager", ARCHIVE_TENANT, cells("manager", "none", "full"));
    expect(await opens()).toBe(false);
    as("manager", ARCHIVE_TENANT, cells("manager", "readonly", "readonly"));
    expect(await opens()).toBe(true);
  });

  it("🔴 저장 = 원장·관리자가 두 권한 모두 '전체'나 '담당'일 때만 — '읽기'면 보기만 · 그 밖의 역할은 '전체'여도 보기만", async () => {
    expect(ROW_NOTE.marketing).toContain("두 권한 모두 ‘전체’나 ‘담당’일 때만 합니다(‘읽기’면 보기만)");
    // 관리자 — 홍보·마케팅 '전체' + 수납관리 '읽기' = 보기만.
    as("admin", ARCHIVE_TENANT, cells("admin", "full", "readonly"));
    expect([await opens(), await saves()]).toEqual([true, false]);
    as("admin", ARCHIVE_TENANT, cells("admin", "readonly", "full"));
    expect([await opens(), await saves()]).toEqual([true, false]);
    for (const [marketing, billing] of [["full", "full"], ["scoped", "full"], ["full", "scoped"]] as const) {
      as("admin", ARCHIVE_TENANT, cells("admin", marketing, billing));
      expect([await opens(), await saves()], `${marketing}·${billing}`).toEqual([true, true]);
    }
    // 원장도 '읽기'로 내려 두었으면 저장하지 못한다.
    as("master", ARCHIVE_TENANT, cells("master", "readonly", "full"));
    expect([await opens(), await saves()]).toEqual([true, false]);
    // 원장·관리자가 아닌 역할은 두 권한이 '전체'여도 보기만 한다.
    for (const role of ["manager", "teacher", "counselor", "accountant"] as const) {
      as(role, ARCHIVE_TENANT, cells(role, "full", "full"));
      expect([await opens(), await saves()], role).toEqual([true, false]);
    }
  });
});

describe("관찰 기록 줄 글 = 문(knowledgeAccess)이 실제로 하는 일", () => {
  const TENANT = "00000000-0000-4000-8000-0000000000bb";
  const gate = async (role: SystemRole, work: PermissionOverride["access"], management: PermissionOverride["access"]) => {
    as(role, TENANT, [{ menu: "work_records", role, access: work }, { menu: "management", role, access: management }]);
    const g = await knowledgeAccess().catch(() => null);
    return g ? { seeAll: g.seeAll, reviewer: g.reviewer, writable: g.writable } : null;
  };

  it("🔴 업무 작성센터만으로는 본인 관찰 기록만 — '전체'여도 남의 관찰 기록은 읽지 못한다", async () => {
    expect(ROW_NOTE.work_records).toContain("관찰 기록은 이 권한만으로는 본인 것만 읽고 씁니다");
    for (const role of ["admin", "manager", "teacher", "counselor"] as const) {
      expect(await gate(role, "full", "none"), role).toEqual({ seeAll: false, reviewer: false, writable: true });
    }
    // 경영 분석·지식그래프가 '읽기'·'담당'이어도 전체 열람이 아니다('전체'여야 한다).
    expect(await gate("admin", "full", "readonly")).toEqual({ seeAll: false, reviewer: false, writable: true });
    expect(await gate("admin", "full", "scoped")).toEqual({ seeAll: false, reviewer: false, writable: true });
  });

  it("🔴 경영 분석·지식그래프 '전체' + 업무 작성센터 열람 = 모든 직원의 관찰 기록을 읽는다 — 역할을 가리지 않는다(강사·상담도)", async () => {
    expect(ROW_NOTE.management).toContain(`‘전체’인 사람은 ${MENU_LABEL.work_records}가 열려 있으면 그 화면의 관찰 기록도 모든 직원 것을 읽고(학생에 대한 기록은 ${MENU_LABEL.students} 권한 범위의 학생 것만), 그 화면에 쓸 수 있으면 확인·후속 조치까지 합니다 — 강사·상담에게 줘도 같습니다`);
    expect(ROW_NOTE.work_records).toContain(`모든 직원의 관찰 기록 열람과 확인·후속 조치는 ‘${MENU_LABEL.management}’ ‘전체’가 함께 있어야 합니다`);
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant"] as const) {
      // 업무 작성센터 '읽기' = 읽기만(확인·후속 조치는 못 한다) · '담당'·'전체' = 확인·후속 조치까지.
      expect(await gate(role, "readonly", "full"), `${role}·읽기`).toEqual({ seeAll: true, reviewer: false, writable: false });
      expect(await gate(role, "scoped", "full"), `${role}·담당`).toEqual({ seeAll: true, reviewer: true, writable: true });
      expect(await gate(role, "full", "full"), `${role}·전체`).toEqual({ seeAll: true, reviewer: true, writable: true });
    }
    // 업무 작성센터가 닫혀 있으면 경영 분석·지식그래프 '전체'여도 관찰 기록 화면은 열리지 않는다.
    expect(await gate("admin", "none", "full")).toBeNull();
  });
});
