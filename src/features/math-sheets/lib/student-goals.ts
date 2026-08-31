/**
 * MCS 목표 대조 — 학생별 월간 목표 ↔ 실제 나간 교재. 순수(Vitest).
 *
 * 🔴 **"같은 책인가" 판정은 새로 만들지 않는다** — ECS와 같은
 *    [`sameBookName`](@/features/class-sheets/lib/goal-match)을 그대로 쓴다. 표기 흔들림은 두 과목에
 *    똑같이 있고(실측 2026-08 수학: 교재 문자열 306종 중 **32묶음이 표기만 다른 같은 책** —
 *    `초6-2 쎈`·`쎈 6-2`·`쎈 초6-2`가 한 학생 한 달 안에서 나왔다), 판정이 갈리면 같은 상황이
 *    영어 시트에선 정상이고 수학 시트에선 경고가 된다.
 * 🔴 **목표가 비어 있으면 판정하지 않는다**(ECS와 같은 규약) — 견줄 것이 없는데 경고를 띄우면
 *    "목표를 안 적었다"가 "다른 책을 나갔다"로 둔갑한다. 수학은 목표 행이 지금 0건이라
 *    켜는 순간 전 칸이 경고가 될 뻔한 자리다.
 * ⚠️ ECS의 `MonthGoalMap`은 키가 `skill_area`지만 여기선 **`student_id`**다 — 뜻이 다른 값을
 *    같은 이름으로 부르지 않으려고 타입을 따로 둔다(판정 함수만 공유).
 */
import { sameBookName } from "@/features/class-sheets/lib/goal-match";

export { normalizeBookName, sameBookName } from "@/features/class-sheets/lib/goal-match";

export type StudentGoal = {
  textbook: string | null;
  targetProgress: string | null;
};

/** `student_id` → 그 달 목표. 빈 칸도 키가 있을 수 있다(입력했다 지운 경우). */
export type StudentGoalMap = Record<string, StudentGoal>;

/** 하루치 수업 기록 — 실제로 나간 것. */
export type MathRecordLike = {
  studentId: string;
  date: string;
  textbook: string | null;
  progress: string | null;
};

/** 이 기록이 "그 학생의 월간 목표에 적힌 책이 아닌 책"인가. */
export function isOffGoalRecord(rec: MathRecordLike, goals: StudentGoalMap): boolean {
  const goal = goals[rec.studentId];
  if (!goal || !goal.textbook) return false;
  return !sameBookName(goal.textbook, rec.textbook);
}

/** 날짜별 어긋난 기록 수 — 열 머리 강조가 쓴다. */
export function offGoalCountByDate(
  records: readonly MathRecordLike[],
  goals: StudentGoalMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rec of records) {
    if (!isOffGoalRecord(rec, goals)) continue;
    out[rec.date] = (out[rec.date] ?? 0) + 1;
  }
  return out;
}

/** 그 학생이 이 달에 실제로 나간 교재(중복 제거, 등장 순) — 목표 칸 아래 "실제 …" 한 줄. */
export function actualBooksOf(records: readonly MathRecordLike[], studentId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rec of records) {
    if (rec.studentId !== studentId) continue;
    const book = (rec.textbook ?? "").trim();
    if (!book || seen.has(book)) continue;
    seen.add(book);
    out.push(book);
  }
  return out;
}

/** 그 학생이 목표 밖으로 나간 교재만(목표가 없으면 빈 배열 — 어긋남이라 부를 수 없다). */
export function offGoalBooksOf(
  records: readonly MathRecordLike[],
  studentId: string,
  goals: StudentGoalMap,
): string[] {
  const goal = goals[studentId];
  if (!goal || !goal.textbook) return [];
  return actualBooksOf(records, studentId).filter((book) => !sameBookName(goal.textbook, book));
}
