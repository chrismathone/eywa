import type { UnifiedRow } from "./model";

/**
 * 성적 현황 '시험정보'의 '오늘 수학' 표시(원장 2026-10-18 *"시험정보에 '오늘 수학' 라벨이 붙어도 좋겠는데 아이콘이랑"*) — 순수 함수.
 * 저장된 성적 줄이 오늘 수학 채점 결과와 **같은 값**인지만 본다(선생님이 같은 값을 직접 쳤을 수도 있다 — '같다'이지 '왔다'가 아니다).
 *   · 일일·확인테스트(수업보고서 · 단위 개) = 같은 날 · 같은 종류 · 맞은 개수와 문항 수가 같다.
 *   · 월말평가(성적 입력 · 단위 점) = 같은 달 · 점수와 만점이 같다.
 */
export type TodaysMathMarkRow = {
  student_id: string; kind: string; test_date: string; absent: boolean;
  score: number | null; max_score: number | null; correct_count: number | null; question_count: number;
};

const KIND: Partial<Record<UnifiedRow["kind"], string>> = { daily: "daily", check: "review", monthly: "monthly" };

/** 표시 후보 줄 — 수학 · 일일/확인(수업보고서) · 월말평가(성적 입력) · 점수 있음. */
export function todaysMathCandidate(row: Pick<UnifiedRow, "subject" | "kind" | "source" | "score">): boolean {
  if (row.subject.split(":")[0] !== "math" || row.score == null) return false;
  if (row.kind === "daily" || row.kind === "check") return row.source === "report";
  return row.kind === "monthly" && row.source === "grade";
}

export function todaysMathMarkedKeys(
  rows: readonly Pick<UnifiedRow, "key" | "studentId" | "subject" | "kind" | "source" | "date" | "score" | "maxScore">[],
  results: readonly TodaysMathMarkRow[],
): string[] {
  const keys: string[] = [];
  const byStudent = new Map<string, TodaysMathMarkRow[]>();
  for (const r of results) { const list = byStudent.get(r.student_id); if (list) list.push(r); else byStudent.set(r.student_id, [r]); }
  for (const row of rows) {
    if (!todaysMathCandidate(row)) continue;
    const kind = KIND[row.kind];
    const monthly = row.kind === "monthly";
    const hit = (byStudent.get(row.studentId) ?? []).some((r) => r.kind === kind && !r.absent
      && (monthly ? r.test_date.slice(0, 7) === row.date.slice(0, 7) && r.score != null && Number(r.score) === row.score && r.max_score != null && Number(r.max_score) === row.maxScore
        : r.test_date === row.date && r.correct_count === row.score && r.question_count === row.maxScore));
    if (hit) keys.push(row.key);
  }
  return keys;
}
