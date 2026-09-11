import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import type {
  FirstClassCandidate,
  FirstClassSchedule,
} from "./admissions-class-link";

/** 캘린더와 학생·수업 열람 권한을 모두 확인한 호출부에서만 사용한다. 클라이언트에는 일치한 반만 보낸다. */
export async function firstClassCandidates(
  fromDate: string,
  toDate: string,
): Promise<FirstClassCandidate[]> {
  const [db, scope] = await Promise.all([
    createClient(),
    effectiveTeacherScope(),
  ]);
  if (scope && !scope.studentIds.length) return [];
  type Student = { name: string; school: string | null; grade: string | null };
  type Class = {
    class_name: string;
    subject: string;
    closed_at: string | null;
  };
  type Row = {
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
    student: Student | Student[];
    class: Class | Class[];
  };
  const rows = await fetchAllPaged<Row>((from, to) =>
    db
      .from("enrollments")
      .select(
        "student_id,class_id,start_date,end_date,on_hold,is_transferred,student:student_id!inner(name,school,grade),class:class_id!inner(class_name,subject,is_active,closed_at)",
      )
      .eq("on_hold", false)
      .eq("class.is_active", true)
      .lte("start_date", toDate)
      .or(`end_date.is.null,end_date.gte.${fromDate}`)
      .order("id")
      .range(from, to),
  );
  const ids = scope ? new Set(scope.studentIds) : null;
  const classIds = scope ? new Set(scope.classIds) : null;
  return rows
    .filter(
      (row) =>
        (!ids || ids.has(row.student_id)) &&
        (!classIds || classIds.has(row.class_id)),
    )
    .flatMap((row) => {
      const student = Array.isArray(row.student) ? row.student[0] : row.student;
      const klass = Array.isArray(row.class) ? row.class[0] : row.class;
      if (!student || !klass) return [];
      return [
        {
          studentId: row.student_id,
          studentName: student.name,
          school: student.school,
          grade: student.grade,
          classId: row.class_id,
          className: klass.class_name,
          subject: klass.subject,
          startDate: row.start_date,
          endDate: row.end_date,
          onHold: row.on_hold,
          isTransferred: row.is_transferred,
          closedAt: klass.closed_at,
        },
      ];
    });
}

export async function firstClassScheduleCandidates(
  fromDate: string,
  toDate: string,
): Promise<FirstClassSchedule[]> {
  const [db, scope] = await Promise.all([
    createClient(),
    effectiveTeacherScope(),
  ]);
  if (scope && !scope.classIds.length) return [];
  type Teacher = { display_name: string };
  type Class = {
    class_name: string;
    subject: string;
    closed_at: string | null;
    teacher: Teacher | Teacher[] | null;
  };
  type Row = {
    class_id: string;
    day_of_week: string;
    start_time: string;
    valid_from: string;
    valid_to: string | null;
    slot_teacher_label: string | null;
    slotTeacher: Teacher | Teacher[] | null;
    class: Class | Class[];
  };
  const rows = await fetchAllPaged<Row>((from, to) =>
    db
      .from("class_schedules")
      .select(
        "class_id,day_of_week,start_time,valid_from,valid_to,slot_teacher_label,slotTeacher:teacher_id(display_name),class:class_id!inner(class_name,subject,is_active,closed_at,teacher:teacher_id(display_name))",
      )
      .eq("class.is_active", true)
      .lte("valid_from", toDate)
      .or(`valid_to.is.null,valid_to.gte.${fromDate}`)
      .order("id")
      .range(from, to),
  );
  const classIds = scope ? new Set(scope.classIds) : null;
  return rows
    .filter((row) => !classIds || classIds.has(row.class_id))
    .flatMap((row) => {
      const klass = Array.isArray(row.class) ? row.class[0] : row.class;
      if (!klass) return [];
      const teacher = Array.isArray(row.slotTeacher)
        ? row.slotTeacher[0]
        : row.slotTeacher;
      const homeroom = Array.isArray(klass.teacher)
        ? klass.teacher[0]
        : klass.teacher;
      return [
        {
          classId: row.class_id,
          className: klass.class_name,
          subject: klass.subject,
          dayOfWeek: row.day_of_week,
          startTime: row.start_time,
          teacherName:
            teacher?.display_name ??
            row.slot_teacher_label ??
            homeroom?.display_name ??
            null,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          closedAt: klass.closed_at,
        },
      ];
    });
}
