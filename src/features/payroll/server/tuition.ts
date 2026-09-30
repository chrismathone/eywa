import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { computeTierSettlement, tierRowsOwnedBy, type TierSettlementResult } from "@/features/payroll/tier-settlement";
import { parseGroupRates, SALARY_GROUPS, type GroupRates } from "@/features/payroll/salary-group";
import { collectTierRows } from "@/features/payroll/server/tier-rows";
import { applyRatePenalty } from "@/features/payroll/payslip";
import type { ProgramSubject } from "@/features/students/program";

/**
 * **강사 한 명의 그 달 수업료** — 급여명세서(`payslip-queries.ts`)와 수납 '강사 정산' 면이 **같은 함수**를 쓴다
 * (원장 2026-09-28 *"급여는 출석부에서 맞춰놓은것을 기준으로"* — 예전 정산 면은 청구 분배 스냅샷(splits) × 수수료 × 비율이라
 * 명세서와 금액이 달랐다). 조립은 출석부 하단 정산액과 같은 `collectTierRows`(시수 × 회차 확정 단가 ?? 티어 단가).
 *
 * 반 집합 = 그 강사가 **담임인 활성 반**(출석부 정산액·명세서와 같은 집합 — 돈은 담임을 따라간다, 위임은 안 본다).
 * 비율 = 계약 비율(`users.commission_rates`·`commission_rate`) − 그 달 명세서의 블로그 패널티(`payslips.rate_penalty_points`).
 */
type Db = Awaited<ReturnType<typeof createClient>>;

export type TeacherRateSource = {
  commission_rate: number | string | null;
  commission_rates: unknown;
};

/** 계약 비율에 패널티를 얹은 적용 비율 — 명세서와 정산 면 공용(계약 값 자체는 바꾸지 않는다). */
export function appliedRatesOf(
  teacher: TeacherRateSource,
  penaltyPoints: number,
): { groupRates: GroupRates; defaultRate: number | null; baseRates: GroupRates; baseDefault: number | null } {
  const baseRates: GroupRates = parseGroupRates(teacher.commission_rates);
  const baseDefault =
    teacher.commission_rate === null || teacher.commission_rate === undefined ? null : Number(teacher.commission_rate);
  const groupRates: GroupRates = {};
  for (const g of SALARY_GROUPS) {
    const v = baseRates[g];
    if (v !== undefined) groupRates[g] = applyRatePenalty(v, penaltyPoints);
  }
  const defaultRate = baseDefault === null ? null : applyRatePenalty(baseDefault, penaltyPoints);
  return { groupRates, defaultRate, baseRates, baseDefault };
}

/**
 * 수업료 산정 — null = 반이 없거나 그 달 출결·단가표가 없어 산정 불가(0원을 지어내지 않는다).
 * ⚠️ admin 클라이언트로 부를 땐 `tenantId` 필수(단가표를 테넌트로 거른다 — collectTierRows 주석).
 */
export async function computeTeacherTuition(
  db: Db,
  args: {
    period: string;
    classIds: string[];
    tenantId: string;
    subjects: readonly ProgramSubject[];
    rates: { groupRates: GroupRates | null; defaultRate: number | null };
    /**
     * 그 강사 — 🔴 대신 보강(원장 결정 3): 담임 반의 **다른 강사 대신 보강 칸**은 빼고, 남의 반에서 **이 강사가 한 보강 칸**은 넣는다
     * (`tierRowsOwnedBy`). 생략하면 종전(반 전체).
     */
    teacherId?: string;
  },
): Promise<TierSettlementResult | null> {
  if (args.classIds.length === 0 && !args.teacherId) return null;
  const collected = await collectTierRows(db, args.period, args.classIds, args.tenantId, args.subjects, {
    substituteTeacherIds: args.teacherId ? [args.teacherId] : [],
  });
  if (!collected) return null;
  const rows = args.teacherId ? tierRowsOwnedBy(collected.rows, args.teacherId, new Set(args.classIds)) : collected.rows;
  if (rows.length === 0) return null;
  return computeTierSettlement(rows, collected.priceByTier, args.rates);
}
