/**
 * 원생상담 통계(요약 띠·통계 화면)의 **모양과 순수 계산**(서버·클라 공용 — `server-only`·`"use client"` 금지, [[#61]]·[[#81]]).
 * 집계는 0318a `consultation_stats`가 하고, 여기선 버킷을 지표 한 줄로 바꾸고 라벨을 짓는 일만 한다(Vitest).
 */

import {
  DEFAULT_HOMEROOM_FILTER,
  DEFAULT_HOMEROOM_SORT,
  defaultDirOf,
  parseHomeroomFilter,
  parseHomeroomSortKey,
  parseHomeroomView,
  type HomeroomFilter,
  type HomeroomSort,
  type HomeroomView,
} from "./homeroom-sort";

export type StatsUnit = "month" | "week";
/** 추이로 볼 지표 — 원장 *"모든 것을 관리 통계 추이 가능하게"*. */
export type StatsMetric = "count" | "perStudent" | "follow" | "media" | "sync" | "class";
export type StatsDimKey = "counselor" | "subject" | "class" | "category" | "audience" | "source";

export type StatsBucket = {
  /** 버킷 시작일(YYYY-MM-DD) — 월 = 1일, 주 = 월요일. */
  b: string;
  n: number;
  students: number;
  done: number;
  pending: number;
  audio: number;
  ai: number;
  synced: number;
  mapped: number;
};

export type StatsDimItem = {
  /** 키(null = 그 축의 '없음' — 상담사 없음·미매핑 등). */
  k: string | null;
  n: number;
  /** DB가 붙인 이름(상담사·반만). 나머지 축은 화면이 라벨을 짓는다. */
  label: string | null;
  /** 최근 12개월 · 최근 12주 건수. */
  m: number[];
  w: number[];
};

export type StatsTotals = {
  n: number;
  students: number;
  done: number;
  pending: number;
  overdue: number;
  audio: number;
  ai: number;
  synced: number;
  mapped: number;
  /** 반을 판정한 행(auto·manual). 나머지는 아직 판정 안 한 옛 행 — 미매핑 비율의 분모를 밝히는 데 쓴다. */
  judged: number;
  /** 범위 안 첫·마지막 상담일(KST, 없으면 null) — "언제부터의 수치인가"를 적는다. */
  first: string | null;
  last: string | null;
};

export type ConsultationStats =
  | {
      full: true;
      today: string;
      totals: StatsTotals;
      buckets: { month: StatsBucket[]; week: StatsBucket[] };
      dims: Partial<Record<StatsDimKey, { distinct: number; items: StatsDimItem[] }>>;
    }
  | {
      /** 0318a 전 — 건수 카드만(헤드 카운트). */
      full: false;
      today: string;
      totals: Pick<StatsTotals, "n" | "done" | "pending" | "overdue" | "audio" | "ai" | "synced">;
    };

export type GapStudent = { id: string; name: string; grade: string | null; last: string | null; days: number | null };

export type GapStats =
  | { full: true; today: string; enrolled: number; never: number; d30: number; d60: number; d90: number; top: GapStudent[] }
  | { full: false; today: string; d30plus: number; never: number; top: GapStudent[] };

/** 보기 설정(계정 귀속 `users.ui_prefs.consultations`) — 기본값(월·건수·상담사·담임 이름순)은 저장하지 않는다. */
export type ConsultationStatsPrefs = { unit: StatsUnit; metric: StatsMetric; dim: StatsDimKey; hrSort: HomeroomSort; hrFilter: HomeroomFilter; hrView: HomeroomView };
export const DEFAULT_STATS_PREFS: ConsultationStatsPrefs = { unit: "month", metric: "count", dim: "counselor", hrSort: DEFAULT_HOMEROOM_SORT, hrFilter: DEFAULT_HOMEROOM_FILTER, hrView: "gauge" };
export const STATS_METRICS: readonly StatsMetric[] = ["count", "perStudent", "follow", "media", "sync", "class"];
export const STATS_DIMS: readonly StatsDimKey[] = ["counselor", "subject", "class", "category", "audience", "source"];

export function parseConsultationStatsPrefs(raw: unknown): ConsultationStatsPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    unit: o.stats_unit === "week" ? "week" : "month",
    metric: (STATS_METRICS as readonly unknown[]).includes(o.stats_metric) ? (o.stats_metric as StatsMetric) : "count",
    dim: (STATS_DIMS as readonly unknown[]).includes(o.stats_dim) ? (o.stats_dim as StatsDimKey) : "counselor",
    hrSort: (() => {
      const key = parseHomeroomSortKey(o.hr_sort);
      if (!key) return DEFAULT_HOMEROOM_SORT;
      return { key, dir: o.hr_dir === "asc" || o.hr_dir === "desc" ? o.hr_dir : defaultDirOf(key) };
    })(),
    hrFilter: parseHomeroomFilter(o.hr_filter),
    hrView: parseHomeroomView(o.hr_view),
  };
}

/** 비율(%) — 분모 0이면 null(0%라고 적으면 "해 봤는데 0"으로 읽힌다). 소수 첫째 자리. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** 버킷 라벨 — 월 `9월`(1월이면 `26년 1월`), 주 `9/22`(그 주 월요일). */
export function bucketLabel(b: string, unit: StatsUnit): string {
  const m = Number(b.slice(5, 7));
  const d = Number(b.slice(8, 10));
  if (unit === "week") return `${m}/${d}`;
  return m === 1 ? `${b.slice(2, 4)}년 ${m}월` : `${m}월`;
}

export type MetricSeries = {
  /** 줄 이름(범례) — 한 지표가 두 줄일 수 있다(녹음·AI). */
  lines: { key: string; name: string }[];
  unit: "건" | "%";
  points: ({ label: string; b: string } & Record<string, number | null | string>)[];
};

/** 지표 → 추이 줄. 비율 지표는 그 버킷의 상담 수(또는 후속 수)가 분모다. */
export function metricSeries(buckets: readonly StatsBucket[], metric: StatsMetric, unit: StatsUnit): MetricSeries {
  const at = (b: StatsBucket) => ({ label: bucketLabel(b.b, unit), b: b.b });
  switch (metric) {
    case "perStudent":
      return {
        lines: [{ key: "v", name: "1인당 상담" }],
        unit: "건",
        points: buckets.map((b) => ({ ...at(b), v: b.students > 0 ? Math.round((b.n / b.students) * 10) / 10 : null })),
      };
    case "follow":
      return {
        lines: [{ key: "v", name: "후속 완료율" }],
        unit: "%",
        points: buckets.map((b) => ({ ...at(b), v: pct(b.done, b.done + b.pending) })),
      };
    case "media":
      return {
        lines: [
          { key: "audio", name: "녹음" },
          { key: "ai", name: "AI 분석" },
        ],
        unit: "%",
        points: buckets.map((b) => ({ ...at(b), audio: pct(b.audio, b.n), ai: pct(b.ai, b.n) })),
      };
    case "sync":
      return {
        lines: [{ key: "v", name: "동기화 비율" }],
        unit: "%",
        points: buckets.map((b) => ({ ...at(b), v: pct(b.synced, b.n) })),
      };
    case "class":
      return {
        lines: [{ key: "v", name: "반 없는 상담 비율" }],
        unit: "%",
        points: buckets.map((b) => ({ ...at(b), v: pct(b.n - b.mapped, b.n) })),
      };
    default:
      return { lines: [{ key: "v", name: "상담" }], unit: "건", points: buckets.map((b) => ({ ...at(b), v: b.n })) };
  }
}

/** 추이 창을 글로 — `최근 12개월(25년 10월~26년 9월)` · `최근 12주(7/7 주~9/22 주)`. 해가 한 번뿐이면 앞에만 적는다. */
export function trendWindowText(buckets: readonly StatsBucket[], unit: StatsUnit): string {
  if (buckets.length === 0) return unit === "week" ? "최근 12주" : "최근 12개월";
  const first = buckets[0]!.b;
  const last = buckets[buckets.length - 1]!.b;
  if (unit === "week") return `최근 ${buckets.length}주(${bucketLabel(first, "week")} 주~${bucketLabel(last, "week")} 주)`;
  const ym = (b: string, withYear: boolean) => `${withYear ? `${b.slice(2, 4)}년 ` : ""}${Number(b.slice(5, 7))}월`;
  const cross = first.slice(0, 4) !== last.slice(0, 4);
  return `최근 ${buckets.length}개월(${ym(first, true)}~${ym(last, cross)})`;
}

/** `2026-01-05`~`2026-09-30` → `1/5~9/30`(같은 해) · 해가 다르면 `25.12/1~26.1/5`처럼 해를 붙인다. */
export function dateSpanText(from: string, to: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${md(from)}~${md(to)}`;
  return `${from.slice(2, 4)}.${md(from)}~${to.slice(2, 4)}.${md(to)}`;
}

/** 분해 한 줄(화면용) — 라벨·걸러 보기 주소까지 서버가 붙여 내려준다. */
export type StatsDimRow = {
  key: string;
  label: string;
  n: number;
  m: number[];
  w: number[];
  /** 누르면 목록이 이 값으로 걸러진다(목록 필터가 있는 축만 — 반·대상·경로는 없다). */
  href: string | null;
  /** 지금 목록이 이 값으로 걸러져 있다. */
  active: boolean;
};

export type StatsDimView = {
  key: StatsDimKey;
  label: string;
  distinct: number;
  rows: StatsDimRow[];
  /** 줄에서 뺀 것(상담사 축의 퇴사자) — 각주에 '퇴사자 N명 M건 제외'로 밝힌다. */
  excluded?: { people: number; n: number } | null;
};
