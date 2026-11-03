import "server-only";
import { addDays } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import type { StudentRoster } from "./extras-types";

type One<T> = T | T[] | null;
const first = <T,>(v: One<T>) => (Array.isArray(v) ? v[0] : v) ?? null;

/** 퇴원생의 마지막 반까지 찾는 창(일) — 상세의 퇴원 명단이 최근 6개월이다. */
const ROSTER_DAYS = 200;

/**
 * 상세 명단의 반·담임 — 학생 id → 지금 듣는 반(그만둔 학생은 마지막 반).
 * 담임 = 반의 지금 담임(`classes.teacher_id`). 이름 없이 id만 키로 싣고, 명단 표가 있는 화면에서만 쓴다. RLS로 읽는다.
 * `subjectOf` = 수강 한 줄의 과목 탭 이름(영어는 반 구분으로 EiE · 인재원 영어).
 */
export async function loadStudentRoster(tenantId: string, today: string, subjectOf: (subject: string | null, track: string | null) => string): Promise<StudentRoster> {
  const db = await createClient();
  const rows = await fetchAllPaged<{ student_id: string; class_id: string; end_date: string | null; class: One<{ class_name: string | null; subject: string | null; english_track: string | null; teacher_id: string | null; teacher: One<{ display_name: string | null }> }> }>((from, to) =>
    db.from("enrollments").select("student_id,class_id,end_date,class:class_id ( class_name, subject, english_track, teacher_id, teacher:teacher_id ( display_name ) )")
      .eq("tenant_id", tenantId).or(`end_date.is.null,end_date.gte.${addDays(today, -ROSTER_DAYS)}`).order("id").range(from, to));
  const grouped = new Map<string, { end: string | null; classId: string; className: string; subject: string; teacher: string | null; teacherId: string | null }[]>();
  const classTeachers: Record<string, string> = {};
  const classSubjects: Record<string, string> = {};
  for (const row of rows) {
    const klass = first(row.class);
    if (!klass?.class_name) continue;
    const teacher = first(klass.teacher)?.display_name ?? null;
    if (teacher) classTeachers[klass.class_name] = teacher;
    const subject = subjectOf(klass.subject, klass.english_track);
    classSubjects[klass.class_name] = subject;
    const list = grouped.get(row.student_id) ?? [];
    list.push({ end: row.end_date?.slice(0, 10) ?? null, classId: row.class_id, className: klass.class_name, subject, teacher, teacherId: klass.teacher_id });
    grouped.set(row.student_id, list);
  }
  const students: StudentRoster["students"] = {};
  for (const [id, list] of grouped) {
    const current = list.filter((e) => !e.end || e.end >= today);
    const last = list.reduce((max, e) => (e.end && e.end > max ? e.end : max), "");
    const shown = current.length ? current : list.filter((e) => e.end === last);
    students[id] = [...new Map(shown.map((e) => [e.className, { classId: e.classId, className: e.className, subject: e.subject, teacher: e.teacher, teacherId: e.teacherId }])).values()];
  }
  return { students, classTeachers, classSubjects };
}
