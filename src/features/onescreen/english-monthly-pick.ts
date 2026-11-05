/**
 * 원스크린 영어 행에 실을 Monthly Test 점수 고르기 — 순수 함수(Vitest). 조회는 server/english-monthly.ts.
 *
 * 🔑 반마다 **가장 최근에 본 달**(taken_on이 가장 늦은 학년도·달) 하나만 쓴다 — 평균은 그 반·그 달 학생들로 낸다.
 *    지난달 점수와 이번 달 점수를 섞어 평균을 내지 않는다.
 */
import { buildMonthlyEval, type MonthlyEval, type MonthlyGradeRow } from "@/features/report-templates/monthly-eval";

export type MonthlyGradeRowWithClass = MonthlyGradeRow & {
  class_id: string | null;
  school_year: number | string | null;
  exam_month: number | string | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 줄들 → `반|학생` → 점수. 점수가 없는 학생은 키가 없다. */
export function pickMonthlyEvals(rows: readonly MonthlyGradeRowWithClass[]): Map<string, MonthlyEval> {
  const byClass = new Map<string, MonthlyGradeRowWithClass[]>();
  for (const r of rows) {
    if (!r.class_id) continue;
    const arr = byClass.get(r.class_id) ?? [];
    arr.push(r);
    byClass.set(r.class_id, arr);
  }
  const out = new Map<string, MonthlyEval>();
  for (const [classId, list] of byClass) {
    const groupOf = (r: MonthlyGradeRowWithClass) => `${r.school_year ?? ""}|${r.exam_month ?? r.taken_on.slice(0, 7)}`;
    const latest = list.reduce((a, b) => (b.taken_on > a.taken_on ? b : a));
    const key = groupOf(latest);
    const group = list.filter((r) => groupOf(r) === key);
    // 달 표기 = 시험 달(exam_month)이 있으면 그 달, 없으면 시험일의 달. 해는 시험일에서(12월 시험을 1월 초에 보내도 맞게).
    const examMonth = Number(latest.exam_month);
    const takenYear = Number(latest.taken_on.slice(0, 4));
    const takenMonth = Number(latest.taken_on.slice(5, 7));
    const year = Number.isFinite(examMonth) && examMonth > takenMonth ? takenYear - 1 : takenYear;
    const month =
      Number.isFinite(examMonth) && examMonth >= 1 && examMonth <= 12 ? `${year}-${pad2(examMonth)}` : latest.taken_on.slice(0, 7);
    for (const r of group) {
      const ev = buildMonthlyEval(group, r.student_id, month);
      if (ev) out.set(`${classId}|${r.student_id}`, ev);
    }
  }
  return out;
}
