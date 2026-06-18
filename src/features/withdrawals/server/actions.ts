"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  type WithdrawalConsultation,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "../types";

const REASONS: WithdrawalReason[] = [
  "graduated",
  "relocation",
  "competitor",
  "financial",
  "schedule",
  "dissatisfaction",
  "other",
];

const CONSULTATION_KEYS: (keyof WithdrawalConsultation)[] = [
  "adminCalledParent",
  "teacherCalledParent",
  "talkedWithStudent",
];

export type WithdrawalReasonState = { error?: string } | undefined;

/** 사유 카테고리 + 메모 저장 */
export async function updateWithdrawalReason(
  _prev: WithdrawalReasonState,
  formData: FormData,
): Promise<WithdrawalReasonState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!REASONS.includes(reasonStr as WithdrawalReason)) {
    return { error: "유효한 퇴원 사유를 선택해주세요" };
  }

  const supabase = await createClient();

  // Read current metadata, preserve consultation flags
  const { data: cur } = await supabase
    .from("students")
    .select("withdrawal_metadata, status")
    .eq("id", studentId)
    .single();

  if (!cur) return { error: "학생을 찾을 수 없습니다" };
  if (cur.status !== "withdrawn") return { error: "퇴원 상태가 아닙니다" };

  const existing = (cur.withdrawal_metadata as Partial<WithdrawalMetadata> | null) ?? DEFAULT_WITHDRAWAL_METADATA;
  const next: WithdrawalMetadata = {
    reason: reasonStr as WithdrawalReason,
    memo,
    consultation: {
      adminCalledParent: !!existing.consultation?.adminCalledParent,
      teacherCalledParent: !!existing.consultation?.teacherCalledParent,
      talkedWithStudent: !!existing.consultation?.talkedWithStudent,
    },
  };

  const { error } = await supabase
    .from("students")
    .update({ withdrawal_metadata: next })
    .eq("id", studentId);

  if (error) return { error: error.message };

  await logAction({
    action: "withdrawal_update",
    targetType: "student",
    metadata: { studentId, reason: reasonStr },
  });
  revalidatePath(`/withdrawals/${studentId}`);
  revalidatePath("/withdrawals");
  return undefined;
}

export type ConsultationToggleState = { error?: string } | undefined;

/** 상담 추적 boolean toggle (적용 후 새 상태를 immediately persist) */
export async function toggleConsultationStep(
  _prev: ConsultationToggleState,
  formData: FormData,
): Promise<ConsultationToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const step = String(formData.get("step") ?? "").trim() as keyof WithdrawalConsultation;
  const next = String(formData.get("next") ?? "false") === "true";

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!CONSULTATION_KEYS.includes(step)) {
    return { error: "유효한 상담 단계가 아닙니다" };
  }

  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("students")
    .select("withdrawal_metadata, status")
    .eq("id", studentId)
    .single();

  if (!cur) return { error: "학생을 찾을 수 없습니다" };
  if (cur.status !== "withdrawn") return { error: "퇴원 상태가 아닙니다" };

  const existing = (cur.withdrawal_metadata as Partial<WithdrawalMetadata> | null) ?? DEFAULT_WITHDRAWAL_METADATA;
  const updated: WithdrawalMetadata = {
    reason: existing.reason ?? "other",
    memo: existing.memo ?? null,
    consultation: {
      adminCalledParent: !!existing.consultation?.adminCalledParent,
      teacherCalledParent: !!existing.consultation?.teacherCalledParent,
      talkedWithStudent: !!existing.consultation?.talkedWithStudent,
      [step]: next,
    },
  };

  const { error } = await supabase
    .from("students")
    .update({ withdrawal_metadata: updated })
    .eq("id", studentId);

  if (error) return { error: error.message };

  revalidatePath(`/withdrawals/${studentId}`);
  return undefined;
}

export type ReactivateState = { error?: string } | undefined;

/** 재원 복구: status=enrolled, withdrawnAt=null, withdrawal_metadata=null */
export async function reactivateStudent(
  _prev: ReactivateState,
  formData: FormData,
): Promise<ReactivateState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({
      status: "enrolled",
      withdrawn_at: null,
      withdrawal_metadata: null,
    })
    .eq("id", studentId);

  if (error) return { error: error.message };

  revalidatePath("/withdrawals");
  revalidatePath(`/students/${studentId}`);
  return undefined;
}
