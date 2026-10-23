import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { blankLessonDates, blankLessonDayError } from "../issue-window";
import type { LedgerEnrollment, LedgerSchedule } from "../ledger-roster";
import type { BlankAttendanceRow } from "../no-homework";

type Db = ReturnType<typeof createAdminClient>;
const ATTENDANCE = "id,student_id,class_id,session_date,slot_start,status,recorded_at";
// 학생 청크(100명)와 함께 한 주소에 실리므로 반 목록은 짧게 — 넘으면 반 조건 없이 읽고 거른다(B3 · URL 길이).
const MAX_IN_CLASSES = 30;

/**
 * 숙제없음 수업일(issue-window `blankLessonDates`)의 출결 재료 — 장부의 숙제 0건 반 줄(①)에 선 학생만, 기간 범위로 한 번에 읽는다
 * (배치·수강은 장부가 이미 읽었다). 🔴 청크 안에서도 1,000행에서 잘리므로 `fetchAllPagedInChunks`(+ 안정 정렬 id).
 * 실패하면 null — 그 줄은 칸 없이 선다(배정 창이 따로 다시 판정한다).
 */
export async function loadBlankLessonRecords(db: Db, tenantId: string, pairs: readonly { classId: string; studentId: string }[],
  fromDate: string, toDate: string): Promise<BlankAttendanceRow[] | null> {
  if (!pairs.length) return [];
  const classIds = [...new Set(pairs.map((pair) => pair.classId))];
  const wanted = new Set(pairs.map((pair) => `${pair.classId}:${pair.studentId}`));
  try {
    const rows = await fetchAllPagedInChunks<BlankAttendanceRow>([...new Set(pairs.map((pair) => pair.studentId))], (chunk, from, to) => {
      const query = db.from("attendance_records").select(ATTENDANCE).eq("tenant_id", tenantId).in("student_id", chunk)
        .gte("session_date", fromDate).lt("session_date", addDays(toDate, 1));
      // 반이 많으면(URL 길이) 반 조건 없이 읽고 아래에서 거른다 — 이 학생들의 기간 출결이라 양은 작다.
      return (classIds.length <= MAX_IN_CLASSES ? query.in("class_id", classIds) : query).order("id", { ascending: true }).range(from, to);
    });
    return rows.filter((row) => wanted.has(`${row.class_id}:${row.student_id}`));
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.blankLessons", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

type PairKey = { classId: string; studentId: string };

/** 한 반 × 학생의 배치·수강·기간 출결 — 배정 창과 배정 저장이 같은 재료로 판정한다. 🔴 조회 실패는 던진다(없는 것으로 읽지 않는다). */
async function loadPairLessons(db: Db, tenantId: string, key: PairKey, fromDate: string, toDate: string) {
  const [cls, schedules, enrollments, records] = await Promise.all([
    db.from("classes").select("closed_at").eq("tenant_id", tenantId).eq("id", key.classId).maybeSingle(),
    db.from("class_schedules").select("day_of_week,valid_from,valid_to").eq("tenant_id", tenantId).eq("class_id", key.classId),
    db.from("enrollments").select("class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days")
      .eq("tenant_id", tenantId).eq("class_id", key.classId).eq("student_id", key.studentId),
    fetchAllPaged<BlankAttendanceRow>((from, to) => db.from("attendance_records").select(ATTENDANCE).eq("tenant_id", tenantId)
      .eq("class_id", key.classId).eq("student_id", key.studentId).gte("session_date", fromDate).lt("session_date", addDays(toDate, 1))
      .order("id", { ascending: true }).range(from, to)),
  ]);
  if (cls.error || schedules.error || enrollments.error) throw new Error("수업일을 확인하지 못했습니다.");
  return { schedules: (schedules.data ?? []) as LedgerSchedule[], enrollments: (enrollments.data ?? []) as LedgerEnrollment[], records,
    closedOn: (cls.data?.closed_at as string | null | undefined) ?? null };
}

/** 배정 창 — 한 반 × 학생의 숙제없음 수업일(기간 안 · 오늘까지 · `exclude` = 이미 숙제가 있는 날). 장부의 칸과 같은 판정(`blankLessonDates`). */
export async function loadBlankLessonDates(db: Db, tenantId: string, input: PairKey & {
  fromDate: string; toDate: string; exclude: ReadonlySet<string>; isHoliday: (date: string) => boolean;
}): Promise<string[]> {
  const today = kstToday();
  const toDate = input.toDate < today ? input.toDate : today;
  if (input.fromDate > toDate) return [];
  const lessons = await loadPairLessons(db, tenantId, input, input.fromDate, toDate);
  return blankLessonDates({ ...lessons, fromDate: input.fromDate, toDate, isHoliday: input.isHoliday, exclude: input.exclude });
}

/** 배정 저장 — 그날이 숙제없음 수업일인가(아니면 까닭). 화면이 보낸 날짜를 믿지 않고 같은 판정(`blankLessonDayError`)으로 다시 본다. */
export async function checkBlankLessonDay(db: Db, tenantId: string, input: PairKey & { date: string; isHoliday: (date: string) => boolean }): Promise<string | null> {
  if (input.date > kstToday()) return "아직 수업하지 않은 날에는 영상을 붙일 수 없습니다.";
  const lessons = await loadPairLessons(db, tenantId, input, input.date, input.date);
  return blankLessonDayError({ ...lessons, date: input.date, isHoliday: input.isHoliday });
}
