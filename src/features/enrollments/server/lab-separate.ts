import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";

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

/**
 * 시간표 — 학원 전체에서 **'따로 수업(*LAB)'에 배정된 수강** id(0271b). 원생 이름을 LAB 파랑 + 이탤릭으로 칠하는 재료
 * ([`applyLabSeparateMarks`](../../timetable/lib/lab-separate.ts) — 그 주 *LAB 교시가 있는 반에만 얹는다).
 *
 * 🔴 **fail-soft** — 시간표는 전원이 매일 여는 화면이다([[#95]]: 뿌리 조회에 칸을 끼우지 않는다). 모르면 null = 표식 없이 그린다.
 * 🔑 켠 수강만 받는다(실측 수십 줄 이하) — 명단 전체를 다시 읽지 않는다. id 명단으로 쓰니 페이징(B2, 헬퍼는 오류를 throw).
 */
export async function getLabSeparateEnrollmentIdSet(): Promise<Set<string> | null> {
  try {
    const supabase = await createClient();
    const rows = await fetchAllPaged<{ id: string }>((from, to) =>
      supabase.from("enrollments").select("id").eq("lab_separate", true).order("id").range(from, to),
    );
    return new Set(rows.map((r) => String(r.id)));
  } catch {
    return null;
  }
}
