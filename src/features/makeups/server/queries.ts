import "server-only";
import { cache } from "react";
import type { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/supabase/db-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { caseListSchema, caseDetailSchema, optionPageSchema, candidatePageSchema, dryRunPageSchema, eventPageSchema, reconciliationPageSchema, type ReadResult } from "./read-types";

async function readRpc<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<ReadResult<T>> {
  const actor = await getCurrentUser();
  if (!actor || !(await canAccessTenant(actor.systemRole, "makeups"))) return { error: "보강관리 조회 권한이 없습니다" };
  if ((await getTenantSettings()).makeups.mode === "off") return { error: "보강관리 운영이 중지되어 있습니다" };
  const db = await createClient();
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const info = describeDbError(error, { fallback: "보강 기록을 불러오지 못했습니다. 다시 시도해 주세요." });
    console.error(`[makeups] ${name} 조회 실패`, error.code);
    return { error: info.kind === "schema" ? "보강관리 DB 설정을 적용한 뒤 사용할 수 있습니다" : info.message };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[makeups] ${name} 응답 형식 오류`, parsed.error.issues.map(issue => issue.path));
    return { error: "보강 기록의 형식을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요." };
  }
  return { data: parsed.data };
}

/** Request-local only: authorization must be reevaluated on every request. */
export const getMakeupCases = cache(async (filter: Record<string, unknown>) =>
  readRpc("makeup_list_cases", { p_filter: filter }, caseListSchema));
export const getMakeupCaseDetail = cache(async (caseId: string) =>
  readRpc("makeup_case_detail", { p_case_id: caseId }, caseDetailSchema));

export async function getMakeupOptions(filter: Record<string, unknown>) {
  return readRpc("makeup_options", { p_filter: filter }, optionPageSchema);
}

export async function getMakeupCandidates(filter: Record<string, unknown>) {
  return readRpc("makeup_candidates", { p_filter: filter }, candidatePageSchema);
}

export async function getMakeupLegacyDryRun(filter: Record<string, unknown>) {
  return readRpc("makeup_legacy_dry_run", { p_filter: filter }, dryRunPageSchema);
}

export async function getMakeupEvents(caseId: string, page: number) {
  return readRpc("makeup_case_events", { p_case_id: caseId, p_filter: { page, page_size: 50 } }, eventPageSchema);
}

export async function getMakeupReconciliation(filter: Record<string, unknown>) {
  return readRpc("makeup_list_reconciliation", { p_filter: filter }, reconciliationPageSchema);
}
