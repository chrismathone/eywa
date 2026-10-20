import { resolveFirstClasses, type DayEnrollmentRow } from "@/features/dashboard/day-arrivals";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import type { PeriodKeys, StatsPeriod } from "@/features/stats/period";
import { addDays } from "@/lib/date-kst";

/**
 * **첫 수업 추이**(원장 2026-10-20 *"오늘 첫수업도 마찬가지"* — 상세에서 추이를) — 날마다 운영실 '오늘첫수업'과 **같은 판정**
 * (`resolveFirstClasses` — 첫 등원 + 새 과목 첫 수업 · 반이동·반 추가는 아니다)을 돌려 칸(날 · 달)마다 센다. 순수 함수(Vitest).
 *
 * 🔑 달 칸 = 그 달 **날마다 센 수의 합**(한 학생이 4일에 수학, 20일에 영어를 처음 들으면 2). 오늘 칸 = 운영실 카드 숫자.
 * 🔑 `trustFrom`(에이와 수강 기록이 갖춰진 달 — `record-coverage.ts`) 전은 null — 옮겨 오기 전 학생의 수강 시작일이 옮긴 날로 잡혀
 *    그날 수백 명이 '첫 수업'으로 솟는다. 오늘 뒤 날은 세지 않는다.
 * `inScope` = 과목 관리자(운영실 `narrow.ts`처럼 그 과목 첫 수업만 · 과목을 모르면 든다).
 */
/** 주소 이름 — 원생 통계 화면의 다른 칸(`view`·`subject`)과 겹치지 않게 `fc…`(서버 페이지·카드가 함께 읽어 일반 모듈에 — [[#81]]). */
export const FIRST_CLASS_KEYS: PeriodKeys = { grain: "fc", month: "fcMonth", from: "fcFrom", to: "fcTo", span: "fcSpan" };

export type FirstClassTrend = { keys: string[]; first: (number | null)[]; newSubject: (number | null)[] };

export function firstClassTrend(input: {
  rows: readonly DayEnrollmentRow[];
  period: StatsPeriod;
  today: string;
  subjects: readonly ProgramSubject[];
  trustFrom: string | null;
  inScope?: (subject: string) => boolean;
}): FirstClassTrend {
  const { period, today, trustFrom } = input;
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const trusted = (key: string) => !trustFrom || key.slice(0, 7) >= trustFrom;
  const first = keys.map((k) => (trusted(k) && (period.grain === "month" || k <= today) ? 0 : null));
  const newSubject = [...first];
  // 날짜 → 그날 시작하는 수강이 있는 학생의 수강 전건(판정은 학생의 수강 전체로 — day-arrivals.ts).
  const byStudent = new Map<string, DayEnrollmentRow[]>();
  for (const row of input.rows) byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
  const startsOn = new Map<string, Set<string>>();
  for (const row of input.rows) {
    if (row.startDate > today) continue;
    const set = startsOn.get(row.startDate) ?? new Set<string>();
    set.add(row.studentId);
    startsOn.set(row.startDate, set);
  }
  const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
  for (let d = from; d <= today && d <= (period.grain === "month" ? `${period.months.at(-1)}-31` : period.to); d = addDays(d, 1)) {
    const i = at.get(period.grain === "month" ? d.slice(0, 7) : d);
    if (i === undefined || first[i] === null) continue;
    const ids = startsOn.get(d);
    if (!ids) continue;
    const rows = [...ids].flatMap((id) => byStudent.get(id) ?? []);
    for (const s of resolveFirstClasses(rows, d, input.subjects)) {
      if (input.inScope && !s.subjects.some(input.inScope)) continue;
      if (s.kind === "first") first[i]!++;
      else newSubject[i]!++;
    }
  }
  return { keys, first, newSubject };
}
