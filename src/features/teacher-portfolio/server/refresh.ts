import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { addDays, kstToday } from "@/lib/date-kst";
import { buildPortfolio, portfolioFloor } from "../model/build";
import { loadPortfolioSnapshot } from "./snapshot";
import { loadOpenMonths, portfolioTableReady, savePortfolioMonths, type SaveSummary } from "./store";

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

export async function refreshTenantPortfolio(admin: SupabaseClient, tenantId: string, opts: { now?: Date } = {}): Promise<RefreshSummary> {
  const now = opts.now ?? new Date();
  const periodEnd = addDays(kstToday(now), -1);
  if (!(await portfolioTableReady(admin, tenantId))) {
    return { tableMissing: true, periodEnd, teachers: 0, written: 0, closedMonths: [], removed: 0 };
  }
  // 설정을 못 읽으면 기본값(다른 지점의 휴원일·과목)으로 계산하지 않고 멈춘다.
  const [settings, openMonths] = await Promise.all([
    getTenantSettingsByTenantId(tenantId, { failOnReadError: true }),
    loadOpenMonths(admin, tenantId, portfolioFloor(periodEnd)),
  ]);
  const snapshot = await loadPortfolioSnapshot(admin, tenantId, {
    end: periodEnd, now,
    settings: {
      holidays: settings.operations.holidays, subjects: settings.operations.subjects,
      report_subjects: settings.report.classnoteSubjects, report_exempt: settings.report.writingExemptTeachers,
    },
  });
  const saved = await savePortfolioMonths(admin, tenantId, buildPortfolio(snapshot, { openMonths }), now);
  return { tableMissing: false, periodEnd, ...saved };
}
