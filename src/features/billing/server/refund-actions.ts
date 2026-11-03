"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { releaseWithdrawalRefunds } from "@/features/withdrawal-reports/server/release";
import {
  normalizeRefund,
  parseRefundForm,
  refundTitle,
  REFUND_FORM_TYPE,
  type RefundRequestData,
} from "../refund-request";
import {
  buildRefundPrefill,
  DEFAULT_PAYMENT_MONTHS,
  PAYMENT_MONTH_CHOICES,
  type PaymentMonths,
} from "../refund-prefill";
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
    await logAction({ action: "refund_request_update", ...refundAuditFields(id, data, prev) });
    // 퇴원보고서 데스크 환불 단계(원장 2026-11-03) — 환불완료일자를 처음 넣으면 이 요청서를 기다리던 퇴원보고서를 이어서 처리한다
    // (승인이 끝났고 다른 환불이 남지 않았을 때만 · 던지지 않는다 — 실패는 오류 보고, 처리일 cron이 다시 본다).
    if (data.result.completedDate.trim() && !(prev?.result.completedDate ?? "").trim())
      await releaseWithdrawalRefunds({ tenantId: gate.user.tenantId, documentId: id, actorId: gate.user.id });
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
  await logAction({ action: "refund_request_create", ...refundAuditFields(row.id, data, null) });
  revalidateRefund(row.id);
  return { ok: true, id: row.id, nonce: Date.now(), redirectTo: `/billing/refunds/${row.id}` };
}

/**
 * 환불 요청서 감사로그의 **대상·상세만** 만든다(action 키는 호출부가 리터럴로 적는다).
 *
 * ⚠️ 액션 키를 이 함수의 **인자로 받지 말 것** — `actions-registry.test.ts`가 `logAction(` 괄호 안의
 *    문자열 리터럴만 스캔해서 AUDIT_ACTIONS 등록 여부를 검사한다. 키를 변수로 넘기면 그 가드가
 *    **아무것도 못 보고 통과**하고, 라벨 미등록 키가 원장 화면에 영문 그대로 뜬다(가드가 막으려던 바로 그 사고).
 *
 * 🔴 **계좌번호·주소는 담지 않는다.** 되짚는 데 필요 없는 값이고, 로그가 새면 가장 크게 새는 값이다
 *    (2026-09-09에 감사로그 읽기를 master·super_admin으로 좁혔지만[0253a] 그건 자물쇠일 뿐이다). 이 서식은 그래서 `restricted:true`로 저장되고 0072a restrictive RLS가 사무실
 *    역할만 통과시키는데, 계좌를 metadata에 실으면 그 잠금이 그대로 무의미해진다(CLAUDE.md 외부전송
 *    금지 필드 목록의 '환불요청서 계좌'와 같은 취지).
 * 🔴 **환불 금액은 담는다** — 되짚을 대상이 그것이고, 금액만으론 사람을 특정하지 못한다.
 * 🔑 '환불완료' 전이(빈 값 → 날짜)는 돈이 실제로 나간 시점이라 따로 표시한다 — 처리자는 `stampCompletion`이
 *    행에도 못박지만, 그건 **최초 1회만** 남아서 "나중에 누가 완료를 풀었나"는 감사로그에만 남는다.
 */
function refundAuditFields(id: string, data: RefundRequestData, prev: RefundRequestData | null) {
  const completed = data.result.completedDate.trim() !== "";
  const wasCompleted = (prev?.result.completedDate ?? "").trim() !== "";
  return {
    targetType: "refund_request",
    targetLabel: refundTitle(data),
    metadata: {
      documentId: id,
      studentName: data.student.name || null,
      totalAmount: data.refund.totalAmount || null,
      requestDate: data.student.requestDate || null,
      completedDate: data.result.completedDate || null,
      // 이번 저장에서 완료 상태가 **바뀌었을 때만** — 매 저장마다 실으면 진짜 전이가 묻힌다.
      ...(completed !== wasCompleted ? { completionChange: completed ? "완료" : "완료 해제" } : {}),
    },
  };
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

/**
 * 선택한 학생 → 서식 칸 값. 주소 등 민감정보가 있어 목록엔 안 싣고 **고른 1명만** 여기서 내려준다.
 * `months` = 결제내역에 넣을 최근 개월 수(1 = 이번 달, null = 전체). 화면 세그먼트가 바뀌면 다시 부른다.
 */
export async function loadRefundPrefill(
  studentId: string,
  months: PaymentMonths = DEFAULT_PAYMENT_MONTHS,
): Promise<{ values?: Record<string, string>; error?: string }> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };
  // 클라가 보낸 값이라 선택지 화이트리스트로 좁힌다(임의 숫자로 창을 늘리지 못하게).
  const safeMonths = (PAYMENT_MONTH_CHOICES as readonly (number | null)[]).includes(months)
    ? months
    : DEFAULT_PAYMENT_MONTHS;
  const src = await getRefundPrefillSource(studentId);
  if (!src) return { error: "학생 정보를 찾지 못했습니다" };
  return { values: buildRefundPrefill(src, { months: safeMonths }) };
}

export async function deleteRefundRequest(id: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireBillingWrite();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  // 지운 뒤엔 되짚을 행이 없다 — 학생·금액을 **삭제 전에** 읽어 둔다(expense_delete와 같은 규약).
  const { data: before } = await supabase
    .from("academy_documents")
    .select("title, form_data")
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE)
    .maybeSingle();
  const { data: gone, error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE)
    .select("id");
  if (error) return { error: `삭제 실패: ${error.message}` };

  // RLS에 막히면 PostgREST가 에러 없이 0행을 지운다 — 안 지워진 삭제를 감사로그가 사실로 적지 않게 한다.
  if (gone?.length) {
    const d = before ? normalizeRefund(before.form_data) : null;
    await logAction({
      action: "refund_request_delete",
      targetType: "refund_request",
      targetLabel: (before?.title as string | null) ?? null,
      metadata: {
        documentId: id,
        studentName: d?.student.name || null,
        totalAmount: d?.refund.totalAmount || null,
        completedDate: d?.result.completedDate || null,
      },
    });
    // 지운 요청서는 퇴원보고서 데스크 환불 단계에서 빠진다(원장 2026-11-03) — 그 요청서만 기다리던 보고서는 이어서 처리한다.
    await releaseWithdrawalRefunds({ tenantId: gate.user.tenantId, documentId: id, actorId: gate.user.id });
  }
  revalidateRefund(id);
  return { ok: true };
}

function revalidateRefund(id: string) {
  revalidatePath("/billing");
  revalidatePath(`/billing/refunds/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}
