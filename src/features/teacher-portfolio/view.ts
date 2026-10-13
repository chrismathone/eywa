/**
 * 직원 포트폴리오 화면의 표시 규칙 — 라벨·색·주 묶음. 순수 모듈(서버·클라이언트 공용).
 * 계산은 여기 없다. 점수와 근거는 `model/`이 만든 값을 그대로 쓴다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { weeksOf } from "./model/dates";
import type { FollowRow, MetricId, PeriodWindow, StoredPeriod } from "./model/types";

export const METRIC_LABEL: Record<MetricId, string> = {
  report: "수업보고서", attendance: "출결 기록", follow: "원생상담", quality: "직원 평가",
  students: "학생 배정·유지", revenue: "매출 기여", expansion: "과목 소개", coverage: "보강관리",
};
export const METRIC_SHORT: Record<MetricId, string> = {
  report: "보고서", attendance: "출결", follow: "상담", quality: "평가",
  students: "배정·유지", revenue: "매출", expansion: "과목 소개", coverage: "보강",
};
/** 항목 막대의 색 — 상태 뜻이 아니라 항목 구분이다. 전부 토큰에서 온다. */
export const METRIC_COLOR: Record<MetricId, string> = {
  report: "var(--color-primary)", attendance: "var(--color-green)", follow: "var(--color-rose)", quality: "var(--color-purple)",
  students: "var(--color-blue)", revenue: "var(--color-amber)", expansion: "var(--color-chart-5)", coverage: "var(--color-gold)",
};
export const MANAGEMENT_METRICS: readonly MetricId[] = ["report", "attendance", "follow", "quality"];
export const IMPACT_METRICS: readonly MetricId[] = ["students", "revenue", "expansion", "coverage"];
/** 채워지지 않은 몫(미작성·미처리)의 색. */
export const SHORTFALL_COLOR = "color-mix(in srgb, var(--color-amber) 45%, var(--color-card))";
export const PROXY_COLOR = "color-mix(in srgb, var(--color-purple) 55%, var(--color-card))";

export const fmtScore = (value: number | null): string => (value === null ? "산출불가" : value.toFixed(1));
export const dayLabel = (ymd: string): string => ymd.slice(5).replace("-", ".");
export const won = (n: number): string => `${Number(n || 0).toLocaleString("ko-KR")}원`;
export const monthName = (month: string): string => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
export function periodLabel(w: Pick<PeriodWindow, "month" | "end" | "partial">): string {
  return `${monthName(w.month)}${w.partial ? ` · ${dayLabel(w.end)}까지` : ""}`;
}
export function closingLabel(w: Pick<StoredPeriod, "closing">): "집계 중" | "마감" | "마감 · 재구성" {
  return !w.closing.closedAt ? "집계 중" : w.closing.source === "reconstructed" ? "마감 · 재구성" : "마감";
}

/** 총점이 오를수록 파랑 → 보라 → 빨강. 산출불가는 중립색. */
export function scoreColor(total: number | null): string {
  if (total === null) return "var(--color-line-strong)";
  const pct = Math.round(Math.min(100, Math.max(0, total)));
  return `color-mix(in srgb, var(--color-danger) ${pct}%, var(--color-blue))`;
}
export const SCORE_SCALE = [0, 20, 40, 60, 80, 100];

/** 전월 대비 — 오르면 붉은색, 내리면 파란색(원장 지정). */
export function deltaOf(now: number | null, before: number | null | undefined): { text: string; tone: "up" | "down" | "flat" | "none"; label: string } {
  if (now === null || before === null || before === undefined) return { text: "비교 불가", tone: "none", label: "전월과 비교할 수 없음" };
  const n = Math.round((now - before) * 10) / 10;
  const size = `${Math.abs(n).toFixed(1)}점`;
  return n > 0
    ? { text: `+${size}`, tone: "up", label: `전월 대비 상승 ${size}` }
    : n < 0 ? { text: `−${size}`, tone: "down", label: `전월 대비 하락 ${size}` } : { text: size, tone: "flat", label: "전월과 같음" };
}
export const DELTA_CLASS = { up: "text-danger", down: "text-blue", flat: "", none: "" } as const;

export type StatusTone = SemanticTone;
/** 처리 상태 → 의미색. 화면마다 따로 정하지 않는다. */
export function statusTone(state: string): StatusTone {
  if (["완료", "인정", "기한 전 완료", "작성"].includes(state)) return "brand";
  if (["미완료", "기한 초과", "미작성", "마감 후 작성"].includes(state)) return "caution";
  if (state === "대리") return "special";
  return "inert";
}
export const REPORT_STATE_LABEL = { own: "작성", proxy: "대리", missing: "미작성", late: "마감 후 작성", unknown: "확인 필요" } as const;

export type WeekGroup<T> = { index: number; start: string; end: string; rows: T[] };
/** 한 달을 월~일 주로 나눠 줄을 담는다. `dayOf`가 null이면 그 줄은 어느 주에도 넣지 않는다. */
export function groupByWeek<T>(w: Pick<PeriodWindow, "start" | "end">, rows: readonly T[], dayOf: (row: T) => string | null): WeekGroup<T>[] {
  return weeksOf(w).map((week, index) => ({
    index, ...week,
    rows: rows.filter((row) => { const day = dayOf(row); return day !== null && day >= week.start && day <= week.end; }),
  }));
}
export const weekRange = (week: Pick<WeekGroup<unknown>, "start" | "end">): string =>
  week.start === week.end ? dayLabel(week.start) : `${dayLabel(week.start)}~${dayLabel(week.end)}`;
/** 처음 펼칠 주 — 기록이 있는 가장 최근 주. 고른 주가 있으면 그 주. */
export function pickWeek(weeks: readonly WeekGroup<unknown>[], chosen: number | undefined): number {
  if (chosen !== undefined && weeks[chosen]) return chosen;
  const filled = weeks.filter((week) => week.rows.length).map((week) => week.index);
  return filled.length ? filled[filled.length - 1] : Math.max(0, weeks.length - 1);
}
/** 상담은 한 날짜에 묶는다 — 그 달에 한 상담은 상담일, 앞 달에서 넘어온 후속은 기한일. */
export function followAnchor(w: Pick<PeriodWindow, "start" | "end">, row: FollowRow): string | null {
  return row.day && row.day >= w.start && row.day <= w.end ? row.day : row.due;
}
