"use server";

import { seatBlockReason } from "@/lib/license/server";
import { revalidatePath } from "next/cache";
import {
  clearOnHoldForActiveEnrollments,
  reopenEnrollmentsClosedByWithdrawal,
  syncWithdrawalEnrollmentReasons,
} from "@/features/students/server/enrollment-sync";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  WITHDRAWAL_REASONS,
  type WithdrawalConsultation,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "../types";
import { logDbError, explainDbError } from "@/lib/supabase/db-error";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { STUDENT_STATUS_DENIED } from "@/features/students/status-access";
import { checkReasonInput } from "../reason-detail";

const REASONS: readonly WithdrawalReason[] = WITHDRAWAL_REASONS;

const CONSULTATION_KEYS: (keyof WithdrawalConsultation)[] = [
  "adminCalledParent",
  "teacherCalledParent",
  "talkedWithStudent",
];

export type WithdrawalReasonState = { error?: string; ok?: boolean } | undefined;

/** 사유 카테고리 + 메모 저장 */
export async function updateWithdrawalReason(
  _prev: WithdrawalReasonState,
  formData: FormData,
): Promise<WithdrawalReasonState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "withdrawals"))) return { error: "퇴원 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const detailStr = String(formData.get("detail") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!REASONS.includes(reasonStr as WithdrawalReason)) {
    return { error: "유효한 퇴원 사유를 선택해주세요" };
  }
  // 세부 사유(선택)는 그 대분류의 것만 · '기타'는 메모 필수(원장 2026-10-15 사유 2단계).
  const checked = checkReasonInput({ reason: reasonStr as WithdrawalReason, detail: detailStr, memo });
  if (checked.error !== undefined) return { error: checked.error };

  const supabase = await createClient();

  // Read current metadata, preserve consultation flags
  const { data: cur } = await supabase
    .from("students")
    .select("withdrawal_metadata, status, withdrawn_at")
    .eq("id", studentId)
    .single();

  if (!cur) return { error: "학생을 찾을 수 없습니다" };
  if (cur.status !== "withdrawn") return { error: "퇴원 상태가 아닙니다" };

  const existing = (cur.withdrawal_metadata as Partial<WithdrawalMetadata> | null) ?? DEFAULT_WITHDRAWAL_METADATA;
  // 다른 칸(퇴원보고서 번호 등)은 그대로 두고 사유·세부·메모만 바꾼다 — 세부를 고르지 않았으면 지운다.
  const { detail: _oldDetail, ...rest } = existing;
  void _oldDetail;
  const next: WithdrawalMetadata = {
    ...rest,
    reason: reasonStr as WithdrawalReason,
    ...(checked.detail ? { detail: checked.detail } : {}),
    memo,
    consultation: {
      adminCalledParent: !!existing.consultation?.adminCalledParent,
      teacherCalledParent: !!existing.consultation?.teacherCalledParent,
      talkedWithStudent: !!existing.consultation?.talkedWithStudent,
    },
  };

  // 그 퇴원이 함께 닫은 수강의 사유도 같은 사유로(퇴원율·시간표 X가 수강 사유도 읽는다 — 학생 사유만 바꾸면 숫자가 그대로다).
  // 🔴 학생보다 **먼저** — 학생을 먼저 바꾸면 수강 쪽이 실패한 뒤 다시 눌렀을 때 옛 사유를 몰라 영영 못 맞춘다.
  const synced = await syncWithdrawalEnrollmentReasons(
    supabase,
    studentId,
    (cur.withdrawn_at as string | null) ?? null,
    existing.reason,
    reasonStr,
  );
  if (synced.error) return { error: synced.error };

  const { error } = await supabase
    .from("students")
    .update({ withdrawal_metadata: next })
    .eq("id", studentId);

  if (error) return { error: explainDbError(error, { scope: "withdrawals.actions.updateWithdrawalReason", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "withdrawal_update",
    targetType: "student",
    metadata: { studentId, reason: reasonStr, detail: checked.detail, enrollments: synced.count },
  });
  revalidatePath(`/withdrawals/${studentId}`);
  revalidatePath("/withdrawals");
  // 성공을 undefined로 돌리면 useActionState 소비처가 성공을 감지할 수 없다(성공 시 초안 삭제가 죽는다).
  return { ok: true };
}

export type ConsultationToggleState = { error?: string } | undefined;

/** 상담 추적 boolean toggle (적용 후 새 상태를 immediately persist) */
export async function toggleConsultationStep(
  _prev: ConsultationToggleState,
  formData: FormData,
): Promise<ConsultationToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "withdrawals"))) return { error: "퇴원 관리 권한이 없습니다" };

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
  // 🔴 상담 칸만 바꾼다 — 메타데이터를 새로 지으면 세부 사유(detail)·퇴원보고서 번호 등 다른 칸이 지워진다.
  const updated: WithdrawalMetadata = {
    ...existing,
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

  if (error) {
    logDbError(error, "withdrawals.toggleConsultationStep");
    return { error: "상담 추적을 저장하지 못했습니다" };
  }

  // 누가 학부모 통화를 켜고 껐는지 남긴다(감사 M3 — 사유 저장·신규생 체크와 같은 결).
  await logAction({
    action: "withdrawal_consultation_step",
    targetType: "student",
    metadata: { studentId, step, done: next },
  });

  revalidatePath(`/withdrawals/${studentId}`);
  revalidatePath("/withdrawals");
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
  if (!(await canWriteTenant(user.systemRole, "withdrawals"))) return { error: "퇴원 관리 권한이 없습니다" };
  // 🔴 재원 복구는 **학생 기록 변경**이다 — 원생 상세의 재원 전환과 같은 문(students full)을 함께 요구한다(감사 S6).
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };
  //    퇴원관리만 full인 경리 계정이 여기서만 학생을 재원으로 되돌릴 수 있었다(#77).
  if (!(await canManageTenant(user.systemRole, "students"))) {
    return { error: "재원 복구 권한이 없습니다 — 원생 정보 변경 권한이 필요합니다" };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  {
    const seat = await seatBlockReason(user.tenantId, 1, [studentId]);
    if (seat) return { error: seat };
  }

  const supabase = await createClient();
  // 되돌릴 대상 판정을 위해 퇴원일을 먼저 읽는다 — 퇴원이 닫은 수강(end_date=퇴원일)만 다시 연다.
  const { data: cur } = await supabase
    .from("students")
    .select("status, withdrawn_at")
    .eq("id", studentId)
    .maybeSingle();
  // 퇴원 상태만 복구한다 — 퇴원 예약(상태 재원·휴원 + 퇴원일) 학생은 원생 상세 '퇴원 예약 취소'로 푼다(원장 2026-09-28).
  if (cur?.status !== "withdrawn") return { error: "퇴원 상태가 아닙니다. 화면을 새로고침해 주세요." };
  const withdrawnDate = cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;

  const { error } = await supabase
    .from("students")
    .update({
      status: "enrolled",
      withdrawn_at: null,
      withdrawal_metadata: null,
    })
    .eq("id", studentId);

  if (error) {
    logDbError(error, "withdrawals.reactivateStudent");
    return { error: "재원 복구에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // ⚠️ students만 되돌리면 수강은 종료된 채로 남아 시간표 셀 '퇴원' 섹션에 계속 뜨고 휴원도 안 풀린다.
  // 학생 상세(changeStudentStatus)의 재원 전환과 **같은 불변식**을 공유해야 한다 — 예전엔 이 경로에만
  // 없어서 "어느 화면에서 눌렀느냐"로 결과가 갈렸다(2026-07-30 적대 리뷰).
  const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, studentId, withdrawnDate);
  if (reopenErr) return { error: reopenErr };
  const holdErr = await clearOnHoldForActiveEnrollments(supabase, studentId);
  if (holdErr) return { error: holdErr };

  // 학생 상세의 재원 전환(student_restore)과 같은 액션 키 — 어느 화면에서 복구했든 한 필터로 역검수.
  await logAction({
    action: "student_restore",
    targetType: "student",
    metadata: { studentId },
  });

  revalidatePath("/withdrawals");
  revalidatePath(`/withdrawals/${studentId}`);
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/timetable");
  return undefined;
}
