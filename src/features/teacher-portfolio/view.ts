/**
 * 직원 포트폴리오 화면의 표시 규칙 — 라벨·색·주 묶음. 순수 모듈(서버·클라이언트 공용).
 * 계산은 여기 없다. 점수와 근거는 `model/`이 만든 값을 그대로 쓴다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { MANUAL_COLORS, METRIC_META } from "./evaluation/catalog";
import { isManualId, MISSING_LABEL, type BuiltinMetricId, type ManualMetricSetting } from "./evaluation/config";
import { settingOf } from "./evaluation/preview";
import { describeScoring } from "./evaluation/scoring";
import { weeksOf } from "./model/dates";
import type { FollowRow, ItemId, Metric, MetricId, PeriodWindow, PortfolioPeriod, StoredPeriod } from "./model/types";

/** 이름이 없는 옛 저장 행의 기본 이름(그 행의 '과목 소개'는 그대로 과목 소개다). 새 행은 설정의 이름을 싣는다. */
export const METRIC_LABEL: Record<MetricId, string> = {
  report: "수업보고서", attendance: "출결 기록", follow: "원생상담", counsel: "원생상담", quality: "직원 평가",
  students: "학생 배정·유지", revenue: "매출 기여", expansion: "과목 소개", coverage: "보강관리",
  payRatio: "매출 대비 급여", churn: "퇴원율", grades: "성적 관리", satisfaction: "학부모 만족도", punctuality: "강사 근태",
};
export const METRIC_SHORT = Object.fromEntries(Object.entries(METRIC_META).map(([id, m]) => [id, m.short])) as Record<MetricId, string>;
/** 항목 막대의 색 — 상태 뜻이 아니라 항목 구분이다. 전부 토큰에서 온다(지표 목록 한 곳). */
export const METRIC_COLOR = Object.fromEntries(Object.entries(METRIC_META).map(([id, m]) => [id, m.color])) as Record<MetricId, string>;

/** 항목 이름 — 원장이 정한 이름이 먼저, 옛 저장 행은 기본 이름. */
export function itemLabel(m: Pick<Metric, "id" | "label">): string {
  return m.label || (isManualId(m.id) ? "직접 입력 지표" : METRIC_LABEL[m.id as MetricId]);
}
/** 탭·표 머리의 짧은 이름 — 원장이 이름을 바꿨으면 그 이름, 기본 이름 그대로면 짧은 이름(표 머리가 두 줄로 접히지 않게). */
export function itemShort(m: Pick<Metric, "id" | "label">): string {
  if (isManualId(m.id)) return m.label || "직접 입력";
  const id = m.id as MetricId;
  return m.label && m.label !== METRIC_LABEL[id] ? m.label : METRIC_SHORT[id];
}
/** 항목 막대 색 — 기본 지표는 고정, 직접 만든 지표는 차례대로 돌려 쓴다. */
export function itemColor(m: Pick<Metric, "id">, items: readonly Pick<Metric, "id">[] = []): string {
  if (!isManualId(m.id)) return METRIC_COLOR[m.id as MetricId];
  const at = Math.max(0, items.filter((x) => isManualId(x.id)).findIndex((x) => x.id === m.id));
  return MANUAL_COLORS[at % MANUAL_COLORS.length];
}
/** 화면에 서는 항목 — 원장이 끈 지표는 저장만 돼 있고 보이지 않는다. */
export const shownItems = (p: Pick<PortfolioPeriod, "items">): Metric[] => p.items.filter((m) => !m.off);
export const itemOf = (p: Pick<PortfolioPeriod, "items">, id: ItemId): Metric | undefined => p.items.find((m) => m.id === id);
/** 그 달 총점의 만점 — 켠 지표 만점의 합. 옛 저장 행(설정 사본 없음)은 100점이었다. */
export const periodMax = (p: Pick<PortfolioPeriod, "evaluation" | "knownMax">): number => (p.evaluation ? p.knownMax : 100);
/** 채워지지 않은 몫(미작성·미처리)의 색. */
export const SHORTFALL_COLOR = "color-mix(in srgb, var(--color-amber) 45%, var(--color-card))";

export const fmtScore = (value: number | null): string => (value === null ? "산출불가" : value.toFixed(1));

/**
 * 항목 점수 글자 — 점수가 없으면 설정으로 매긴 달은 '합계에서 제외', 2026-10-13 전에 저장된 달(설정 사본 없음)은 그때 뜻 그대로 '산출불가'.
 * 만점은 그 달을 매긴 설정의 만점이다(고정 10점·20점이 아니다).
 */
export const scoreText = (m: Pick<Metric, "value">, p: Pick<PortfolioPeriod, "evaluation">): string =>
  m.value === null ? (p.evaluation ? "합계에서 제외" : "산출불가") : m.value.toFixed(1);
/** 만점 글자 — 만점 0은 학부모 만족도처럼 총점에 그대로 더하고 빼는 지표(원장 *"무제한 가감"*)라 '가감'. */
export const maxLabel = (max: number): string => (max > 0 ? `${max}점` : "가감");
export const pointsText = (m: Pick<Metric, "value" | "max">, p: Pick<PortfolioPeriod, "evaluation">): string =>
  m.value === null ? scoreText(m, p) : m.max > 0 ? `${scoreText(m, p)} / ${m.max}점` : `${m.value > 0 ? "+" : ""}${scoreText(m, p)}점 (가감)`;
const unitOf = (p: Pick<PortfolioPeriod, "evaluation">, id: ItemId): string => {
  if (!isManualId(id)) return METRIC_META[id as BuiltinMetricId].unit;
  return (p.evaluation ? (settingOf(p.evaluation, id) as ManualMetricSetting | undefined)?.unit : undefined) ?? "";
};
/** 그 달을 매긴 점수 규칙 한 줄 — 설정 사본이 없는 옛 달은 null(그때의 고정 규칙은 각 화면이 적는다). */
export function ruleText(p: Pick<PortfolioPeriod, "evaluation">, id: ItemId): string | null {
  const s = p.evaluation ? settingOf(p.evaluation, id) : undefined;
  return s ? `${describeScoring(s.scoring, s.max, unitOf(p, id))} · 자료가 없으면 ${MISSING_LABEL[s.missing]}` : null;
}
/** 자료가 없어 규칙으로 매긴 항목의 꼬리표 — "자료 없음 · 0점" · "마감 대상 없음 · 만점". 옛 달은 null. */
export function missingTag(m: Pick<Metric, "id" | "missing" | "uncounted" | "value"> & { newcomer?: boolean }, p: Pick<PortfolioPeriod, "evaluation">): string | null {
  if (m.uncounted) return m.value === null ? "계산 전 · 합계에서 제외" : `계산 전 · ${m.value.toFixed(1)}점`;
  // 급여 비율 — 지난달 담당 반이 없던 새 선생님은 설정 규칙과 상관없이 뺀다(evaluate.ts).
  if (m.missing && m.newcomer) return "지난달 담당 없음 · 합계에서 제외";
  const s = m.missing && p.evaluation ? settingOf(p.evaluation, m.id) : undefined;
  if (!s) return null;
  return `${m.id === "coverage" ? "마감 대상 없음" : "자료 없음"} · ${MISSING_LABEL[s.missing]}`;
}
/** 자료가 없어 **깎이거나 빠진** 항목(만점으로 매긴 항목·계산 전 항목은 빼고) — 맨 아래 안내가 이것만 말한다. */
export const shortItems = (p: Pick<PortfolioPeriod, "evaluation" | "items">): Metric[] =>
  shownItems(p).filter((m) => !m.uncounted && (m.value === null || (m.missing && (!p.evaluation || settingOf(p.evaluation, m.id)?.missing !== "full"))));
/** 아직 자동으로 세지 않는 항목 — 맨 아래 안내가 따로 말한다. */
export const pendingShown = (p: Pick<PortfolioPeriod, "items">): Metric[] => shownItems(p).filter((m) => m.uncounted);
export const dayLabel = (ymd: string): string => ymd.slice(5).replace("-", ".");
export const won = (n: number): string => `${Number(n || 0).toLocaleString("ko-KR")}원`;
export const monthName = (month: string): string => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
export function periodLabel(w: Pick<PeriodWindow, "month" | "end" | "partial">): string {
  return `${monthName(w.month)}${w.partial ? ` · ${dayLabel(w.end)}까지` : ""}`;
}
export function closingLabel(w: Pick<StoredPeriod, "closing">): "집계 중" | "마감" | "마감 · 재구성" {
  return !w.closing.closedAt ? "집계 중" : w.closing.source === "reconstructed" ? "마감 · 재구성" : "마감";
}

/** 총점이 만점에 가까울수록 파랑 → 보라 → 빨강. 산출불가는 중립색. 만점이 100점이 아니어도 비율로 칠한다. */
export function scoreColor(total: number | null, max = 100): string {
  if (total === null) return "var(--color-line-strong)";
  const pct = Math.round(Math.min(100, Math.max(0, max > 0 ? (total / max) * 100 : 0)));
  return `color-mix(in srgb, var(--color-danger) ${pct}%, var(--color-blue))`;
}
/** 게이지 아래 눈금 — 만점을 넷으로 나눈다. */
export const scoreScale = (max: number): number[] => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max * 10) / 10);

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
  if (["완료", "인정", "기한 전 완료", "작성", "상담함", "응시"].includes(state)) return "brand";
  if (["미완료", "기한 초과", "미작성", "마감 후 작성", "포함", "미상담", "미응시"].includes(state)) return "caution";
  if (state === "대리") return "special";
  return "inert";
}
/** 보고서 칸 — 작성/미작성 둘만(원장 2026-10-14). 지난 달에 남은 대리·마감 후·확인 필요도 점수에서 본인 작성이 아니었으니 미작성으로 보인다. */
export const REPORT_STATE_LABEL = { own: "작성", proxy: "미작성", missing: "미작성", late: "미작성", unknown: "미작성" } as const;

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

/**
 * 계산 전 자리의 안내 — 2026-10-15 전에 저장된 달은 "…단계에서 들어옵니다"로 굳어 있다(그 단계는 이미 들어왔다).
 * 그 문장은 보일 때 바꿔 적는다(저장 행은 그대로 — 마감한 달은 바꾸지 않는다).
 */
export function shownReason(m: { id: string; reason: string; uncounted?: boolean }): string {
  return m.uncounted && /단계에서 들어/.test(m.reason) ? "이 지표를 세기 시작(2026-10-15)하기 전에 매긴 달이라 '계산 전'으로 남아 있습니다." : m.reason;
}
