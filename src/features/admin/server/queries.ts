import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DuplicateGroup = {
  key: string;
  students: {
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
    status: string;
    enrolledAt: string | null;
  }[];
};

/**
 * 중복 의심 학생 그룹.
 * 키: lower(이름) + grade + school. 같은 키에 2명 이상.
 */
export async function findDuplicateStudents(): Promise<DuplicateGroup[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, school, status, enrolled_at")
    .order("name");

  if (!data) return [];

  const groups = new Map<string, DuplicateGroup>();
  for (const r of data) {
    const key = `${r.name.toLowerCase().trim()}::${r.grade ?? ""}::${r.school ?? ""}`;
    const g = groups.get(key) ?? { key, students: [] };
    g.students.push({
      id: r.id,
      name: r.name,
      grade: r.grade,
      school: r.school,
      status: r.status,
      enrolledAt: r.enrolled_at,
    });
    groups.set(key, g);
  }

  return Array.from(groups.values()).filter((g) => g.students.length >= 2);
}

export type OrphanReport = {
  studentsWithoutEnrollments: { id: string; name: string; status: string }[];
  classesWithoutSchedules: { id: string; className: string; isActive: boolean }[];
  enrollmentsWithoutEndDate: number; // 모순 — withdrawn 학생인데 end_date=null
};

export async function findOrphans(): Promise<OrphanReport> {
  const supabase = await createClient();

  // 1) status='enrolled'인데 enrollment 0개
  const { data: enrolled } = await supabase
    .from("students")
    .select("id, name, status")
    .eq("status", "enrolled");
  const enrolledIds = (enrolled ?? []).map((s) => s.id);

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("student_id")
    .in("student_id", enrolledIds)
    .is("end_date", null);

  const withEnrollment = new Set((enrollments ?? []).map((e) => e.student_id));
  const studentsWithoutEnrollments = (enrolled ?? [])
    .filter((s) => !withEnrollment.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, status: s.status }));

  // 2) is_active=true 반 중 schedule 0개
  const { data: classes } = await supabase
    .from("classes")
    .select("id, class_name, is_active")
    .eq("is_active", true);
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select("class_id")
    .in("class_id", classIds);
  const withSchedule = new Set((schedules ?? []).map((s) => s.class_id));
  const classesWithoutSchedules = (classes ?? [])
    .filter((c) => !withSchedule.has(c.id))
    .map((c) => ({ id: c.id, className: c.class_name, isActive: c.is_active }));

  // 3) withdrawn 학생인데 active enrollment 남음
  const { data: withdrawnStudents } = await supabase
    .from("students")
    .select("id")
    .eq("status", "withdrawn");
  const withdrawnIds = (withdrawnStudents ?? []).map((s) => s.id);
  const { count: orphanEnrollments } = await supabase
    .from("enrollments")
    .select("*", { count: "exact", head: true })
    .in("student_id", withdrawnIds)
    .is("end_date", null);

  return {
    studentsWithoutEnrollments,
    classesWithoutSchedules,
    enrollmentsWithoutEndDate: orphanEnrollments ?? 0,
  };
}

