"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { parseRefundForm, refundTitle, REFUND_FORM_TYPE } from "../refund-request";

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

/** 생성/수정 겸용 — formData에 id가 있으면 해당 요청서 갱신, 없으면 신규 작성. */
export async function saveRefundRequest(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };

  const data = parseRefundForm(formData);
  if (!data.student.name) return { error: "학생 이름을 입력하세요" };

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    const { error } = await supabase
      .from("academy_documents")
      .update({ title: refundTitle(data), form_data: data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("form_type", REFUND_FORM_TYPE);
    if (error) return { error: `저장 실패: ${error.message}` };
    revalidateRefund(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/billing/refunds/${id}` };
  }

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
