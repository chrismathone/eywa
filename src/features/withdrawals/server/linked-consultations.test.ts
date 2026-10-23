import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  level: "full" as string,
  result: { status: "ok", rows: [] } as unknown,
  assigned: {} as Record<string, number>,
  load: vi.fn(),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => state.level }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/features/students/server/queries", () => ({ getStudentEnrollmentConsultations: state.load }));
vi.mock("@/features/enrollment/server/assigned-classes", () => ({
  countAssignedClasses: async (_db: unknown, _student: string, subject: string | null) => state.assigned[subject ?? ""] ?? 0,
}));
import { loadLinkedConsultations } from "./linked-consultations";

const row = (id: string, date: string, subject: string | null, outcome: string) => ({ id, date, subject, outcome, request: null, careerGoal: null, followUp: null });

beforeEach(() => {
  state.level = "full";
  state.assigned = {};
  state.load.mockReset();
  state.load.mockImplementation(async () => state.result);
});

describe("퇴원 상세 — 이어진 콜&상담", () => {
  it("콜&상담 메뉴 권한이 없으면 카드가 없고 조회도 안 한다(퇴원관리 권한만으로 보이지 않는다)", async () => {
    state.level = "none";
    expect(await loadLinkedConsultations("s1", "accountant")).toEqual({ status: "hidden" });
    expect(state.load).not.toHaveBeenCalled();
  });

  it("전부 최신순 · 상태는 칸반과 같은 판정(반 배정이 결과를 이긴다)", async () => {
    state.result = { status: "ok", rows: [row("old", "2025-01-10T01:00:00Z", "수학", "declined"), row("new", "2026-02-01T01:00:00Z", "english", "consulted")] };
    state.assigned = { english: 1 };
    const res = await loadLinkedConsultations("s1", "manager");
    expect(res.status === "ok" && res.rows.map((r) => [r.id, r.stage.label])).toEqual([["new", "등록 완료"], ["old", "미등록"]]);
  });

  it("조회 실패·준비 안 됨은 그대로 넘긴다(0건으로 위장하지 않는다)", async () => {
    state.result = { status: "error" };
    expect(await loadLinkedConsultations("s1", "manager")).toEqual({ status: "error" });
    state.result = { status: "not_ready" };
    expect(await loadLinkedConsultations("s1", "manager")).toEqual({ status: "not_ready" });
    state.load.mockRejectedValueOnce(new Error("boom"));
    expect(await loadLinkedConsultations("s1", "manager")).toEqual({ status: "error" });
  });
});
