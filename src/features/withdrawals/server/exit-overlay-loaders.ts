import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { isMergedStudent } from "@/features/students/merged";
import type { OverlayHoldInput } from "../exit-overlay-model";

/** 시간표 X 겹침의 조회 셋(`exit-overlay.ts`가 조립한다). */
type Supabase = Awaited<ReturnType<typeof createClient>>;
export type ClassRow = { id: string; teacher_id: string | null; created_at: string; closed_at: string | null; class_name: string | null; is_special: boolean | null; is_active: boolean };

/** 그 과목 반 전부 — 폐지·종강한 반도(지난 달의 그때 담임 · 퇴원 줄의 반을 찾는다). */
export async function loadSubjectClasses(supabase: Supabase, subject: string): Promise<ClassRow[]> {
  return fetchAllPaged<ClassRow>((f, t) =>
    supabase
      .from("classes")
      .select("id, teacher_id, created_at, closed_at, class_name, is_special, is_active")
      .eq("subject", subject)
      .order("id")
      .range(f, t),
  );
}

export type HoldRow = Omit<OverlayHoldInput, "teacher"> & { subject: string; teacherId: string | null };
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * 지금 휴원(대기) 중인 수강 — 시작일이 저장되지 않아 '지금'만 안다(모델 머리 주석).
 * 한 학생이 같은 과목 두 반에서 대기면 한 줄(앞 반의 담임)이다 — 사람 수를 적는 칸이다.
 */
export async function loadCurrentHolds(supabase: Supabase, today: string): Promise<HoldRow[]> {
  type Row = {
    id: string;
    student_id: string;
    class: One<{ subject: string | null; class_name: string | null; teacher_id: string | null }>;
    student: One<{ name: string; school: string | null; grade: string | null; status: string; notes: string | null }>;
  };
  const rows = await fetchAllPaged<Row>((f, t) =>
    supabase
      .from("enrollments")
      .select(
        "id, student_id, class:class_id ( subject, class_name, teacher_id ), student:student_id ( name, school, grade, status, notes )",
      )
      .eq("on_hold", true)
      .lte("start_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("id")
      .range(f, t),
  );
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const c = one(r.class);
    const s = one(r.student);
    if (!c?.subject || !s || isMergedStudent(s.notes) || !["enrolled", "on_hold"].includes(s.status)) return [];
    const k = `${r.student_id}|${c.subject}`;
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ key: k, subject: c.subject, name: s.name, schoolGrade: schoolGradeLabel(s.school, s.grade), className: c.class_name, teacherId: c.teacher_id }];
  });
}

export async function teacherNames(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  const rows = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  return new Map(rows.flatMap((r) => (r.display_name ? [[r.id, r.display_name] as [string, string]] : [])));
}
