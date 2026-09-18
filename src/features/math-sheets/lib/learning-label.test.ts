import { describe, expect, it } from "vitest";
import { learningBlockLabel } from "./learning-label";

describe("MCS 진도 표시", () => {
  it("과목 접두사를 빼고 단원의 실제 학년과 학기를 표시한다", () => {
    expect(learningBlockLabel("수학 회전체", "중1")).toBe("중1 2학기, 회전체");
    expect(learningBlockLabel("수학 반비례 관계 y=a/x의 그래프", "중1")).toBe("중1 1학기, 반비례 관계 y=a/x의 그래프");
    expect(learningBlockLabel("이차함수의 최댓값과 최솟값", "중3")).toBe("중3 1학기, 이차함수의 최댓값과 최솟값");
  });
  it("시작 학년이 달라도 선행 단원의 학년을 유지한다", () => {
    expect(learningBlockLabel("중2 · 확률의 계산", "중1")).toBe("중2 2학기, 확률의 계산");
    expect(learningBlockLabel("수학 확률의 계산", "중1")).toBe("중2 2학기, 확률의 계산");
  });
  it("여러 차시를 보존하고 각각 학기를 판별한다", () => {
    expect(learningBlockLabel("수학 회전체\n히스토그램", "중1")).toBe("중1 2학기, 회전체 / 중1 2학기, 히스토그램");
  });
  it("고등 과목명은 보존하고 동명 단원은 명시된 과목으로 구분한다", () => {
    expect(learningBlockLabel("수학 미적분Ⅱ 접선의 방정식", "미적분Ⅰ")).toBe("미적분Ⅱ, 접선의 방정식");
    expect(learningBlockLabel("수학 공통수학1 다항식의 덧셈과 뺄셈")).toBe("공통수학1, 다항식의 덧셈과 뺄셈");
  });
  it("자유 입력에는 학기를 임의로 붙이지 않는다", () => {
    expect(learningBlockLabel("수학 오답 복습", "중1")).toBe("중1, 오답 복습");
    expect(learningBlockLabel("수학 오답 복습")).toBe("오답 복습");
  });
});
