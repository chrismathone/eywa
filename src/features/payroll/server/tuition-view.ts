import "server-only";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import type { createClient } from "@/lib/supabase/server";
import type { PayslipData } from "@/features/payroll/payslip-view";
import type { SalaryType } from "../settlement";
import { parseGroupRates, type GroupRates } from "../salary-group";
import { canReadSalary } from "./salary-access";
import { appliedRatesOf } from "./tuition";
import { computeSheetTuition } from "./sheet-tuition";
import { collectTierRows } from "./tier-rows";
import { computeTierSettlement } from "@/features/payroll/tier-settlement";
import { hasFreelancePart } from "@/features/staff/employment";

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
/** 프리랜서 출석부 수업료를 동시에 조립할 사람 수 — 한 사람이 반 수만큼 조회를 내므로 작게 둔다. */
const SHEET_CONCURRENCY = 3;
// computeTeacherTuition(명세서 한 명)과 같은 조립·같은 산식 — 여기선 여러 명을 한 번에 조립해 반 담임으로 나눈다.

/**
 * 수납 '강사 정산' 면 — **급여명세서와 같은 수업료**를 강사마다(원장 2026-09-28 *"급여는 출석부에서 맞춰놓은것을 기준으로"*).
 * 계산은 명세서와 같은 갈림이다: **프리랜서** = 출석부 실급여 합계([`computeSheetTuition`](./sheet-tuition.ts), 2026-10-06) ·
 * **그 밖** = [`computeTeacherTuition`](./tuition.ts) 한 벌(출석부 하단 정산액과 같은 `collectTierRows` 조립) · 발행된 명세서는
 * 스냅샷 금액을 그대로 싣는다(명세서 화면과 같은 규칙 — 지급·서명이 끝난 달이 출결 정정으로 흔들리지 않게).
 * 🔴 급여 = 원장·총괄 전용(`canReadSalary`) — 게이트를 지난 뒤에만 admin(+ tenant_id 필터)으로 읽는다(단가표·명세서는 master RLS).
 * 대상 = 담임인 활성 반이 있는 강사.
 * ⚠️ 그래서 **교시만 맡는 프리랜서**(담임 반 0개)는 명세서엔 수업료가 서지만 이 면에는 줄이 없다(종전과 같은 대상 규칙 —
 *    2026-10-06 실측 해당자 0명). 그런 사람이 생기면 대상에 프리랜서 교시 담당을 더할 것.
 */
export async function getTeacherTuitionView(period: string): Promise<TuitionView> {
  const empty: TuitionView = { rows: [], total: 0, computedCount: 0, pendingCount: 0 };
  const user = await getCurrentUser();
  if (!user || !(await canReadSalary())) return empty;
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
    employment_type: string | null;
  }>(teacherIds, (chunk) =>
    admin
      .from("users")
      .select("id, display_name, salary_type, commission_rate, commission_rates, monthly_base, employment_type")
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
    collected = await collectTierRows(db, period, [...teacherOfClass.keys()], tenantId, settings.operations.subjects, {
      substituteTeacherIds: teacherIds,
    });
  } catch {
    collectFailed = true; // 0199a 미적용 등 — 면은 살리고 행마다 '조회 실패'로 밝힌다.
  }
  const tierRowsByTeacher = new Map<string, NonNullable<typeof collected>["rows"]>();
  for (const row of collected?.rows ?? []) {
    // 🔴 대신 보강 칸은 반 담임이 아니라 **보강한 강사** 몫(원장 결정 3) — 명세서(`tierRowsOwnedBy`)와 같은 귀속.
    const t = row.taughtBy ?? teacherOfClass.get(row.classId);
    if (!t) continue;
    const list = tierRowsByTeacher.get(t) ?? [];
    list.push(row);
    tierRowsByTeacher.set(t, list);
  }

  /**
   * 프리랜서의 출석부 수업료 — **몇 명씩만 동시에** 조립한다(B6·B7). 한 사람의 출석부가 반 수만큼 매트릭스를 읽으므로
   * 전원을 한꺼번에 띄우면 프리랜서 수 × 반 수의 조회가 한 번에 나간다(적대 리뷰 2026-10-06). 발행된 사람은 스냅샷을 쓰므로 건너뛴다.
   */
  type SheetOutcome = Awaited<ReturnType<typeof computeSheetTuition>> | "failed";
  const sheetByUser = new Map<string, SheetOutcome>();
  const sheetTargets = users.filter((u) => {
    const slip = slipByUser.get(u.id);
    return hasFreelancePart(u.employment_type) && !(slip?.status === "issued" && slip.print_payload);
  });
  for (let i = 0; i < sheetTargets.length; i += SHEET_CONCURRENCY) {
    await Promise.all(
      sheetTargets.slice(i, i + SHEET_CONCURRENCY).map(async (u) => {
        const penaltyPoints = Number(slipByUser.get(u.id)?.rate_penalty_points ?? 0);
        try {
          sheetByUser.set(u.id, await computeSheetTuition({ tenantId, teacherId: u.id, period, penaltyPoints, contractRates: parseGroupRates(u.commission_rates) }));
        } catch (e) {
          // 이동(redirect)·동적 렌더 신호 같은 프레임워크 오류는 삼키지 않는다 — 접는 것은 조회 실패뿐이다.
          unstable_rethrow(e);
          console.error("[tuition-view] 출석부 실급여 조립 실패", u.id, e instanceof Error ? e.message : e);
          sheetByUser.set(u.id, "failed");
        }
      }),
    );
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
      /**
       * 🔴 **프리랜서 = 그 강사 출석부의 실급여 합계**(원장 2026-10-06 *"전부 통일 출석부 그대로"* · *"프리랜서만."*) — 명세서와
       *    **같은 함수**(`computeSheetTuition`)라 두 화면의 금액이 같다. 프리랜서가 아니거나 회차 정산이 꺼진 학원은 null → 아래 티어 정산.
       * ⚠️ 조립은 위에서 몇 명씩 끝냈다(`sheetByUser`). 한 명의 실패가 면 전체를 죽이지 않게 접되, 실패한 사람을 티어 정산으로
       *    떨어뜨리지는 않는다(다른 식의 금액이 명세서와 갈린다).
       */
      const sheet = sheetByUser.get(u.id);
      if (sheet === "failed") {
        return { ...base, unitsTotal: 0, tuition: null, issued: false, notes: ["출석부 조립 실패 — 잠시 후 다시 열어 주세요"] };
      }
      if (sheet) {
        return {
          ...base,
          unitsTotal: sheet.settlement?.unitsTotal ?? 0,
          tuition: sheet.settlement?.total ?? null,
          issued: false,
          notes: ["출석부 실급여 기준", ...sheet.warnings, ...(penaltyPoints > 0 ? [`블로그 미작성 −${penaltyPoints}%p 반영`] : [])],
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
