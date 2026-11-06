/**
 * 원스크린 영어 행에 실을 **한 달 학습 기록** 고르기 — 순수 함수(Vitest). 조회는 server/english-monthly.ts.
 *
 * 원장 2026-11-06 — EiE 월간 보고서에 그 달 숙제 완성도·수업 태도·단어 테스트 통계. 재료는 그 반의 일일 보고서 줄.
 * 🔑 달 = 그 학생의 Monthly Test 달(점수 그래프와 같은 달). 시험이 없으면 보고서 날짜의 달, 그 달 기록이 아직 없으면 지난달
 *    (월초에 지난달 보고서를 쓰는 경우 — 시트 실례: 11/2에 10월 보고서).
 * 🔴 보고서 날짜 **당일 줄은 넣지 않는다**(조회가 뺀다) — 월간 보고서를 저장하면 그 줄이 생겨 사실이 바뀌고, 방금 쓴 글이
 *    곧바로 '칸 달라짐'이 된다.
 */
import { parseScoreLine } from "./pilot-notes";
import { parseHomeworkRate } from "./homework-rate";
import { attitudeLevel } from "./math-report-pilot-sections";
import type { MonthlyActivity, MonthlyLesson } from "@/features/report-templates/monthly-activity";

export type MonthlyReportRow = {
  student_id: string;
  class_id: string | null;
  report_date: string;
  homework_score: string | null;
  attitude: string | null;
  daily_test: string | null;
};

const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
};

/** 일일 보고서 한 줄 → 수업 하나. */
export function lessonOfRow(r: MonthlyReportRow, retest: boolean): MonthlyLesson {
  const word = parseScoreLine((r.daily_test ?? "").split("\n")[0] ?? "");
  return {
    date: r.report_date,
    homework: parseHomeworkRate(r.homework_score),
    attitude: attitudeLevel(r.attitude ?? ""),
    word,
    retest: retest && !!word,
  };
}

/**
 * 줄들 → `반|학생` → 한 달 기록. `monthOf`는 그 학생의 Monthly Test 달(없으면 undefined).
 * 같은 날 줄이 둘이면(정규 + 보강) 둘 다 수업으로 센다 — 따로 나간 보고서다.
 */
export function pickMonthlyActivities(
  rows: readonly MonthlyReportRow[],
  retestKeys: ReadonlySet<string>,
  targetDate: string,
  monthOf: (key: string) => string | undefined,
): Map<string, MonthlyActivity> {
  const byKey = new Map<string, MonthlyReportRow[]>();
  for (const r of rows) {
    if (!r.class_id || r.report_date >= targetDate) continue;
    const key = `${r.class_id}|${r.student_id}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  const out = new Map<string, MonthlyActivity>();
  const thisMonth = targetDate.slice(0, 7);
  for (const [key, list] of byKey) {
    const has = (ym: string) => list.some((r) => r.report_date.startsWith(ym));
    const month = monthOf(key) ?? (has(thisMonth) ? thisMonth : prevMonth(thisMonth));
    const lessons = list
      .filter((r) => r.report_date.startsWith(month))
      .sort((a, b) => a.report_date.localeCompare(b.report_date))
      .map((r) => lessonOfRow(r, retestKeys.has(`${key}|${r.report_date}`)));
    if (lessons.length) out.set(key, { month, lessons });
  }
  return out;
}
