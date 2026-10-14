"use server";

// 직원별 항목 비교 — 한 달의 저장된 점수를 직원 전부 읽는다(원장 2026-10-15 *"직원별로 항목 비교 가능하게"*).
// 직원 포트폴리오와 같은 문(원장 역할)을 지난 뒤에만. 근거(학생 줄)는 싣지 않는다 — 점수·수치만.
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { CompareRow } from "../compare";
import type { Metric } from "../model/types";
import { itemLabel } from "../view";
import { getPortfolioGate } from "./queries";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
type Raw = { teacher_id: string; total: number | string | null; closed_at: string | null; items: Metric[] | null; known_max: number | string | null };

export async function loadPortfolioComparison(month: string): Promise<{ ok: true; rows: CompareRow[] } | { ok: false; error: string }> {
  const gate = await getPortfolioGate();
  if (!gate) return { ok: false, error: "직원 포트폴리오를 볼 권한이 없습니다" };
  if (!MONTH.test(month)) return { ok: false, error: "달을 확인해 주세요" };
  try {
    const raw = await fetchAllPaged<Raw>((a, b) => createAdminClient().from("teacher_portfolio_months")
      .select("teacher_id, total, closed_at, items:payload->items, known_max:payload->knownMax")
      .eq("tenant_id", gate.tenantId).eq("month", month).order("teacher_id").range(a, b) as unknown as PromiseLike<{ data: Raw[] | null; error: { message: string } | null }>);
    return {
      ok: true,
      rows: raw.map((r) => ({
        teacherId: r.teacher_id, total: r.total === null ? null : Number(r.total), knownMax: Number(r.known_max ?? 0), closed: Boolean(r.closed_at),
        items: (r.items ?? []).filter((m) => !m.off).map((m) => ({
          id: m.id, label: itemLabel(m), max: m.max, value: m.value, raw: m.raw ?? null, missing: Boolean(m.missing), uncounted: Boolean(m.uncounted),
        })),
      })),
    };
  } catch (e) {
    reportWarning("직원 비교 조회 실패", { scope: "loadPortfolioComparison", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "불러오지 못했습니다. 잠시 후 다시 열어 주세요" };
  }
}
