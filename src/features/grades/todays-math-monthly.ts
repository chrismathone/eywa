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

/**
 * 성적 입력 창: 명단을 불러오면 **단추 없이** 빈 칸에 오늘 수학 월말평가를 채운다(원장 2026-10-18 *"따로 불러오지 않더라도
 * 오늘 수학이 연동된 학생들의 점수는 자동으로 불러와져야"* · *"모든 배선이 on 상태라면"*). 규칙은 `planMonthlyFill` 그대로 —
 * 빈 칸만 · 만점이 같을 때만. 저장은 선생님이 누른다(자동 저장 아님).
 */
export function prefillFromTodaysMath(
  results: TodaysMathMonthly | null | undefined,
  rows: readonly { studentId: string; applies: boolean; withdrawn: boolean; noExam: boolean }[],
  scores: Record<string, string>,
  gridMax: number,
): MonthlyFillPlan & { scores: Record<string, string> } {
  if (!results) return { fill: {}, maxMismatch: 0, otherMax: null, scores };
  const plan = planMonthlyFill(results, rows.map((r) => ({ studentId: r.studentId, applies: r.applies && !r.withdrawn })),
    { scores, noExam: Object.fromEntries(rows.map((r) => [r.studentId, r.noExam])) }, gridMax);
  return { ...plan, scores: { ...scores, ...plan.fill } };
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
