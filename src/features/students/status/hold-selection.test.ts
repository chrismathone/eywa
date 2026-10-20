import { describe, expect, it } from "vitest";
import { describeHoldSelection } from "./hold-selection";

/**
 * 단위는 **과목**이고, 한 과목만 쉬는 건 **학생 휴원이 아니다**(원장 2026-09-16
 * *"어차피 한과목만 그만둔다고 휴원이나 퇴원이 아님"*).
 */
describe("describeHoldSelection", () => {
  it("전부 선택 = 학생 휴원(종전) — 과목 수를 말한다", () => {
    const plan = describeHoldSelection(2, ["수학", "영어"]);
    expect(plan.mode).toBe("full");
    expect(plan.buttonLabel).toBe("휴원 처리");
    expect(plan.notice).toContain("2과목이 모두 대기");
    expect(plan.notice).toContain("'휴원'");
  });

  it("활성 수강이 0개여도 막지 않는다 — 학생 상태만 휴원", () => {
    const plan = describeHoldSelection(0, []);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("활성 수강이 없습니다");
  });

  it("일부만 선택 = 그 과목만 대기 · **학생은 재원** · 버튼을 '휴원'이라 부르지 않는다", () => {
    const plan = describeHoldSelection(2, ["영어"]);
    expect(plan.mode).toBe("partial");
    expect(plan.buttonLabel).toBe("과목 대기(1과목)");
    expect(plan.buttonLabel).not.toContain("휴원");
    expect(plan.notice).toContain("영어만 대기로 바꿉니다");
    expect(plan.notice).toContain("학생은 재원으로 남습니다");
  });

  it("체크를 푼 대기 과목은 되돌린다고 미리 말한다", () => {
    const plan = describeHoldSelection(3, ["영어"], ["수학"]);
    expect(plan.mode).toBe("partial");
    expect(plan.notice).toContain("수학");
    expect(plan.notice).toContain("되돌립니다");
  });

  it("0개 선택인데 대기 중인 과목이 있으면 = 전부 해제(되돌릴 유일한 문)", () => {
    const plan = describeHoldSelection(2, [], ["영어", "수학"]);
    expect(plan.mode).toBe("resume");
    expect(plan.buttonLabel).toBe("대기 해제(2과목)");
    expect(plan.notice).toContain("다시 수강으로");
  });

  it("0개 선택 + 되돌릴 것도 없으면 진행 불가", () => {
    const plan = describeHoldSelection(2, [], []);
    expect(plan.mode).toBe("none");
    expect(plan.notice).toContain("과목을 1개 이상");
  });
});
