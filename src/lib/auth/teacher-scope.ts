import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";

/**
 * 강사(teacher) 데이터 스코프 — "내가 담당하는 반과 그 반의 학생".
 *
 * 강사는 메뉴(학생/출석/수업/시간표/상담 등)에 scoped 권한이 있으나, 쿼리에 강사 필터가 없으면
 * 테넌트 전체가 보인다(intra-tenant 누수 + 사용성 저하). 각 목록 쿼리가 이 헬퍼로 자기 스코프를
 * 적용한다 — 호출부가 빠뜨려도 쿼리 자체가 강사면 좁히므로 fail-safe.
 *
 * 담당 = `classes.teacher_id = 강사`(과목 강사 모델, 담임 primary_teacher_id 아님 — 인재원은 과목제).
 * React cache로 요청 내 1회만 조회(여러 쿼리가 불러도 DB 1번).
 */
export type TeacherScope = { classIds: string[]; studentIds: string[]; subjects: string[] };

export const getTeacherScope = cache(async (teacherId: string): Promise<TeacherScope> => {
  const supabase = await createClient();
  const { data: classes } = await supabase
    .from("classes")
    .select("id, subject")
    .eq("teacher_id", teacherId);
  const classIds = (classes ?? []).map((c) => c.id);
  const subjects = [...new Set((classes ?? []).map((c) => c.subject).filter(Boolean))] as string[];
  if (classIds.length === 0) return { classIds: [], studentIds: [], subjects };

  const enrollments = await fetchInChunks<{ student_id: string }>(classIds, (chunk) =>
    supabase.from("enrollments").select("student_id").is("end_date", null).in("class_id", chunk),
  );
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  return { classIds, studentIds, subjects };
});
