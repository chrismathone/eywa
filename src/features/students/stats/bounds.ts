import { firstFlowMonth, firstNonZeroMonth, laterMonth, type FlowRow } from "./model";

/**
 * 원생 통계 카드들의 **아래 경계**와 그 안내 문장 — 화면(page.tsx)이 하던 계산을 한 곳으로(카드를 따로 그려도 같은 값을 쓰게 · 순수 · Vitest).
 * 학원 전체는 퇴원 기록 시작부터(퇴원 기록이 아직 없으면 첫 학생이 있는 달과 지점이 에이와를 시작한 달 중 늦은 쪽부터) · 과목 관리자는
 * 과목을 가를 수 있는 달(수강 종료 첫 기록 · 그것도 없으면 지점 시작 달)부터도 · 모두 에이와 수강 기록이 갖춰진 달(`trustFrom` —
 * 원장 2026-10-20 '2026년 4월부터')부터. 그 전 흐름은 '지난 기록'이 맡는다.
 */
export type StatsBounds = { recordsFrom: string | null; breakdownFrom: string | null; createdMonth: string | null; trustFrom: string | null };
type MonthlyCounts = readonly { key: string; count: number }[];

const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/** 재원생 추이(첫 선)의 아래 경계와 안내 문장. `monthly` = 학원 전체(과목 관리자는 담당 과목 전체) 월별 점. */
export function trendBounds(bounds: StatsBounds, monthly: MonthlyCounts | null, scopeLabel: string | null): { countFrom: string | null; clipNote: string | null } {
  const { recordsFrom, breakdownFrom, createdMonth, trustFrom } = bounds;
  const baseFrom = laterMonth(recordsFrom ?? laterMonth(monthly ? firstNonZeroMonth(monthly) : null, createdMonth), trustFrom);
  const countFrom = scopeLabel ? laterMonth(baseFrom, breakdownFrom ?? createdMonth) : baseFrom;
  const clipNote =
    trustFrom && countFrom === trustFrom
      ? `에이와 수강 기록이 갖춰진 ${monthText(trustFrom)}부터 그립니다 — 그 전 달은 옮겨 오기 전 학생의 수강 시작일이 늦게 잡혀 실제보다 낮게 나옵니다(그 전 흐름은 아래 '지난 기록').`
      : scopeLabel && countFrom
        ? breakdownFrom && countFrom === breakdownFrom
          ? `${scopeLabel} 흐름은 ${monthText(countFrom)}부터입니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 과목을 가를 수 없습니다.`
          : `${scopeLabel} 흐름은 ${monthText(countFrom)}부터의 기록만 보입니다.`
        : recordsFrom
          ? `퇴원 기록이 ${monthText(recordsFrom)}부터 있어, 그 전 기간은 정확히 셀 수 없어 보이지 않습니다.`
          : countFrom
            ? `${monthText(countFrom)}부터의 기록만 보입니다 — 그 전 기간은 떠난 학생의 기록이 없어 정확히 셀 수 없습니다.`
            : null;
  return { countFrom, clipNote };
}

/** 강좌수 추이 — 수강 행에 기대므로 수강 종료가 처음 기록된 달(breakdownFrom)도 지킨다(과목 선과 같은 경계). */
export function courseBounds(bounds: StatsBounds, trend: { countFrom: string | null; clipNote: string | null }): { courseFrom: string | null; courseClipNote: string | null } {
  const { breakdownFrom, trustFrom } = bounds;
  const courseFrom = laterMonth(trend.countFrom, breakdownFrom);
  const courseClipNote =
    trustFrom && courseFrom === trustFrom
      ? `에이와 수강 기록이 갖춰진 ${monthText(trustFrom)}부터 그립니다 — 그 전 달은 옮겨 오기 전 학생의 수강 시작일이 늦게 잡혀 실제보다 적게 나옵니다.`
      : breakdownFrom && courseFrom === breakdownFrom && courseFrom !== trend.countFrom
        ? `강좌수는 ${monthText(breakdownFrom)}부터 그립니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 반을 셀 수 없습니다.`
        : trend.clipNote;
  return { courseFrom, courseClipNote };
}

/** 월별 기록(등록·퇴원 추이)의 아래 경계 + 말일 재원생(재원생 추이 첫 선과 같은 값 · 같은 경계로 자른 것). */
export function flowBounds(
  bounds: StatsBounds,
  rows: readonly FlowRow[] | null,
  monthly: MonthlyCounts | null,
  scopeLabel: string | null,
): { flowFrom: string | null; monthEnd: Record<string, number> | null } {
  const { recordsFrom, breakdownFrom, createdMonth, trustFrom } = bounds;
  const flowBase = laterMonth(recordsFrom ?? laterMonth(rows ? firstFlowMonth(rows) : null, createdMonth), trustFrom);
  const flowFrom = scopeLabel ? laterMonth(flowBase, breakdownFrom ?? createdMonth) : flowBase;
  const monthEnd = monthly ? Object.fromEntries(monthly.filter((p) => !flowFrom || p.key >= flowFrom).map((p) => [p.key, p.count])) : null;
  return { flowFrom, monthEnd };
}
