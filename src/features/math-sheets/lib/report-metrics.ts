/**
 * 한 학생의 이 달 보고서에서 **숫자로 말할 수 있는 것만** 접는다 — 일일테스트 정답률 · 과제 수행률. 순수(Vitest).
 *
 * 초안(able)의 반별 현황 표에는 DT · 3LT · 오답 · 정답률 열이 있었다. 우리에게 있는 건 둘뿐이다:
 *  · 일일테스트 `lesson_reports.daily_test` — "5문제 중 4개 맞음"(실측 2026-08: 1,814건 중 880건 기입)
 *    + 옛 합본 `exam_info`의 `일일` 조각(edutrix 이관분은 이것만 있다 — [`test-score.ts`](./test-score.ts) 규약)
 *  · 과제 수행률 `lesson_reports.homework_score` — "100%"·"미제출"·"완료"(1,527건 기입)
 * 확인테스트(`check_test`)는 8월 기입 0건, 오답·3LT는 대응물이 없다 — **없는 열을 지어내지 않는다.**
 * (확인테스트는 칸에는 적힌다 — 평균 열만 안 세운다.)
 *
 * 🔴 변환은 새로 만들지 않는다 — 시험은 [`dailyTestPercent`](./test-score.ts)(안은 학부모 카드 추이 그래프와 같은
 *    `parseExamPercent`), 과제는 [`parseHomeworkRate`](@/features/onescreen/homework-rate)(퍼센트의
 *    단일 소스 — `일부 미흡`을 50으로 읽던 사고를 막은 그 함수). 여기서 다시 읽으면 같은 값이 화면마다 갈린다.
 * 🔴 **null은 0이 아니다** — 안 친 날·정도를 모르는 값은 평균에서 뺀다. 분모가 0이면 평균도 null.
 */
import { parseHomeworkRate } from "@/features/onescreen/homework-rate";
import { dailyTestPercent, type TestScoreSource } from "./test-score";

export type ReportMetricInput = TestScoreSource & {
  homework: string | null;
};

export type ReportMetrics = {
  /** 일일테스트 정답률 평균(0~100). 한 번도 없으면 null. */
  dtAvg: number | null;
  /** 정답률을 셀 수 있었던 날 수. */
  dtCount: number;
  /** 과제 수행률 평균(0~100). 한 번도 없으면 null. */
  hwAvg: number | null;
  hwCount: number;
};

export function summarizeReportMetrics(rows: readonly ReportMetricInput[]): ReportMetrics {
  let dtSum = 0;
  let dtCount = 0;
  let hwSum = 0;
  let hwCount = 0;
  for (const r of rows) {
    const dt = dailyTestPercent(r);
    if (dt != null) {
      dtSum += dt;
      dtCount += 1;
    }
    const hw = parseHomeworkRate(r.homework);
    if (hw != null) {
      hwSum += hw;
      hwCount += 1;
    }
  }
  return {
    dtAvg: dtCount > 0 ? Math.round(dtSum / dtCount) : null,
    dtCount,
    hwAvg: hwCount > 0 ? Math.round(hwSum / hwCount) : null,
    hwCount,
  };
}
