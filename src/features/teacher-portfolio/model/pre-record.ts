/**
 * 기록을 시작하기 전에 끝난 달 — 보고서·출결을 같은 강사의 기준 달 평균으로 둔다.
 *
 * 원장 결정(2026-10-12): 침산은 2026-07-01부터 수업보고서·출결을 앱에 기록했다. 그 전 달(4~6월)은
 * 기록이 없어 0점이 되므로 0점·산출불가·만점 대신 8~9월 평균을 쓴다. 기록을 시작한 첫 달(7월)은
 * 한 달이 다 차지 않아 기준에서 뺀다.
 *
 * - 그 달에 대상이 없던 강사(수업 전·보고서 담당 아님)는 다른 달과 똑같이 계산한다.
 * - 기준 달이 산출불가이거나 대상이 없으면 그 달은 뺀다. 쓸 달이 하나도 없으면 산출불가.
 * - 평균으로 둔 달에는 기록처럼 보이는 줄을 만들지 않는다(`detail`을 비우고 `estimated`에 근거를 싣는다).
 */
import { monthOf, shiftMonth } from "@/lib/date-kst";
import { round1 } from "./dates";
import { metricOf, type PortfolioPeriod, type PreRecordPolicy } from "./types";

export type DutyCounts = { report: number; attendance: number };
export type WorkingPeriod = PortfolioPeriod & { duty: DutyCounts };

export function scoreTotals(items: PortfolioPeriod["items"]): Pick<PortfolioPeriod, "knownCount" | "knownScore" | "knownMax" | "total"> {
  const known = items.filter((x) => x.value !== null);
  const sum = round1(known.reduce((n, x) => n + (x.value as number), 0));
  return { knownCount: known.length, knownScore: sum, knownMax: known.reduce((n, x) => n + x.max, 0), total: known.length === items.length ? sum : null };
}

/** "8~9월 평균" · "9월 점수" · "8월·10월 평균". */
export function referenceLabel(months: readonly string[]): string {
  const n = months.map((m) => Number(m.slice(5)));
  if (n.length === 1) return `${n[0]}월 점수`;
  const consecutive = n.every((x, i) => !i || x === n[i - 1] + 1);
  return `${consecutive ? `${n[0]}~${n[n.length - 1]}월` : n.map((x) => `${x}월`).join("·")} 평균`;
}

const koreanDate = (day: string) => `${Number(day.slice(0, 4))}년 ${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`;

/** 기록 시작 다음 달부터 온전히 지난 두 달 — 시작한 달은 한 달이 다 차지 않아 뺀다. */
export function referenceMonthsAfter(before: string, count = 2): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(monthOf(before), i + 1));
}

/**
 * 기준 달 평균을 쓴 달이 **아직 마감하면 안 되는가** — 기준 달이 하나라도 아직 끝나지 않았으면 기다린다.
 * 기록을 막 시작한 지점은 기준 달이 미래라 지금 마감하면 영영 산출불가로 굳는다(적대적 리뷰 2026-10-13).
 */
export function awaitsReference(period: Pick<PortfolioPeriod, "items">, policy: PreRecordPolicy | null, lastClosedMonth: string | null): boolean {
  if (!policy) return false;
  return period.items.some((m) => {
    const rule = m.estimated && (m.id === "report" || m.id === "attendance") ? policy[m.id] : undefined;
    return Boolean(rule?.reference.some((month) => !lastClosedMonth || month > lastClosedMonth));
  });
}

export function applyPreRecord(monthly: WorkingPeriod[], policy: PreRecordPolicy): void {
  for (const w of monthly) {
    let changed = false;
    for (const id of ["report", "attendance"] as const) {
      const rule = policy[id];
      const targets = w.duty[id];
      if (!rule || w.end >= rule.before || !targets) continue;
      const used = monthly
        .filter((r) => rule.reference.includes(r.month) && !r.partial && r.end >= rule.before)
        .map((r) => ({ month: r.month, value: metricOf(r, id).value, targets: r.duty[id] }))
        .filter((r): r is { month: string; value: number; targets: number } => r.targets > 0 && r.value !== null)
        .map(({ month, value }) => ({ month, value }))
        .sort((a, b) => a.month.localeCompare(b.month));
      const m = metricOf(w, id);
      const label = referenceLabel(used.map((r) => r.month));
      m.value = used.length ? round1(used.reduce((n, r) => n + r.value, 0) / used.length) : null;
      m.estimated = { since: rule.before, targets, reference: used };
      m.detail = [];
      m.basis = used.length ? `기록 시작 전 · ${label}` : "기록 시작 전 · 기준 달 점수 없음";
      m.reason = used.length
        ? `${koreanDate(rule.before)}부터 기록했습니다. 그 전 달은 같은 강사의 ${label}${label.endsWith("평균") ? "으로" : "로"} 둡니다. ${used.map((r) => `${Number(r.month.slice(5))}월 ${r.value.toFixed(1)}점`).join(" · ")}.`
        : `${koreanDate(rule.before)}부터 기록했습니다. 기준으로 삼을 달의 점수가 없어 산출하지 않았습니다.`;
      if (m.value === null) m.gap = "기준 달 점수 없음";
      else delete m.gap;
      changed = true;
    }
    if (!changed) continue;
    Object.assign(w, scoreTotals(w.items));
    if (metricOf(w, "report").estimated) {
      w.dayStats = w.dayStats.map((s) => ({ ...s, target: 0, own: 0, proxy: 0, missing: 0, late: 0 }));
    }
  }
}
