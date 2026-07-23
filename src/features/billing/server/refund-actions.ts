"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeRefund,
  parseRefundForm,
  refundTitle,
  REFUND_FORM_TYPE,
  type RefundRequestData,
} from "../refund-request";
import { buildRefundPrefill } from "../refund-prefill";
import {
  getRefundPrefillSource,
  getRefundStudentOptions,
  type RefundStudentOption,
} from "./refund-queries";

// 환불 요청서(웹 작성 폼) 변경 액션 — 게이트는 canWriteTenant("billing")(수납 쓰기 = master/admin/accountant).
// 저장소는 academy_documents(kind='form', restricted=true) — 데이터베이스 탐색기에도 같은 행이 보인다.
// restricted 행(계좌·환불금액 등 민감)은 RLS restrictive(0072a)가 DB 레벨에서도 사무실 역할만 통과시킨다.

export type RefundActionState =
  | { ok?: boolean; error?: string; id?: string; nonce?: number; redirectTo?: string }
  | undefined;

async function requireBillingWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "billing"))) {
    return { error: "수납관리 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 환불완료 처리자 자동 기록 — 환불완료일자가 채워지면 "누가 완료 처리했는지"를 서버에서 못박는다(위조 불가).
 * 최초 완료(빈 값→값) 때만 저장한 사람으로 기록하고, 이미 기록돼 있으면 그대로 보존(마지막 편집자로 안 바뀜).
 * 완료일자를 비우면(완료 해제) 처리자 기록도 함께 지운다. makeedu 실행 이력의 triggered_by와 동일 패턴.
 */
function stampCompletion(
  data: RefundRequestData,
  prev: RefundRequestData | null,
  user: { id: string; displayName: string },
): RefundRequestData {
  const completed = data.result.completedDate.trim() !== "";
  const completedBy = completed ? prev?.result.completedBy || user.id : "";
  const completedByName = completed ? prev?.result.completedByName || user.displayName || "" : "";
  return { ...data, result: { ...data.result, completedBy, completedByName } };
}

/** 생성/수정 겸용 — formData에 id가 있으면 해당 요청서 갱신, 없으면 신규 작성. */
export async function saveRefundRequest(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };

  const parsed = parseRefundForm(formData);
  if (!parsed.student.name) return { error: "학생 이름을 입력하세요" };

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    // 완료 처리자 자동 기록엔 직전 저장분이 필요(이미 기록된 완료자를 보존하려고).
    const { data: existing } = await supabase
      .from("academy_documents")
      .select("form_data")
      .eq("id", id)
      .eq("form_type", REFUND_FORM_TYPE)
      .maybeSingle();
    const prev = existing ? normalizeRefund(existing.form_data) : null;
    const data = stampCompletion(parsed, prev, gate.user);
    const { error } = await supabase
      .from("academy_documents")
      .update({ title: refundTitle(data), form_data: data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("form_type", REFUND_FORM_TYPE);
    if (error) return { error: `저장 실패: ${error.message}` };
    revalidateRefund(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/billing/refunds/${id}` };
  }

  const data = stampCompletion(parsed, null, gate.user); // 생성 시 완료일자를 함께 넣으면 작성자가 완료자로 기록.
  const { data: row, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: refundTitle(data),
      category: "billing",
      kind: "form",
      form_type: REFUND_FORM_TYPE,
      form_data: data,
      restricted: true, // 계좌·환불금액 포함 → 사무실 전용 열람
      description: "환불처리요청서 (웹 작성)",
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { error: `저장 실패: ${error?.message ?? "unknown"}` };
  revalidateRefund(row.id);
  return { ok: true, id: row.id, nonce: Date.now(), redirectTo: `/billing/refunds/${row.id}` };
}

/**
 * 자동입력 학생 목록 — 폼이 열린 뒤 클라에서 on-demand로 부른다(첫 페인트를 800명 목록으로 막지 않게, B7).
 * 게이트는 저장과 동일(수납 쓰기) — 환불서를 못 쓰는 사람이 학생 명부를 긁어가는 통로가 되면 안 된다.
 */
export async function loadRefundStudentOptions(): Promise<{
  options?: RefundStudentOption[];
  error?: string;
}> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };
  return { options: await getRefundStudentOptions() };
}

/** 선택한 학생 → 서식 칸 값. 주소 등 민감정보가 있어 목록엔 안 싣고 **고른 1명만** 여기서 내려준다. */
export async function loadRefundPrefill(studentId: string): Promise<{
  values?: Record<string, string>;
  error?: string;
}> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };
  const src = await getRefundPrefillSource(studentId);
  if (!src) return { error: "학생 정보를 찾지 못했습니다" };
  return { values: buildRefundPrefill(src) };
}

export async function deleteRefundRequest(id: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE);
  if (error) return { error: `삭제 실패: ${error.message}` };
  revalidateRefund(id);
  return { ok: true };
}

function revalidateRefund(id: string) {
  revalidatePath("/billing");
  revalidatePath(`/billing/refunds/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}
