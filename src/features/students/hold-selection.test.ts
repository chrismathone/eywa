import { describe, expect, it } from "vitest";
import { describeHoldSelection } from "./hold-selection";

describe("describeHoldSelection", () => {
  it("전부 선택 = 학생 휴원(종전 동작) — 활성 수강 수를 말한다", () => {
    const plan = describeHoldSelection(2, ["초등M 초4 BS1J", "LS4b"]);
    expect(plan.mode).toBe("full");
    expect(plan.buttonLabel).toBe("휴원 처리");
    expect(plan.notice).toContain("모두 대기");
    expect(plan.notice).toContain("'휴원'");
  });

  it("활성 수강이 0개여도 막지 않는다 — 학생 상태만 휴원", () => {
    const plan = describeHoldSelection(0, []);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("활성 수강이 없습니다");
  });

  it("일부만 선택 = 그 수업만 대기 · **학생은 재원** (이 문장이 핵심)", () => {
    const plan = describeHoldSelection(2, ["LS4b"]);
    expect(plan.mode).toBe("partial");
    expect(plan.buttonLabel).toBe("휴원(1개)");
    expect(plan.notice).toContain("LS4b");
    expect(plan.notice).toContain("학생은 재원으로 남습니다");
  });

  it("체크를 푼 대기 수업은 되돌린다고 미리 말한다", () => {
    const plan = describeHoldSelection(3, ["LS4b"], ["초등M 초4 BS1J"]);
    expect(plan.mode).toBe("partial");
    expect(plan.notice).toContain("초등M 초4 BS1J");
    expect(plan.notice).toContain("되돌립니다");
  });

  it("0개 선택인데 대기 중인 수업이 있으면 = 전부 해제(되돌릴 유일한 문)", () => {
    const plan = describeHoldSelection(2, [], ["LS4b", "초등M 초4 BS1J"]);
    expect(plan.mode).toBe("resume");
    expect(plan.buttonLabel).toBe("휴원 해제(2개)");
    expect(plan.notice).toContain("다시 수강으로");
  });

  it("0개 선택 + 되돌릴 것도 없으면 진행 불가", () => {
    const plan = describeHoldSelection(2, [], []);
    expect(plan.mode).toBe("none");
    expect(plan.notice).toContain("1개 이상");
  });
});
