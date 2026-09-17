import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import type { SessionPricingMode, SessionQuantityBasis } from "@/features/billing/session-pricing";
import { previousPeriod, type LastMonthTerm } from "../last-month-suggestion";
import { loadLivePlans } from "./live-plans";

/** `학생|반` → 지난 달 확정 행 + 지난 달 예정 시수(지금 수강·배치로 다시 계산). */
export type LastMonthBasis = Map<string, { last: LastMonthTerm; lastPlan: number | null }>;

/**
 * 회차 확정 '지난 달 기준 미리 채우기'의 재료(원장 2026-09-17). 이번 달 청구서가 있는 학생만, 지난 달 청구서의 **확정** 행만 읽는다.
 * - 시수 기준(`attendance_units`) · 회당 단가 확정만 담는다(월 정액·일수 기준 옛 확정은 제안 대상이 아니다 — 예정 재계산도 안 한다).
 * - 🔴 같은 학생·반에 지난 달 확정이 **둘 이상**이면 담지 않는다(청구서 중복 — 어느 쪽이 맞는지 모른다. 한쪽을 0으로 확정해 둔
 *   경우 비율이 0이 된다, 적대적 리뷰 2026-09-17).
 * 🔴 fail-soft — 미리 채우기는 편의라 조회가 실패해도 목록은 그대로 떠야 한다(빈 맵 + 로그 — 영구 실패가 "확정 없음"으로 숨지 않게).
 */
export async function loadLastMonthBasis(
  db: Awaited<ReturnType<typeof createClient>>,
  period: string,
  studentIds: string[],
  holidaysOf: (year: number) => string[],
): Promise<LastMonthBasis> {
  const out: LastMonthBasis = new Map();
  if (studentIds.length === 0) return out;
  const prev = previousPeriod(period);
  try {
    const invoices = await fetchAllPagedInChunks<{ id: string; student_id: string }>(studentIds, (ids, from, to) =>
      db.from("invoices").select("id, student_id").eq("period", prev).neq("status", "void").in("student_id", ids).order("id").range(from, to),
    );
    if (invoices.length === 0) return out;
    const studentOf = new Map(invoices.map((i) => [i.id, i.student_id]));
    const terms = await fetchAllPagedInChunks<{
      id: string;
      invoice_id: string;
      class_id: string | null;
      confirmed_sessions: number | string | null;
      unit_price: number | string | null;
      pricing_mode: SessionPricingMode | null;
      quantity_basis: SessionQuantityBasis | null;
    }>(invoices.map((i) => i.id), (ids, from, to) =>
      db
        .from("invoice_session_terms")
        .select("id, invoice_id, class_id, confirmed_sessions, unit_price, pricing_mode, quantity_basis")
        .in("invoice_id", ids)
        .not("confirmed_sessions", "is", null)
        .order("id")
        .range(from, to),
    );
    const byKey = new Map<string, LastMonthTerm[]>();
    for (const t of terms) {
      const studentId = studentOf.get(t.invoice_id);
      if (!studentId || !t.class_id || t.confirmed_sessions === null) continue;
      const key = `${studentId}|${t.class_id}`;
      byKey.set(key, [
        ...(byKey.get(key) ?? []),
        {
          confirmedSessions: Number(t.confirmed_sessions),
          unitPrice: t.unit_price === null ? null : Number(t.unit_price),
          pricingMode: t.pricing_mode ?? "per_session",
          quantityBasis: t.quantity_basis ?? "days",
        },
      ]);
    }
    const usable = [...byKey].filter(([, list]) => list.length === 1 && list[0]!.pricingMode !== "monthly" && list[0]!.quantityBasis === "attendance_units");
    if (usable.length === 0) return out;
    const needPlan = [...new Set(usable.map(([key]) => key.split("|")[0]!))];
    const { plans } = await loadLivePlans(db, prev, needPlan, holidaysOf(Number(prev.slice(0, 4))));
    for (const [key, [last]] of usable) {
      const [studentId, classId] = key.split("|") as [string, string];
      out.set(key, { last: last!, lastPlan: plans.get(studentId)?.get(classId) ?? null });
    }
    return out;
  } catch (e) {
    console.error("[session-terms] 지난 달 확정 기준 조회 실패", e instanceof Error ? e.message : e);
    return new Map();
  }
}
