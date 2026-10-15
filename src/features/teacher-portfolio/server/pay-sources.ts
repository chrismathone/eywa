import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAttendanceSalaryRates } from "@/features/attendance/server/salary-rates";
import { runWithAttendanceReadContext } from "@/features/attendance/server/read-context";
import { loadTeacherSheet, sheetSalaryOf } from "@/features/attendance/server/teacher-sheet";
import { TeacherSheetError } from "@/features/attendance/teacher-sheet-error";
import { rowKey } from "@/features/attendance/grid/model";
import type { TenantSettings } from "@/features/owner/settings-types";
import { isModuleEnabled } from "@/lib/modules";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { PAY_OVERRIDE_KEY } from "../evaluation/config";
import { contractMonthlyPay, type ContractRow } from "../model/contract-pay";
import { round1 } from "../model/dates";
import { indexEntries, type ManualEntryRow } from "../model/evaluate";
import { MIN_BILLED_SHARE, payDataMonth, payRatioOf, type PayFacts, type PayResult } from "../model/pay-ratio";
import { rowRevenue } from "../model/pay-revenue";
import type { PortfolioResult } from "../model/types";
import { loadMonthRevenue, type MonthRevenue } from "./pay-invoices";

/**
 * 강사평가 '매출 대비 급여'의 재료 — 원장 2026-10-13 *"출석부 하단에 합계 있을텐데"* · *"청구액 그대로"* · *"계약서에 적힌 금액"*.
 *
 * - 매출 = 그 강사 출석부(강사 전체 보기)의 줄(학생 × 담당 반, 보강 묶음 제외)마다 그 반 청구액(할인 전)의 합(`rowRevenue`) —
 *   회차 행이 있는 청구서는 출석부 청구액 열 그대로, 없으면 **그 달 청구서에서 그 반 항목 금액**(반 이름·코드 맞춤).
 *   🔴 회차 확정을 기다리지 않는다(원장 2026-10-14 *"회차 확정으로 하지말고 청구액으로 잡을것"*).
 *   영어 청구서 항목은 교재 이름이라 반 이름과 안 맞는다(실측) — 그 학생의 못 맞춘 반 하나 · 남은 수강료 항목 하나면 그 짝으로
 *   바로 잡는다(`soleLeftover`). 짝이 여럿인 줄(반 이동한 달 등)만 회차 확정 배분 뒤에 잡히고, 그사이 맞춘 줄이 80% 미만이면 비율을 내지 않는다.
 * - 급여 후보 = 계약서 월급(`contractMonthlyPay`) · 출석부 **실급여**(프리랜서 — 명세서와 같은 `sheetSalaryOf`).
 *   원장 직접 입력이 있으면 그것이 먼저다(그 결정은 모델 `payRatioOf`가 한다).
 * 🔴 로그인 없이(밤 집계) 출석부를 조립하므로 `runWithAttendanceReadContext`(지점 · 관리 클라이언트 · 이미 읽은 학원 설정) 안에서 부른다.
 * 🔴 금액은 이 모듈 밖으로 비율 재료로만 나간다 — 저장 행·화면엔 비율만(원장 *"비율만 노출하면됨"*). 외부 AI로 보내지 않는다.
 *    반별로도 금액이 아니라 매출 비중(%)·학생 수만 낸다(`byClass` — 원장 2026-10-15 '반별 비중만').
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
  const invoicesByMonth = new Map<string, Promise<MonthRevenue>>();
  const invoicesOf = (month: string) => {
    // 못 읽으면 그 달 강사 모두 같은 사유로 '다시 셀 칸'(emptyFacts retry) — 출석부 실패로 적지 않는다.
    if (!invoicesByMonth.has(month)) invoicesByMonth.set(month, loadMonthRevenue(admin, tenantId, month).catch((e: unknown) => {
      console.error("[teacher-portfolio/pay] 청구서 조회 실패", month, e instanceof Error ? e.message : e);
      throw new TeacherSheetError("청구서를 읽지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)");
    }));
    return invoicesByMonth.get(month)!;
  };
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
          const [sheet, rates, revenueOf] = await Promise.all([
            loadTeacherSheet(tenantId, teacherId, month),
            payrollOn ? loadAttendanceSalaryRates(tenantId, teacherId).catch((e: unknown) => {
              console.error("[teacher-portfolio/pay] 실급여 비율 조회 실패", teacherId, e instanceof Error ? e.message : e);
              payReadFailed = true;
              return null;
            }) : Promise.resolve(null),
            invoicesOf(month),
          ]);
          const groups = sheet.groups.filter((g) => !g.makeupPool);
          // 줄(학생 × 반)마다 그 반 청구액(`rowRevenue`). 청구서가 없는 학생의 줄은 분모에 넣지 않는다(청구할 게 없다).
          let revenue = 0, rows = 0, matched = 0;
          // 반별 몫 — 금액은 이 함수 안에서만(비중을 낸 뒤 버린다).
          const perClass = new Map<string, { className: string; students: Set<string>; rows: number; billed: number; amount: number }>();
          for (const g of groups) for (const s of g.matrix.students) {
            const c = perClass.get(g.classId) ?? perClass.set(g.classId, { className: g.className, students: new Set(), rows: 0, billed: 0, amount: 0 }).get(g.classId)!;
            c.students.add(s.id);
            const bills = revenueOf.invoices.get(s.id);
            if (!bills?.length) continue;
            const billed = sheet.billing.billed[rowKey(g.classId, s.id)];
            const enrolled = Boolean(revenueOf.enrolled.get(s.id)?.has(g.classId));
            // 그 달 그 반 수강이 없는 줄(보강 방문)은 출석부 청구액이 있을 때만 센다 — 그 반 매출이 아니다(분모에도 안 넣는다).
            if (!enrolled && billed === undefined) continue;
            rows++;
            c.rows++;
            const amount = rowRevenue({ classId: g.classId, className: g.className, billed, invoices: bills, sole: revenueOf.sole.get(s.id), enrolled });
            if (amount !== null) { matched++; revenue += amount; c.billed++; c.amount += amount; }
          }
          // 프리랜서 실급여는 출석부 단가(회차 확정)로 셈한다 — 단가가 잡힌 줄이 모자라면(달 중간·확정 전) 0원으로 만점이 되지 않게
          // 급여를 모르는 것으로 둔다(직접 입력으로 넣을 수 있다). 분모는 단가를 못 정한 줄(`no-price`)만 — 비율 없음·학년 미상으로
          // 빠진 줄은 회차 확정을 기다려도 안 풀리고, 명세서도 그 줄 없이 나간다(그 합계가 실제 받는 돈).
          const salary = rates && sheet.sessionBillingOn ? sheetSalaryOf(sheet, rates.rates) : null;
          // 청구서가 없는 학생의 줄은 매출처럼 여기서도 뺀다(회차 행이 청구서에 붙어 단가가 영영 안 선다).
          const noPrice = salary ? salary.excluded.filter((x) => x.reason === "no-price" && revenueOf.invoices.get(x.studentId)?.length) : [];
          const priced = salary ? salary.lines.length / Math.max(1, salary.lines.length + noPrice.length) : 0;
          // '기다림'(마감 미룸) = 회차 확정 단가가 아직 없는 줄만 — 단가는 있는데 못 쓰는 줄(월 정액 · 단가 여럿 · 일수 기준)은 확정 뒤에도
          // 그대로라 기다리지 않는다. 그래도 80% 분모에는 남긴다(빼면 일부 줄 급여 ÷ 전체 매출이 되어 비율이 낮게 나온다 — 그 달은 '급여 모름').
          const unpriced = noPrice.filter((x) => !sheet.billing.confirmedPrices[rowKey(x.classId, x.studentId)]?.length).length;
          const sheetPay = salary && salary.total !== null && priced >= MIN_BILLED_SHARE ? salary.total : null;
          out.set(`${teacherId}|${month}`, {
            revenue: matched ? revenue : null, rows, billedRows: matched,
            sheetPay, payPending: unpriced > 0 && sheetPay === null,
            students: new Set(groups.flatMap((g) => g.matrix.students.map((s) => s.id))).size,
            classes: groups.length,
            enrollments: groups.reduce((n, g) => n + g.matrix.students.length, 0),
            problem: null, payReadFailed,
            byClass: [...perClass.values()].map((c) => ({
              className: c.className, students: c.students.size, rows: c.rows, billed: c.billed,
              // 이 반에서 금액을 하나도 못 찾았으면 0%가 아니라 모름(null).
              share: c.billed && revenue > 0 ? round1((100 * c.amount) / revenue) : null,
            })).sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.className.localeCompare(b.className, "ko")),
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
 * 🔴 점수 달마다 **재료는 지난달 것**을 읽는다(`payDataMonth` — 원장 2026-10-15) · 결과 키는 점수 달 그대로.
 * 🔴 일시 실패로 마감을 미룬 달(`PayResult.retry`)도 여기 든다 — 두 달로 자르면 미룬 달이 한 달 뒤 계획 밖으로 밀려
 *    '계산 전' 0점으로 마감된다(적대적 재리뷰 2026-10-13). **오래된 달부터** 세서 시간 상한에 밀리지 않게 한다.
 */
export async function loadPayPlan(input: {
  admin: SupabaseClient; tenantId: string; settings: TenantSettings; result: PortfolioResult; deadline: number;
  /** 마감한 달도 센다 — 원장 지시로 마감한 달을 다시 집계하는 도구만(`recompute-all`). */
  includeClosed?: boolean;
}): Promise<PayPlan> {
  const { admin, tenantId, result } = input;
  const months = [...new Set(result.teachers.flatMap((t) => t.periods.map((w) => w.month)))];
  if (!months.length) return { facts: new Map(), contracts: new Map() };
  const closedRows = input.includeClosed ? [] : await fetchAllPaged<{ teacher_id: string; month: string }>((from, to) =>
    admin.from("teacher_portfolio_months").select("teacher_id, month").eq("tenant_id", tenantId).in("month", months)
      .not("closed_at", "is", null).order("teacher_id").order("month").range(from, to));
  const closed = new Set(closedRows.map((r) => `${r.teacher_id}|${r.month}`));
  const pairs = result.teachers
    .flatMap((t) => t.periods.filter((w) => !closed.has(`${t.id}|${w.month}`)).map((w) => ({ teacherId: t.id, month: w.month })))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!pairs.length) return { facts: new Map(), contracts: new Map() };
  const data = pairs.map((p) => ({ teacherId: p.teacherId, month: payDataMonth(p.month) }));
  const [byData, contracts] = await Promise.all([
    loadSheetFacts({ admin, tenantId, settings: input.settings, pairs: data, deadline: input.deadline }),
    loadContracts(admin, tenantId, [...new Set(pairs.map((p) => p.teacherId))]),
  ]);
  const facts = new Map<string, PayFacts>();
  for (const p of pairs) {
    const f = byData.get(`${p.teacherId}|${payDataMonth(p.month)}`);
    if (f) facts.set(`${p.teacherId}|${p.month}`, f);
  }
  return { facts, contracts };
}

/**
 * 강사|달 → 비율 — 원장 직접 입력(직접 입력 표의 급여 칸)이 먼저. 입력은 다시 매길 때마다 새로 읽은 것을 쓴다.
 * 직접 입력은 **점수 달에 저장된 값**(그 달 창에서 '9월 급여'로 넣는다) · 계약서 월급은 재료의 달(지난달) 것.
 */
export function payMapOf(plan: PayPlan, entries: readonly ManualEntryRow[]): Map<string, PayResult> {
  const entriesOf = indexEntries(entries.filter((e) => e.metric_key === PAY_OVERRIDE_KEY));
  const out = new Map<string, PayResult>();
  for (const [key, facts] of plan.facts) {
    const [teacherId, month] = key.split("|") as [string, string];
    const override = entriesOf(teacherId, month).get(PAY_OVERRIDE_KEY)?.value ?? null;
    const dataMonth = payDataMonth(month);
    const result = payRatioOf(facts, contractPayOf(plan.contracts, teacherId, dataMonth), override, dataMonth === month ? undefined : dataMonth);
    if (result) out.set(key, result);
  }
  return out;
}
