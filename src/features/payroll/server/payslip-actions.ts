"use server";

// 급여명세서 월별 조정 저장·발행 — 원장 전용. 저장소는 payslips(0205a, master 전용 RLS).
//
// 🔴🔴 **감사로그는 "무슨 일이 있었나"만 남기고 "얼마"는 절대 남기지 않는다.**
//   · 남긴다: 대상 직원 id · 대상 월 · 발행/발행취소/조정저장 중 무엇인지.
//   · 🔴 안 남긴다: 금액·인센티브·공제·시급·배분율·패널티 수치 — **하나도**.
//   이유: 급여는 **본 것 자체가 사고**인 값이라 자물쇠 하나에 기대지 않는다. (2026-09-09에 감사로그
//   읽기를 master·super_admin으로 좁혔다[0253a] — 그전까지는 로그인한 전 직원이 읽을 수 있었다.) 반면
//   payslips는 master 전용 RLS + 원장 역할 · 학원 설정에서 지정한 사람(payslip-access.ts)으로 잠근 표다. 금액을 metadata에
//   실으면 그 잠금 두 겹이 **한 줄로 무의미해진다.**
//   이 갈래는 새로 지어낸 규칙이 아니라 0120a(`log_activity` redact: hourly_rate·monthly_base·
//   salary_type·commission_rate)가 이미 쓰던 규약 그대로다 — **바뀐 사실은 기록하되 값은 가린다.**
//   ⚠️ 종전 주석은 "급여성 액션은 audit_logs를 아예 안 남긴다"였다(class-salary-actions.ts·
//      comp-actions.ts는 지금도 그렇다 — 그쪽은 users의 log_activity 트리거가 redact된 기록을 이미
//      남긴다). payslips에는 **그 트리거가 없어**(0081a·0084a 대상 표 목록 밖) 발행·발행취소가
//      어디에도 안 남았다 → 원장 지시(2026-09-09 "기능이 추가되거나 변동되는건 모두 감사로그에")에
//      따라 **값 없는 사실 기록만** 연다.
//   ⚠️ 이 파일에 새 액션을 더할 때도 같은 규칙 — metadata에 숫자를 넣기 전에 위 이유를 다시 읽을 것.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { resolvePenaltyPoints } from "../payslip";
import { PAYSLIP_MANAGE_DENIED_MSG } from "../payslip-access";
import { canManagePayslipNow } from "./payslip-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPayslipData } from "./payslip-queries";
import { explainDbError } from "@/lib/supabase/db-error";

export type SavePayslipState =
  | {
      ok?: true;
      error?: string;
      nonce?: number;
      /** 거부됐을 때 방금 친 값 — 폼이 리셋돼 입력이 사라지지 않게 되돌려준다([[#83]]). */
      values?: Record<string, string>;
    }
  | undefined;

/** "1,200,000" · "" · null → 정수. 음수·비숫자는 null(=거부 신호). */
function parseWon(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(/[,\s원]/g, "");
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** 거부 응답에 제출값을 함께 실어 보낸다. */
function reject(error: string, formData: FormData): SavePayslipState {
  const keys = ["incentive", "otherDeduction", "blogWrittenOn", "ratePenaltyPoints", "memo"];
  const values: Record<string, string> = {};
  for (const k of keys) values[k] = String(formData.get(k) ?? "");
  values.blogPenalty = formData.get("blogPenalty") === "on" ? "on" : "";
  return { error, values, nonce: Date.now() };
}

export async function savePayslipAdjustments(
  _prev: SavePayslipState,
  formData: FormData,
): Promise<SavePayslipState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 메뉴 권한과 별개인 관리 명단 + 읽기 전용/모듈 제한을 실제 요청자로 확인한다.
  if (!(await canManagePayslipNow())) return { error: PAYSLIP_MANAGE_DENIED_MSG };

  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!teacherId) return { error: "대상 강사가 지정되지 않았습니다" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: "기간 형식이 올바르지 않습니다(YYYY-MM)" };

  const incentive = parseWon(formData.get("incentive"));
  if (incentive === null) return reject("인센티브는 0 이상의 숫자여야 합니다", formData);
  const otherDeduction = parseWon(formData.get("otherDeduction"));
  if (otherDeduction === null) return reject("기타공제는 0 이상의 숫자여야 합니다", formData);

  const blogWrittenOn = String(formData.get("blogWrittenOn") ?? "").trim() || null;

  /**
   * 🔴 체크박스가 **1차 컨트롤**이다 — 체크가 꺼져 있으면 숫자 칸에 뭐가 있든 0으로 확정한다.
   *    (첫 구현은 숫자 칸이 항상 이겨서, 저장값 "2"가 프리필된 뒤엔 체크를 풀어도 −2%p가 안 지워졌다.
   *     비율 45%가 43%로 굳어 매달 약 4.4% 과소지급 — 적대 리뷰가 잡은 치명 버그.)
   * 🔴 자동으로 켜지 않는다 — 월중에 "아직 안 썼다"를 미작성으로 확정하면 과소지급이 된다(원장 확인 사항).
   */
  const resolved = resolvePenaltyPoints(
    formData.get("blogPenalty") === "on",
    String(formData.get("ratePenaltyPoints") ?? ""),
  );
  if (resolved.points === undefined) return reject(resolved.error, formData);
  const ratePenaltyPoints = resolved.points;
  const ratePenaltyReason =
    ratePenaltyPoints > 0 ? String(formData.get("ratePenaltyReason") ?? "").trim() || "블로그 미작성" : null;

  const memo = String(formData.get("memo") ?? "").trim() || null;

  // 🔴 payslips는 master 전용 RLS — 지정된 사람이 원장 역할이 아니면 세션 클라이언트로 0행을 받는다([[#104]]).
  //    앱 게이트를 통과한 뒤 admin으로 쓰되 tenant_id를 명시한다(RLS 우회이므로).
  const supabase = createAdminClient();
  // 발행(issued)된 명세서는 동결이다 — 조정을 다시 쓰면 서명된 문서와 값이 갈린다.
  const { data: existing } = await supabase
    .from("payslips")
    .select("status")
    .eq("tenant_id", user.tenantId)
    .eq("user_id", teacherId)
    .eq("period", period)
    .maybeSingle();
  if (existing?.status === "issued")
    return { error: "이미 발행된 명세서입니다. 값을 바꾸려면 발행을 먼저 취소해야 합니다." };

  const { error } = await supabase.from("payslips").upsert(
    {
      tenant_id: user.tenantId,
      user_id: teacherId,
      period,
      incentive,
      other_deduction: otherDeduction,
      blog_written_on: blogWrittenOn,
      rate_penalty_points: ratePenaltyPoints,
      rate_penalty_reason: ratePenaltyReason,
      memo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,user_id,period" },
  );
  // 0205a 미적용이면 표가 없다 — 무슨 일인지 분명히 말한다(조용히 성공한 척하지 않는다).
  if (error) return reject(explainDbError(error, { scope: "payroll.payslip-actions.savePayslipAdjustments", fallback: "저장 실패 — 잠시 후 다시 시도해 주세요" }).message, formData);

  // 🔴 값은 담지 않는다(파일 머리 주석) — 조정한 **항목 이름**조차 담지 않는다. "인센티브를 고쳤다"만으로도
  //    그 사람 급여에 무슨 일이 있었는지가 읽히기 때문. 남기는 건 "누가 · 누구의 · 어느 달을 · 언제 고쳤나"뿐이다.
  await logAction({
    action: "payslip_adjust",
    targetType: "payslip",
    targetLabel: period,
    metadata: { userId: teacherId, period },
  });
  revalidatePath(`/payroll/${teacherId}/payslip`);
  revalidatePath("/attendance");
  return { ok: true, nonce: Date.now() };
}

/**
 * 발행 — 그 시점 명세서 전체를 `print_payload`에 **동결**하고 status를 issued로 넘긴다.
 *
 * 🔴 이게 있어야 0205a가 약속한 "출결을 나중에 고쳐도 서명된 명세서가 안 바뀐다"가 성립한다.
 *    (동결 없이 발행 상태만 두면, 지급·서명이 끝난 뒤 출결 1건만 정정해도 같은 URL이 다른 금액을 인쇄한다.)
 * 🔴 산정 불가(수업료를 못 낸 상태)면 발행하지 않는다 — ₩0짜리 문서를 동결하면 되돌리기 어렵다.
 */
export async function issuePayslip(
  _prev: SavePayslipState,
  formData: FormData,
): Promise<SavePayslipState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManagePayslipNow())) return { error: PAYSLIP_MANAGE_DENIED_MSG };

  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!teacherId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: "대상이 올바르지 않습니다" };

  let data;
  try {
    data = await getPayslipData(teacherId, period);
  } catch (e) {
    // 이동(redirect) 같은 프레임워크 신호는 삼키지 않는다 — 프리랜서 명세서는 출석부 조회(권한 확인 포함)를 지나므로
    // 여기서 삼키면 이동 신호의 원문이 오류 문구로 화면에 뜬다.
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : "명세서를 계산할 수 없습니다" };
  }
  if (!data.settlement) return { error: "수업료를 산정할 수 없어 발행할 수 없습니다. 위 경고를 먼저 해결하세요." };
  if (data.amounts.netPay < 0) return { error: "실수령액이 음수입니다. 기타공제를 확인하세요." };

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  // 제약(payslips_issued_has_payload)이 status·issued_at·print_payload를 **함께** 요구한다 — 한 문장으로 쓴다.
  const { error } = await supabase.from("payslips").upsert(
    {
      tenant_id: user.tenantId,
      user_id: teacherId,
      period,
      incentive: data.adjustments.incentive,
      other_deduction: data.adjustments.otherDeduction,
      blog_written_on: data.adjustments.blogWrittenOn,
      rate_penalty_points: data.adjustments.ratePenaltyPoints,
      rate_penalty_reason: data.adjustments.ratePenaltyReason,
      memo: data.adjustments.memo,
      status: "issued",
      issued_at: now,
      issued_by: user.id,
      print_payload: data,
      updated_at: now,
    },
    { onConflict: "tenant_id,user_id,period" },
  );
  if (error) return { error: explainDbError(error, { scope: "payroll.payslip-actions.issuePayslip", fallback: "발행 실패 — 잠시 후 다시 시도해 주세요" }).message };

  // 발행 = 그 시점 명세서를 **동결**해 서명·지급의 근거로 삼는 행위 → 남는 흔적이 있어야 한다.
  // 🔴 print_payload(=금액 전체)는 물론 netPay 한 줄도 담지 않는다(파일 머리 주석).
  await logAction({
    action: "payslip_issue",
    targetType: "payslip",
    targetLabel: period,
    metadata: { userId: teacherId, period },
  });
  revalidatePath(`/payroll/${teacherId}/payslip`);
  return { ok: true, nonce: Date.now() };
}

/** 발행 취소 — 동결을 풀고 다시 계산 상태로 되돌린다(잘못 발행했을 때의 유일한 출구). */
export async function unissuePayslip(
  _prev: SavePayslipState,
  formData: FormData,
): Promise<SavePayslipState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManagePayslipNow())) return { error: PAYSLIP_MANAGE_DENIED_MSG };

  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!teacherId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: "대상이 올바르지 않습니다" };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("payslips")
    .update({ status: "draft", issued_at: null, issued_by: null, print_payload: null })
    .eq("tenant_id", user.tenantId)
    .eq("user_id", teacherId)
    .eq("period", period);
  if (error) return { error: explainDbError(error, { scope: "payroll.payslip-actions.unissuePayslip", fallback: "발행 취소 실패 — 잠시 후 다시 시도해 주세요" }).message };

  // 🔴 셋 중 **가장 중요한 줄** — 동결을 푸는 행위라, 이미 서명·지급된 명세서의 값이 이 뒤에 바뀔 수 있다.
  //    "왜 지급액과 명세서가 다르지"의 답이 여기서만 나온다.
  await logAction({
    action: "payslip_unissue",
    targetType: "payslip",
    targetLabel: period,
    metadata: { userId: teacherId, period },
  });
  revalidatePath(`/payroll/${teacherId}/payslip`);
  return { ok: true, nonce: Date.now() };
}
