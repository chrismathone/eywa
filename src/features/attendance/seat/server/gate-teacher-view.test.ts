/**
 * 자리 출석부 쓰기 게이트(gateSeatWrite)는 담당 토글·명의를 **화면 주인**으로 본다(2026-11-05 강사뷰 신원 점검).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 랩실 담당 강사 X를 열면, 메뉴 권한은 X 것(자리 메뉴 없음)인데 토글은 A의 것을 봐서
 * "자리 출석부 입력 권한이 없습니다"가 났다. 거꾸로 읽기 강사뷰는 토글 갈래가 canWriteTenant를 안 지나 X의 토글로 쓸 수 있었다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-admin", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "admin" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };
const READONLY = "다른 강사 뷰(읽기)에서는 저장할 수 없습니다";

const m = vi.hoisted(() => ({ user: vi.fn(), readonly: vi.fn(), canWrite: vi.fn(), duties: vi.fn(), pin: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("./duty", () => ({ getActiveSeatDuties: m.duties }));
vi.mock("./pin-session", () => ({ readSeatPinSession: m.pin }));
vi.mock("@/features/owner/server/modules", () => ({ isModuleOnForTenant: vi.fn(async () => true) }));
vi.mock("./queries", () => ({ getPublicSeatDay: vi.fn(), getSeatDay: vi.fn() }));
vi.mock("./period-choice", () => ({ applySeatDayChoices: vi.fn(), getSeatPeriodChoices: vi.fn() }));

import { kstToday } from "@/lib/date-kst";
import { gateSeatWrite } from "./gate";

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.readonly.mockResolvedValue(null);
  m.canWrite.mockResolvedValue(false); // 대상 강사 X의 역할엔 자리 메뉴가 없다(매트릭스가 X 값으로 덮였다)
  m.duties.mockImplementation(async (id: string) => ({ lab: id === X.id, jj: false }));
  m.pin.mockResolvedValue(null);
});

describe("자리 출석부 쓰기 게이트 — 강사뷰", () => {
  it("대상 강사 X의 랩실 담당 토글로 열리고, 명의(userId)도 X다", async () => {
    expect(await gateSeatWrite("lab", kstToday())).toEqual({ ok: true, userId: X.id, tenantId: "t1", via: "duty" });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(m.duties).toHaveBeenCalledWith(X.id, "t1");
  });

  it("X가 담당이 아닌 자리는 (실제 계정의 토글과 무관하게) 권한 문구로 거절한다", async () => {
    expect(await gateSeatWrite("jj", kstToday())).toEqual({ error: "자리 출석부 입력 권한이 없습니다" });
  });

  it("🔴 읽기 강사뷰는 대상의 토글로 쓰지 못한다 — 읽기 문구로 거절", async () => {
    m.readonly.mockResolvedValue(READONLY);
    expect(await gateSeatWrite("lab", kstToday())).toEqual({ error: READONLY });
    expect(m.duties).not.toHaveBeenCalled();
  });

  it("읽기 강사뷰여도 그 자리 PIN 문은 로그인과 무관하게 그대로다(명의 없음)", async () => {
    m.readonly.mockResolvedValue(READONLY);
    m.pin.mockResolvedValue({ seat: "lab", tenantId: "t1" });
    expect(await gateSeatWrite("lab", kstToday())).toEqual({ ok: true, userId: null, tenantId: "t1", via: "pin" });
  });
});
