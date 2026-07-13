// 계획 N(planned_sessions) 산출 — 순수 함수(Vitest 강제). 청구=N회 키스톤(docs/per-session-billing-plan.md).
// ⚠️ 불변규칙 N1: 여기서 나온 값은 "계획"이지 "청구값"이 아니다 — 프리필·참고 전용, 확정은 사람이 한다.

import { countSessions } from "../tuition-calc";

export type PlanEnrollment = {
  classId: string;
  subject: string; // 운영 enum key
  startDate: string; // enrollment 시작 "YYYY-MM-DD"
  endDate: string | null; // 종료(null=계속)
  weekdays: number[]; // class_schedules 요일(0=일~6=토, 중복 제거)
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

  const byClass = new Map<string, { subject: string; sessions: number }>();
  for (const e of enrollments) {
    if (e.weekdays.length === 0) continue;
    const start = later(e.startDate, range.start);
    const end = e.endDate ? earlier(e.endDate, range.end) : range.end;
    if (start > end) continue; // 이 달과 안 겹침
    const sessions = countSessions(start, end, e.weekdays, holidays);
    if (sessions <= 0) continue;
    const cur = byClass.get(e.classId) ?? byClass.set(e.classId, { subject: e.subject, sessions: 0 }).get(e.classId)!;
    cur.sessions += sessions;
  }

  return [...byClass.entries()]
    .map(([classId, v]) => ({ subject: v.subject, classId, plannedSessions: v.sessions }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.classId.localeCompare(b.classId));
}
