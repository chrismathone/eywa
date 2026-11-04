import "server-only";
import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { attendanceOverview, attendanceWindowStart } from "@/features/dashboard/overview/attendance-day";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceBySubject } from "./extras-types";

/**
 * 과목 탭의 오늘·14일 출결. 운영실 카드와 같은 기록·같은 정정 접기·같은 집계 함수를 과목별로 나눠 부른다 —
 * 영어는 반의 프로그램 구분으로 가른다(`attendance_rate_buckets`는 과목까지만 묶어 EiE를 못 가른다).
 */
export async function loadAttendanceBySubject(today: string, keyOf: (subject: string | null, track: string | null) => string | null): Promise<AttendanceBySubject> {
  const db = await createClient();
  const rows = await fetchAllPaged<EffectiveAttendanceRecord & { status: string }>((from, to) =>
    db.from("attendance_records").select("id,student_id,class_id,session_date,slot_start,status,recorded_at").gte("session_date", attendanceWindowStart(today)).lte("session_date", today).order("id").range(from, to));
  const cells = effectiveAttendanceRecords(rows);
  const classes = await fetchInChunks<{ id: string; subject: string | null; english_track: string | null }>([...new Set(cells.map((c) => c.class_id).filter(Boolean))], (chunk) =>
    db.from("classes").select("id,subject,english_track").in("id", chunk));
  const program = new Map(classes.map((c) => [c.id, keyOf(c.subject, c.english_track)]));
  const groups = new Map<string, typeof cells>();
  for (const cell of cells) {
    const key = program.get(cell.class_id);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(cell);
    else groups.set(key, [cell]);
  }
  return Object.fromEntries([...groups].map(([key, list]) => [key, attendanceOverview(list, today)]));
}
