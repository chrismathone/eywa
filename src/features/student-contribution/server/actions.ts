"use server";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { familyBonus } from "../model/family-loyalty";
import { sumRaws, scoreRaws } from "../model/calc";
import { configForStorage, contributionConfigSchema } from "../model/config";
import { requireContributionWrite } from "./access";
import { getContributionList } from "./queries";
import { contributionReady, loadContributionSettings, SETTINGS_TABLE, SIGNALS_TABLE } from "./store";
import { refreshStudentContribution } from "./refresh";
import { contributionSnapshotTag } from "./snapshot-cache";
import { hasApprovedParentEventImport } from "./parent-events";

function invalidate() { revalidatePath("/student-contribution"); revalidatePath("/students", "layout"); revalidatePath("/owner"); }
const message = (error: unknown) => error instanceof Error ? error.message : "작업을 완료하지 못했습니다";
export async function saveContributionSettings(value: unknown, revision: number) {
  try {
    const gate = await requireContributionWrite(), config = contributionConfigSchema.parse(value);
    const db = createAdminClient();
    if (!(await contributionReady(db, gate.tenantId))) throw new Error("기여도 저장 준비가 필요합니다");
    const [before, list] = await Promise.all([loadContributionSettings(db, gate.tenantId), getContributionList()]);
    if (!before.config.rates.parentSeminarEvents.enabled && config.rates.parentSeminarEvents.enabled && !(await hasApprovedParentEventImport(db, gate.tenantId)))
      throw new Error("설명회 자료와 배점의 반영 범위를 확인한 뒤 사용할 수 있습니다");
    if (before.revision !== revision) throw new Error("설정이 바뀌었습니다. 새로고침 후 다시 저장해 주세요");
    const raws = sumRaws((list?.rows ?? []).flatMap((r) => r.total ? [r.total.raws] : []));
    const familySum = (c: typeof config) => (list?.rows ?? []).reduce((s,r)=>s+(familyBonus(r.family,c)??0),0);
    const prevScore = scoreRaws(raws, before.config).total + familySum(before.config), nextScore = scoreRaws(raws, config).total + familySum(config);
    const initial = await db.from(SETTINGS_TABLE).upsert({ tenant_id: gate.tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
    if (initial.error) throw new Error("기여도 설정 준비에 실패했습니다");
    const { data, error } = await db.from(SETTINGS_TABLE).update({ config: configForStorage(config), revision: revision + 1, updated_by: gate.userId, updated_at: new Date().toISOString() })
      .eq("tenant_id", gate.tenantId).eq("revision", revision).is("refresh_token", null).select("revision").maybeSingle();
    if (error) throw new Error("설정을 저장하지 못했습니다");
    if (!data) throw new Error("집계 중이거나 설정이 바뀌었습니다. 집계가 끝난 뒤 다시 저장해 주세요");
    await logAction({ action: "student_contribution_settings_save", targetType: "student_contribution", targetLabel: "원생 로열티",
      metadata: { before: before.config, after: config, beforeTotal: prevScore, afterTotal: nextScore, students: list?.rows.length ?? 0 } });
    invalidate();
    return { ok: true, message: "배점이 지난 실적 전체에 반영되었습니다. 인정 기준을 바꿨다면 지금 집계를 눌러 주세요." };
  } catch (error) { return { error: message(error) }; }
}
export async function refreshContribution() {
  try {
    const gate = await requireContributionWrite();
    let summary;
    try { summary = await refreshStudentContribution(createAdminClient(), gate.tenantId, { deadline: Date.now() + 85_000 }); }
    finally { updateTag(contributionSnapshotTag(gate.tenantId)); }
    await logAction({ action: "student_contribution_refresh", targetType: "student_contribution", targetLabel: "원생 로열티", metadata: { ...summary, trigger: "manual" } });
    invalidate();
    return { ok: true, message: summary.unavailable ? "기여도 저장 준비가 필요합니다" : summary.busy ? "다른 집계가 진행 중입니다" : summary.complete
      ? `${summary.students}명 집계 · ${summary.closed}개 월 기록 마감` : `${summary.written}개 월 기록 저장 · 다음 집계에서 이어집니다` };
  } catch (error) { return { error: message(error) }; }
}
export async function changePositiveSignal(input: { id: string; operation: "cancel" | "rejudge"; reason: string }) {
  try {
    const gate = await requireContributionWrite();
    const value = z.object({ id: z.string().uuid(), operation: z.enum(["cancel", "rejudge"]), reason: z.string().trim().min(2).max(500) }).parse(input);
    const db = createAdminClient();
    const { data: before, error: readError } = await db.from(SIGNALS_TABLE).select("id, student_id, classification, evidence, cancelled_at, judged_at")
      .eq("tenant_id", gate.tenantId).eq("id", value.id).maybeSingle();
    if (readError || !before) throw new Error("판정 기록을 찾지 못했습니다");
    if (value.operation === "cancel" && before.cancelled_at) throw new Error("이미 취소한 판정입니다");
    const patch = value.operation === "cancel" ? { cancelled_at: new Date().toISOString(), cancelled_by: gate.userId, cancel_reason: value.reason }
      : { rejudge_requested_at: new Date().toISOString() };
    const { data, error } = await db.from(SIGNALS_TABLE).update(patch).eq("tenant_id", gate.tenantId).eq("id", value.id)
      .eq("judged_at", before.judged_at).select("id").maybeSingle();
    if (error || !data) throw new Error("판정이 바뀌었습니다. 새로고침 후 다시 시도해 주세요");
    await logAction({ action: value.operation === "cancel" ? "student_contribution_signal_cancel" : "student_contribution_signal_rejudge",
      targetType: "student_contribution", targetLabel: "긍정 신호", metadata: { id: value.id, studentId: before.student_id, before, reason: value.reason } });
    invalidate();
    return { ok: true, message: value.operation === "cancel" ? "판정을 취소했습니다. 다음 집계에서 정정에 반영됩니다." : "다음 밤 배치에서 다시 판정합니다. 기존 취소 이력은 유지됩니다." };
  } catch (error) { return { error: message(error) }; }
}
