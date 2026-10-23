import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { kstToday } from "@/lib/date-kst";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { CONTRIBUTION_PILOT_TENANT } from "../model/access";
import { assembleContribution } from "../model/assemble";
import { contributionReady, loadContributionMonths, loadContributionSettings, saveContributionMonths, SETTINGS_TABLE } from "./store";
import { loadCoreSources, loadHistoricalBills } from "./core-sources";
import { loadActivities } from "./activity-sources";
import { judgeStudentPositiveSignals } from "./positive-job";
import { loadContributionLessonTeachers } from "./subject-evidence";

export async function refreshStudentContribution(db: SupabaseClient, tenant: string, options: { nightly?: boolean; now?: Date; deadline?: number } = {}) {
  const result = { written: 0, closed: 0, students: 0, complete: false, unavailable: false, busy: false, judged: 0 };
  if (tenant !== CONTRIBUTION_PILOT_TENANT || !(await isLaboratoryMenuAvailable(tenant, "student_contribution"))) throw new Error("기여도 집계를 사용할 수 없습니다");
  if (!(await contributionReady(db, tenant))) return { ...result, unavailable: true };
  const { data: token, error: claimError } = await db.rpc("claim_student_contribution_refresh", { p_tenant: tenant });
  if (claimError) throw new Error(`집계 시작 실패: ${claimError.message}`);
  if (!token) return { ...result, busy: true };
  const deadline = options.deadline ?? Date.now() + 240_000;
  try {
    // AI는 밤 배치에서만. 앞부분 예산만 써서 원자료 집계·저장 시간을 남긴다.
    if (options.nightly) result.judged = (await judgeStudentPositiveSignals(db, tenant, Math.min(Date.now() + 75_000, deadline - 120_000))).judged;
    if (Date.now() >= deadline - 30_000) return result;
    const [config, settings, core, stored] = await Promise.all([loadContributionSettings(db, tenant),
      getTenantSettingsByTenantId(tenant, { failOnReadError: true }), loadCoreSources(db, tenant), loadContributionMonths(db, tenant)]);
    const now = options.now ?? new Date(), today = kstToday(now);
    const [activity, history] = await Promise.all([loadActivities(db, tenant, today, core), loadHistoricalBills(db, tenant, core.historyLinks)]);
    core.lessonTeachers = await loadContributionLessonTeachers(db, tenant, core, history, settings.operations.subjects);
    const built = assembleContribution({ tenant, today, capturedAt: now.toISOString(), core, activity, settings, config: config.config, stored, history, historyReady: config.historyReady });
    const frozen = new Set(stored.filter((r) => r.closedAt).map((r) => `${r.studentId}:${r.month}`));
    const changed = built.rows.filter((r) => !frozen.has(`${r.studentId}:${r.month}`));
    const saved = await saveContributionMonths(db, tenant, token, config.revision, changed, deadline);
    result.written = saved.written; result.students = built.roster.length; result.closed = saved.closed;
    const { error } = await db.from(SETTINGS_TABLE).update({ referral_review: { ...built.backfill, checkedAt: now.toISOString() } })
      .eq("tenant_id", tenant).eq("refresh_token", token).eq("revision", config.revision);
    if (error) throw new Error(`소개 확인 목록 저장 실패: ${error.message}`);
    result.complete = saved.complete;
    return result;
  } finally {
    const { error } = await db.rpc("finish_student_contribution_refresh", { p_tenant: tenant, p_token: token, p_success: result.complete });
    if (error) throw new Error(`집계 종료 기록 실패: ${error.message}`);
  }
}
