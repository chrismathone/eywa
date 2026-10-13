import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAttendanceSalaryRates } from "@/features/attendance/server/salary-rates";
import { runWithAttendanceReadContext } from "@/features/attendance/server/read-context";
import { loadTeacherSheet, sheetBilledOf, sheetSalaryOf } from "@/features/attendance/server/teacher-sheet";
import { TeacherSheetError } from "@/features/attendance/teacher-sheet-error";
import { rowKey } from "@/features/attendance/grid/model";
import type { TenantSettings } from "@/features/owner/settings-types";
import { isModuleEnabled } from "@/lib/modules";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { PAY_OVERRIDE_KEY } from "../evaluation/config";
import { contractMonthlyPay, type ContractRow } from "../model/contract-pay";
import { indexEntries, type ManualEntryRow } from "../model/evaluate";
import { payRatioOf, type PayFacts, type PayResult } from "../model/pay-ratio";
import type { PortfolioResult } from "../model/types";

/**
 * 강사평가 '매출 대비 급여'의 재료 — 원장 2026-10-13 *"출석부 하단에 합계 있을텐데"* · *"청구액 그대로"* · *"계약서에 적힌 금액"*.
 *
 * - 매출 = 그 강사 출석부(강사 전체 보기) 합계 행의 **청구액**(`sheetBilledOf` — 화면과 같은 조립 `loadTeacherSheet`).
 * - 급여 후보 = 계약서 월급(`contractMonthlyPay`) · 출석부 **실급여**(프리랜서 — 명세서와 같은 `sheetSalaryOf`).
 *   원장 직접 입력이 있으면 그것이 먼저다(그 결정은 모델 `payRatioOf`가 한다).
 * 🔴 로그인 없이(밤 집계) 출석부를 조립하므로 `runWithAttendanceReadContext`(지점 · 관리 클라이언트 · 이미 읽은 학원 설정) 안에서 부른다.
 * 🔴 금액은 이 모듈 밖으로 비율 재료로만 나간다 — 저장 행·화면엔 비율만(원장 *"비율만 노출하면됨"*). 외부 AI로 보내지 않는다.
 * ⚠️ 무겁다(강사 × 달마다 출석부 하나) — 호출부는 마감하지 않은 달만, 3개씩 나란히(명세서 목록과 같은 폭).
 */
const CONCURRENCY = 3;
/**
 * 못 센 칸 — 조회 실패·시간 초과는 일시적이라 `retry`(집계가 그 달 마감을 미루고 다음 집계가 다시 센다).
 * 시간 상한(`deadline`)은 부르는 쪽이 준다 — 화면 집계는 함수 상한 120초 안에 저장까지, 밤 집계는 지점이 여럿인 300초 안에.
 */
const emptyFacts = (problem: string): PayFacts =>
  ({ revenue: null, sheetPay: null, students: 0, classes: 0, enrollments: 0, rows: 0, billedRows: 0, problem, retry: true });

export async function loadSheetFacts(input: {
  admin: SupabaseClient; tenantId: string; settings: TenantSettings; pairs: readonly { teacherId: string; month: string }[]; deadline: number;
}): Promise<Map<string, PayFacts>> {
  const { admin, tenantId, settings, deadline } = input;
  const out = new Map<string, PayFacts>();
  const queue = [...input.pairs];
  // 실급여는 급여 모듈을 쓰는 지점만(화면의 실급여 열과 같은 스위치) — 꺼져 있으면 계약서 월급·직접 입력만 쓴다.
  const payrollOn = isModuleEnabled(settings.modules.disabled, "payroll");
  await runWithAttendanceReadContext({ tenantId, db: admin, settings }, async () => {
    const work = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { teacherId, month } = next;
        if (Date.now() > deadline) {
          out.set(`${teacherId}|${month}`, emptyFacts("이번 집계 시간 안에 다 세지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)"));
          continue;
        }
        try {
          // 실급여 비율표를 못 읽어도 매출(청구액)은 산다 — 급여는 계약서 월급·직접 입력으로 갈 수 있다.
          let payReadFailed = false;
          const [sheet, rates] = await Promise.all([
            loadTeacherSheet(tenantId, teacherId, month),
            payrollOn ? loadAttendanceSalaryRates(tenantId, teacherId).catch((e: unknown) => {
              console.error("[teacher-portfolio/pay] 실급여 비율 조회 실패", teacherId, e instanceof Error ? e.message : e);
              payReadFailed = true;
              return null;
            }) : Promise.resolve(null),
          ]);
          const groups = sheet.groups.filter((g) => !g.makeupPool);
          // 청구액이 잡힐 줄 = 보강 묶음 밖에서 청구서가 살아 있는 학생의 줄 — 청구서가 없거나 취소된 줄(출석부 '—')은
          // 회차 확정이 끝나도 청구액이 안 생기니 '덜 됐다'의 분모에 넣지 않는다(판정을 안 한 지점은 빈 맵 = 전부 센다).
          const state = sheet.billing.invoiceStateByStudent;
          const keys = groups.flatMap((g) => g.matrix.students
            .filter((s) => state[s.id] !== "none" && state[s.id] !== "void")
            .map((s) => rowKey(g.classId, s.id)));
          out.set(`${teacherId}|${month}`, {
            revenue: sheetBilledOf(sheet),
            rows: keys.length, billedRows: keys.filter((k) => typeof sheet.billing.billed[k] === "number").length,
            sheetPay: rates && sheet.sessionBillingOn ? sheetSalaryOf(sheet, rates.rates).total : null,
            students: new Set(groups.flatMap((g) => g.matrix.students.map((s) => s.id))).size,
            classes: groups.length,
            enrollments: groups.reduce((n, g) => n + g.matrix.students.length, 0),
            problem: null, payReadFailed,
          });
        } catch (e) {
          // 출석부를 금액으로 쓸 수 없는 상태(접힌 재료·조회 실패)는 0이 아니라 '자료 없음' — 까닭을 남긴다.
          const problem = e instanceof TeacherSheetError ? e.message : "출석부를 읽지 못했습니다";
          if (!(e instanceof TeacherSheetError)) console.error("[teacher-portfolio/pay] 출석부 조립 실패", teacherId, month, e);
          out.set(`${teacherId}|${month}`, emptyFacts(problem));
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
  });
  return out;
}

/** 강사 → 계약 이력(직원관리) — 그 강사들 것만, 관리 클라이언트 + 지점 조건(#104). */
export async function loadContracts(admin: SupabaseClient, tenantId: string, teacherIds: readonly string[]): Promise<Map<string, ContractRow[]>> {
  const ids = new Set(teacherIds);
  if (!ids.size) return new Map();
  const rows = await fetchAllPaged<ContractRow & { user_id: string }>((from, to) =>
    admin.from("staff_contracts").select("user_id, kind, start_date, end_date, terms, seq").eq("tenant_id", tenantId).order("id").range(from, to));
  const out = new Map<string, ContractRow[]>();
  for (const r of rows) if (ids.has(r.user_id)) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  return out;
}

/** 계약서 월급(강사 × 달) — 모델로 넘길 때는 비율 계산에만 쓴다. */
export function contractPayOf(contracts: ReadonlyMap<string, ContractRow[]>, teacherId: string, month: string): number | null {
  return contractMonthlyPay(contracts.get(teacherId) ?? [], month);
}

export type PayPlan = { facts: Map<string, PayFacts>; contracts: Map<string, ContractRow[]> };

/**
 * 이번 집계에서 급여 비율을 낼 칸 — **아직 마감하지 않은 달 전부**(평소엔 진행 중인 달 하나 · 1일 새벽엔 마감할 지난달 · 마감을 미룬 달). 마감한 달은 굳어 있어 다시 셀 필요가 없고,
 * 출석부 조립은 무겁다. 1일 새벽 집계는 집계 끝 날이 지난달 말일이라 마감하는 그 달을 센다(마감 전에 값이 선다).
 * 🔴 일시 실패로 마감을 미룬 달(`PayResult.retry`)도 여기 든다 — 두 달로 자르면 미룬 달이 한 달 뒤 계획 밖으로 밀려
 *    '계산 전' 0점으로 마감된다(적대적 재리뷰 2026-10-13). **오래된 달부터** 세서 시간 상한에 밀리지 않게 한다.
 */
export async function loadPayPlan(input: {
  admin: SupabaseClient; tenantId: string; settings: TenantSettings; result: PortfolioResult; deadline: number;
}): Promise<PayPlan> {
  const { admin, tenantId, result } = input;
  const months = [...new Set(result.teachers.flatMap((t) => t.periods.map((w) => w.month)))];
  if (!months.length) return { facts: new Map(), contracts: new Map() };
  const closedRows = await fetchAllPaged<{ teacher_id: string; month: string }>((from, to) =>
    admin.from("teacher_portfolio_months").select("teacher_id, month").eq("tenant_id", tenantId).in("month", months)
      .not("closed_at", "is", null).order("teacher_id").order("month").range(from, to));
  const closed = new Set(closedRows.map((r) => `${r.teacher_id}|${r.month}`));
  const pairs = result.teachers
    .flatMap((t) => t.periods.filter((w) => !closed.has(`${t.id}|${w.month}`)).map((w) => ({ teacherId: t.id, month: w.month })))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!pairs.length) return { facts: new Map(), contracts: new Map() };
  const [facts, contracts] = await Promise.all([
    loadSheetFacts({ admin, tenantId, settings: input.settings, pairs, deadline: input.deadline }),
    loadContracts(admin, tenantId, [...new Set(pairs.map((p) => p.teacherId))]),
  ]);
  return { facts, contracts };
}

/** 강사|달 → 비율 — 원장 직접 입력(직접 입력 표의 급여 칸)이 먼저. 입력은 다시 매길 때마다 새로 읽은 것을 쓴다. */
export function payMapOf(plan: PayPlan, entries: readonly ManualEntryRow[]): Map<string, PayResult> {
  const entriesOf = indexEntries(entries.filter((e) => e.metric_key === PAY_OVERRIDE_KEY));
  const out = new Map<string, PayResult>();
  for (const [key, facts] of plan.facts) {
    const [teacherId, month] = key.split("|") as [string, string];
    const override = entriesOf(teacherId, month).get(PAY_OVERRIDE_KEY)?.value ?? null;
    const result = payRatioOf(facts, contractPayOf(plan.contracts, teacherId, month), override);
    if (result) out.set(key, result);
  }
  return out;
}
