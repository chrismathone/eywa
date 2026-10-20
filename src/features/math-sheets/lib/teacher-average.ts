/**
 * 선생님별 평균 진행률(원장 2026-10-20 *"선생님 별로 볼때도 평균 퍼센테이지"*) — 학생마다 지금 3개월 창의
 * `나간 차시 / 전체 차시`를 백분율로 바꿔 **학생 평균**을 낸다(차시를 합쳐 나누지 않는다 — 한 학생이 두 권 창이면
 * 그 학생만 무게가 커진다).
 * 🔴 교재 주문이 없거나 진도를 못 읽은 학생은 **빼고** 센다 — 0%로 넣으면 기록이 없는 것이 '안 나갔다'로 둔갑한다.
 *    그래서 몇 명으로 낸 평균인지(`counted`)를 같이 돌려준다.
 */
export function averageProgress(students: readonly { window: { done: number | null; total: number } | null }[]): { pct: number | null; counted: number } {
  const rates = students
    .map((s) => s.window)
    .filter((w): w is { done: number; total: number } => !!w && w.done != null && w.total > 0)
    .map((w) => Math.min(1, w.done / w.total));
  if (rates.length === 0) return { pct: null, counted: 0 };
  return { pct: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100), counted: rates.length };
}
