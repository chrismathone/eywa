import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { DEFAULT_EVALUATION_CONFIG, resolveEvaluationConfig, type EvaluationConfig } from "../evaluation/config";
import type { ManualEntryRow } from "../model/evaluate";

/**
 * 강사평가 설정·직접 만든 지표 입력(0359a) 읽기·쓰기.
 *
 * 🔴 두 표 모두 정책이 0개다 — admin 클라이언트로만, **모든 조회·쓰기에 tenant_id**(#104).
 * 🔴 표가 아직 없으면(SQL 적용 전) 읽기는 기본 설정·빈 입력으로 돌려준다 — 집계와 화면이 죽지 않는다(#95).
 */
const SETTINGS = "teacher_evaluation_settings";
const ENTRIES = "teacher_evaluation_entries";

const missingTable = (err: { code?: string | null; message?: string | null } | null | undefined, table: string) =>
  Boolean(err) && (err!.code === "42P01" || err!.code === "PGRST205" || ((err!.message ?? "").includes(table) && /does not exist|schema cache|could not find/i.test(err!.message ?? "")));
/** 칸이 아직 없다(0359a 전의 raws). */
export const missingColumn = (err: { code?: string | null; message?: string | null } | null | undefined) =>
  Boolean(err) && (err!.code === "42703" || err!.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(err!.message ?? ""));

export type LoadedEvaluation = { config: EvaluationConfig; saved: boolean; tableMissing: boolean; updatedAt: string | null };

export async function loadEvaluationConfig(admin: SupabaseClient, tenantId: string): Promise<LoadedEvaluation> {
  const { data, error } = await admin.from(SETTINGS).select("config, updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    if (missingTable(error, SETTINGS)) return { config: DEFAULT_EVALUATION_CONFIG, saved: false, tableMissing: true, updatedAt: null };
    throw new Error(`강사평가 설정 조회 실패: ${error.message}`);
  }
  return {
    config: data ? resolveEvaluationConfig(data.config) : DEFAULT_EVALUATION_CONFIG,
    saved: Boolean(data), tableMissing: false, updatedAt: (data?.updated_at as string | null) ?? null,
  };
}

export async function saveEvaluationConfig(admin: SupabaseClient, tenantId: string, config: EvaluationConfig, userId: string): Promise<void> {
  const { error } = await admin.from(SETTINGS).upsert(
    { tenant_id: tenantId, config, updated_by: userId, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(missingTable(error, SETTINGS) ? "강사평가 설정 표가 아직 준비되지 않았습니다" : `강사평가 설정 저장 실패: ${error.message}`);
}

export async function loadManualEntries(admin: SupabaseClient, tenantId: string, months: readonly string[]): Promise<ManualEntryRow[]> {
  if (!months.length) return [];
  try {
    return await fetchAllPaged<ManualEntryRow>((from, to) =>
      admin.from(ENTRIES).select("teacher_id, month, metric_key, value, note").eq("tenant_id", tenantId).in("month", [...months])
        .order("teacher_id").order("month").order("metric_key").range(from, to));
  } catch (e) {
    if (missingTable({ message: e instanceof Error ? e.message : String(e) }, ENTRIES)) return [];
    throw e;
  }
}

/** 한 강사 · 한 달의 입력(직접 입력 창이 여는 순간의 값 — 포트폴리오 행은 다시 매기기 전이라 늦을 수 있다). */
export async function loadTeacherEntries(admin: SupabaseClient, tenantId: string, teacherId: string, month: string): Promise<ManualEntryRow[]> {
  const { data, error } = await admin.from(ENTRIES).select("teacher_id, month, metric_key, value, note")
    .eq("tenant_id", tenantId).eq("teacher_id", teacherId).eq("month", month).order("metric_key").limit(100);
  if (error) {
    if (missingTable(error, ENTRIES)) return [];
    throw new Error(`지표 입력 조회 실패: ${error.message}`);
  }
  return (data ?? []) as ManualEntryRow[];
}

export type EntryInput = { teacherId: string; metricKey: string; value: number | null; note: string | null };

/** 한 달의 입력을 저장한다 — 값과 메모가 둘 다 비면 그 줄을 지운다. */
export async function saveManualEntries(admin: SupabaseClient, tenantId: string, month: string, rows: readonly EntryInput[], userId: string): Promise<{ saved: number; cleared: number }> {
  const keep = rows.filter((r) => r.value !== null || (r.note ?? "").trim());
  const clear = rows.filter((r) => r.value === null && !(r.note ?? "").trim());
  const enteredAt = new Date().toISOString();
  for (let i = 0; i < keep.length; i += 200) {
    const { error } = await admin.from(ENTRIES).upsert(keep.slice(i, i + 200).map((r) => ({
      tenant_id: tenantId, teacher_id: r.teacherId, month, metric_key: r.metricKey, value: r.value, note: r.note?.trim() || null,
      entered_by: userId, entered_at: enteredAt,
    })), { onConflict: "tenant_id,teacher_id,month,metric_key" });
    if (error) throw new Error(missingTable(error, ENTRIES) ? "직접 만든 지표 표가 아직 준비되지 않았습니다" : `지표 입력 저장 실패: ${error.message}`);
  }
  for (const r of clear) {
    const { error } = await admin.from(ENTRIES).delete().eq("tenant_id", tenantId).eq("teacher_id", r.teacherId).eq("month", month).eq("metric_key", r.metricKey);
    if (error) throw new Error(`지표 입력 정리 실패: ${error.message}`);
  }
  return { saved: keep.length, cleared: clear.length };
}

export type PreviewRow = { teacherId: string; month: string; raws: Record<string, number | null> };

/** 설정 미리보기 재료 — 그 달 강사별 원래 수치. raws 칸이 없으면(0359a 전) 빈 목록. */
export async function loadPreviewRaws(admin: SupabaseClient, tenantId: string, month: string): Promise<PreviewRow[]> {
  const { data, error } = await admin.from("teacher_portfolio_months").select("teacher_id, month, raws")
    .eq("tenant_id", tenantId).eq("month", month).order("teacher_id").limit(500);
  if (error) {
    if (missingColumn(error) || missingTable(error, "teacher_portfolio_months")) return [];
    throw new Error(`미리보기 조회 실패: ${error.message}`);
  }
  return (data ?? []).filter((r) => r.raws).map((r) => ({ teacherId: r.teacher_id as string, month: r.month as string, raws: r.raws as Record<string, number | null> }));
}
