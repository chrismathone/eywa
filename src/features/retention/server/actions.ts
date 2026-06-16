"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export type LogActionState = { ok?: boolean; error?: string } | undefined;

/**
 * 이탈 방어 조치 기록 → eywa 학생상담(student_consultations)에 적재.
 * 부원장의 "조치 타임라인"을 별도 테이블 없이 eywa 상담 기록과 한 몸으로 만든다.
 * follow_up_date를 주면 그게 곧 다음 연락 예정일(브리핑·캘린더 연동).
 */
export async function logRetentionAction(
  _prev: LogActionState,
  formData: FormData,
): Promise<LogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const followUpDate = String(formData.get("followUpDate") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (summary.length < 2) return { error: "조치 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_consultations").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    counselor_id: user.id,
    consulted_at: new Date().toISOString(),
    category: "general",
    audience: "parent",
    summary,
    follow_up_date: followUpDate,
    follow_up_done: false,
  });
  if (error) return { error: error.message };

  revalidatePath("/retention");
  revalidatePath("/retention/messages");
  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

// ─────────────────── 재등록 캠페인 (reenrollment_campaign_targets) ───────────────────
// 클라 컴포넌트에서 startTransition으로 직접 호출(평범한 인자). 모두 RLS로 테넌트 격리.
export type CampaignResult = { ok: boolean; error?: string };

const CAMPAIGN_STATUSES = ["pending", "contacted", "enrolled", "declined"];

/** 후보 학생을 캠페인에 추가(status=pending). 학생당 1트랙(unique 제약). */
export async function campaignAdd(studentId: string): Promise<CampaignResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!studentId) return { ok: false, error: "학생 ID가 누락되었습니다" };
  const supabase = await createClient();
  const { error } = await supabase.from("reenrollment_campaign_targets").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    status: "pending",
    counselor_id: user.id,
    trigger_reason: "renewal_risk",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}

/** 캠페인 대상 상태 전환(대상→연락함→재등록|이탈). contacted/decided 타임스탬프 기록. */
export async function campaignSetStatus(targetId: string, status: string): Promise<CampaignResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!targetId || !CAMPAIGN_STATUSES.includes(status)) return { ok: false, error: "잘못된 요청입니다" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "contacted") patch.contacted_at = new Date().toISOString();
  if (status === "enrolled" || status === "declined") patch.decided_at = new Date().toISOString();
  const { error } = await supabase
    .from("reenrollment_campaign_targets")
    .update(patch)
    .eq("id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}

/** 캠페인에서 대상 제거. */
export async function campaignRemove(targetId: string): Promise<CampaignResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!targetId) return { ok: false, error: "대상 ID가 누락되었습니다" };
  const supabase = await createClient();
  const { error } = await supabase.from("reenrollment_campaign_targets").delete().eq("id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}
