import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { splitsFingerprint } from "../splits";
import type { SessionPricingMode } from "../../session-pricing";

/** 저장된 분배 스냅샷 요약 — 시수 검증 면의 드리프트 표시용. null = 저장 이력 없음. */
export type SplitsSnapshotStatus = {
  rowCount: number;
  confirmedAmount: number;
  actualAmount: number;
  diffAmount: number;
  savedAt: string; // ISO — 표시 시 KST 변환
  // 강사 귀속까지 포함한 지문 — 합계가 상쇄되는 변경(강사 재배정 등)도 드리프트로 잡는다.
  fingerprint: string;
};

/** 기간의 저장된 분배 스냅샷 합계. (B2: 전건은 fetchAllPaged — 행수는 그 달 확정 행 수 이하로 유계) */
export async function getTeacherSplitsStatus(period: string): Promise<SplitsSnapshotStatus | null> {
  const supabase = await createClient();
  const rows = await fetchAllPaged<{
    invoice_id: string;
    class_id: string;
    teacher_id: string | null;
    confirmed_amount: number | string;
    actual_amount: number | string;
    pricing_mode: SessionPricingMode;
    created_at: string;
  }>((from, to) =>
    supabase
      .from("invoice_teacher_splits")
      .select("invoice_id, class_id, teacher_id, confirmed_amount, actual_amount, pricing_mode, created_at")
      .eq("period", period)
      .order("id")
      .range(from, to),
  );
  if (rows.length === 0) return null;

  const normalized = rows.map((r) => ({
    invoiceId: r.invoice_id,
    classId: r.class_id,
    teacherId: r.teacher_id,
    confirmedAmount: Number(r.confirmed_amount) || 0,
    actualAmount: Number(r.actual_amount) || 0,
    pricingMode: r.pricing_mode,
  }));
  const confirmedAmount = normalized.reduce((s, r) => s + r.confirmedAmount, 0);
  const actualAmount = normalized.reduce((s, r) => s + r.actualAmount, 0);
  const savedAt = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), rows[0]!.created_at);
  return {
    rowCount: rows.length,
    confirmedAmount,
    actualAmount,
    diffAmount: actualAmount - confirmedAmount,
    savedAt,
    fingerprint: splitsFingerprint(normalized),
  };
}
