import { addDays, isValidYm, isValidYmd, monthRange, shiftMonth } from "@/lib/date-kst";

/**
 * 통계 화면의 **기간 축 한 벌**(원장 2026-10-20 *"월별에서 일자별로 상세하게 볼 수도 있으면 … 하나의 월을 선택해서 해당월을 일자별로 /
 * 혹은 구간을 잡아서 한달치정도를 일자별로"*) — 신규 콜&상담·수납·원생 통계가 같은 주소 규약과 같은 자르기 규칙을 쓴다.
 *
 * 주소: 월별 = `?grain=month`(기본 · 이번 달까지 `months`개월) · 일별 한 달 = `?grain=day&month=2026-09` ·
 * 일별 구간 = `?grain=day&from=2026-09-15&to=2026-10-14`(최대 `MAX_DAY_SPAN`일 — 넘치면 시작일부터 자른다).
 * 🔑 미래는 그리지 않는다 — 끝은 오늘에서 멈춘다(오늘 칸 = 운영실 카드의 오늘 값). 잘못된 값은 오류 대신 기본값(이번 달)으로.
 * 순수 함수(Vitest).
 */
export const MAX_DAY_SPAN = 31;
export const MONTH_SPANS = [12, 24] as const;
export type MonthSpan = (typeof MONTH_SPANS)[number];

export type StatsPeriod =
  | { grain: "month"; months: string[] }
  | {
      grain: "day";
      /** 칸이 되는 날(오름차순). */
      days: string[];
      from: string;
      to: string;
      /** 한 달을 골라 연 것이면 그 달 — 구간으로 연 것이면 null. */
      month: string | null;
      /** 구간이 `MAX_DAY_SPAN`을 넘어 잘렸나(화면이 알린다). */
      clipped: boolean;
    };

export type PeriodParams = { grain?: string; month?: string; from?: string; to?: string; span?: string };

/** `from`~`to`(포함) 날짜 목록. */
export function dayKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 이번 달까지 `count`개월(오름차순). */
export function monthKeysTo(today: string, count: number): string[] {
  const last = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

export function monthSpanOf(raw: string | undefined): MonthSpan {
  return MONTH_SPANS.find((n) => String(n) === raw) ?? 12;
}

export function parseStatsPeriod(params: PeriodParams, today: string): StatsPeriod {
  if (params.grain !== "day") return { grain: "month", months: monthKeysTo(today, monthSpanOf(params.span)) };
  if (params.from && params.to && isValidYmd(params.from) && isValidYmd(params.to)) {
    let from = params.from <= params.to ? params.from : params.to;
    let to = params.from <= params.to ? params.to : params.from;
    if (from > today) from = today;
    if (to > today) to = today;
    const cut = addDays(from, MAX_DAY_SPAN - 1);
    const clipped = to > cut;
    if (clipped) to = cut;
    return { grain: "day", days: dayKeys(from, to), from, to, month: null, clipped };
  }
  const month = params.month && isValidYm(params.month) && params.month <= today.slice(0, 7) ? params.month : today.slice(0, 7);
  const range = monthRange(month);
  const to = range.to > today ? today : range.to;
  return { grain: "day", days: dayKeys(range.from, to), from: range.from, to, month, clipped: false };
}

/**
 * 기간 칸의 **주소 이름** — 화면마다 이미 쓰는 쿼리와 겹치지 않게 바꿀 수 있다(신규 콜&상담은 `month`가 목록 필터라
 * `trend`·`trendMonth`… 를 쓴다). 화면 안에서는 한 벌만 쓴다.
 */
export type PeriodKeys = Record<keyof PeriodParams, string>;
export const PERIOD_KEYS: PeriodKeys = { grain: "grain", month: "month", from: "from", to: "to", span: "span" };

/** 주소 → 기간 값(이름 매핑 적용). 배열 값은 첫 값. */
export function readPeriodParams(sp: Record<string, string | string[] | undefined>, keys: PeriodKeys = PERIOD_KEYS): PeriodParams {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  return { grain: one(keys.grain), month: one(keys.month), from: one(keys.from), to: one(keys.to), span: one(keys.span) };
}

/**
 * 같은 화면의 다른 기간 주소(쿼리 문자열 `?…`) — 기간 칸은 모두 갈아끼우고 나머지 쿼리(`keep`)는 그대로 둔다.
 * 🔑 `month`와 `from/to`를 함께 싣지 않는다 — 둘이 같이 있으면 어느 쪽이 이기는지 주소만 보고 알 수 없다.
 */
export function periodQuery(next: PeriodParams, keep: Record<string, string | undefined> = {}, keys: PeriodKeys = PERIOD_KEYS): string {
  const owned = new Set(Object.values(keys));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v && !owned.has(k)) q.set(k, v);
  const clean: PeriodParams = next.from && next.to ? { ...next, month: undefined } : { ...next, from: undefined, to: undefined };
  for (const k of Object.keys(keys) as (keyof PeriodParams)[]) if (clean[k]) q.set(keys[k], clean[k]!);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** 지금 기간을 주소 값으로(되돌려 적기) — 월별이면 span, 일별이면 month 또는 from/to. */
export function periodParamsOf(period: StatsPeriod): PeriodParams {
  if (period.grain === "month") return { span: period.months.length === 12 ? undefined : String(period.months.length) };
  return period.month ? { grain: "day", month: period.month } : { grain: "day", from: period.from, to: period.to };
}

/**
 * 계정에 남기는 **보기 방식**(원장 2026-08-04 '뷰 세팅은 계정 귀속') — 고른 달·구간 자체는 남기지 않는다(다음 방문엔 지난 달이 된다).
 * 주소에 기간이 있으면 주소가 이긴다 → 없으면 저장된 방식 → 없으면 월별 12개월. 구간 방식은 오늘까지 30일로 다시 연다.
 */
export const PERIOD_MODES = ["month", "month24", "day", "range"] as const;
export type PeriodMode = (typeof PERIOD_MODES)[number];
export const RANGE_DEFAULT_DAYS = 30;

export function parsePeriodMode(raw: unknown): PeriodMode | null {
  return PERIOD_MODES.find((m) => m === raw) ?? null;
}

export function periodModeOf(period: StatsPeriod): PeriodMode {
  if (period.grain === "month") return period.months.length === 24 ? "month24" : "month";
  return period.month ? "day" : "range";
}

/** 방식 → 그 방식의 기본 기간 값(달 = 이번 달 · 구간 = 오늘까지 30일). */
export function paramsForMode(mode: PeriodMode, today: string): PeriodParams {
  // 12개월도 주소에 적는다 — 비워 두면 서버가 아직 저장이 끝나지 않은 옛 방식을 다시 적용한다(리뷰 2026-10-20).
  if (mode === "month") return { span: "12" };
  if (mode === "month24") return { span: "24" };
  if (mode === "day") return { grain: "day", month: today.slice(0, 7) };
  return { grain: "day", from: addDays(today, -(RANGE_DEFAULT_DAYS - 1)), to: today };
}

/** 주소에 기간 칸이 하나도 없나 — 그때만 저장된 방식을 쓴다. */
export function hasPeriodParams(p: PeriodParams): boolean {
  return Object.values(p).some((v) => !!v);
}
