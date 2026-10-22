import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { assertRaws } from "../model/calc";
import { resolveConfig, type Metric, type Raws } from "../model/config";
import { emptyPayload, type ContributionPayload, type ContributionTotal, type StoredContributionMonth } from "../model/stored";
import type { BillingSeed } from "../model/billing";

export const MONTHS_TABLE = "student_contribution_months";
export const SETTINGS_TABLE = "student_contribution_settings";
export const SIGNALS_TABLE = "student_positive_signals";
export function tableMissing(error: { code?: string; message?: string } | null | undefined) {
  return !!error && (error.code === "42P01" || error.code === "PGRST205"
    || /(?:student_contribution|student_positive_signals).*(?:does not exist|schema cache)/i.test(error.message ?? ""));
}
export async function contributionReady(db: SupabaseClient, tenant: string) {
  const { error } = await db.from(MONTHS_TABLE).select("month").eq("tenant_id", tenant).limit(1);
  if (tableMissing(error)) return false;
  if (error) throw new Error(`기여도 조회 실패: ${error.message}`);
  return true;
}
export async function loadContributionSettings(db: SupabaseClient, tenant: string) {
  const { data, error } = await db.from(SETTINGS_TABLE).select("config, revision, history_ready, refreshed_at")
    .eq("tenant_id", tenant).maybeSingle();
  if (error && !tableMissing(error)) throw new Error(`기여도 설정 조회 실패: ${error.message}`);
  return { config: resolveConfig(data?.config), revision: Number(data?.revision ?? 0), historyReady: data?.history_ready === true,
    refreshedAt: (data?.refreshed_at as string | null) ?? null, missing: tableMissing(error) };
}
type DbMonth = { student_id: string; month: string; raws: Raws; correction: Raws; payload: ContributionPayload;
  evidence_ids?: string[];
  historical: BillingSeed[] | null; unavailable: Metric[]; closed_at: string | null; reconstructed: boolean; computed_at: string };
export async function loadContributionMonths(db: SupabaseClient, tenant: string, studentId?: string): Promise<StoredContributionMonth[]> {
  const rows = await fetchAllPaged<DbMonth>((a, b) => {
    const columns = `student_id, month, raws, correction, ${studentId ? "payload," : "evidence_ids:payload->evidenceIds,"} historical, unavailable, closed_at, reconstructed, computed_at`;
    const query = db.from(MONTHS_TABLE).select(columns)
      .eq("tenant_id", tenant).order("student_id").order("month");
    if (studentId) query.eq("student_id", studentId);
    return query.range(a, b).returns<DbMonth[]>();
  });
  return rows.map((r) => {
    assertRaws(r.raws); assertRaws(r.correction);
    const payload = { ...emptyPayload(), ...r.payload };
    if (r.evidence_ids) payload.evidenceIds = r.evidence_ids;
    return { studentId: r.student_id, month: r.month, raws: r.raws, correction: r.correction, payload,
      evidenceIds: payload.evidenceIds, historical: r.historical ?? [], unavailable: r.unavailable ?? [],
      closedAt: r.closed_at, reconstructed: r.reconstructed, computedAt: r.computed_at };
  });
}
export async function loadContributionTotals(db: SupabaseClient, tenant: string, ids: string[], since: string): Promise<ContributionTotal[]> {
  const rows = await fetchInChunks<{ student_id: string; raws: Raws; recent: Raws; computed_at: string; unavailable: Metric[] }>(ids,
    (chunk) => db.rpc("student_contribution_totals", { p_tenant: tenant, p_students: chunk, p_since: since }, { get: true }));
  return rows.map((r) => {
    assertRaws(r.raws); assertRaws(r.recent);
    return { studentId: r.student_id, raws: r.raws, recent: r.recent, computedAt: r.computed_at, unavailable: r.unavailable };
  });
}
export async function saveContributionMonths(db: SupabaseClient, tenant: string, token: string, revision: number, rows: StoredContributionMonth[], deadline = Infinity) {
  let written = 0, closed = 0;
  // 큰 근거 행은 요청 크기를 제한한다. 중단 후 재실행은 이미 마감한 행을 건너뛴다.
  let processed = 0;
  while (processed < rows.length && Date.now() < deadline) {
    const batch: StoredContributionMonth[] = [];
    let bytes = 0;
    while (processed < rows.length && batch.length < 100 && bytes < 800_000) {
      const row = rows[processed++]!; batch.push(row); bytes += JSON.stringify(row).length * 3;
    }
    const { data, error } = await db.rpc("save_student_contribution_months", { p_tenant: tenant, p_token: token, p_revision: revision,
      p_rows: batch.map((r) => ({ student_id: r.studentId, month: r.month, raws: r.raws, correction: r.correction,
        payload: r.payload, historical: r.historical, unavailable: r.unavailable, closed_at: r.closedAt, reconstructed: r.reconstructed, computed_at: r.computedAt })) });
    if (error) throw new Error(`기여도 저장 실패: ${error.message}`);
    written += Number(data ?? 0);
    closed += batch.filter((r) => !!r.closedAt).length;
  }
  return { written, closed, complete: processed === rows.length };
}
