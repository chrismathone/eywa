import { describe, expect, it } from "vitest";
import { reportScorePatch } from "./report-patch";

describe("수업보고서 시험 원문 보존", () => {
  it("숫자가 같거나 원문을 해석할 수 없으면 저장 클릭만으로 지우지 않는다", () => {
    expect(reportScorePatch({ daily_test: "22문제 중 21개 맞음", check_test: null, exam_info: null }, "daily", 21, 22)).toBeNull();
    expect(reportScorePatch({ daily_test: "미응시", check_test: null, exam_info: null }, "daily", null, 100)).toBeNull();
    expect(reportScorePatch({ daily_test: null, check_test: null, exam_info: "시험 결과 확인 필요" }, "other", null, 100)).toBeNull();
  });

  it("옛 합본 중 한 시험을 고치면 다른 시험 점수를 분리 칸으로 보존한다", () => {
    expect(reportScorePatch({ daily_test: null, check_test: null, exam_info: "일일 18/20 확인 8/10" }, "daily", 19, 20))
      .toEqual({ daily_test: "19/20", check_test: "8/10", exam_info: null });
  });
});
