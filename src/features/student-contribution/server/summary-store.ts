import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUMMARY_VERSION, type RecentSummary } from "@/features/students/ontology/summary";

const TABLE = "student_ontology_summaries";
/** Atomic tenant/day reservation; failed provider calls also consume the conservative pilot allowance. */
export async function reserveSummaryCall(tenant: string) {
  const { data, error } = await createAdminClient().rpc("reserve_student_ontology_summary_call", { p_tenant: tenant });
  if (error) throw error;
  return data === true;
}
export type SummaryScope = { tenant: string; studentId: string; userId: string };
const key = (scope: SummaryScope) => ({ tenant_id: scope.tenant, student_id: scope.studentId, requested_by: scope.userId, purpose: "recent_records" });
export type SavedSummary = { input_hash: string | null; contract_version: string | null; result: unknown; model_label: string | null;
  generated_at: string | null; request_token: string | null; requested_at: string | null };

export async function readSavedSummary(scope: SummaryScope) {
  const { data, error } = await createAdminClient().from(TABLE)
    .select("input_hash, contract_version, result, model_label, generated_at, request_token, requested_at").match(key(scope)).maybeSingle();
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return { ready: false as const, row: null };
    throw error;
  }
  return { ready: true as const, row: data as SavedSummary | null };
}

/** A user/tenant/student/purpose lease prevents duplicate billable calls. Never overwrites a valid result while generating. */
export async function claimSummary(scope: SummaryScope, token: string) {
  const db = createAdminClient(), now = new Date().toISOString();
  const conflict = "tenant_id,student_id,requested_by,purpose";
  const inserted = await db.from(TABLE).upsert({ ...key(scope), request_token: token, requested_at: now }, { onConflict: conflict, ignoreDuplicates: true }).select("request_token");
  if (inserted.error) throw inserted.error;
  if (inserted.data?.length) return true;
  const cutoff = new Date(Date.now() - 120_000).toISOString();
  const claimed = await db.from(TABLE).update({ request_token: token, requested_at: now }).match(key(scope))
    .or(`request_token.is.null,requested_at.lt.${cutoff}`).select("request_token");
  if (claimed.error) throw claimed.error;
  return !!claimed.data?.length;
}

export async function finishSummary(scope: SummaryScope, token: string, hash: string, result: RecentSummary, model: string) {
  const { data, error } = await createAdminClient().from(TABLE).update({ input_hash: hash, result, model_label: model,
    contract_version: SUMMARY_VERSION, generated_at: new Date().toISOString(), request_token: null, requested_at: null })
    .match(key(scope)).eq("request_token", token).select("generated_at");
  if (error) throw error;
  if (!data?.length) throw new Error("요약 요청이 만료되었습니다. 다시 시도해 주세요.");
}
export async function releaseSummary(scope: SummaryScope, token: string) {
  const { error } = await createAdminClient().from(TABLE).update({ request_token: null, requested_at: null }).match(key(scope)).eq("request_token", token);
  if (error) console.error("[student-ontology] summary lease release failed", error.code);
}
