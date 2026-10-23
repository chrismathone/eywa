import { describe, expect, it } from "vitest";
import { describeEndSelection } from "./withdraw-selection";

/**
 * 단위는 **과목**이다(원장 2026-09-16 *"과목 선택 가능하게 해달라한것 같은데, 수업 선택이 아니라"*) —
 * `total`은 수강 과목 수, 라벨은 과목 라벨이다(반 이름이 아니다).
 */
describe("describeEndSelection", () => {
  it("과목이 하나뿐이면 기본(전부 선택)이 곧 퇴원 — 퇴원보고서로 보낸다(원장 2026-10-23)", () => {
    // 수학만 세 반 다녀도 과목은 하나다(실측 송준영 — 주말내신특강·BS4F 수·BS4F 토).
    const plan = describeEndSelection(1, ["수학"]);
    expect(plan.mode).toBe("full");
    expect(plan.buttonLabel).toBe("퇴원보고서로 진행");
    expect(plan.notice).toContain("퇴원보고서로 처리합니다");
  });

  it("두 과목 중 하나만 고르면 과목 종료 — 학생이 재원으로 남는다고 미리 말한다", () => {
    const plan = describeEndSelection(2, ["영어"]);
    expect(plan.mode).toBe("partial");
    expect(plan.buttonLabel).toBe("과목 종료(1과목)");
    expect(plan.notice).toContain("영어만 종료합니다");
    expect(plan.notice).toContain("재원으로 남습니다");
    // 🔴 한 과목만 그만두는 건 퇴원이 아니다 — 안내가 "퇴원"으로 읽히면 안 된다(말싸움의 원인).
    expect(plan.notice).not.toContain("퇴원 처리");
    expect(plan.buttonLabel).not.toContain("퇴원");
  });

  it("전부 고르면 학생 퇴원 — 이 창이 아니라 퇴원보고서로", () => {
    const plan = describeEndSelection(2, ["수학", "영어"]);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("2과목을 모두 끝내면 퇴원");
    expect(plan.notice).toContain("퇴원보고서");
  });

  it("0개 선택은 진행 불가 — 무엇을 하겠다는 건지 알 수 없다", () => {
    const plan = describeEndSelection(2, []);
    expect(plan.mode).toBe("none");
    expect(plan.notice).toContain("과목을 1개 이상");
  });

  it("활성 수강이 0개면 고를 것이 없다 — 퇴원보고서(바로 처리)로", () => {
    const plan = describeEndSelection(0, []);
    expect(plan.mode).toBe("full");
    expect(plan.notice).toContain("종료할 수강이 없습니다");
    expect(plan.notice).toContain("퇴원보고서");
  });

  it("선택이 total을 넘겨도(경합으로 목록이 줄어든 경우) 퇴원으로 판정 — 부분으로 새지 않는다", () => {
    expect(describeEndSelection(1, ["수학", "영어"]).mode).toBe("full");
  });

  it("과목 종료 라벨은 고른 과목 수를 그대로 센다", () => {
    expect(describeEndSelection(3, ["수학", "영어"]).buttonLabel).toBe("과목 종료(2과목)");
  });
});
