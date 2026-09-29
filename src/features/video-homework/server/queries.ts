import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { rosterIncludesEnrollment } from "@/features/onescreen/roster-filter";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";

type DbMark = { class_id: string; student_id: string; check_date: string; homework_date: string | null; status: string };

export type VideoHomeworkClassOption = { id: string; name: string; subjectKey: string; active: boolean };

export async function getVideoHomeworkClassOptions(tenantId: string): Promise<VideoHomeworkClassOption[]> {
  const db = createAdminClient();
  const rows = await fetchAllPaged<{ id: string; class_name: string; subject: string; is_active: boolean }>(
    (from, to) => db.from("classes").select("id,class_name,subject,is_active")
      // 수업목록의 '운영'과 동일: 활성 상태여도 종강한 반은 설정 선택지에서 제외한다.
      .eq("tenant_id", tenantId).eq("is_active", true).is("closed_at", null)
      .order("id").range(from, to),
  );
  return rows.map((row) => ({ id: row.id, name: row.class_name, subjectKey: row.subject, active: row.is_active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ko"));
}

export async function getVideoHomeworkMarks(tenantId: string, studentIds: string[], checkDate: string): Promise<VideoHomeworkMark[]> {
  if (!studentIds.length) return [];
  const db = createAdminClient();
  const rows = await fetchAllPagedInChunks<DbMark>(studentIds, (chunk, from, to) => db
    .from("video_homework_marks")
    .select("class_id,student_id,check_date,homework_date,status")
    .eq("tenant_id", tenantId).eq("check_date", checkDate).in("student_id", chunk)
    .order("id", { ascending: true }).range(from, to));
  return rows.map((row) => ({ classId: row.class_id, studentId: row.student_id,
    checkDate: row.check_date, homeworkDate: row.homework_date, status: row.status as VideoHomeworkStatus }));
}

export type VideoHomeworkRosterRow = {
  classId: string;
  className: string;
  subject: string;
  studentId: string;
  studentName: string;
  school: string | null;
  grade: string | null;
};

export type VideoHomeworkHistoryRow = VideoHomeworkRosterRow & VideoHomeworkMark;

export async function getVideoHomeworkHistory(tenantId: string, fromDate: string, toDate: string): Promise<VideoHomeworkHistoryRow[]> {
  const db = createAdminClient();
  const markRows = await fetchAllPaged<DbMark>((from, to) => db.from("video_homework_marks")
    .select("class_id,student_id,check_date,homework_date,status")
    .eq("tenant_id", tenantId).gte("check_date", fromDate).lte("check_date", toDate)
    .order("id").range(from, to));
  if (!markRows.length) return [];
  const classIds = [...new Set(markRows.map((row) => row.class_id))];
  const studentIds = [...new Set(markRows.map((row) => row.student_id))];
  const [classes, students] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; class_name: string; subject: string }>(classIds,
      (chunk, from, to) => db.from("classes").select("id,class_name,subject")
        .eq("tenant_id", tenantId).in("id", chunk).order("id").range(from, to)),
    fetchAllPagedInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(studentIds,
      (chunk, from, to) => db.from("students").select("id,name,school,grade")
        .eq("tenant_id", tenantId).in("id", chunk).order("id").range(from, to)),
  ]);
  const byClass = new Map(classes.map((row) => [row.id, row]));
  const byStudent = new Map(students.map((row) => [row.id, row]));
  return markRows.flatMap((mark): VideoHomeworkHistoryRow[] => {
    const cls = byClass.get(mark.class_id);
    const student = byStudent.get(mark.student_id);
    return cls && student ? [{
      classId: cls.id, className: cls.class_name, subject: cls.subject,
      studentId: student.id, studentName: student.name, school: student.school, grade: student.grade,
      checkDate: mark.check_date, homeworkDate: mark.homework_date, status: mark.status as VideoHomeworkStatus,
    }] : [];
  });
}

export async function getVideoHomeworkRoster(tenantId: string, checkDate: string = kstToday()): Promise<{
  rows: VideoHomeworkRosterRow[];
  marks: VideoHomeworkMark[];
}> {
  const db = createAdminClient();
  const today = checkDate;
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][weekdayIndexOf(checkDate)];
  const [classes, enrollments, schedules, attendance, reservations, markRows] = await Promise.all([
    fetchAllPaged<{ id: string; class_name: string; subject: string; is_active: boolean }>((from, to) => db
      .from("classes").select("id,class_name,subject,is_active").eq("tenant_id", tenantId)
      .order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; class_id: string; start_date: string | null; end_date: string | null;
      on_hold: boolean | null; is_transferred: boolean | null; attendance_days: string[] | null }>((from, to) => db
      .from("enrollments").select("student_id,class_id,start_date,end_date,on_hold,is_transferred,attendance_days")
      .eq("tenant_id", tenantId).or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("id").range(from, to)),
    fetchAllPaged<{ class_id: string }>((from, to) => db
      .from("class_schedules").select("class_id").eq("tenant_id", tenantId)
      .eq("day_of_week", dayKey).or(`valid_from.is.null,valid_from.lte.${checkDate}`)
      .or(`valid_to.is.null,valid_to.gte.${checkDate}`)
      .order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; class_id: string }>((from, to) => db
      .from("attendance_records").select("student_id,class_id")
      .eq("tenant_id", tenantId).eq("session_date", checkDate)
      .order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; class_id: string }>((from, to) => db
      .from("makeup_reservations").select("student_id,class_id")
      .eq("tenant_id", tenantId).eq("makeup_date", checkDate).eq("status", "reserved")
      .order("id").range(from, to)),
    fetchAllPaged<DbMark>((from, to) => db.from("video_homework_marks")
      .select("class_id,student_id,check_date,homework_date,status")
      .eq("tenant_id", tenantId).eq("check_date", checkDate)
      .order("id").range(from, to)),
  ]);
  const byClass = new Map(classes.map((row) => [row.id, row]));
  const historical = checkDate < kstToday();
  const scheduledClassIds = new Set(schedules.filter((row) => historical ||
    byClass.get(row.class_id)?.is_active).map((row) => row.class_id));
  const validEnrollments = enrollments.filter((row) => byClass.has(row.class_id) &&
    scheduledClassIds.has(row.class_id) && rosterIncludesEnrollment(row, checkDate, dayKey, true));
  const pairs = new Map<string, { class_id: string; student_id: string }>(
    validEnrollments.map((row) => [`${row.class_id}:${row.student_id}`, row]),
  );
  for (const row of [...attendance, ...reservations, ...markRows]) {
    if (byClass.has(row.class_id)) pairs.set(`${row.class_id}:${row.student_id}`, row);
  }
  const studentIds = [...new Set([...pairs.values()].map((row) => row.student_id))];
  const students = await (
    fetchAllPagedInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(studentIds,
      (chunk, from, to) => db.from("students").select("id,name,school,grade")
        .eq("tenant_id", tenantId).in("id", chunk)
        .order("id").range(from, to))
  );
  const marks: VideoHomeworkMark[] = markRows.map((row) => ({ classId: row.class_id,
    studentId: row.student_id, checkDate: row.check_date, homeworkDate: row.homework_date,
    status: row.status as VideoHomeworkStatus }));
  const byStudent = new Map(students.map((row) => [row.id, row]));
  const rows = [...pairs.values()].flatMap((entry): VideoHomeworkRosterRow[] => {
    const cls = byClass.get(entry.class_id);
    const student = byStudent.get(entry.student_id);
    return cls && student ? [{ classId: cls.id, className: cls.class_name, subject: cls.subject,
      studentId: student.id, studentName: student.name, school: student.school, grade: student.grade }] : [];
  });
  rows.sort((a, b) => a.className.localeCompare(b.className, "ko") || a.studentName.localeCompare(b.studentName, "ko"));
  return { rows, marks };
}
