"use server";

// 강사 분배 스냅샷 저장 — 로드맵 2단계 (b). 골든마스터(N6) 통과 후 착수(2026-07-16).
// 스냅샷 의미론: 그 달 확정 행(N1) 전체를 계산해 기간 단위로 교체한다.
// ⚠️ 순서가 생명(적대 리뷰 픽스): **upsert 먼저 → 잔여(stale) 행 정리 마지막** — 기존 스냅샷을
//    절대 먼저 파괴하지 않는다. 중간 실패 시에도 이전 기록은 남고(잔여 행은 드리프트 배지로 가시화),
//    "삭제 후 삽입 실패 = 스냅샷 소실" 창이 없다.
// 기록 전용 — invoices는 절대 건드리지 않는다(N2). 저장 실패는 한글 요약으로 가시화(N4 정신).

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getSessionVerificationView } from "./verification-queries";
import { computeSplitRows } from "../splits";

export type SaveSplitsState =
  | { error?: string; saved?: number; skipped?: number }
  | undefined;

const CHUNK = 200;

/**
 * 기간(청구월) 전체의 강사 분배 스냅샷 저장. 과목 필터와 무관하게 **그 달 전체**를 저장한다
 * (부분 저장은 합계가 어긋나 보이는 함정 — 화면에 명시). 확정 행이 0이면 스냅샷을 비운다(잔여 정리만).
 */
export async function saveTeacherSplits(
  _prev: SaveSplitsState,
  formData: FormData,
): Promise<SaveSplitsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const period = String(formData.get("period") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: "잘못된 청구월입니다" };

  // 현재 회차 검증 뷰(확정·단가·실 회차·담당 강사)에서 분배 행 산출 — 확정 행만(N1).
  const view = await getSessionVerificationView(period);
  const stale = view.rows.filter((row) => row.allocationStale);
  if (stale.length) {
    // 자유 배분 청구서의 재확인은 관리자만 풀 수 있다(0279a — 다른 사람의 항목별 저장은 잠겨 있다). 누가 고쳐야 하는지까지 말한다.
    const adminOnly = [...new Set(stale.filter((row) => row.freeAllocationSaved).map((row) => row.studentName))];
    return { error: adminOnly.length
      ? `관리자가 자유 배분으로 저장한 청구서의 배분을 다시 확인해야 합니다(${adminOnly.slice(0, 3).join(", ")}${adminOnly.length > 3 ? ` 외 ${adminOnly.length - 3}명` : ""}) — 관리자만 고칠 수 있습니다`
      : "수납 연결 후 청구액 또는 반 확정금액이 바뀐 학생이 있습니다. 수납 연결·배분을 다시 확인해 주세요" };
  }
  // 금액 이월(0278a) — 조회가 실패했거나 받을 줄이 없는 이월이 있으면 저장하지 않는다(그 돈은 어느 달에도 분배되지 않거나 두 번 들어간다).
  if (view.carryFailed) return { error: "금액 이월 정보를 불러오지 못했습니다. 잠시 뒤 다시 저장해 주세요" };
  if (view.carryBlockedStudents?.length) {
    const names = view.carryBlockedStudents;
    return { error: `받을 반이 없는 금액 이월이 있습니다(${names.slice(0, 3).join(", ")}${names.length > 3 ? ` 외 ${names.length - 3}명` : ""}). 보낸 달에서 이월을 취소하거나 받을 반을 다시 골라 주세요` };
  }
  const rows = computeSplitRows(view.rows);
  const skipped = view.rows.length - rows.length;

  const supabase = await createClient();

  // ① upsert — (tenant, invoice, class) 키로 제자리 교체. 기존 스냅샷은 이 시점까지 온전하다.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      tenant_id: user.tenantId,
      invoice_id: r.invoiceId,
      class_id: r.classId,
      period,
      subject: r.subject,
      teacher_id: r.teacherId,
      teacher_name: r.teacherName,
      confirmed_sessions: r.confirmedSessions,
      unit_price: r.unitPrice,
      pricing_mode: r.pricingMode,
      confirmed_amount: r.confirmedAmount,
      actual_units: r.actualUnits,
      actual_amount: r.actualAmount,
      diff_amount: r.diffAmount,
      created_by: user.id,
    }));
    const { error } = await supabase
      .from("invoice_teacher_splits")
      .upsert(chunk, { onConflict: "tenant_id,invoice_id,class_id" });
    if (error) {
      return { error: `분배 저장 실패 — 기존 스냅샷은 보존됐습니다. 다시 시도하세요. (${error.message})` };
    }
  }

  // ② 잔여 정리 — 이 기간의 저장 행 중 이번 계산에 없는 키(확정 해제된 행 등)만 제거.
  const { data: existing, error: listError } = await supabase
    .from("invoice_teacher_splits")
    .select("id, invoice_id, class_id")
    .eq("tenant_id", user.tenantId)
    .eq("period", period);
  if (listError) {
    return { error: `저장은 완료됐으나 이전 잔여 행 확인 실패 — 다시 저장하세요. (${listError.message})` };
  }
  const liveKeys = new Set(rows.map((r) => `${r.invoiceId}|${r.classId}`));
  const staleIds = (existing ?? [])
    .filter((e) => !liveKeys.has(`${e.invoice_id}|${e.class_id}`))
    .map((e) => e.id);
  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const { error } = await supabase
      .from("invoice_teacher_splits")
      .delete()
      .in("id", staleIds.slice(i, i + CHUNK));
    if (error) {
      return { error: `저장은 완료됐으나 이전 잔여 행 정리 실패 — 다시 저장하세요. (${error.message})` };
    }
  }

  revalidatePath("/billing");
  return { saved: rows.length, skipped };
}
