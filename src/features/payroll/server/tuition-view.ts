import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import type { createClient } from "@/lib/supabase/server";
import type { PayslipData } from "@/features/payroll/payslip-view";
import type { SalaryType } from "../settlement";
import { parseGroupRates, type GroupRates } from "../salary-group";
import { canManageSalary } from "./salary-access";
import { appliedRatesOf } from "./tuition";
import { collectTierRows } from "./tier-rows";
import { computeTierSettlement } from "@/features/payroll/tier-settlement";

export type TuitionRow = {
  teacherId: string;
  teacherName: string;
  classCount: number;
  /** 산정에 들어간 시수 합(명세서 '수업 내역'과 같은 값). */
  unitsTotal: number;
  /** 수업료(원) — 명세서 수업료와 같은 값. null = 산정 불가(사유는 notes). */
  tuition: number | null;
  /** 명세서가 발행돼 **발행 금액 그대로**(동결)인가. */
  issued: boolean;
  penaltyPoints: number;
  notes: string[];
  salaryType: SalaryType | null;
  commissionRate: number | null;
  /** 과정별 배분율 — 편집기가 현재 값을 다시 그려야 저장 시 안 지워진다(비우면 null로 저장된다). */
  groupRates: GroupRates | null;
  monthlyBase: number;
};

export type TuitionView = { rows: TuitionRow[]; total: number; computedCount: number; pendingCount: number };

type Db = Awaited<ReturnType<typeof createClient>>;
// computeTeacherTuition(명세서 한 명)과 같은 조립·같은 산식 — 여기선 여러 명을 한 번에 조립해 반 담임으로 나눈다.

/**
 * 수납 '강사 정산' 면 — **급여명세서와 같은 수업료**를 강사마다(원장 2026-09-28 *"급여는 출석부에서 맞춰놓은것을 기준으로"*).
 * 계산은 [`computeTeacherTuition`](./tuition.ts) 한 벌(출석부 하단 정산액과 같은 `collectTierRows` 조립) · 발행된 명세서는
 * 스냅샷 금액을 그대로 싣는다(명세서 화면과 같은 규칙 — 지급·서명이 끝난 달이 출결 정정으로 흔들리지 않게).
 * 🔴 급여 = 원장·총괄 전용(`canManageSalary`) — 게이트를 지난 뒤에만 admin(+ tenant_id 필터)으로 읽는다(단가표·명세서는 master RLS).
 * 대상 = 담임인 활성 반이 있는 강사.
 */
export async function getTeacherTuitionView(period: string): Promise<TuitionView> {
  const empty: TuitionView = { rows: [], total: 0, computedCount: 0, pendingCount: 0 };
  const user = await getCurrentUser();
  if (!user || !(await canManageSalary())) return empty;
  const admin = createAdminClient();
  const db = admin as unknown as Db;
  const tenantId = user.tenantId;

  const [classes, settings, payslips] = await Promise.all([
    fetchAllPaged<{ id: string; teacher_id: string | null }>((from, to) =>
      admin
        .from("classes")
        .select("id, teacher_id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .not("teacher_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    getTenantSettings(),
    // 0205a 미적용이어도 면은 떠야 한다(#95) — 조회 실패 = 명세서 없음.
    admin
      .from("payslips")
      .select("user_id, rate_penalty_points, status, print_payload")
      .eq("tenant_id", tenantId)
      .eq("period", period)
      .then(
        (r) => (r.data ?? []) as { user_id: string; rate_penalty_points: number | null; status: string | null; print_payload: unknown }[],
        () => [],
      ),
  ]);

  const classIdsByTeacher = new Map<string, string[]>();
  for (const c of classes) {
    if (!c.teacher_id) continue;
    const list = classIdsByTeacher.get(c.teacher_id) ?? [];
    list.push(c.id);
    classIdsByTeacher.set(c.teacher_id, list);
  }
  const teacherIds = [...classIdsByTeacher.keys()];
  if (teacherIds.length === 0) return empty;

  const users = await fetchInChunks<{
    id: string;
    display_name: string | null;
    salary_type: string | null;
    commission_rate: number | string | null;
    commission_rates: unknown;
    monthly_base: number | string | null;
  }>(teacherIds, (chunk) =>
    admin
      .from("users")
      .select("id, display_name, salary_type, commission_rate, commission_rates, monthly_base")
      .eq("tenant_id", tenantId)
      .in("id", chunk),
  );
  const slipByUser = new Map(payslips.map((p) => [p.user_id, p]));

  // 🔑 조립은 **한 번** — 강사마다 collectTierRows를 부르면 강사 수 × 7 왕복이 한꺼번에 나가고 한 명의 실패가 면 전체를 죽인다.
  //    행은 (학생 × 반 × 티어)라 반 단위로 독립이다 → 반의 담임으로 나눠 강사별로 computeTierSettlement를 부르면
  //    명세서(그 강사의 반만 조립)와 같은 금액이다(행별 내림 → 합계 내림, 순서 무관).
  const teacherOfClass = new Map<string, string>();
  for (const [t, ids] of classIdsByTeacher) for (const id of ids) teacherOfClass.set(id, t);
  let collected: Awaited<ReturnType<typeof collectTierRows>> = null;
  let collectFailed = false;
  try {
    collected = await collectTierRows(db, period, [...teacherOfClass.keys()], tenantId, settings.operations.subjects);
  } catch {
    collectFailed = true; // 0199a 미적용 등 — 면은 살리고 행마다 '조회 실패'로 밝힌다.
  }
  const tierRowsByTeacher = new Map<string, NonNullable<typeof collected>["rows"]>();
  for (const row of collected?.rows ?? []) {
    const t = teacherOfClass.get(row.classId);
    if (!t) continue;
    const list = tierRowsByTeacher.get(t) ?? [];
    list.push(row);
    tierRowsByTeacher.set(t, list);
  }

  const rows = await Promise.all(
    users.map(async (u): Promise<TuitionRow> => {
      const classIds = classIdsByTeacher.get(u.id) ?? [];
      const slip = slipByUser.get(u.id);
      const penaltyPoints = Number(slip?.rate_penalty_points ?? 0);
      const base = {
        teacherId: u.id,
        teacherName: u.display_name?.trim() || "(이름 없음)",
        classCount: classIds.length,
        penaltyPoints,
        salaryType: (u.salary_type as SalaryType | null) ?? null,
        commissionRate: u.commission_rate === null || u.commission_rate === undefined ? null : Number(u.commission_rate),
        groupRates: parseGroupRates(u.commission_rates),
        monthlyBase: Number(u.monthly_base) || 0,
      };
      // 발행된 명세서 = 그때 저장한 금액 그대로(명세서 화면과 같은 규칙).
      if (slip?.status === "issued" && slip.print_payload) {
        const frozen = slip.print_payload as PayslipData;
        return {
          ...base,
          classCount: frozen.teacher?.classes?.length ?? base.classCount,
          unitsTotal: frozen.settlement?.unitsTotal ?? 0,
          tuition: frozen.settlement?.total ?? null,
          issued: true,
          notes: ["명세서 발행됨 — 발행 금액"],
        };
      }
      const rates = appliedRatesOf(u, penaltyPoints);
      const mine = tierRowsByTeacher.get(u.id) ?? [];
      const result =
        collected && mine.length > 0
          ? computeTierSettlement(mine, collected.priceByTier, { groupRates: rates.groupRates, defaultRate: rates.defaultRate })
          : null;
      const notes: string[] = [];
      if (collectFailed) notes.push("출결·단가 조회 실패 — 잠시 후 다시 열어 주세요");
      else if (!result) notes.push("그 달 출결이 없거나 단가표가 비어 산정 불가");
      else {
        if (result.missingTierStudents.length > 0)
          notes.push(`단가 미지정 ${result.missingTierStudents.length}명 · ${result.excludedUnits}시수 제외`);
        if (result.missingPriceTiers.length > 0) notes.push(`단가표에 없는 티어: ${result.missingPriceTiers.join(", ")}`);
        if (result.missingRateGroups.length > 0) notes.push(`배분율 미정 과정: ${result.missingRateGroups.join(", ")}`);
      }
      if (penaltyPoints > 0) notes.push(`블로그 미작성 −${penaltyPoints}%p 반영`);
      return {
        ...base,
        unitsTotal: result?.unitsTotal ?? 0,
        tuition: result?.total ?? null,
        issued: false,
        notes,
      };
    }),
  );
  rows.sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko"));
  const computed = rows.filter((r) => r.tuition !== null);
  return {
    rows,
    total: computed.reduce((s, r) => s + (r.tuition ?? 0), 0),
    computedCount: computed.length,
    pendingCount: rows.length - computed.length,
  };
}
