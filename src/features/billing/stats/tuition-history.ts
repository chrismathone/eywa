/**
 * 수납 통계 **'지난 기록 — 수업료 수납'**(원장 2026-10-21 *"청구 수납도 더 이전 데이터 못찾나?"*) — 지난 기록 월별 집계(0385a
 * `student_history_monthly`)의 돈 칸으로 청구월마다 수업료 수납을 EiE 외 / EiE로 잇는다. 순수 함수(Vitest).
 *   makeedu = 2020-01 ~ 2025-12 메이크에듀 수납 원자료(0384a — 운영자 스크립트가 한 번 센다)
 *   aywa    = 청구가 지점을 덮은 달 ~ 이번 달 에이와 청구(원생 매일 기록 cron이 밤마다 다시 센다 — `aywaHistoryMonths`)
 * 겹치는 달은 에이와가 이긴다(`mergeHistory`와 같은 규칙).
 * 🔑 **수업료만**(수업 항목) — 교재·차량비 같은 기타 항목은 메이크에듀에서 2025-05에 청구 방식이 바뀌어(그 전 달마다 4~5천만 원 → 그 뒤
 *    1천만 원대) 길게 견줄 수 없다. 🔑 2025-05 전엔 EiE·국어·매쓰몽 수업료가 메이크에듀 **'교재' 구분**에 있었다 — 운영자 스크립트가 그 줄도
 *    수업료로 센다(`makeedu-history-bills.ts` · 2026-10-28 — EiE는 2021-07부터 · 그 전은 0). 청구 건수를 비운 달(2020-02·2025-04)도 돈 칸은 있다.
 * ⚠️ 2025-03·04는 청구 방식이 바뀐 때다(그 뒤로는 다음 달 수업료를 미리 청구) — 3월이 많고 4월이 적다. 고르지 않고 그대로 두고 화면이 밝힌다.
 */
export type TuitionRow = { month: string; source: "makeedu" | "aywa"; data: unknown };
/** 한 달 — 원. 값이 없는 칸은 비운다. */
export type TuitionMonth = { month: string; general?: number; eie?: number; source: "makeedu" | "aywa" };
export type TuitionYear = { year: string; months: number; general?: number; eie?: number; generalMonths: number; eieMonths: number };

const money = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

/** 두 출처 → 달마다 한 줄(달 순서). 돈 칸이 하나도 없는 줄은 뺀다(메이크에듀 재원생 기록만 있는 2026-01~03 줄 등). */
export function mergeTuitionHistory(rows: readonly TuitionRow[]): TuitionMonth[] {
  const byMonth = new Map<string, TuitionMonth>();
  const ordered = [...rows].sort((a, b) => a.month.localeCompare(b.month) || (a.source === "makeedu" ? -1 : 1));
  for (const r of ordered) {
    if (!/^\d{4}-\d{2}$/.test(r.month)) continue;
    const o = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};
    const general = money(o.tuitionPaidGeneral);
    const eie = money(o.tuitionPaidEie);
    if (general === undefined && eie === undefined) continue;
    // 에이와 줄이 있으면 그 달은 에이와 값 그대로(메이크에듀 칸과 섞지 않는다).
    byMonth.set(r.month, { month: r.month, source: r.source, ...(general !== undefined ? { general } : {}), ...(eie !== undefined ? { eie } : {}) });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** 연도별 — 그해 값이 있는 달의 **합**(돈은 합이 뜻이 있다) · 칸마다 더한 달 수(열두 달이 안 찬 해를 밝힌다). */
export function yearlyTuition(months: readonly TuitionMonth[]): TuitionYear[] {
  const byYear = new Map<string, TuitionMonth[]>();
  for (const m of months) byYear.set(m.month.slice(0, 4), [...(byYear.get(m.month.slice(0, 4)) ?? []), m]);
  return [...byYear]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, list]) => {
      const g = list.filter((m) => m.general !== undefined);
      const e = list.filter((m) => m.eie !== undefined);
      return {
        year,
        months: list.length,
        ...(g.length ? { general: g.reduce((n, m) => n + m.general!, 0) } : {}),
        ...(e.length ? { eie: e.reduce((n, m) => n + m.eie!, 0) } : {}),
        generalMonths: g.length,
        eieMonths: e.length,
      };
    });
}
