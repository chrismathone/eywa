import { enrollmentAttendsOnDay, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { dayKeyOf } from "./dates";

/** 수강 행(반 하나·학생 하나) — 명단 판정에 쓰는 열만. */
export type RosterEnrollment = { start_date: string; end_date: string | null; is_transferred: boolean; attendance_days: string[] | null };

/** 그날 이 반에 오는 학생인가 — 명단에 있고(종료 규약 eligibility.ts) 분리등원이면 그 요일만. 화면·저장·통계가 같은 판정을 쓴다. */
export function attendsClassOn(rows: readonly RosterEnrollment[], date: string): boolean {
  return rows.some((e) =>
    isEnrollmentOnRosterOn({ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred }, date)
    && enrollmentAttendsOnDay(e.attendance_days, dayKeyOf(date)));
}
