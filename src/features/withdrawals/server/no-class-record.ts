import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { NO_CLASS_RECORD_KEY, isCleanupExit } from "../system-bulk";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 장부 정리 일괄 퇴원 직후 — 출결 기록도 수업료 청구(취소·환불 제외)도 한 번도 없는 학생의 퇴원 메타데이터에 `noClassRecord: true`를 굳힌다.
 * 그러면 끝난 수강 줄이 남아 있어도 `isBookkeepingOnlyExit`가 장부 정리로 본다(퇴원관리·운영실·원스크린·통계·비서 보기 어디서나 조용히 빠짐).
 * 원장 2026-11-09 *"저렇게 처리했음 알아서 걸러야지"*. 퇴원 처리가 끝난(status=withdrawn) 장부 정리 퇴원만 손댄다.
 * 조회·쓰기 실패는 throw — 부르는 쪽이 기록만 남기고 정리 자체는 그대로 둔다(최악이면 종전처럼 퇴원으로 보일 뿐).
 * @returns 표식을 적은 학생 id.
 */
export async function markNoClassRecord(admin: Admin, tenantId: string, studentIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return [];
  const [attended, billed, students] = await Promise.all([
    fetchAllPagedInChunks<{ student_id: string }>(ids, (chunk, from, to) =>
      admin.from("attendance_records").select("student_id").eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(from, to),
    ),
    fetchAllPagedInChunks<{ student_id: string }>(ids, (chunk, from, to) =>
      admin
        .from("invoices")
        .select("student_id")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .eq("category", "tuition")
        .not("status", "in", "(void,refunded)")
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<{ id: string; status: string; withdrawal_metadata: unknown }>(ids, (chunk, from, to) =>
      admin.from("students").select("id, status, withdrawal_metadata").eq("tenant_id", tenantId).in("id", chunk).order("id").range(from, to),
    ),
  ]);
  const traced = new Set([...attended, ...billed].map((r) => r.student_id));
  const marked: string[] = [];
  for (const s of students) {
    if (traced.has(s.id) || s.status !== "withdrawn" || !isCleanupExit(s.withdrawal_metadata)) continue;
    const meta = { ...(s.withdrawal_metadata as Record<string, unknown>), [NO_CLASS_RECORD_KEY]: true };
    const { error } = await admin.from("students").update({ withdrawal_metadata: meta }).eq("tenant_id", tenantId).eq("id", s.id).eq("status", "withdrawn");
    if (error) throw error;
    marked.push(s.id);
  }
  return marked;
}
