// 계획 N(planned_sessions) 산출 — 순수 함수(Vitest 강제). 청구=N회 키스톤(docs/per-session-billing-plan.md).
// ⚠️ 불변규칙 N1: 여기서 나온 값은 "계획"이지 "청구값"이 아니다 — 프리필·참고 전용, 확정은 사람이 한다.

import { autoUnitsOn, isAutoUnitsSubject, type AutoUnitsSchedule } from "@/features/attendance/auto-units";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";

export type PlanEnrollment = {
  classId: string;
  subject: string; // 운영 enum key
  startDate: string; // enrollment 시작 "YYYY-MM-DD"
  endDate: string | null; // 종료(null=계속)
  weekdays: number[]; // class_schedules 요일(0=일~6=토, 중복 제거)
  schedules?: AutoUnitsSchedule[]; // 실제 시간·유효기간. 옛 동결 픽스처는 weekdays만 사용한다.
};

export type PlannedTerm = {
  subject: string;
  classId: string; // 반 단위 — 같은 과목 복수 반도 합산하지 않는다(반마다 회당 단가가 다름, 2026-07-13 원장 지시)
  plannedSessions: number;
};

/** 청구월("YYYY-MM")의 달력 경계. 잘못된 입력은 null. */
export function monthRange(period: string): { start: string; end: string } | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, "0")}` };
}

const later = (a: string, b: string) => (a >= b ? a : b);
const earlier = (a: string, b: string) => (a <= b ? a : b);

/**
 * 한 학생의 청구월 계획 N — **반 단위**(테이블 유니크 = invoice×class). 중등+초등을 같이 들으면
 * 시수·단가가 반마다 다르므로 절대 합산하지 않는다. 같은 반 중복 enrollment는 기간 합산(연속 재등록).
 * 한계(v1, 설계 문서에 명시): 청구월=달력월 근사. 홀드/분리등원 미세케이스는 확정 단계에서 사람이 교정.
 */
export function planTermsForMonth(
  period: string,
  enrollments: PlanEnrollment[],
  holidays: string[],
): PlannedTerm[] {
  const range = monthRange(period);
  if (!range) return [];

  const holidaysSet = new Set(holidays);
  const byClass = new Map<string, { subject: string; dates: Map<string, number> }>();
  for (const e of enrollments) {
    if (e.weekdays.length === 0 && !e.schedules?.length) continue;
    const start = later(e.startDate, range.start);
    const end = e.endDate ? earlier(e.endDate, range.end) : range.end;
    if (start > end) continue; // 이 달과 안 겹침
    const dates = byClass.get(e.classId)?.dates ?? new Map<string, number>();
    for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0, 10) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      if (holidaysSet.has(date)) continue;
      if (e.schedules) {
        // 유효한 수업이 없는 날과 LAB·JJ 자리 배치는 수업량으로 만들지 않는다.
        const slots = [...liveSlotMinutesOn(date, e.schedules).values()].filter((minutes) => minutes > 0);
        if (slots.length === 0) continue;
        // 수학은 출석부 시간 환산, 영어는 출석부와 같이 교시마다 기본 1시수.
        dates.set(date, isAutoUnitsSubject(e.subject) ? autoUnitsOn(date, e.schedules) ?? 1 : e.subject === "english" ? slots.length : 1);
      } else if (e.weekdays.includes(day.getUTCDay())) {
        dates.set(date, 1);
      }
    }
    if (dates.size > 0) byClass.set(e.classId, { subject: e.subject, dates });
  }

  return [...byClass.entries()]
    .map(([classId, v]) => ({ subject: v.subject, classId, plannedSessions: Math.round([...v.dates.values()].reduce((sum, n) => sum + n, 0) * 10) / 10 }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.classId.localeCompare(b.classId));
}
