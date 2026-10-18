import { resolveRowFields } from "./row-fields";
import type { OneScreenStudent, Subject } from "./types";

/**
 * 오늘 수학 채점 결과 → 원스크린 수학 행의 일일·확인테스트 칸(2026-10-17 · 개발 중, 학원 설정 토글로만 켠다). 순수 함수.
 *
 * 규칙:
 *   · 오늘 수학 '일일테스트' → 일일 칸, '확인테스트' → 확인 칸(월말평가 등 다른 종류는 여기 안 온다).
 *   · **빈 칸만** 채운다 — 세션(작업 중 입력) · 오늘 저장한 보고서 · 시트가 다 지나간 뒤에도 비어 있을 때. 선생님이 친 값이 이긴다.
 *   · 이미 보낸(저장된) 보고서 행 · 보강 행 · 나눔 받은 행은 건드리지 않는다.
 *   · 결시 · 맞은 개수를 모르는 기록(응답 없는 채점) · 문항 수 0은 채우지 않는다 — 0개로 적지 않는다.
 *   · 반으로 짝짓는다(오늘 수학 반의 연결 = aywa 반). 반 연결이 없는 결과는 그 학생의 수학 행이 하나일 때만.
 *   · 같은 반 · 같은 종류가 여럿이면 마지막에 채점한 것.
 * 채운 칸(또는 이미 같은 값인 칸)엔 `todaysMath`에 그 값을 적는다 — 화면은 칸 값이 그대로일 때만 '오늘 수학'을 단다
 * (`todaysMathMarked`). 선생님이 고치면 저절로 풀린다.
 */
export type TodaysMathFillRow = {
  student_id: string;
  class_id: string | null;
  kind: string;
  question_count: number;
  absent: boolean;
  correct_count: number | null;
  taken_at: string;
};

type Which = "daily" | "check";
const KIND_TO: Record<string, Which> = { daily: "daily", review: "check" };

export function applyTodaysMathFill(
  student: OneScreenStudent,
  rows: readonly TodaysMathFillRow[],
  opts: { daily: boolean; check: boolean; isMathRow: (su: Subject) => boolean },
): void {
  const mine = rows.filter(
    (r) => r.student_id === student.id && !r.absent && r.correct_count != null && r.question_count > 0 && r.correct_count <= r.question_count,
  );
  if (mine.length === 0) return;
  const targets = student.subjects.filter((su) => opts.isMathRow(su) && !!su.classId && !su.reportSent && !su.makeup && !su.splitIn);
  for (const which of ["daily", "check"] as const) {
    if (!opts[which]) continue;
    const ofKind = mine.filter((r) => KIND_TO[r.kind] === which);
    for (const su of targets) {
      const matched = ofKind.filter((r) => r.class_id === su.classId || (r.class_id == null && targets.length === 1));
      const pick = matched.sort((a, b) => b.taken_at.localeCompare(a.taken_at))[0];
      if (!pick) continue;
      const score = pick.correct_count!;
      const now = resolveRowFields(student, su).tests[which];
      if (now.score == null) {
        if (which === "daily") { su.dailyScore = score; su.dailyMax = pick.question_count; }
        else { su.checkScore = score; su.checkMax = pick.question_count; }
      } else if (now.score !== score || now.max !== pick.question_count) {
        continue; // 선생님 값이 다르다 — 그대로 두고 표식도 달지 않는다.
      }
      su.todaysMath = { ...su.todaysMath, [which]: { score, max: pick.question_count } };
    }
  }
}

/** 이 칸에 '오늘 수학' 표식을 다나 — 로스터가 적어 둔 값과 지금 칸 값(점수 · 문항 수)이 같을 때만. */
export function todaysMathMarked(
  su: Pick<Subject, "todaysMath"> | undefined,
  which: Which,
  now: { score: number | null; max: number },
): boolean {
  const filled = su?.todaysMath?.[which];
  return !!filled && now.score === filled.score && now.max === filled.max;
}

/** 보고서에 저장되는 시험 글("20문제 중 18개 맞음") → 문항 수 · 맞은 수. 모양이 다르면 null. */
export function parseTestText(text: string | null | undefined): { max: number; score: number } | null {
  const m = /(\d+)\s*문제\s*중\s*(\d+)\s*개/.exec(text ?? "");
  return m ? { max: Number(m[1]), score: Number(m[2]) } : null;
}

/**
 * 감사로그용(2026-10-18) — 저장한 일일·확인 칸이 그날 오늘 수학 채점 결과와 **같은 값**인가. 채움 규칙과 같은 짝짓기
 * (같은 반 우선 · 반 연결 없는 결과는 같은 반 결과가 없을 때만 · 마지막 채점). 같은 값이라는 사실만 말한다 — 선생님이
 * 같은 값을 직접 쳤을 수도 있다(그래서 '오늘 수학에서 왔다'가 아니라 '같다'로 적는다).
 */
export function todaysMathSameOnSave(
  rows: readonly TodaysMathFillRow[],
  saved: { studentId: string; classId: string | null; dailyTest?: string | null; checkTest?: string | null },
): Which[] {
  const out: Which[] = [];
  for (const which of ["daily", "check"] as const) {
    const text = parseTestText(which === "daily" ? saved.dailyTest : saved.checkTest);
    if (!text) continue;
    const ofKind = rows.filter((r) => r.student_id === saved.studentId && KIND_TO[r.kind] === which && !r.absent && r.correct_count != null);
    const sameClass = ofKind.filter((r) => saved.classId != null && r.class_id === saved.classId);
    const pool = sameClass.length ? sameClass : ofKind.filter((r) => r.class_id == null);
    const pick = [...pool].sort((a, b) => b.taken_at.localeCompare(a.taken_at))[0];
    if (pick && pick.correct_count === text.score && pick.question_count === text.max) out.push(which);
  }
  return out;
}
