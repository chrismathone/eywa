import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { classDatesInMonth, type ScheduleRow } from "../dates";
import { attendanceAbsentKeys, prevAbsentDates, PREV_LESSON_LOOKBACK_DAYS, shiftYmd, type AttendanceRow } from "../excuse";
import { attendsClassOn, type RosterEnrollment } from "../roster";
import { loadOffDays } from "./off-days";

/**
 * '지난 수업 결석' 자동 제외 대상(원장 2026-11-02) — 열쇠 `${classId}|${studentId}|${date}`의 모음, [from, to] 안의 날만.
 * 판정 규칙은 excuse.ts(순수). 여기는 재료(반 수업일 · 명단 · 체크리스트 결석 · 출석부 기록)만 읽는다 — 서버 전용 표라
 * admin + tenant_id 명시([[#104]]). 지난 수업을 찾으려고 from 앞으로 45일을 더 읽는다.
 * 쉰 휴일(off-days.ts — 학원 휴일인데 그 반 기록이 없는 날)은 수업일이 아니다 — 그 앞 수업이 '지난 수업'이다.
 * 🔴 실패해도 화면·보고서를 막지 않는다 — 빈 모음(자동 제외 없음)으로 돌리고 로그만 남긴다(선생님이 직접 켤 수 있다).
 */
export async function loadAutoExcusedKeys(
  tenantId: string, classIds: readonly string[], from: string, to: string, studentId?: string,
): Promise<Set<string>> {
  if (classIds.length === 0) return new Set();
  try {
    const admin = createAdminClient();
    const since = shiftYmd(from, -PREV_LESSON_LOOKBACK_DAYS);
    const ids = [...classIds];
    let enrQ = admin.from("enrollments").select("class_id, student_id, start_date, end_date, is_transferred, attendance_days")
      .eq("tenant_id", tenantId).in("class_id", ids).lte("start_date", to).or(`end_date.is.null,end_date.gte.${since}`);
    if (studentId) enrQ = enrQ.eq("student_id", studentId);
    const [sched, enr, checks, attendance, offDays] = await Promise.all([
      admin.from("class_schedules").select("class_id, day_of_week, valid_from, valid_to").eq("tenant_id", tenantId).in("class_id", ids),
      enrQ,
      fetchAllPaged((a, b) => {
        let q = admin.from("before_class_checks").select("id, class_id, student_id, check_date")
          .eq("tenant_id", tenantId).in("class_id", ids).eq("absent", true).gte("check_date", since).lte("check_date", to);
        if (studentId) q = q.eq("student_id", studentId);
        return q.order("id").range(a, b);
      }),
      fetchAllPaged((a, b) => {
        let q = admin.from("attendance_records").select("id, class_id, student_id, session_date, slot_start, status, recorded_at")
          .eq("tenant_id", tenantId).in("class_id", ids).gte("session_date", since).lte("session_date", to);
        if (studentId) q = q.eq("student_id", studentId);
        return q.order("id").range(a, b);
      }),
      loadOffDays(tenantId, ids, since, to),
    ]);
    if (sched.error) throw new Error(`class_schedules: ${sched.error.message}`);
    if (enr.error) throw new Error(`enrollments: ${enr.error.message}`);

    const absent = attendanceAbsentKeys(attendance as AttendanceRow[]);
    for (const c of checks) absent.add(`${c.class_id}|${c.student_id}|${c.check_date}`);

    const schedByClass = new Map<string, ScheduleRow[]>();
    for (const s of sched.data ?? []) schedByClass.set(s.class_id as string, [...(schedByClass.get(s.class_id as string) ?? []), s as ScheduleRow]);
    const months: string[] = [];
    for (let m = since.slice(0, 7); m <= to.slice(0, 7); m = shiftYmd(`${m}-28`, 7).slice(0, 7)) months.push(m);
    const datesOf = new Map<string, string[]>();
    for (const id of ids) {
      const rows = schedByClass.get(id) ?? [];
      const off = offDays.get(id) ?? {};
      datesOf.set(id, months.flatMap((m) => classDatesInMonth(m, rows)).filter((d) => d >= since && d <= to && !off[d]));
    }

    const enrByPair = new Map<string, RosterEnrollment[]>();
    for (const e of enr.data ?? []) {
      const k = `${e.class_id}|${e.student_id}`;
      enrByPair.set(k, [...(enrByPair.get(k) ?? []), e as RosterEnrollment]);
    }
    const out = new Set<string>();
    for (const [pair, rows] of enrByPair) {
      const classId = pair.split("|")[0]!;
      const active = (datesOf.get(classId) ?? []).filter((d) => attendsClassOn(rows, d));
      const absentDates = new Set(active.filter((d) => absent.has(`${pair}|${d}`)));
      for (const d of prevAbsentDates(active, absentDates, from, to)) out.add(`${pair}|${d}`);
    }
    return out;
  } catch (e) {
    console.error("[before-class] 지난 수업 결석 판정 실패 — 자동 제외 없이 진행", e);
    return new Set();
  }
}
