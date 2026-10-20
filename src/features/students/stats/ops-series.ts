import type { StatsPeriod } from "@/features/stats/period";
import type { OpsDaily } from "./ops-daily";

/**
 * 매일 기록의 운영 칸(`OpsDaily`)을 기간 칸으로 — 일별 = 그날 기록 · 월별 = 그 달 **마지막으로 기록된 날** 값(그 달 끝 상태).
 * 기록이 없는 칸은 null(기록 시작 전 · cron이 빠진 날 — 지어내지 않는다). 순수 함수(Vitest).
 */
export type OpsDay = { date: string; ops: OpsDaily | null };

export function opsSeries(rows: readonly OpsDay[], period: StatsPeriod, pick: (ops: OpsDaily) => number | null | undefined): (number | null)[] {
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const out: (number | null)[] = keys.map(() => null);
  const when: (string | null)[] = keys.map(() => null);
  for (const row of rows) {
    if (!row.ops) continue;
    const i = at.get(period.grain === "month" ? row.date.slice(0, 7) : row.date);
    if (i === undefined) continue;
    // 그 칸이 없는 날(부분 실패 · 기록 시작 전)만 건너뛴다. 기록된 '모름'(null)은 그날 값 — 월별 칸이 날짜를 섞지 않게.
    const v = pick(row.ops);
    if (v === undefined) continue;
    if (when[i] === null || row.date > when[i]!) {
      out[i] = v;
      when[i] = row.date;
    }
  }
  return out;
}

/** 기록이 처음 남은 날(그 칸이 있는 줄 중) — 화면이 "언제부터 쌓였나"를 적는다. */
export function firstRecorded(rows: readonly OpsDay[], has: (ops: OpsDaily) => boolean): string | null {
  return rows.reduce<string | null>((m, r) => (r.ops && has(r.ops) && (!m || r.date < m) ? r.date : m), null);
}
