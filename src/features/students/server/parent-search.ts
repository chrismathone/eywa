/**
 * 원생목록 검색의 **학부모명** — 원장 2026-10-28 *"검색 필드에 학부모명으로도 검색 가능하게"*.
 *
 * 학생 행의 `parent_name`은 검색 컬럼(`SEARCH_FIELD_COLS`)이 직접 본다. 여기는 그 칸이 빈 학생을 위한
 * 보조 — 그 학생에게 **연결된**(`student_id`) 신규 콜&상담의 학부모 이름이 검색어와 겹치면 그 학생도 올린다
 * (실측 침산 재원생 339명 중 155명이 학생 행에 학부모 이름이 없다).
 *
 * ⚠️ 0행·에러는 빈 배열 — 보조 검색이 실패해도 학생 목록은 종전대로 돈다(메모 검색과 같은 규약).
 * ⚠️ 상한 안에서만 — id는 `id.in.(…)`로 URL에 실린다(queries.ts `MEMO_MATCH_CAP` 주석의 사고).
 */
import type { createClient } from "@/lib/supabase/server";

export async function consultParentMatchStudentIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  term: string,
  cap: number,
): Promise<string[]> {
  if (!term) return [];
  const { data, error } = await supabase
    .from("enrollment_consultations")
    .select("student_id")
    .not("student_id", "is", null)
    .ilike("parent_name", `%${term}%`)
    .limit(cap);
  if (error || !data) return [];
  return [...new Set(data.map((r) => r.student_id as string))];
}
