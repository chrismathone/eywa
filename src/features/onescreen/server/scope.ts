import "server-only";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 강사 스코프 — 이 학생이 로그인 강사의 담당 반 활성 수강생인지(원스크린 보고서/첨부/링크 액션 공용 이중방어).
 * ⚠️ `"use server"` 액션 파일이 아닌 순수 server-only 모듈 — actions.ts·attachment-actions.ts가 함께 import.
 * RLS가 tenant 격리를 담당하고, 이 함수가 강사-학생 소유를 추가로 확인(다른 반 학생 조작 차단).
 */
export async function teacherOwnsStudent(
  supabase: ServerClient,
  teacherId: string,
  studentId: string,
): Promise<boolean> {
  const { data: myClasses } = await supabase.from("classes").select("id").eq("teacher_id", teacherId);
  const myClassIds = (myClasses ?? []).map((c) => c.id);
  if (myClassIds.length === 0) return false;
  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .is("end_date", null)
    .in("class_id", myClassIds)
    .limit(1);
  return !!enr && enr.length > 0;
}
