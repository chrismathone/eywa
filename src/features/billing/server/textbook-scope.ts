import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { teacherViewableClassIds } from "@/features/students/server/read-scope";

/**
 * 교재 요청의 강사 학생 범위 — 감사 D5(2026-09-23).
 *
 * 종전엔 `getTeacherScope`(담임 반만)를 써서, 담임 반이 없는 교시 담당 강사(영어 부담임 등)는 학생 목록이
 * 비어 교재를 요청할 수 없었다. 반 = **학생 상세 열람과 같은 판정**(`teacherViewableClassIds` — 담임 ∪ 교시 담당
 * ∪ 임시 위임)이고, 학생 = 그 반들의 **열린 수강**(종전 getTeacherScope와 같은 `end_date is null`).
 * 🔴 화면(목록·학생 선택)과 서버 액션(요청·수정·삭제·학부모 발송)이 **이 한 함수**를 지난다(#77) — 한쪽만
 *    넓히면 "목록엔 뜨는데 요청하면 '담당 학생만'" 거절이 난다.
 * ⚠️ 공용 getTeacherScope는 넓히지 않는다(그걸 쓰는 다른 화면의 범위가 조용히 함께 넓어진다).
 */
export const textbookRequestStudentIds = cache(async (teacherId: string): Promise<string[]> => {
  const classIds = await teacherViewableClassIds(teacherId);
  if (classIds.length === 0) return [];
  const supabase = await createClient();
  const rows = await fetchInChunks<{ student_id: string }>(classIds, (chunk) =>
    supabase.from("enrollments").select("student_id").is("end_date", null).in("class_id", chunk),
  );
  return [...new Set(rows.map((r) => r.student_id))];
});
