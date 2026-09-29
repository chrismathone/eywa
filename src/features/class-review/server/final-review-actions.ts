"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { FINAL_REVIEW_MAX } from "../final-review";
import { isSelfOnlyReviewer } from "../self-only";
import { CLASS_REVIEW_FORM_TYPE, getReviewPrivileges, type ReviewDoc } from "./queries";
import type { ReviewActionState } from "./actions";

/**
 * 최종 총평 저장 — 평가지당 하나(원장 2026-09-29). 쓰는 사람 = 원장 + class_review 개인 예외 인원
 * (`getReviewPrivileges().writeFinalReview`, 실명 열람과 같은 사람들 — 평가자 전원을 보고 종합하는 자리).
 * 빈 값으로 저장하면 총평을 지운다. 채점(submissions)은 건드리지 않고 `finalReview` 키만 갈아끼운다.
 * ⚠️ 채점 제출과 같은 read-modify-write라 동시 저장 창이 이론상 있다(submitClassReviewScores와 같은 트레이드오프).
 */
export async function saveFinalReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  if (!(await canWriteTenant(user.systemRole, "class_review"))) {
    return { error: "수업 평가를 작성할 권한이 없습니다" };
  }
  // 강사 직급 = 자기 평가 전용(#77 — POST는 화면을 안 거친다). 개인 예외로 full을 받아도 막힌다.
  if (isSelfOnlyReviewer(user.systemRole)) return { error: "총평은 사무실에서 작성합니다" };
  const priv = await getReviewPrivileges();
  if (!priv.writeFinalReview) return { error: "총평은 원장·지정 인원만 작성할 수 있습니다" };

  const docId = String(formData.get("docId") ?? "").trim();
  const text = String(formData.get("finalReview") ?? "").trim();
  if (!docId) return { error: "평가 건을 찾을 수 없습니다" };
  if (text.length > FINAL_REVIEW_MAX) return { error: `총평은 ${FINAL_REVIEW_MAX}자까지 쓸 수 있습니다` };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("academy_documents")
    .select("id, form_data")
    .eq("tenant_id", user.tenantId) // admin = RLS 우회 — tenant 명시
    .eq("form_type", CLASS_REVIEW_FORM_TYPE)
    .eq("id", docId)
    .maybeSingle();
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "평가 건을 찾을 수 없습니다" };

  const doc = { ...((row.form_data ?? {}) as ReviewDoc) };
  if (text) {
    doc.finalReview = {
      text,
      updatedAt: new Date().toISOString(),
      by: { id: user.id, name: user.displayName },
    };
  } else {
    delete doc.finalReview;
  }
  const { error } = await admin
    .from("academy_documents")
    .update({ form_data: doc, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId)
    .eq("id", docId);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "class_review_final_review",
    targetType: "user",
    targetLabel: doc.header?.teacherName ?? null,
    metadata: { docId, cleared: !text, length: text.length },
  });
  revalidatePath(`/class-review/${docId}`);
  return { ok: true, notice: text ? "총평을 저장했습니다" : "총평을 지웠습니다" };
}
