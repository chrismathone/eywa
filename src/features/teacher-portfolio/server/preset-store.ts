import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEvaluationConfig, type EvaluationConfig } from "../evaluation/config";

/**
 * 강사평가 구성 저장·불러오기(0360a) — 원장이 이름 붙여 저장한 구성 목록.
 * 🔴 정책이 0개인 표 — admin 클라이언트로만, 모든 조회·쓰기에 tenant_id(#104).
 * 🔴 표가 아직 없으면(SQL 적용 전) 목록은 비어 있고 저장만 준비 안내(#95).
 */
const TABLE = "teacher_evaluation_presets";
export const PRESET_LIMIT = 20;

export type SavedPreset = { id: string; name: string; config: EvaluationConfig; createdAt: string };

const missingTable = (err: { code?: string | null; message?: string | null } | null | undefined) =>
  Boolean(err) && (err!.code === "42P01" || err!.code === "PGRST205" || ((err!.message ?? "").includes(TABLE) && /does not exist|schema cache|could not find/i.test(err!.message ?? "")));

export async function loadPresets(admin: SupabaseClient, tenantId: string): Promise<{ presets: SavedPreset[]; tableMissing: boolean }> {
  const { data, error } = await admin.from(TABLE).select("id, name, config, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(PRESET_LIMIT);
  if (error) {
    if (missingTable(error)) return { presets: [], tableMissing: true };
    throw new Error(`강사평가 구성 목록 조회 실패: ${error.message}`);
  }
  return {
    // 저장된 구성도 지금 규칙으로 다시 해석한다(그 뒤에 더한 기본 지표가 빠져 있어도 화면이 깨지지 않게).
    presets: (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, config: resolveEvaluationConfig(r.config), createdAt: r.created_at as string })),
    tableMissing: false,
  };
}

/** 같은 이름이 있으면 그 구성을 새 내용으로 바꾼다(덮어쓰기는 화면이 먼저 묻는다). */
export async function savePreset(admin: SupabaseClient, tenantId: string, name: string, config: EvaluationConfig, userId: string): Promise<"saved" | "full"> {
  const { count, error: countError } = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("name", name);
  if (countError) throw new Error(missingTable(countError) ? "강사평가 구성 표가 아직 준비되지 않았습니다" : `강사평가 구성 저장 실패: ${countError.message}`);
  if ((count ?? 0) >= PRESET_LIMIT) return "full";
  const { error } = await admin.from(TABLE).upsert(
    { tenant_id: tenantId, name, config, created_by: userId, created_at: new Date().toISOString() },
    { onConflict: "tenant_id,name" },
  );
  if (error) throw new Error(missingTable(error) ? "강사평가 구성 표가 아직 준비되지 않았습니다" : `강사평가 구성 저장 실패: ${error.message}`);
  return "saved";
}

export async function deletePreset(admin: SupabaseClient, tenantId: string, id: string): Promise<string | null> {
  const { data, error } = await admin.from(TABLE).delete().eq("tenant_id", tenantId).eq("id", id).select("name");
  if (error) throw new Error(missingTable(error) ? "강사평가 구성 표가 아직 준비되지 않았습니다" : `강사평가 구성 삭제 실패: ${error.message}`);
  return (data?.[0]?.name as string | undefined) ?? null;
}
