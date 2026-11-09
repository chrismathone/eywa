"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canSeeRestrictedDocuments } from "@/features/documents/server/restricted";
import { teacherViewReadDb, writeSessionFirst } from "./teacher-view-db";
import { releaseWithdrawalRefunds } from "@/features/withdrawal-reports/server/release";
import { loadRefundLink } from "@/features/withdrawal-reports/server/refund-steps";
import { COMPLETION_DATE_FORMAT, completionDateOk, linkedCapError, linkedCompletionLock, linkedDeleteLock, linkedEditLock } from "@/features/withdrawal-reports/refund-decision";
import { viewAsTeacher } from "@/lib/auth/view-as";
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

// 🔑 행위자 = '다른 강사 뷰'의 대상 직원(`getCurrentUser({ teacherView: true })`) — 작성자(uploaded_by)·환불완료 처리자(completedBy)가
//    대상 명의다(원장 2026-11-05 강사뷰 전수). '읽기' 강사뷰는 canWriteTenant가 막는다. 감사로그 행위자는 로그인 계정(logAction).
// 🔴 요청서는 전부 restricted(계좌·환불금액) — DB 백스톱(0170a academy_documents_restricted_guard)은 restricted 행을 **사무 역할**
//    (master·admin·manager·accountant)에게만 연다. 수납 쓰기 권한(개인 예외 등)만 있는 다른 역할은 DB가 거절·0행으로 막는다 → 앱도
//    같은 역할 목록(canSeeRestrictedDocuments, 대상 X의 역할)으로 먼저 막는다. 평소 사용자에게는 DB와 같은 결과다.
async function requireBillingWrite() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "billing")) || !canSeeRestrictedDocuments(user.systemRole)) {
    return { error: "수납관리 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 요청서 행을 **읽는** 클라이언트 — 평소엔 세션(RLS), '다른 강사 뷰'면 관리 클라이언트(teacher-view-db.ts): DB의 restricted 백스톱이
 * **로그인 계정의 역할**(`auth_system_role()`)로 사무실 여부를 보므로, 대상 직원(회계 등)이 쓸 수 있는 요청서가 로그인 계정 역할에 따라
 * 조용히 0행이 된다. **쓰기**는 `writeSessionFirst` — A의 세션으로 먼저(활동 기록·환불 데스크 할 일 닫기 s2_0011의 행위자 = auth.uid()),
 * 막힐 때만 관리 클라이언트. 앱 게이트(대상의 수납 쓰기 + 사무 역할)를 지난 뒤에만 부르고, 모든 조회·변경에 tenant_id를 명시한다.
 */
async function refundDb(tenantId: string) {
  return { db: (await teacherViewReadDb()).db, tenantId };
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

  const { db: supabase, tenantId } = await refundDb(gate.user.tenantId);
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    // 완료 처리자 자동 기록엔 직전 저장분이 필요(이미 기록된 완료자를 보존하려고).
    const { data: existing, error: existingError } = await supabase
      .from("academy_documents")
      .select("form_data")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("form_type", REFUND_FORM_TYPE)
      .maybeSingle();
    // 직전 값을 못 읽으면 저장하지 않는다(리뷰 r2 D-8 · #16) — 완료 처리자가 이번 저장자로 바뀌고 '처음 완료'로 잘못 보던 길.
    if (existingError) return { error: "요청서를 다시 불러오지 못해 저장하지 않았습니다. 잠시 후 다시 시도해 주세요." };
    const prev = existing ? normalizeRefund(existing.form_data) : null;
    // 퇴원보고서에 이어진 요청서(원장 2026-11-06·11-09) — 고치는 것(모든 칸)·환불완료일자는 그 요청서의 데스크 담당(재직)과 원장급만 · 비우기는 원장만 ·
    // 총 환불금액은 원장 승인 줄의 낸 돈 합(상한)을 넘지 않는다. 완료일자가 기다리던 퇴원·수강종료 처리를 푼다(release). DB 트리거(s2_0037)도 같은 규칙으로 막는다.
    const denied = await linkedSaveDenied(gate.user, id, parsed, prev);
    if (denied) return { error: denied };
    const data = stampCompletion(parsed, prev, gate.user);
    // 세션 먼저(행위자 A) · 강사뷰에서 RLS에 막히면 관리 클라이언트로 같은 문장(teacher-view-db.ts).
    // select 없으면 RLS에 막혀 0행을 고쳐도 성공으로 보고된다(삭제와 같은 규약) — 0행은 아래에서 "저장되지 않았습니다".
    const { data: updated, error } = await writeSessionFirst("mutate", (db) => db
      .from("academy_documents")
      .update({ title: refundTitle(data), form_data: data, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("form_type", REFUND_FORM_TYPE)
      .select("id"));
    if (error) return { error: `저장 실패: ${error.message}` };
    if (!updated?.length) return { error: "저장되지 않았습니다 — 이 요청서를 고칠 권한이 없거나 이미 지워졌습니다." };
    await logAction({ action: "refund_request_update", ...refundAuditFields(id, data, prev) });
    // 퇴원보고서 데스크 환불 단계(원장 2026-11-03) — 환불완료일자를 처음 넣으면 이 요청서를 기다리던 퇴원보고서를 이어서 처리한다
    // (승인이 끝났고 다른 환불이 남지 않았을 때만 · 던지지 않는다 — 실패는 오류 보고, 처리일 cron이 다시 본다).
    if (data.result.completedDate.trim() && !(prev?.result.completedDate ?? "").trim())
      await releaseWithdrawalRefunds({ tenantId: gate.user.tenantId, documentId: id, actorId: gate.user.id });
    revalidateRefund(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/billing/refunds/${id}` };
  }

  const data = stampCompletion(parsed, null, gate.user); // 생성 시 완료일자를 함께 넣으면 작성자가 완료자로 기록.
  const { data: row, error } = await writeSessionFirst("insert", (db) => db
    .from("academy_documents")
    .insert({
      tenant_id: tenantId,
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
    .single());
  if (error || !row) return { error: `저장 실패: ${error?.message ?? "unknown"}` };
  await logAction({ action: "refund_request_create", ...refundAuditFields(row.id, data, null) });
  revalidateRefund(row.id);
  return { ok: true, id: row.id, nonce: Date.now(), redirectTo: `/billing/refunds/${row.id}` };
}

/** 화면 행위자(강사뷰면 대상 직원 — 원장 몫으로 치지 않는다)와 실제 로그인 계정(DB 트리거가 보는 계정)의 원장급 여부. */
async function linkedActors(user: { id: string; systemRole: string }) {
  const account = (await getCurrentUser()) ?? user;
  return { actor: { id: user.id, directorLevel: user.systemRole === "master" && !(await viewAsTeacher()) }, account: { id: account.id, directorLevel: account.systemRole === "master" }, viaTeacherView: account.id !== user.id };
}

/**
 * 이어진 요청서 저장을 막을 까닭(원장 결정 2026-11-06·11-09 · 리뷰 r2 I6·B1) — 이어지지 않았으면 null. 행위자·실제 계정 **둘 다** 본다(`linked-request.ts`):
 * 🔴 강사뷰 쓰기(`writeSessionFirst`)는 세션이 RLS에 막히면 관리 키로 다시 써 트리거를 지나 버린다 — 앱이 같은 기준으로 먼저 막는다(DB는 관리 키 쓰기의 행위자를 모른다).
 * ① 고치기(모든 칸) = 재직 중인 담당 데스크·원장급 ② 환불완료일자 비우기 = 원장급만 ③ 넣기·바꾸기 = 담당 데스크·원장급 · C.3 대체된 요청서는 누구도 ④ 상한(원장 승인 줄의 낸 돈 합 —
 * 모르면 금액 칸을 바꾸는 저장만 거절). 연결을 못 읽으면 막는다. 거절은 감사로그(`refund_request_complete_denied` · `refund_request_linked_denied`).
 */
async function linkedSaveDenied(user: { id: string; tenantId: string; systemRole: string }, id: string, next: RefundRequestData, prev: RefundRequestData | null): Promise<string | null> {
  let link: Awaited<ReturnType<typeof loadRefundLink>>;
  try { link = await loadRefundLink(user.tenantId, id); }
  catch { return "퇴원보고서 연결을 확인하지 못해 저장하지 않았습니다. 잠시 후 다시 시도해 주세요."; }
  if (!link) return null;
  const { actor, account, viaTeacherView } = await linkedActors(user);
  const base = { documentId: id, studentName: next.student.name || null, deskName: link.deskName, ...(viaTeacherView ? { viaTeacherView: true } : {}) };
  const edit = linkedEditLock(link, actor, account);
  if (edit) {
    await logAction({ action: "refund_request_linked_denied", targetType: "refund_request", targetLabel: refundTitle(next), metadata: { ...base, attempted: "요청서 수정", reason: "담당 데스크·원장만" } });
    return edit;
  }
  const before = (prev?.result.completedDate ?? "").trim();
  const after = next.result.completedDate.trim();
  // 완료일자 꼴 = 빈칸 또는 YYYY-MM-DD(리뷰 r3 R-9 · DB 트리거와 같다 — '확인 중' 같은 글이 완료로 읽혀 데스크 대기가 풀렸다).
  if (before !== after && !completionDateOk(next.result.completedDate)) {
    await logAction({ action: "refund_request_linked_denied", targetType: "refund_request", targetLabel: refundTitle(next),
      metadata: { ...base, attempted: `환불완료일자 ${after}`, reason: "날짜 꼴 아님" } });
    return COMPLETION_DATE_FORMAT;
  }
  if (before !== after) {
    const reason = linkedCompletionLock(link, actor, account, !!before && !after);
    if (reason) {
      await logAction({ action: "refund_request_complete_denied", targetType: "refund_request", targetLabel: refundTitle(next),
        metadata: { ...base, attempted: after ? `환불완료일자 ${after} 입력` : "환불완료일자 지움" } });
      return reason;
    }
  }
  const cap = linkedCapError(link.cap, prev ? { totalAmount: prev.refund.totalAmount, paymentDetails: prev.refund.paymentDetails } : null, { totalAmount: next.refund.totalAmount, paymentDetails: next.refund.paymentDetails });
  if (cap) {
    await logAction({ action: "refund_request_linked_denied", targetType: "refund_request", targetLabel: refundTitle(next),
      metadata: { ...base, attempted: `총 환불금액 ${next.refund.totalAmount || "(빈칸)"}`, reason: link.cap === null ? "상한 모름" : `상한 ${link.cap.toLocaleString("ko-KR")}원` } });
    return cap;
  }
  return null;
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

  const { db: supabase, tenantId } = await refundDb(gate.user.tenantId);
  // 지운 뒤엔 되짚을 행이 없다 — 학생·금액을 **삭제 전에** 읽어 둔다(expense_delete와 같은 규약).
  const { data: before, error: beforeError } = await supabase
    .from("academy_documents")
    .select("title, form_data")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE)
    .maybeSingle();
  if (beforeError) return { error: "요청서를 다시 불러오지 못해 지우지 않았습니다. 잠시 후 다시 시도해 주세요." };
  // 퇴원보고서에 이어진 요청서(원장 결정 2026-11-09 · 리뷰 r2 B1) — 완료된 것은 지우지 않는다(DB도 막는다 · 원장이 먼저 완료일자를 비운다) ·
  // 미완료는 재직 중인 담당 데스크·원장급만(행위자·실제 계정 둘 다 — 강사뷰 관리 키 재시도가 DB를 지나기 전에).
  const prevData = before ? normalizeRefund(before.form_data) : null;
  let link: Awaited<ReturnType<typeof loadRefundLink>>;
  try { link = await loadRefundLink(gate.user.tenantId, id); }
  catch { return { error: "퇴원보고서 연결을 확인하지 못해 지우지 않았습니다. 잠시 후 다시 시도해 주세요." }; }
  if (link) {
    const { actor, account, viaTeacherView } = await linkedActors(gate.user);
    const denied = linkedDeleteLock(link, !!prevData?.result.completedDate.trim(), actor, account);
    if (denied) {
      await logAction({ action: "refund_request_linked_denied", targetType: "refund_request", targetLabel: (before?.title as string | null) ?? null,
        metadata: { documentId: id, studentName: prevData?.student.name || null, deskName: link.deskName, attempted: "요청서 삭제", reason: prevData?.result.completedDate.trim() ? "환불완료일자 있음" : "담당 데스크·원장만", ...(viaTeacherView ? { viaTeacherView: true } : {}) } });
      return { error: denied };
    }
  }
  const { data: gone, error } = await writeSessionFirst("mutate", (db) => db
    .from("academy_documents")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("form_type", REFUND_FORM_TYPE)
    .select("id"));
  if (error) return { error: `삭제 실패: ${error.message}` };
  // RLS에 막히면 PostgREST가 에러 없이 0행을 지운다 — 성공으로 보고하지 않는다(리뷰 r2 B1 — 안 지워진 요청서를 지운 것으로 알고 다시 승인하지 않게).
  if (!gone?.length) return { error: "지워지지 않았습니다 — 이 요청서를 지울 권한이 없거나 이미 지워졌습니다." };

  await logAction({
    action: "refund_request_delete",
    targetType: "refund_request",
    targetLabel: (before?.title as string | null) ?? null,
    metadata: {
      documentId: id,
      studentName: prevData?.student.name || null,
      totalAmount: prevData?.refund.totalAmount || null,
      completedDate: prevData?.result.completedDate || null,
    },
  });
  // 지운 요청서는 퇴원보고서 데스크 환불 단계에서 빠진다(원장 2026-11-03) — 그 요청서만 기다리던 보고서는 이어서 처리한다(이어진 요청서면 그 줄은 원장 환불 결정 대기로).
  await releaseWithdrawalRefunds({ tenantId: gate.user.tenantId, documentId: id, actorId: gate.user.id });
  revalidateRefund(id);
  return { ok: true };
}

function revalidateRefund(id: string) {
  revalidatePath("/billing");
  revalidatePath(`/billing/refunds/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}
