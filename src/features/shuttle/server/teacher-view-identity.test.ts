/**
 * 셔틀 기록·열람·관리자 면·연락처는 **화면 주인**의 역할·셔틀 담당 토글로 판정한다(2026-11-05 강사뷰 신원 점검 · 적대 리뷰).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 셔틀 담당 X를 열면 X의 토글이 안 보여 셔틀 화면이 착지로 튕겼고, 실제 계정(원장) 역할로
 * 관리자 면(실시간 위치)이 열렸다. 읽기 강사뷰는 토글 갈래가 canWriteTenant를 안 지나 대상의 토글로 등하원을 기록할 수 있었다.
 * 거꾸로 읽기 강사뷰는 기록 자격이 늘 막혀, X(셔틀 담당)가 보는 탑승 연락처가 빈칸이었다.
 * ⚠️ `@/lib/permissions`는 **진짜 모듈**을 쓴다 — canAccess를 false로 고정하면 메뉴 갈래(누구의 역할 줄을 보나)를 검증하지 못한다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMatrix, type Access, type AccessMatrix } from "@/lib/permissions";

const A = { id: "a-master", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "master" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({
  user: vi.fn(), readonly: vi.fn(), readonlyView: vi.fn(), canWrite: vi.fn(), superAdmin: vi.fn(), recordDuty: vi.fn(), viewDuty: vi.fn(),
  userMatrix: vi.fn(), baseMatrix: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
  rows: {} as Record<string, unknown[]>,
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly, isReadonlyTeacherView: m.readonlyView }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, getUserPermMatrix: m.userMatrix, getPermMatrix: m.baseMatrix }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/auth/teacher-home", () => ({ landingPath: vi.fn(async () => "/onescreen") }));
vi.mock("./duty", () => ({ hasShuttleRecordDuty: m.recordDuty, getShuttleDuty: m.viewDuty }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in"]) q[k] = () => q;
      q.then = (r: (v: unknown) => void) => r({ data: m.rows[table] ?? [], error: null });
      return q;
    },
  }),
}));

import { canRecordBoarding, canSeeBoardingContacts } from "./record-gate";
import { isShuttleAdmin, requireShuttleView } from "./access";
import { getRiderContacts } from "./rider-contacts";

/** 셔틀 메뉴 줄만 바꾼 매트릭스(나머지는 코드 기본값). */
function shuttleMatrix(levels: Partial<Record<string, Access>>): AccessMatrix {
  const base = resolveMatrix([]);
  return { ...base, shuttle: { ...base.shuttle, ...levels } } as AccessMatrix;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.readonly.mockResolvedValue(null);
  m.readonlyView.mockResolvedValue(false);
  m.canWrite.mockResolvedValue(false); // X(강사)는 편성 권한이 없다 — 매트릭스가 X 값으로 덮였다
  m.superAdmin.mockResolvedValue(false); // 강사뷰 중에는 운영 계정 우회도 꺼진다(팀장 공통 수정)
  m.recordDuty.mockImplementation(async (id: string) => id === X.id);
  m.viewDuty.mockImplementation(async (id: string) => id === X.id);
  // 실제 getUserPermMatrix는 A·X 역할 줄을 같은 값으로 덮지만, 여기선 **누구의 줄을 보는지** 가르려고 일부러 다르게 둔다.
  m.userMatrix.mockResolvedValue(shuttleMatrix({ master: "full", teacher: "none" }));
  m.baseMatrix.mockResolvedValue(resolveMatrix([])); // 지점 기본: 강사 셔틀 = 열람(쓰기 없음)
  m.rows = {
    students: [{ id: "s1", student_phone: "01012345678" }],
    parent_account_students: [{ student_id: "s1", parent_account_id: "p1", is_primary: true }],
    parent_accounts: [{ id: "p1", phone: "01099998888", status: "active" }],
  };
});

describe("등하원 기록 자격(canRecordBoarding)", () => {
  it("대상 강사 X의 셔틀 담당 토글로 열린다", async () => {
    expect(await canRecordBoarding()).toBe(true);
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(m.recordDuty).toHaveBeenCalledWith(X.id, "t1");
  });

  it("🔴 읽기 강사뷰는 대상의 토글로 기록하지 못한다", async () => {
    m.readonly.mockResolvedValue("읽기 전용입니다");
    expect(await canRecordBoarding()).toBe(false);
    expect(m.recordDuty).not.toHaveBeenCalled();
  });

  it("X가 담당이 아니면 실제 계정의 토글과 무관하게 닫힌다", async () => {
    m.recordDuty.mockImplementation(async (id: string) => id === A.id);
    expect(await canRecordBoarding()).toBe(false);
  });
});

describe("셔틀 화면 열람(requireShuttleView) — 메뉴 갈래와 토글 갈래 둘 다", () => {
  it("메뉴 갈래: 대상 X 역할 줄이 셔틀을 열면 토글을 묻지 않고 X를 돌려준다", async () => {
    m.userMatrix.mockResolvedValue(shuttleMatrix({ master: "none", teacher: "readonly" }));
    expect(await requireShuttleView()).toEqual(X);
    expect(m.viewDuty).not.toHaveBeenCalled();
  });

  it("🔴 메뉴 갈래는 실제 계정(원장) 역할 줄로 열리지 않는다 — X 줄이 닫혀 있고 담당도 아니면 착지로", async () => {
    m.viewDuty.mockResolvedValue(false);
    await expect(requireShuttleView()).rejects.toThrow("redirect:/onescreen");
  });

  it("토글 갈래: 메뉴가 닫혀도 X의 셔틀 담당이면 연다", async () => {
    expect(await requireShuttleView()).toEqual(X);
    expect(m.viewDuty).toHaveBeenCalledWith(X.id, "t1");
  });

  it("🔴 관리자 면(실시간 위치)은 X의 역할(강사)로 닫힌다 — 실제 계정이 원장이어도", async () => {
    expect(await isShuttleAdmin()).toBe(false);
    m.user.mockImplementation(async () => A); // 강사뷰가 아니면 실제 계정(원장) 그대로
    expect(await isShuttleAdmin()).toBe(true);
  });
});

describe("탑승 연락처 — 읽기는 대상 강사와 같고, 쓰기는 여전히 막힌다", () => {
  it("🔴 읽기 강사뷰: X가 셔틀 담당이면 연락처가 보이고(정규화된 번호), 기록 자격은 닫힌 채다", async () => {
    m.readonlyView.mockResolvedValue(true);
    m.readonly.mockResolvedValue("읽기 전용입니다");
    expect(await canRecordBoarding()).toBe(false);
    expect(await canSeeBoardingContacts()).toBe(true);
    expect(await getRiderContacts(["s1"])).toEqual({ s1: { student: "010-1234-5678", parents: ["010-9999-8888"] } });
  });

  it("읽기 강사뷰: X가 담당도 사무실도 아니면 빈 결과", async () => {
    m.readonlyView.mockResolvedValue(true);
    m.readonly.mockResolvedValue("읽기 전용입니다");
    m.recordDuty.mockResolvedValue(false);
    expect(await canSeeBoardingContacts()).toBe(false);
    expect(await getRiderContacts(["s1"])).toEqual({});
  });

  it("읽기 강사뷰: X 역할이 원래 편성 쓰기(사무실)면 캡 이전 수준으로 보인다 — 캡이 지운 '사무실'을 되살린다", async () => {
    m.readonlyView.mockResolvedValue(true);
    m.readonly.mockResolvedValue("읽기 전용입니다");
    m.recordDuty.mockResolvedValue(false);
    m.baseMatrix.mockResolvedValue(shuttleMatrix({ teacher: "full" }));
    expect(await canSeeBoardingContacts()).toBe(true);
  });

  it("강사뷰가 아니거나 전체 강사뷰면 기록 자격과 똑같다", async () => {
    expect(await canSeeBoardingContacts()).toBe(await canRecordBoarding());
    m.recordDuty.mockResolvedValue(false);
    expect(await canSeeBoardingContacts()).toBe(false);
    expect(m.baseMatrix).not.toHaveBeenCalled();
  });
});
