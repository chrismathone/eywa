/**
 * 비포클래스체크리스트 — '지난 수업 결석' 자동 제외 판정(순수 · Vitest).
 *
 * 원장 2026-11-02 *"저번수업에 결석이였던 친구는 이번수업에서 비포클래스 체크를 할 수 없자나"* → *"지난 수업 결석이면 자동으로 제외"*.
 * 지난 수업 = 그 학생이 **이 반에 오는 수업일**(명단·분리등원 = roster.ts) 중 바로 앞의 날. 그날이 결석이면 이번 수업은 제외다.
 * 결석의 근거 = 체크리스트의 결석 체크 **또는** 출석부(attendance_records)의 결석·공결 — 둘 중 하나면 결석으로 본다.
 * 🔴 저장하지 않는다 — 화면을 열 때마다 판정한다(선생님이 직접 정한 값 `excused`가 이긴다, items.ts `isExcused`).
 */
import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";

/** 지난 수업을 찾으러 거슬러 올라가는 날 수 — 방학·휴원으로 수업이 몇 주 비어도 잡히게. */
export const PREV_LESSON_LOOKBACK_DAYS = 45;

/** 출석부에서 '오지 않은 날'로 보는 상태 — 결석·공결. */
const NOT_ATTENDED = new Set(["absent", "excused"]);

/**
 * 오는 수업일(오름차순)과 결석한 날로 자동 제외할 날을 고른다 — [from, to] 안의 날만.
 * 첫 수업일(앞 수업이 없는 날)은 제외하지 않는다.
 */
export function prevAbsentDates(
  activeDates: readonly string[], absentDates: ReadonlySet<string>, from: string, to: string,
): string[] {
  const sorted = [...new Set(activeDates)].sort();
  const out: string[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i]!;
    if (d < from || d > to) continue;
    if (absentDates.has(sorted[i - 1]!)) out.push(d);
  }
  return out;
}

export type AttendanceRow = EffectiveAttendanceRecord & { status: string };

/**
 * 출석부 기록에서 학생·날짜별 '오지 않은 날' — 정정 이력을 먼저 접고(effective-records), 그날 남은 교시가 **모두** 결석·공결일 때만.
 * 한 교시라도 출석·지각·조퇴·보강이면 온 날이다.
 * 열쇠 = `${classId}|${studentId}|${date}`.
 */
export function attendanceAbsentKeys(rows: readonly AttendanceRow[]): Set<string> {
  const byDay = new Map<string, string[]>();
  for (const r of effectiveAttendanceRecords(rows)) {
    const key = `${r.class_id}|${r.student_id}|${r.session_date}`;
    byDay.set(key, [...(byDay.get(key) ?? []), r.status]);
  }
  return new Set([...byDay].filter(([, statuses]) => statuses.every((s) => NOT_ATTENDED.has(s))).map(([k]) => k));
}

/** 날짜 빼기(YYYY-MM-DD, UTC 계산). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
