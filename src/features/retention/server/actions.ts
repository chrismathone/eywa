"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { explainDbError } from "@/lib/supabase/db-error";

export type LogActionState = { ok?: boolean; error?: string } | undefined;

// 🔑 행위자 = `getCurrentUser({ teacherView: true })` — '다른 강사 뷰'면 대상 직원 X(원장 2026-11-05 강사뷰 전수).
//    조치 기록·캠페인의 담당(counselor_id)이 X여야 X의 상담 목록·퇴원보고서 상담 연결 후보(counselor_id 축)에 뜬다.
//    감사로그 행위자는 logAction이 실제 계정으로 남긴다. 두 표의 RLS는 지점 격리뿐이라 세션 클라이언트로 X 명의 저장이 된다.

/**
 * 이탈 방어 조치 기록 → aywa 학생상담(student_consultations)에 적재.
 * 부원장의 "조치 타임라인"을 별도 테이블 없이 aywa 상담 기록과 한 몸으로 만든다.
 * follow_up_date를 주면 그게 곧 다음 연락 예정일(브리핑·캘린더 연동).
 */
export async function logRetentionAction(
  _prev: LogActionState,
  formData: FormData,
): Promise<LogActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "retention"))) return { error: "이탈 방어 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const followUpDate = String(formData.get("followUpDate") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (summary.length < 2) return { error: "조치 내용을 입력해주세요" };

  const supabase = await createClient();
  const { data: created, error } = await supabase.from("student_consultations").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    counselor_id: user.id,
    consulted_at: new Date().toISOString(),
    category: "general",
    audience: "parent",
    summary,
    follow_up_date: followUpDate,
    follow_up_done: false,
  }).select("id").single();
  if (error) return { error: explainDbError(error, { scope: "retention.actions.logRetentionAction", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 🔴 요약 본문은 담지 않는다(상담 내용 금지) — 학생상담 기록(student_consultation_create)과 같은 규약.
  //    대상 열의 학생 이름은 metadata.studentId를 뷰어가 해석한다(auditTargetName).
  await logAction({
    action: "retention_action_create",
    targetType: "student_consultation",
    metadata: {
      consultationId: created?.id ?? null,
      studentId,
      source: "retention",
      followUpDate,
    },
  });

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "retention"))) return { ok: false, error: "이탈 방어 권한이 없습니다" };
  if (!studentId) return { ok: false, error: "학생 ID가 누락되었습니다" };
  const supabase = await createClient();
  const { error } = await supabase.from("reenrollment_campaign_targets").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    status: "pending",
    counselor_id: user.id,
    trigger_reason: "renewal_risk",
  });
  if (error) return { ok: false, error: explainDbError(error, { scope: "retention.actions.campaignAdd", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  await logAction({
    action: "retention_campaign_add",
    targetType: "campaign_target",
    metadata: { studentId, triggerReason: "renewal_risk" },
  });
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}

/** 캠페인 대상 상태 전환(대상→연락함→재등록|이탈). contacted/decided 타임스탬프 기록. */
export async function campaignSetStatus(targetId: string, status: string): Promise<CampaignResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "retention"))) return { ok: false, error: "이탈 방어 권한이 없습니다" };
  if (!targetId || !CAMPAIGN_STATUSES.includes(status)) return { ok: false, error: "잘못된 요청입니다" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "contacted") patch.contacted_at = new Date().toISOString();
  if (status === "enrolled" || status === "declined") patch.decided_at = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("reenrollment_campaign_targets")
    .update(patch)
    .eq("id", targetId)
    .select("student_id"); // 추가 왕복 없이 로그용 학생 id 확보 + 0행이면 안 남긴다
  if (error) return { ok: false, error: explainDbError(error, { scope: "retention.actions.campaignSetStatus", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (updated?.length) {
    await logAction({
      action: "retention_campaign_status",
      targetType: "campaign_target",
      metadata: { studentId: updated[0].student_id, targetId, status },
    });
  }
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}

/** 캠페인에서 대상 제거. */
export async function campaignRemove(targetId: string): Promise<CampaignResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "retention"))) return { ok: false, error: "이탈 방어 권한이 없습니다" };
  if (!targetId) return { ok: false, error: "대상 ID가 누락되었습니다" };
  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("reenrollment_campaign_targets")
    .delete()
    .eq("id", targetId)
    .select("student_id, status");
  if (error) return { ok: false, error: explainDbError(error, { scope: "retention.actions.campaignRemove", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
  const gone = removed?.[0];
  if (gone) {
    // 🔴 학생 이름을 그 자리에서 굳힌다 — 나중에 그 학생이 삭제되면 id로는 아무것도 못 읽는다.
    //    조회 실패해도 기록은 남긴다(이름만 빠진 채로 — 삭제 흔적이 사라지는 쪽이 훨씬 나쁘다).
    const { data: stu } = await supabase
      .from("students")
      .select("name")
      .eq("id", gone.student_id)
      .maybeSingle();
    await logAction({
      action: "retention_campaign_remove",
      targetType: "campaign_target",
      targetLabel: stu?.name ?? null,
      metadata: { studentId: gone.student_id, targetId, status: gone.status },
    });
  }
  revalidatePath("/retention/campaign");
  revalidatePath("/retention");
  return { ok: true };
}
