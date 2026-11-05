/**
 * 셔틀 기록·열람·관리자 면은 **화면 주인**의 역할·셔틀 담당 토글로 판정한다(2026-11-05 강사뷰 신원 점검).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 셔틀 담당 X를 열면 X의 토글이 안 보여 셔틀 화면이 착지로 튕겼고, 실제 계정(원장) 역할로
 * 관리자 면(실시간 위치)이 열렸다. 읽기 강사뷰는 토글 갈래가 canWriteTenant를 안 지나 대상의 토글로 등하원을 기록할 수 있었다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-master", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "master" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({
  user: vi.fn(), readonly: vi.fn(), canWrite: vi.fn(), superAdmin: vi.fn(), recordDuty: vi.fn(), viewDuty: vi.fn(),
  matrix: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, getUserPermMatrix: m.matrix }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/auth/teacher-home", () => ({ landingPath: vi.fn(async () => "/onescreen") }));
vi.mock("@/lib/permissions", () => ({ canAccess: () => false }));
vi.mock("./duty", () => ({ hasShuttleRecordDuty: m.recordDuty, getShuttleDuty: m.viewDuty }));

import { canRecordBoarding } from "./record-gate";
import { isShuttleAdmin, requireShuttleView } from "./access";

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.readonly.mockResolvedValue(null);
  m.canWrite.mockResolvedValue(false); // X(강사)는 편성 권한이 없다 — 매트릭스가 X 값으로 덮였다
  m.superAdmin.mockResolvedValue(false); // 강사뷰 중에는 운영 계정 우회도 꺼진다(팀장 공통 수정)
  m.recordDuty.mockImplementation(async (id: string) => id === X.id);
  m.viewDuty.mockImplementation(async (id: string) => id === X.id);
  m.matrix.mockResolvedValue({});
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

describe("셔틀 화면 열람·관리자 면", () => {
  it("열람 게이트는 X의 담당 토글로 열고, 돌려주는 사람도 X다", async () => {
    expect(await requireShuttleView()).toEqual(X);
    expect(m.viewDuty).toHaveBeenCalledWith(X.id, "t1");
  });

  it("X가 담당이 아니면 착지로 보낸다", async () => {
    m.viewDuty.mockResolvedValue(false);
    await expect(requireShuttleView()).rejects.toThrow("redirect:/onescreen");
  });

  it("🔴 관리자 면(실시간 위치)은 X의 역할(강사)로 닫힌다 — 실제 계정이 원장이어도", async () => {
    expect(await isShuttleAdmin()).toBe(false);
    m.user.mockImplementation(async () => A); // 강사뷰가 아니면 실제 계정(원장) 그대로
    expect(await isShuttleAdmin()).toBe(true);
  });
});
