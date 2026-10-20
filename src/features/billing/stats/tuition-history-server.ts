import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeTuitionHistory, type TuitionMonth } from "./tuition-history";

/**
 * '지난 기록 — 수업료 수납' 읽기 — 지점의 월별 집계(0385a `student_history_monthly` · 수십 줄)에서 돈 칸 두 개만. 서버 전용 표라 관리 키 +
 * tenant_id([[#104]] · 호출부가 `requireAccess("billing")`를 먼저 지난다 — 수납 권한이 있는 사람만 이 화면에 온다). 실패는 던진다(카드만 빠진다).
 */
export async function loadTuitionHistory(tenantId: string): Promise<TuitionMonth[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("student_history_monthly")
    .select("month,source,general:data->tuitionPaidGeneral,eie:data->tuitionPaidEie")
    .eq("tenant_id", tenantId)
    .order("month")
    .limit(400);
  if (error) throw new Error(`지난 수납 기록 읽기: ${error.message}`);
  const rows = (data ?? []) as unknown as { month: string; source: "makeedu" | "aywa"; general: unknown; eie: unknown }[];
  return mergeTuitionHistory(rows.map((r) => ({ month: r.month.slice(0, 7), source: r.source, data: { tuitionPaidGeneral: r.general, tuitionPaidEie: r.eie } })));
}
