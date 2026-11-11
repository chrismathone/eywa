import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 직원 완전 삭제 전 확인 — 신규생 정착 관리(s2_0061·s2_0062)·콜&상담 여정(s2_0063) 표는 직원 칸에 지움 규칙이 없어(기록 명의 보존)
 * 한 줄이라도 걸려 있으면 `users` 삭제가 23503으로 멈춘다. 로그인 계정을 먼저 지우는 삭제 흐름이 반쯤 끝난 상태가 되지 않게 미리 본다.
 * 표가 없으면(SQL 미적용) 걸릴 것도 없다. 그 밖의 조회 실패는 **막는 쪽**으로 본다(지운 뒤엔 되돌릴 수 없다).
 */
const REFS: [table: string, columns: string[]][] = [
  ["student_onboarding_feedback", ["author_id", "updated_by", "reviewed_by", "followup_by"]],
  ["student_onboarding_followup_events", ["actor_id"]],
  ["student_onboarding_subject_assignments", ["manager_id", "updated_by"]],
  ["student_onboarding_manager_defaults", ["manager_id", "updated_by"]],
  ["enrollment_journey_records", ["actor_id"]],
  ["enrollment_journey_revisions", ["actor_id"]],
];

export async function careRecordsByStaff(staffId: string): Promise<"refs" | "none" | "error"> {
  const admin = createAdminClient();
  const results = await Promise.all(REFS.map(([table, columns]) =>
    admin.from(table).select("tenant_id", { count: "exact", head: true }).or(columns.map((c) => `${c}.eq.${staffId}`).join(","))));
  if (results.some((r) => !r.error && (r.count ?? 0) > 0)) return "refs";
  return results.some((r) => r.error && !["42P01", "PGRST205"].includes(r.error.code ?? "")) ? "error" : "none";
}
