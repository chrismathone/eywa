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
import { parseGroupRates } from "../salary-group";

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

  // 반 이름(과정 자동 판정) + 반별 수동 설정(과정·비율) — 둘 다 splits에 등장한 반만 청크 조회(B3).
  // class_salary_settings는 master 전용 RLS라 비-master가 부르면 빈 배열 → 반별 override 없이 계산된다.
  const classIds = [...new Set(splits.map((s) => s.class_id).filter(Boolean))];
  const [classRows, classSettings] = await Promise.all([
    classIds.length > 0
      ? fetchInChunks<{ id: string; class_name: string | null }>(classIds, (chunk) =>
          supabase.from("classes").select("id, class_name").in("id", chunk),
        )
      : Promise.resolve([]),
    classIds.length > 0
      ? fetchInChunks<{ class_id: string; salary_group: string | null; commission_rate: number | string | null }>(
          classIds,
          (chunk) =>
            supabase
              .from("class_salary_settings")
              .select("class_id, salary_group, commission_rate")
              .in("class_id", chunk),
        )
      : Promise.resolve([]),
  ]);
  const classNameById = new Map(classRows.map((c) => [c.id, c.class_name ?? null]));
  const settingByClassId = new Map(classSettings.map((c) => [c.class_id, c]));

  const rows: SettlementRowInput[] = splits.map((s) => {
    const setting = settingByClassId.get(s.class_id);
    return {
      teacherId: s.teacher_id,
      teacherName: s.teacher_name,
      classId: s.class_id,
      confirmedAmount: Number(s.confirmed_amount) || 0,
      actualAmount: Number(s.actual_amount) || 0,
      className: classNameById.get(s.class_id) ?? null,
      manualGroup: setting?.salary_group ?? null,
      classRate:
        setting?.commission_rate === null || setting?.commission_rate === undefined
          ? null
          : Number(setting.commission_rate),
    };
  });

  // 급여 정책 — 등장한 강사만 청크 조회(B3).
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((id): id is string => !!id))];
  const users =
    teacherIds.length > 0
      ? await fetchInChunks<{
          id: string;
          salary_type: string | null;
          commission_rate: number | string | null;
          commission_rates: unknown;
          monthly_base: number | string | null;
        }>(teacherIds, (chunk) =>
          supabase
            .from("users")
            .select("id, salary_type, commission_rate, commission_rates, monthly_base")
            .in("id", chunk),
        )
      : [];
  const compByTeacherId = new Map<string, TeacherComp>(
    users.map((u) => [
      u.id,
      {
        salaryType: (u.salary_type as SalaryType | null) ?? null,
        commissionRate: u.commission_rate === null || u.commission_rate === undefined ? null : Number(u.commission_rate),
        monthlyBase: Number(u.monthly_base) || 0,
        groupRates: parseGroupRates(u.commission_rates),
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
