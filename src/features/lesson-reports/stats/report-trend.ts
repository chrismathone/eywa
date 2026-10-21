import { NOT_SUBMITTED, parseHomeworkRate } from "@/features/onescreen/homework-rate";
import { LOW_HOMEWORK_RATE } from "@/features/dashboard/onescreen/homework-risk";
import type { StatsPeriod } from "@/features/stats/period";

/**
 * **학습 · 학부모 보고 추이**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — RPC `lesson_report_buckets`(0388a)가 준
 * 칸 × 과목 × 숙제 값별 건수를 칸마다 접는다. 순수 함수(Vitest).
 *  · 숙제: 숫자 판정은 `parseHomeworkRate` 하나(운영실 숙제 위험과 같다 — `없음`·빈칸·정도 미상은 분모에서 빠진다) · 낮음 = `LOW_HOMEWORK_RATE` 미만.
 *    운영실 카드는 최근 7일 **학생 수**, 여기는 칸마다 **기록 비율**(달마다 학생 수를 세면 달 길이·반 수에 끌려 흐름이 안 보인다).
 *  · 학부모 확인: 카드와 같은 조건(발송 성공 · 매칭 가능 · 48시간) — 칸의 `unread`를 최근 30일 더하면 카드의 미확인 건수다.
 *    확인율 = **보낸 지 48시간이 지난** 보고서 중 48시간 안에 확인한 비율(0389a `sent_mature`·`read48_mature` — 방금 보낸 보고서를 분모에
 *    넣으면 최근 이틀이 늘 낮게 나온다). 0389a 전 DB(칸이 없다)면 종전 값(`sent`·`read48`)으로 그린다(#95).
 * 과목: 운영실처럼 보고서를 쓰는 과목(`tracked` — 비면 좁히지 않는다)만 · 과목 관리자는 그 과목만(`inScope`).
 */
export type ReportBucketRow = {
  bucket: string;
  subject: string | null;
  homework_score: string | null;
  reports: number;
  sent: number;
  read48: number;
  unread: number;
  /** 0389a — 없으면(옛 DB) undefined. */
  sent_mature?: number;
  read48_mature?: number;
};
export type ReportTrend = {
  keys: string[];
  reports: number[];
  /** 숙제 판정한 기록 · 그중 낮음 · 미제출 · 0% · 판정 못 한 기록. */
  parsed: number[];
  low: number[];
  notSubmitted: number[];
  zero: number[];
  unparsed: number[];
  sent: number[];
  read48: number[];
  unread: number[];
  /** 보낸 지 48시간이 지난 발송 · 그중 48시간 안 확인 — 확인율의 분모·분자. */
  sentMature: number[];
  read48Mature: number[];
};

export function reportTrend(input: {
  rows: readonly ReportBucketRow[];
  period: StatsPeriod;
  tracked: readonly string[];
  inScope?: (subject: string | null) => boolean;
}): ReportTrend {
  const { period, tracked } = input;
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const zeros = () => keys.map(() => 0);
  const out: ReportTrend = {
    keys,
    reports: zeros(),
    parsed: zeros(),
    low: zeros(),
    notSubmitted: zeros(),
    zero: zeros(),
    unparsed: zeros(),
    sent: zeros(),
    read48: zeros(),
    unread: zeros(),
    sentMature: zeros(),
    read48Mature: zeros(),
  };
  for (const row of input.rows) {
    const i = at.get(row.bucket);
    if (i === undefined) continue;
    if (tracked.length && !(row.subject && tracked.includes(row.subject))) continue;
    if (input.inScope && !input.inScope(row.subject)) continue;
    const n = Number(row.reports);
    out.reports[i]! += n;
    out.sent[i]! += Number(row.sent);
    out.read48[i]! += Number(row.read48);
    out.unread[i]! += Number(row.unread);
    out.sentMature[i]! += Number(row.sent_mature ?? row.sent);
    out.read48Mature[i]! += Number(row.read48_mature ?? row.read48);
    const raw = (row.homework_score ?? "").trim();
    const rate = parseHomeworkRate(raw);
    if (rate === null) {
      out.unparsed[i]! += n;
      continue;
    }
    out.parsed[i]! += n;
    if (rate >= LOW_HOMEWORK_RATE) continue;
    out.low[i]! += n;
    if (raw === NOT_SUBMITTED) out.notSubmitted[i]! += n;
    else if (rate === 0) out.zero[i]! += n;
  }
  return out;
}

/** 비율(%) — 분모가 0이면 null(0%로 그리면 "다 못 했다"로 읽힌다). 소수 첫째 자리. */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
