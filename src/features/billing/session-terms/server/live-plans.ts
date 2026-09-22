import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { toAutoUnitsSchedule } from "@/features/attendance/auto-units";
import { planTermsForMonth, monthRange } from "../plan";
import type { TransferEnrollment } from "../receipt-suggestion";
import { DOW_NUMBER, individualAttendDays } from "../term-days";
import { kstMonth } from "@/lib/date-kst";

export type PlanHistory = TransferEnrollment & {
  student_id: string; on_hold: boolean; attendance_days: string[] | null;
  class: { subject?: string; is_active?: boolean; english_track?: string | null; class_name?: string } | { subject?: string; is_active?: boolean; english_track?: string | null; class_name?: string }[] | null;
};
const dow: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** 조회 시 최신 수강 기간으로 계산한다. DB의 오래된 계획값을 0시수의 대체값으로 쓰지 않는다. */
export async function loadLivePlans(db: Awaited<ReturnType<typeof createClient>>, period: string, studentIds: string[], holidays: string[]) {
  const range = monthRange(period);
  const plans = new Map<string, Map<string, number>>();
  /**
   * `학생|반` — 이 달과 겹치는 수강 중 **휴원(on_hold)이거나 반이 비활성**이라 계산에서 뺀 것이 있는 쌍.
   * 둘 다 시간 축이 없어(지금 상태) 지난 달·월중 휴원이면 예정이 실제보다 작게 나온다 → 화면의 '확정 ≠ 예정' 표시를 끈다
   * (적대적 리뷰 2026-09-17: 9월 휴원생의 8월 확정 행이 "예정 0"으로 칠해져 지난 청구를 0으로 고치게 유도).
   */
  const uncertain = new Set<string>();
  /** 반 id → 그 달에 걸친 배치 요일(0=일). 표의 반 이름 옆에 선다. */
  const classDays = new Map<string, number[]>();
  /** `학생|반` → 반 요일과 다른 개별 등원 요일(같거나 전체면 없음). 표의 학생 이름 옆에 선다. */
  const attendDays = new Map<string, number[]>();
  if (!range || !studentIds.length) return { plans, history: [] as PlanHistory[], uncertain, classDays, attendDays };
  const previousDay = new Date(Date.parse(range.start) - 86400000).toISOString().slice(0, 10);
  const history = await fetchAllPagedInChunks<PlanHistory>(studentIds, (ids, from, to) => db.from("enrollments")
    .select("student_id, class_id, start_date, end_date, on_hold, attendance_days, is_transferred, is_transferred_in, class:class_id!inner (subject, is_active, english_track, class_name)")
    .in("student_id", ids).lte("start_date", range.end).or(`end_date.is.null,end_date.gte.${previousDay}`).order("id").range(from, to));
  const classIds = [...new Set(history.map((e) => e.class_id))];
  const schedules = await fetchAllPagedInChunks<Parameters<typeof toAutoUnitsSchedule>[0] & { class_id: string }>(classIds, (ids, from, to) => db.from("class_schedules")
    .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, lab_separate")
    .in("class_id", ids).lte("valid_from", range.end).or(`valid_to.is.null,valid_to.gte.${range.start}`).order("id").range(from, to));
  for (const sch of schedules) {
    const d = DOW_NUMBER[sch.day_of_week];
    if (d === undefined) continue;
    const days = classDays.get(sch.class_id) ?? [];
    if (!days.includes(d)) days.push(d);
    classDays.set(sch.class_id, days);
  }
  // 등원 요일(`attendance_days`)은 지금 값 하나뿐이라 지난 달 표에 대입하면 그 달에 실제로 오던 요일과 어긋난다 — 이번 달부터만 싣는다
  // (리뷰 2026-09-17, 휴원 `uncertain`과 같은 한계). 반 요일은 배치 이력에서 뽑으므로 지난 달도 맞다.
  const showAttendDays = period >= kstMonth();
  for (const studentId of studentIds) {
    const byClass = new Map<string, { attendanceDays: string[] | null }[]>();
    for (const e of history) {
      // 그 달과 실제로 겹치는 휴원 아닌 수강만(조회는 전달 말일 종료분까지 받는다 — 반이동 판정용).
      if (!showAttendDays || e.student_id !== studentId || e.on_hold || (e.end_date !== null && e.end_date < range.start)) continue;
      const list = byClass.get(e.class_id) ?? [];
      list.push({ attendanceDays: e.attendance_days });
      byClass.set(e.class_id, list);
    }
    for (const [classId, list] of byClass) {
      const days = individualAttendDays(classDays.get(classId) ?? [], list);
      if (days) attendDays.set(`${studentId}|${classId}`, days);
    }
    for (const e of history) {
      if (e.student_id !== studentId) continue;
      const cls = Array.isArray(e.class) ? e.class[0] : e.class;
      if (e.on_hold || cls?.is_active === false) uncertain.add(`${studentId}|${e.class_id}`);
    }
    const enrollments = history.filter((e) => e.student_id === studentId && !e.on_hold).flatMap((e) => {
      const cls = Array.isArray(e.class) ? e.class[0] : e.class;
      if (!cls?.subject || cls.is_active === false) return [];
      return [{ classId: e.class_id, subject: cls.subject, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred,
        englishTrack: cls.english_track, className: cls.class_name,
        weekdays: [], attendanceDays: (e.attendance_days ?? []).map((day) => dow[day]).filter((day) => day !== undefined),
        schedules: schedules.filter((s) => s.class_id === e.class_id).map(toAutoUnitsSchedule) }];
    });
    plans.set(studentId, new Map(planTermsForMonth(period, enrollments, holidays).map((p) => [p.classId, p.plannedSessions])));
  }
  return { plans, history, uncertain, classDays, attendDays };
}
