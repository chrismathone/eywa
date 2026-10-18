/**
 * 성적관리 월말평가 칸 ↔ 오늘 수학 월말평가 결과(2026-10-17 · 개발 중). 순수 함수 — 격자와 시험이 같은 판정을 쓴다.
 *
 * 규칙: **빈 칸만**(이미 적힌 점수 · '시험없음' · 제도상 해당 없는 줄은 건드리지 않는다) · **만점이 같을 때만**(오늘 수학 점수는 배점의
 * 합이라 시험마다 만점이 다르다 — 85가 몇 점 만점의 85인지 모르면 넣지 않는다. 다르면 건수만 알린다). 결시는 오지 않는다(서버가 뺀다).
 */
export type TodaysMathMonthly = Record<string, { score: number; maxScore: number | null; testDate: string; title: string | null }>;

export type MonthlyFillPlan = { fill: Record<string, string>; maxMismatch: number; otherMax: number | null };

export function planMonthlyFill(
  results: TodaysMathMonthly,
  rows: readonly { studentId: string; applies: boolean }[],
  current: { scores: Record<string, string>; noExam: Record<string, boolean> },
  gridMax: number,
): MonthlyFillPlan {
  const fill: Record<string, string> = {};
  let maxMismatch = 0;
  let otherMax: number | null = null;
  const seen = new Set<string>();
  for (const { studentId: id, applies } of rows) {
    if (seen.has(id)) continue; // 두 반 학생은 줄이 둘이지만 칸은 하나
    seen.add(id);
    const r = results[id];
    if (!r || !applies || current.noExam[id] || (current.scores[id] ?? "").trim() !== "") continue;
    if (r.maxScore !== gridMax) {
      maxMismatch += 1;
      otherMax ??= r.maxScore;
      continue;
    }
    fill[id] = String(r.score);
  }
  return { fill, maxMismatch, otherMax };
}

/** 이 칸의 지금 값이 오늘 수학 결과 그대로인가 — '오늘 수학' 표시 전용(고치면 사라진다). */
export function monthlyFromTodaysMath(results: TodaysMathMonthly | null | undefined, id: string, value: string, gridMax: number): boolean {
  const r = results?.[id];
  return !!r && r.maxScore === gridMax && value.trim() !== "" && Number(value) === r.score;
}

/** 감사로그용(2026-10-18) — 이번에 저장한 점수 중 같은 달 오늘 수학 월말평가와 **같은 값**(같은 만점)인 칸 수. 같다는 사실만 센다. */
export function countTodaysMathSame(
  results: TodaysMathMonthly | null | undefined,
  saved: readonly { studentId: string; score: number | null }[],
  gridMax: number,
): number {
  if (!results) return 0;
  return saved.filter((c) => {
    const r = results[c.studentId];
    return !!r && c.score != null && r.maxScore === gridMax && r.score === c.score;
  }).length;
}
