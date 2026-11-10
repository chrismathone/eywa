import { attendanceRate } from "@/lib/calc/attendance";
import type { StatsPeriod } from "@/features/stats/period";
import { round1 } from "@/lib/guards";

/**
 * **등원율 추이**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — RPC `attendance_rate_buckets`(0387a)가 준
 * 칸 × 반 과목별 (기록 칸 · 출석+지각)을 칸마다 접는다. 판정은 운영실 '최근 14일 등원율'과 같다(정정은 최신 한 줄 · 분자 = 출석+지각 ·
 * 분모 = 기록 칸 전부) → 오늘 칸 = 카드의 오늘 점. 기록이 없는 칸은 null(0%로 그리면 "다 결석"으로 읽힌다). 순수 함수(Vitest).
 * `groupOf` = 반 과목 → 선 묶음(영어·수학 — 없으면 전체에만) · `inScope` = 과목 관리자(운영실처럼 반 과목으로 · 과목 모름은 든다).
 */
export type RateBucketRow = { bucket: string; subject: string | null; total: number; attended: number };
export type RateTrend = {
  keys: string[];
  rate: (number | null)[];
  total: number[];
  groups: { group: string; rate: (number | null)[]; total: number[] }[];
};


export function rateTrend(input: {
  rows: readonly RateBucketRow[];
  period: StatsPeriod;
  groupOf: (subject: string | null) => string | null;
  inScope?: (subject: string | null) => boolean;
}): RateTrend {
  const { period } = input;
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const total = keys.map(() => 0);
  const attended = keys.map(() => 0);
  const byGroup = new Map<string, { total: number[]; attended: number[] }>();
  for (const row of input.rows) {
    const i = at.get(row.bucket);
    if (i === undefined) continue;
    if (input.inScope && !input.inScope(row.subject)) continue;
    total[i]! += Number(row.total);
    attended[i]! += Number(row.attended);
    const g = input.groupOf(row.subject);
    if (!g) continue;
    const slot = byGroup.get(g) ?? { total: keys.map(() => 0), attended: keys.map(() => 0) };
    slot.total[i]! += Number(row.total);
    slot.attended[i]! += Number(row.attended);
    byGroup.set(g, slot);
  }
  const rates = (t: number[], a: number[]) => t.map((n, i) => (n > 0 ? round1(attendanceRate(a[i]!, n)) : null));
  const sum = (v: number[]) => v.reduce((n, x) => n + x, 0);
  return {
    keys,
    rate: rates(total, attended),
    total,
    groups: [...byGroup]
      .map(([group, v]) => ({ group, rate: rates(v.total, v.attended), total: v.total }))
      .sort((a, b) => sum(b.total) - sum(a.total) || a.group.localeCompare(b.group)),
  };
}
