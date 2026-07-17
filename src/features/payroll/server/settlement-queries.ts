import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import {
  computeTeacherSettlements,
  totalSettlements,
  type SettlementRowInput,
  type SalaryType,
  type TeacherComp,
  type TeacherSettlement,
  type SettlementTotals,
} from "../settlement";

export type SettlementView = {
  rows: TeacherSettlement[];
  totals: SettlementTotals;
  splitCount: number; // 그 달 저장된 splits 행 수(0이면 스냅샷 없음 안내)
};

/**
 * 청구월의 강사 정산 참고 — **저장된 splits 스냅샷**(invoice_teacher_splits)을 담당 강사(teacher_id) 단위로
 * 묶어 급여 정책(users.salary_type/commission_rate/monthly_base)을 적용. 읽기전용, 저장 0.
 * (B2: splits 전건 fetchAllPaged / B3: users는 청크 조회)
 * ⚠️ live 확정치가 아니라 저장된 스냅샷을 읽는다 — 지급은 동결된 기록 기준(P5 스냅샷 규율).
 */
export async function getTeacherSettlementView(period: string): Promise<SettlementView> {
  const supabase = await createClient();

  const splits = await fetchAllPaged<{
    teacher_id: string | null;
    teacher_name: string | null;
    class_id: string;
    confirmed_amount: number | string;
    actual_amount: number | string;
  }>((from, to) =>
    supabase
      .from("invoice_teacher_splits")
      .select("teacher_id, teacher_name, class_id, confirmed_amount, actual_amount")
      .eq("period", period)
      .order("id")
      .range(from, to),
  );

  const rows: SettlementRowInput[] = splits.map((s) => ({
    teacherId: s.teacher_id,
    teacherName: s.teacher_name,
    classId: s.class_id,
    confirmedAmount: Number(s.confirmed_amount) || 0,
    actualAmount: Number(s.actual_amount) || 0,
  }));

  // 급여 정책 — 등장한 강사만 청크 조회(B3).
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((id): id is string => !!id))];
  const users =
    teacherIds.length > 0
      ? await fetchInChunks<{
          id: string;
          salary_type: string | null;
          commission_rate: number | string | null;
          monthly_base: number | string | null;
        }>(teacherIds, (chunk) =>
          supabase.from("users").select("id, salary_type, commission_rate, monthly_base").in("id", chunk),
        )
      : [];
  const compByTeacherId = new Map<string, TeacherComp>(
    users.map((u) => [
      u.id,
      {
        salaryType: (u.salary_type as SalaryType | null) ?? null,
        commissionRate: u.commission_rate === null || u.commission_rate === undefined ? null : Number(u.commission_rate),
        monthlyBase: Number(u.monthly_base) || 0,
      },
    ]),
  );

  const settlementRows = computeTeacherSettlements(rows, compByTeacherId);
  return {
    rows: settlementRows,
    totals: totalSettlements(settlementRows),
    splitCount: splits.length,
  };
}
