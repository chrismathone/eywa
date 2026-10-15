import "server-only";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import type { createClient } from "@/lib/supabase/server";
import { isBookkeepingOnlyExit, isCleanupExit } from "../system-bulk";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 수업 기록 없는 장부 정리 퇴원(`isBookkeepingOnlyExit`)의 학생 id — 수강을 따로 읽지 않는 퇴원 집계(원스크린 증감)가
 * 퇴원관리·운영실과 **같은 모집단**으로 거르게(원장 2026-10-15 *"단체 정리면 그냥 장부 정리는 미출력되게"*).
 * 장부 정리 메모가 붙은 행만 끝난 수강을 읽는다(대개 0건이라 조회도 없다). 조회 실패는 throw(빈 집합으로 삼키지 않는다).
 */
export async function bookkeepingOnlyIds(
  supabase: Supabase,
  rows: readonly { id: string; withdrawal_metadata?: unknown }[],
): Promise<Set<string>> {
  // 같은 학생이 등록·퇴원 두 목록에 함께 올 수 있어 id로 한 번만.
  const candidates = [...new Map(rows.filter((r) => isCleanupExit(r.withdrawal_metadata)).map((r) => [r.id, r])).values()];
  if (candidates.length === 0) return new Set();
  const ended = await fetchAllPagedInChunks<{ student_id: string }>(
    candidates.map((r) => r.id),
    (chunk, from, to) =>
      supabase.from("enrollments").select("student_id").in("student_id", chunk).not("end_date", "is", null).order("id").range(from, to),
  );
  const withHistory = new Set(ended.map((e) => e.student_id));
  return new Set(
    candidates
      .filter((r) => isBookkeepingOnlyExit({ withdrawalMetadata: r.withdrawal_metadata, hasEnrollmentHistory: withHistory.has(r.id) }))
      .map((r) => r.id),
  );
}
