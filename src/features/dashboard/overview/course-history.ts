import { historyCoursePoints } from "@/features/students/stats/joined";
import type { HistoryMonth } from "@/features/students/stats/history";
import type { CourseTrend } from "./enrolled-trend-server";
import { monthlyPoints } from "./trend-points";

/**
 * 운영실 '강좌수 추이' 카드의 앞쪽 달 — 에이와 수강 기록이 갖춰지기 전 달(`monthlyFrom` 앞, 지금까지 비워 둔 칸)을 **지난 기록**으로 메운다
 * (원장 2026-10-30 *"이전 기록에서 과학과 국어를 강좌수에 반영 필요"* — 원생 통계 '강좌수 추이'와 같은 판정 `historyCoursePoints`:
 * 그달 과목마다 수업료가 청구된 학생 수를 더한 추정 · 과학·국어 포함 · 영어를 가른 지점은 인재원 영어 · EiE 따로).
 * 순수 함수(Vitest). `monthlyFrom` 바로 앞 달부터 거꾸로 이어진 달만 메운다 — 셀 수 없는 달(과목 칸이 빈 달 · 건너뛴 달)을 만나면 거기서 멈춘다
 * (가로축이 달 이름이라 중간이 빠지면 소리 없이 붙어 보인다 — 리뷰 2026-10-30). 연도별은 그대로(에이와 기록만).
 * `groups` = 강좌 묶음 키(학원설정 과목 묶음 — 영어를 가른 지점은 `injaewon`·`eie`).
 */
export type CourseTrendWithHistory = CourseTrend & {
  /** 지난 기록으로 메운 달(YYYY-MM) 범위 — 없으면 메운 달이 없다. */
  historyFrom?: string | null;
  historyTo?: string | null;
};

export function withCourseHistory(trend: CourseTrend, months: readonly HistoryMonth[], groups: readonly string[], today: string): CourseTrendWithHistory {
  if (!trend.monthlyFrom || !groups.length) return trend;
  const history = new Map(historyCoursePoints(months, trend.monthlyFrom, groups).monthly.map((p) => [p.key, p.count]));
  const before = monthlyPoints(today).filter((p) => p.key < trend.monthlyFrom!);
  let start = before.length;
  while (start > 0 && history.has(before[start - 1]!.key)) start--;
  const filled = before.slice(start).map((p) => ({ ...p, count: history.get(p.key)! }));
  if (!filled.length) return trend;
  return {
    ...trend,
    monthly: [...filled, ...trend.monthly],
    historyFrom: filled[0]!.key,
    historyTo: filled.at(-1)!.key,
  };
}
