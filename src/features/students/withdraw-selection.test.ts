import { describe, expect, it } from "vitest";
import { describeEndSelection } from "./withdraw-selection";

describe("describeEndSelection", () => {
  it("과목이 하나뿐이면 기본(전부 선택)이 곧 퇴원 — 종전과 체감이 같다", () => {
    const plan = describeEndSelection(1, ["수학 A반"]);
    expect(plan.mode).toBe("full");
    expect(plan.buttonLabel).toBe("퇴원 처리");
    expect(plan.notice).toContain("퇴원관리");
  });

  it("두 과목 중 하나만 고르면 부분 종료 — 학생이 재원으로 남는다고 미리 말한다", () => {
    const plan = describeEndSelection(2, ["영어 PL반"]);
    expect(plan.mode).toBe("partial");
    expect(plan.buttonLabel).toBe("수업 종료(1개)");
    expect(plan.notice).toContain("영어 PL반");
    expect(plan.notice).toContain("재원으로 남습니다");
    // 🔴 부분 종료 안내가 "퇴원"이라고 읽히면 안 된다(말싸움의 원인).
    expect(plan.notice).not.toContain("퇴원 처리");
  });

  it("전부 고르면 지금과 동일한 학생 퇴원", () => {
    const plan = describeEndSelection(2, ["수학 A반", "영어 PL반"]);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("2개가 모두 종료");
  });

  it("0개 선택은 진행 불가 — 무엇을 하겠다는 건지 알 수 없다", () => {
    const plan = describeEndSelection(3, []);
    expect(plan.mode).toBe("none");
    expect(plan.notice).toContain("1개 이상");
  });

  it("활성 수강이 0개면 고를 것이 없으니 단순 퇴원", () => {
    const plan = describeEndSelection(0, []);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("활성 수강이 없습니다");
  });

  it("선택이 total을 넘겨도(경합으로 목록이 줄어든 경우) 퇴원으로 판정 — 부분으로 새지 않는다", () => {
    expect(describeEndSelection(1, ["A", "B"]).mode).toBe("full");
  });

  it("부분 종료 라벨은 고른 개수를 그대로 센다", () => {
    expect(describeEndSelection(4, ["A", "B"]).buttonLabel).toBe("수업 종료(2개)");
  });
});
