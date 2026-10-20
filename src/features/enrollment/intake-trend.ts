import type { PeriodKeys, StatsPeriod } from "@/features/stats/period";
import type { GroupsOf } from "@/features/dashboard/layout/slices";

/**
 * **신규 문의 추이**(원장 2026-10-20 *"신규 문의 추이는 없네 신규 문의 상세에서 그것도 추가"*) — 콜&상담을 칸(달 · 날)마다 센다.
 *
 * 🔑 날짜 = **상담일**(`consulted_at`, KST). 입력 시각(`created_at`)이 아니다 — 2026-07-01·8월에 옛 시트·메이크에듀 상담 2,222건이
 *    한꺼번에 들어와 입력 시각으로 세면 7~8월에 가짜 봉우리가 선다(실측 2026-10-20). 9월부터 들어온 31건은 모두 상담일 = 입력일이라
 *    오늘 칸은 운영실 '신규문의'(그날 입력된 상담)와 같다. 기존 통계 보기(`consultation_monthly_stats`)도 같은 상담일 축이다.
 * 과목 칸은 자유 입력이라 운영실 과목 관리자 값과 **같은 판정**(`sliceGroupsOf` — 'EIE' = 영어 · '영어 수학' = 둘 다)으로 가른다.
 * 두 과목 문의는 양쪽 선에 들고, 못 읽는 칸은 '과목 모름'. 순수 함수(Vitest).
 */
/** 주소 이름 — 신규 콜&상담은 `month`가 목록 필터라 추이 기간 칸을 `trend…`로 쓴다(서버 페이지·카드가 함께 읽어 일반 모듈에 둔다 — [[#81]]). */
export const INTAKE_TREND_KEYS: PeriodKeys = { grain: "trend", month: "trendMonth", from: "trendFrom", to: "trendTo", span: "trendSpan" };

export type IntakeTrendRow = { date: string; subject: string | null };
export type IntakeTrend = {
  /** 칸 키 — 월별 `YYYY-MM` · 일별 `YYYY-MM-DD`(오름차순). */
  keys: string[];
  total: number[];
  /** 과목 묶음(학원 설정 과목 · 영어 갈래는 영어로)별 — 그 기간 합이 큰 순. */
  groups: { group: string; values: number[] }[];
  unknown: number[];
};

export function bucketIntake(rows: readonly IntakeTrendRow[], period: StatsPeriod, groupsOf: GroupsOf): IntakeTrend {
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const total = keys.map(() => 0);
  const unknown = keys.map(() => 0);
  const byGroup = new Map<string, number[]>();
  for (const row of rows) {
    const i = at.get(period.grain === "month" ? row.date.slice(0, 7) : row.date);
    if (i === undefined) continue;
    total[i]!++;
    const groups = groupsOf(row.subject);
    if (!groups.length) unknown[i]!++;
    for (const g of groups) {
      const values = byGroup.get(g) ?? keys.map(() => 0);
      values[i]!++;
      byGroup.set(g, values);
    }
  }
  const sum = (v: number[]) => v.reduce((n, x) => n + x, 0);
  const groups = [...byGroup].map(([group, values]) => ({ group, values })).sort((a, b) => sum(b.values) - sum(a.values) || a.group.localeCompare(b.group));
  return { keys, total, groups, unknown };
}
