/**
 * 반 게이트(class-scope.ts)의 '내 반인가'는 **화면 주인**으로 판정한다 — 강사뷰 신원 점검(2026-11-05).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 강사 X를 열면 메뉴 수준은 X 것(scoped)으로 바뀌는데, 담임·교시·위임 비교만
 * 실제 계정 A의 id로 해서 X의 반 상세가 404, 반 수정·인수인계·위임이 "담당 반만 수정할 수 있습니다"로 거절됐다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMatrix, type Access, type AccessMatrix } from "@/lib/permissions";

const A = { id: "a-admin", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "admin" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  level: vi.fn(),
  baseMatrix: vi.fn(),
  readonlyView: vi.fn(),
  superAdmin: vi.fn(),
  delegated: vi.fn(),
  calls: [] as unknown[][],
  classTeacher: null as string | null,
  /** count 질의에서 teacher_id가 이 값이면 1건으로 답한다(담임·교시 갈래). */
  ownerId: "x-teacher",
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level, getPermMatrix: m.baseMatrix }));
vi.mock("@/lib/auth/view-as", () => ({ isReadonlyTeacherView: m.readonlyView }));
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
  m.readonlyView.mockResolvedValue(false);
  m.baseMatrix.mockResolvedValue(resolveMatrix([])); // 지점 기본: 강사 = 반 scoped, 원장·실장 = full
});

/** 반 메뉴 줄만 바꾼 지점 매트릭스(나머지는 코드 기본값). */
function classesMatrix(levels: Partial<Record<string, Access>>): AccessMatrix {
  const base = resolveMatrix([]);
  return { ...base, classes: { ...base.classes, ...levels } } as AccessMatrix;
}

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

describe("🔴 읽기 강사뷰 — 캡이 지운 담당 범위를 되살린다(2026-11-05 적대 리뷰)", () => {
  // 읽기 강사뷰에선 getUserPermMatrix가 대상의 scoped를 readonly로 누른다 → 넘겨받는 수준은 readonly.
  beforeEach(() => { m.level.mockResolvedValue("readonly"); m.readonlyView.mockResolvedValue(true); });

  it("대상 강사 X의 반만 열린다 — X와 무관한 반은 닫힌다(리뷰어 재현: 담당 조회 없이 무조건 열렸다)", async () => {
    m.ownerId = "someone-else";
    expect(await canViewClassDetail("someone-elses-class")).toBe(false);
    expect(m.calls.length).toBeGreaterThan(0);
    m.ownerId = X.id;
    expect(await canViewClassDetail("class-1")).toBe(true);
    expect(m.calls).toContainEqual(["classes", "teacher_id", X.id]);
  });

  it("X가 위임받은 반도 열린다(세 갈래 그대로)", async () => {
    m.ownerId = "someone-else";
    m.delegated.mockResolvedValue(["class-1"]);
    expect(await canViewClassDetail("class-1")).toBe(true);
    expect(m.delegated).toHaveBeenCalledWith(X.id, expect.any(String), expect.any(String));
  });

  it("대상 역할이 원래 전체(원장·실장)면 캡이 지운 범위가 없어 종전대로 무제한 열람", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? { ...X, systemRole: "manager" } : A));
    m.ownerId = "someone-else";
    expect(await canViewClassDetail("someone-elses-class")).toBe(true);
    expect(m.calls).toEqual([]);
  });

  it("지점 설정이 강사 반 수준을 full로 열어 두었으면 종전대로 무제한", async () => {
    m.baseMatrix.mockResolvedValue(classesMatrix({ teacher: "full" }));
    m.ownerId = "someone-else";
    expect(await canViewClassDetail("someone-elses-class")).toBe(true);
  });
});

describe("강사뷰가 아닐 때와 전체 강사뷰는 그대로", () => {
  it("강사뷰가 아닌 readonly(회계·뷰어)는 지점 매트릭스를 보지 않고 무제한 열람", async () => {
    m.level.mockResolvedValue("readonly");
    m.readonlyView.mockResolvedValue(false);
    m.ownerId = "someone-else";
    expect(await canViewClassDetail("someone-elses-class")).toBe(true);
    expect(m.baseMatrix).not.toHaveBeenCalled();
    expect(m.calls).toEqual([]);
  });

  it("full(관리자 본인·겸직 강사뷰)은 무제한", async () => {
    m.level.mockResolvedValue("full");
    m.ownerId = "someone-else";
    expect(await canViewClassDetail("someone-elses-class")).toBe(true);
    expect(m.readonlyView).not.toHaveBeenCalled();
  });
});
