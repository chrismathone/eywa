import { describe, expect, it } from "vitest";
import { compareMentRuns, measureAnalysisQuality, measureMentQuality } from "../../../scripts/_oneoff/ai-provider-metrics";

describe("AI 공급자 품질 비교 지표", () => {
  it("종결형 혼합·없는 숫자·과목 접두·금지 표현·없는 고유명사를 잡는다", () => {
    const metrics = measureMentQuality(
      "수학: 오늘 3단원을 공부했습니다. 새봄학교에서도 앞으로도 잘 해요. 정답률은 90%입니다.",
      "오늘 진도 3단원",
    );
    expect(metrics.endingMixRatio).toBeGreaterThan(0);
    expect(metrics.unknownNumbers).toContain("90%");
    expect(metrics.subjectPrefix).toBe(true);
    expect(metrics.bannedExpressions).toContain("앞으로도 잘");
    expect(metrics.suspiciousNames).toContain("새봄학교");
  });

  it("같은 입력 두 결과의 문장·종결형·길이 차이를 계산한다", () => {
    const a = measureMentQuality("오늘 3단원을 공부했습니다.", "3단원");
    const b = measureMentQuality("오늘 3단원을 공부했어요. 과제를 확인했어요.", "3단원");
    expect(compareMentRuns(a, b)).toMatchObject({ sentenceDelta: 1, endingChanged: true });
  });

  it("분석 칸 채움·warnings 누락·정규화 실패·잡담을 잡는다", () => {
    const metrics = measureAnalysisQuality({
      data: { summary: "요약" },
      expectedFields: ["summary", "warnings"],
      raw: "결과입니다\n{\"summary\":\"요약\"}",
      normalize: () => { throw new Error("모양 오류"); },
    });
    expect(metrics).toEqual({
      fieldFillRate: 0.5,
      missingFields: ["warnings"],
      warningsMissing: true,
      normalizationPassed: false,
      chatterMixed: true,
    });
  });
});
