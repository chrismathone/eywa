import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * 반 상세 — 이 반에서 **'따로 수업(*LAB)'에 배정된 수강** id(0271b `enrollments.lab_separate`).
 *
 * 🔴 **따로·fail-soft로 읽는다**([[#95]]) — 명단 조회(`getClassStudents`)에 칸을 끼우면 칸이 없는 DB에서 반 상세가
 *    통째로 죽는다. 모르면 null → 화면은 토글을 세우지 않는다(모르는 상태를 "꺼짐"으로 보여 주면 누르는 순간
 *    켜 둔 배정을 모른 채 뒤집는다).
 */
export async function getClassLabSeparateEnrollmentIds(classId: string): Promise<Set<string> | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("enrollments")
      .select("id")
      .eq("class_id", classId)
      .eq("lab_separate", true);
    if (error) return null;
    return new Set((data ?? []).map((r) => String((r as { id: string }).id)));
  } catch {
    return null;
  }
}
