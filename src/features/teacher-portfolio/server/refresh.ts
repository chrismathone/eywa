import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { reportWarning } from "@/lib/observability/report-error";
import { addDays, kstToday, shiftMonth } from "@/lib/date-kst";
import { PORTFOLIO_MONTHS, buildPortfolio, portfolioFloor } from "../model/build";
import { monthWindows } from "../model/dates";
import { loadEvaluationConfig, loadManualEntries } from "./evaluation-store";
import { loadPayPlan, payMapOf, type PayPlan } from "./pay-sources";
import { loadPortfolioSnapshot } from "./snapshot";
import { loadOpenMonths, portfolioRawsReady, portfolioTableReady, savePortfolioMonths, type SaveSummary } from "./store";

/**
 * 한 지점의 직원 포트폴리오를 다시 집계한다 — 매일 cron과 화면의 [지금 집계]가 같은 함수를 부른다.
 *
 * 수업 대상은 **한국 시간 어제까지**다. 그래서 1일 새벽에 돌면 지난달이 말일까지 다 찬 달이 되어 그때 마감된다.
 * 하루를 놓쳐도(cron 실패) 다음 실행이 아직 마감하지 않은 달을 마감한다 — 날짜가 아니라 상태로 잡는다.
 * 마감한 달은 다시 쓰지 않는다(store.ts).
 *
 * 🔴 admin 클라이언트 전용 → 안의 모든 조회·쓰기가 tenant_id를 명시한다.
 */
export type RefreshSummary = SaveSummary & { tableMissing: boolean; periodEnd: string };

/**
 * cron이 지점을 도는 순서 — 날마다 한 칸씩 돌린다. 시간이 모자라 뒤 지점을 건너뛰는 날이 있어도
 * 늘 같은 지점만 밀리지 않게(밀린 달은 다음 실행이 마감한다).
 */
export function rotateForDay<T>(items: readonly T[], today: string): T[] {
  if (!items.length) return [];
  const offset = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * 화면 집계([지금 집계] · 저장 뒤 다시 매기기)의 출석부 조립 시간 — 함수 상한이 120초라 스냅샷·저장 몫을 남긴다.
 * 밤 집계는 지점이 여럿이라 route가 `payDeadline`을 직접 준다.
 */
const SCREEN_PAY_BUDGET_MS = 50_000;

export async function refreshTenantPortfolio(
  admin: SupabaseClient, tenantId: string, opts: { now?: Date; payDeadline?: number } = {},
): Promise<RefreshSummary> {
  const now = opts.now ?? new Date();
  const periodEnd = addDays(kstToday(now), -1);
  if (!(await portfolioTableReady(admin, tenantId))) {
    return { tableMissing: true, periodEnd, teachers: 0, written: 0, closedMonths: [], removed: 0 };
  }
  // 설정을 못 읽으면 기본값(다른 지점의 휴원일·과목)으로 계산하지 않고 멈춘다.
  // 강사평가 설정·직접 만든 지표 입력(0359a)은 표가 없으면 기본 설정·빈 입력이다.
  const months = monthWindows(periodEnd, PORTFOLIO_MONTHS).map((w) => w.month);
  const loadScoring = async () => {
    const [evaluation, entries] = await Promise.all([loadEvaluationConfig(admin, tenantId), loadManualEntries(admin, tenantId, months)]);
    return { evaluation, entries, stamp: `${evaluation.updatedAt ?? ""}|${JSON.stringify(entries)}` };
  };
  const [settings, openMonths, first, withRaws] = await Promise.all([
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    loadOpenMonths(admin, tenantId, portfolioFloor(periodEnd)),
    loadScoring(),
    portfolioRawsReady(admin, tenantId),
  ]);
  const snapshot = await loadPortfolioSnapshot(admin, tenantId, {
    end: periodEnd, now,
    settings: {
      holidays: settings.operations.holidays, subjects: settings.operations.subjects,
      report_subjects: settings.report.classnoteSubjects, report_exempt: settings.report.writingExemptTeachers,
    },
  });
  // 🔴 집계가 도는 사이 원장이 설정·직접 입력을 또 저장했으면, 늦게 끝난 쪽이 옛 설정으로 덮어쓴다(저장마다 따로 다시 매기기가 돈다).
  //    쓰고 나서 설정·입력을 다시 읽어 달라졌으면 새 값으로 한 번 더 매긴다(같은 스냅샷 — 기록은 그대로고 점수 규칙만 바뀐 것).
  //    마감한 달은 첫 번째 쓰기에서 굳으므로 요약은 두 번을 합친다(다시 매긴 쪽은 이미 마감된 줄을 건너뛰어 '마감 0'으로 보인다).
  // 매출 대비 급여(켠 경우만) — 진행 중인 달의 출석부를 조립해 청구액·실급여를 낸다(무겁다 — 한 번만, 비율은 다시 매길 때마다).
  //   재료를 못 모으면(마감 확인·계약서 조회 실패) 급여 비율만 '계산 전'으로 두고 나머지 지표는 그대로 저장한다.
  //   🔴 일시 실패(조회 실패·시간 초과)로 못 센 달은 **마감하지 않는다** — 1일 새벽 마감 때 0점으로 굳지 않게 다음 집계가 다시 센다
  //      (기준 달을 기다리는 달과 같은 방식 · 창 끝 달은 그래도 마감).
  const noPay: PayPlan = { facts: new Map(), contracts: new Map() };
  const payOn = first.evaluation.config.metrics.payRatio.enabled;
  let payFailed = false;
  const plan: PayPlan = payOn
    ? await loadPayPlan({
      admin, tenantId, settings, deadline: opts.payDeadline ?? Date.now() + SCREEN_PAY_BUDGET_MS,
      result: buildPortfolio(snapshot, { openMonths, evaluation: { config: first.evaluation.config, entries: first.entries } }),
    }).catch((e: unknown) => {
      reportWarning("강사평가 급여 비율 재료 조회 실패", { scope: "refreshTenantPortfolio", message: e instanceof Error ? e.message : String(e) });
      payFailed = true;
      return noPay;
    })
    : noPay;
  const holdFrom = shiftMonth(periodEnd.slice(0, 7), -1);
  let scoring = first;
  let saved: SaveSummary | null = null;
  for (let pass = 0; ; pass++) {
    const pay = payMapOf(plan, scoring.entries);
    const result = buildPortfolio(snapshot, { openMonths, evaluation: { config: scoring.evaluation.config, entries: scoring.entries }, pay });
    // 재료 조회 자체가 실패하면 어느 달을 못 셌는지도 모른다 — 그 실행은 마감을 모두 미룬다(다음 실행이 다시 센다).
    // 미루는 것은 다음 달 말까지 — 계속 나는 오류(깨진 비율표 등)로 달이 반년씩 열려 있지 않게, 그 뒤엔 사유를 남긴 채 마감한다.
    const holdClose = (teacherId: string, month: string) =>
      month >= holdFrom && (payFailed || Boolean(pay.get(`${teacherId}|${month}`)?.retry));
    const once = await savePortfolioMonths(admin, tenantId, result, now, { withRaws, holdClose });
    saved = !saved ? once : {
      teachers: once.teachers, written: Math.max(saved.written, once.written), removed: saved.removed + once.removed,
      closedMonths: [...new Set([...saved.closedMonths, ...once.closedMonths])].sort(),
    };
    if (pass >= 2) break;
    const latest = await loadScoring();
    if (latest.stamp === scoring.stamp) break;
    scoring = latest;
  }
  return { tableMissing: false, periodEnd, ...saved };
}
