/**
 * 반 게이트(class-scope.ts)의 '내 반인가'는 **화면 주인**으로 판정한다 — 강사뷰 신원 점검(2026-11-05).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 강사 X를 열면 메뉴 수준은 X 것(scoped)으로 바뀌는데, 담임·교시·위임 비교만
 * 실제 계정 A의 id로 해서 X의 반 상세가 404, 반 수정·인수인계·위임이 "담당 반만 수정할 수 있습니다"로 거절됐다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-admin", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "admin" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  level: vi.fn(),
  superAdmin: vi.fn(),
  delegated: vi.fn(),
  calls: [] as unknown[][],
  classTeacher: null as string | null,
  /** count 질의에서 teacher_id가 이 값이면 1건으로 답한다(담임·교시 갈래). */
  ownerId: "x-teacher",
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("./delegation", () => ({ getDelegatedClassIdsInRange: m.delegated }));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let head = false;
      const q: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return q; },
        eq: (k: string, v: unknown) => { filters[k] = v; m.calls.push([table, k, v]); return q; },
        maybeSingle: async () => ({ data: { teacher_id: m.classTeacher }, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve(head ? { count: filters.teacher_id === m.ownerId ? 1 : 0, error: null } : { data: null, error: null }),
      };
      return q;
    },
  }),
}));

import { canViewClassDetail, canWriteLoadedClass, requireClassWrite } from "./class-scope";
import { CLASS_NOT_MINE_ERROR } from "../class-write-scope";

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.classTeacher = X.id;
  m.ownerId = X.id;
  // 강사뷰: 옵션을 주면 대상 X, 안 주면 실제 계정 A — 실제 getCurrentUser와 같은 모양.
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  // getUserPermMatrix는 A의 역할 줄까지 X 값으로 덮는다 → 어느 역할로 물어도 scoped.
  m.level.mockResolvedValue("scoped");
  m.superAdmin.mockResolvedValue(false);
  m.delegated.mockResolvedValue([]);
});

describe("반 쓰기 게이트 — 강사뷰면 대상 강사의 담임 반", () => {
  it("대상 강사 X의 담임 반은 통과하고, 기록 명의로 쓸 사람도 X를 돌려준다", async () => {
    const gate = await requireClassWrite("class-1");
    expect(gate).toEqual({ user: X });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
  });

  it("X의 반이 아니면(실제 계정 A의 반이어도) 거절한다", async () => {
    m.classTeacher = A.id;
    expect(await requireClassWrite("class-1")).toEqual({ user: null, error: CLASS_NOT_MINE_ERROR });
  });

  it("화면 버튼(canWriteLoadedClass)도 같은 사람으로 판정한다", async () => {
    expect(await canWriteLoadedClass(X.id)).toBe(true);
    expect(await canWriteLoadedClass(A.id)).toBe(false);
  });

  it("읽기 강사뷰(수준 readonly)는 담임이어도 쓰지 못한다", async () => {
    m.level.mockResolvedValue("readonly");
    expect((await requireClassWrite("class-1")).error).toBeTruthy();
    expect(await canWriteLoadedClass(X.id)).toBe(false);
  });
});

describe("반 상세 열람 — 담임·교시·위임 세 갈래를 대상 강사 id로 묻는다", () => {
  it("X의 반 상세가 열린다(실제 계정 id로 물어 404가 되던 자리)", async () => {
    expect(await canViewClassDetail("class-1")).toBe(true);
    expect(m.calls).toContainEqual(["classes", "teacher_id", X.id]);
    expect(m.calls).toContainEqual(["class_schedules", "teacher_id", X.id]);
    expect(m.calls.some(([, k, v]) => k === "teacher_id" && v === A.id)).toBe(false);
    expect(m.delegated).toHaveBeenCalledWith(X.id, expect.any(String), expect.any(String));
  });

  it("담임·교시가 아니어도 X가 위임받은 반이면 열린다", async () => {
    m.ownerId = "someone-else";
    m.delegated.mockResolvedValue(["class-1"]);
    expect(await canViewClassDetail("class-1")).toBe(true);
  });

  it("X와 무관한 반은 닫힌다", async () => {
    m.ownerId = A.id; // A의 반이어도 X 화면에서는 남의 반
    expect(await canViewClassDetail("class-1")).toBe(false);
  });
});
