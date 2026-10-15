/**
 * 강사 근태 — 그 달 **지각·결근 횟수**(원장 결정 9 *"출퇴근 기록부 기준 — 지금은 메이크에듀 출퇴근 기록"*). 순수 함수.
 *
 * - 원장이 그 달 횟수를 직접 넣었으면 그 값(계획서 '원장 월 입력' — 출퇴근 기록이 아직 안 들어오는 지점·달).
 * - 아니면 출퇴근 기록(0365a `staff_attendance_days` — 연동 PC가 메이크에듀에서 가져온다)의 지각·결근을 센다. 지각 판정은 원본 표시 그대로.
 *   🔴 결재된 휴가(연차·반차·반반차)가 걸친 날과 휴원일은 뺀다 — 법정 휴가로 감점하지 않는다(계획서 결정 9).
 * - 수치(raw) = 지각 × 지각 가중 + 결근 × 결근 가중(학원 설정 — 기본 1·1). 그 달 기록도 입력도 없으면 자료 없음.
 */
import type { PunctualityOptions } from "../evaluation/options";
import { between } from "./dates";
import type { PunctualityRow, SnapshotLeave, SnapshotStaffDay } from "./source-types";
import type { PeriodWindow } from "./types";

export type PunctualityResult = { raw: number | null; late: number; absent: number; excused: number; days: number; manual: boolean; detail: PunctualityRow[] };

export function punctualityOf(input: {
  days: readonly SnapshotStaffDay[]; leaves: readonly SnapshotLeave[]; holidays: ReadonlySet<string>;
  teacherId: string; w: PeriodWindow; options: PunctualityOptions; manual: number | null;
}): PunctualityResult {
  const { w, teacherId, options } = input;
  const leaveOn = (day: string) => input.leaves.some((l) => l.user_id === teacherId && l.start_date <= day && l.end_date >= day);
  // 같은 날 줄이 여럿이면(출처가 둘 · 원본 줄이 둘) 가장 무거운 하나만 — 결근 > 지각 > 그 밖.
  const weight = (s: SnapshotStaffDay["status"]) => (s === "absent" ? 2 : s === "late" ? 1 : 0);
  const byDay = new Map<string, SnapshotStaffDay>();
  for (const d of input.days) {
    if (d.user_id !== teacherId || !between(d.work_date, w.start, w.end)) continue;
    const was = byDay.get(d.work_date);
    if (!was || weight(d.status) > weight(was.status)) byDay.set(d.work_date, d);
  }
  const mine = [...byDay.values()].sort((a, b) => a.work_date.localeCompare(b.work_date));
  const detail: PunctualityRow[] = mine.filter((d) => d.status === "late" || d.status === "absent").map((d) => {
    const excuse = input.holidays.has(d.work_date) ? "휴원일" : leaveOn(d.work_date) ? "결재된 휴가" : null;
    return { day: d.work_date, status: d.status as "late" | "absent", lateMinutes: d.late_minutes, checkIn: d.check_in_at, counted: !excuse, excuse };
  });
  const late = detail.filter((r) => r.counted && r.status === "late").length;
  const absent = detail.filter((r) => r.counted && r.status === "absent").length;
  const excused = detail.filter((r) => !r.counted).length;
  if (input.manual !== null) return { raw: input.manual, late, absent, excused, days: mine.length, manual: true, detail };
  const raw = mine.length ? Math.round((late * options.late + absent * options.absent) * 10) / 10 : null;
  return { raw, late, absent, excused, days: mine.length, manual: false, detail };
}
