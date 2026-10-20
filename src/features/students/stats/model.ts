import type { PillColor } from "@/components/atoms/pill";
import { parsePeriodMode, type PeriodMode } from "@/features/stats/period";

/**
 * 원생 통계 화면(`/students/stats`)의 순수 규칙 — 보기 범위·선 고르기·과목 색·요약 수치·보기 설정 파싱(Vitest).
 * 숫자 자체는 운영실과 같은 함수(`trendOf`·`subjectTrendOf`·`mixTrendOf`·`monthlyChanges`)가 만든다. 여기는 **고르고 요약만** 한다.
 * 🔑 화면의 목적(원장 2026-10-20): 운영실은 지금·최근만 보이니, 여기서는 **그동안 학원에 무슨 일이 있었나**를 본다.
 *    과거를 정확히 셀 수 없는 기간(퇴원 기록 시작 전)은 억지로 보이지 않는다 — `clipToRecords`.
 */

/** 재원생 추이 보기 범위 — 최근 12개월 · 전체 기간(퇴원 기록 시작부터, 최대 36개월) · 주별 26주 · 연도별. */
export const TREND_RANGES = ["all", "m12", "w26", "y"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
export const TREND_RANGE_LABELS: Record<TrendRange, string> = {
  all: "전체 기간",
  m12: "최근 12개월",
  w26: "주별 26주",
  y: "연도별",
};

/** 추이를 무엇으로 나눠 보나 — 과목마다 · 수강 구성(영어만·동시수강·수학만·기타 과목만). */
export type TrendView = "subject" | "mix";
export const TREND_VIEWS: readonly TrendView[] = ["subject", "mix"];

/** 월별 기록 보기 — 최근 12개월 · 전체 기간. */
export type FlowRange = "all" | "m12";
export type ChartKind = "line" | "bar";

export type StudentStatsPrefs = {
  range: TrendRange;
  view: TrendView;
  /** 꺼 둔 선 — `total` · `subject:<과목키>` · `mix:<구성키>`. 처음엔 모두 켜져 있다. */
  off: string[];
  flowRange: FlowRange;
  /** 그래프 종류 — 재원생 추이는 꺾은선, 월별 기록은 막대가 기본(계정 귀속 · 운영실 차트 종류와 같은 결). */
  trendKind: ChartKind;
  flowKind: ChartKind;
  /** '지난 기록' 보기 — 연도별이 기본(원장 2026-10-20 · 6년치라 달마다는 촘촘하다). */
  historyView: HistoryView;
  /** 강좌수 추이(원장 2026-10-20) — 기간 · 그래프 종류 · 꺼 둔 선(`total` · `program:<프로그램>`). */
  courseRange: TrendRange; courseKind: ChartKind; courseOff: string[];
  /** 첫 수업 추이(원장 2026-10-20) — 보기 방식(12·24개월 · 일별 · 구간). 고른 달·구간은 남기지 않는다(`period.ts`). */
  firstMode: PeriodMode;
};
export type HistoryView = "yearly" | "monthly";
export const DEFAULT_STUDENT_STATS_PREFS: StudentStatsPrefs = { range: "all", view: "subject", off: [], flowRange: "all", trendKind: "line", flowKind: "bar", historyView: "yearly", courseRange: "all", courseKind: "line", courseOff: [], firstMode: "month" };

const isRange = (v: unknown): v is TrendRange => TREND_RANGES.includes(v as TrendRange);

/** `users.ui_prefs.studentStats` 원본 → 보기 설정(모르는 값은 기본값). 꺼 둔 선이 지금 학원설정에 있나는 **읽는 쪽**이 본다. */
export function parseStudentStatsPrefs(raw: unknown): StudentStatsPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const offOf = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && k.length <= 80))].slice(0, 30) : []);
  return {
    range: isRange(o.range) ? o.range : DEFAULT_STUDENT_STATS_PREFS.range,
    view: o.view === "mix" ? "mix" : "subject",
    off: offOf(o.off),
    flowRange: o.flowRange === "m12" ? "m12" : "all",
    trendKind: o.trendKind === "bar" ? "bar" : "line",
    flowKind: o.flowKind === "line" ? "line" : "bar",
    historyView: o.historyView === "monthly" ? "monthly" : "yearly",
    courseRange: isRange(o.courseRange) ? o.courseRange : "all",
    courseKind: o.courseKind === "bar" ? "bar" : "line",
    courseOff: offOf(o.courseOff),
    firstMode: parsePeriodMode(o.firstMode) ?? "month",
  };
}

/** 주소의 `?view=` — 운영실 '재원생 구성'·'과목별 수강'의 상세가 보기를 골라 연다(이번 방문만 · 저장하지 않는다). */
export function viewFromParam(v: string | string[] | undefined): TrendView | null {
  return v === "mix" || v === "subject" ? v : null;
}

export type Point = { key: string; label: string; date: string; count: number };
export type SeriesSet = { monthly: Point[]; weekly: Point[]; yearly: Point[] };

/**
 * 정확히 셀 수 있는 달(`from`, YYYY-MM) 전의 점은 뺀다 — 퇴원 기록 전(재원생·순증을 셀 수 없다) · 과목 관리자는 수강 종료 기록 전
 * (과목을 가를 수 없다). 점의 **날짜**(월 = 말일 · 주 = 일요일/오늘 · 연 = 연말/오늘)로 판정한다 — 연도별도 같은 규칙(리뷰 2026-10-20:
 * 연도별만 자르지 않아 과목 관리자 화면의 2025년 점이 부풀었다).
 */
export function clipToRecords<T extends { date: string }>(points: readonly T[], from: string | null): T[] {
  if (!from) return [...points];
  return points.filter((p) => p.date.slice(0, 7) >= from);
}

/** 범위에 맞는 점들 — 월별은 뒤에서 N개(이번 달이 마지막) · 셀 수 있는 달 전은 뺀다. */
export function pointsFor(set: SeriesSet, range: TrendRange, from: string | null): Point[] {
  if (range === "y") return clipToRecords(set.yearly, from);
  if (range === "w26") return clipToRecords(set.weekly, from);
  const monthly = clipToRecords(set.monthly, from);
  return range === "m12" ? monthly.slice(-12) : monthly;
}

/**
 * 이 기록 길이에서 **뜻이 있는** 기간 버튼(리뷰 2026-10-21 — 침산은 2026-04부터라 '전체 기간'과 '최근 12개월'이 같은 7칸, '연도별'은 점 하나였다):
 * 월별 칸이 12개 이하면 '최근 12개월'을 빼고(전체 기간과 같다), 해가 하나뿐이면 '연도별'을 뺀다. '전체 기간'·'주별'은 늘 있다.
 */
export function availableRanges(set: SeriesSet, from: string | null): TrendRange[] {
  const months = clipToRecords(set.monthly, from).length;
  const years = clipToRecords(set.yearly, from).length;
  return TREND_RANGES.filter((r) => (r === "m12" ? months > 12 : r === "y" ? years > 1 : true));
}

/** 저장된 기간이 지금 없는 버튼이면 '전체 기간'으로(기록이 길어지면 저장값이 다시 산다). */
export function rangeIn(range: TrendRange, available: readonly TrendRange[]): TrendRange {
  return available.includes(range) ? range : "all";
}

/** 월별 기록(등록·퇴원 추이)의 기간 버튼 — 칸이 12개 이하면 '최근 12개월'은 '전체 기간'과 같아 뺀다. */
export function availableFlowRanges(rows: readonly FlowRow[], from: string | null): FlowRange[] {
  return flowRowsFor(rows, "all", from).length > 12 ? ["all", "m12"] : ["all"];
}

/** 두 달(YYYY-MM) 중 늦은 쪽 — 둘 다 지켜야 하는 아래 경계. 하나가 없으면 다른 쪽. */
export function laterMonth(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** 값이 처음 0보다 큰 달 — 퇴원 기록이 아직 없는 새 지점은 첫 학생이 있는 달부터 그린다(앞쪽 0만 이어지는 기간을 빼려고). */
export function firstNonZeroMonth(points: readonly { key: string; count: number }[]): string | null {
  return points.find((p) => p.count > 0)?.key.slice(0, 7) ?? null;
}

/** 값 상자 머리 — 월 `2026년 3월 말` · 주 `9/28 주` · 연 `2026년 말`, 오늘 칸은 `(오늘)`. */
export function longLabel(p: Point, range: TrendRange, today: string): string {
  const now = p.date === today ? " (오늘)" : "";
  if (range === "w26") return `${p.label} 주${now}`;
  if (range === "y") return `${p.key}년${now ? now : " 말"}`;
  return `${p.key.slice(0, 4)}년 ${Number(p.key.slice(5, 7))}월${now ? now : " 말"}`;
}

/** 가로축 라벨 — 월 `26.09` · 주 `9/28` · 연 `2026`. */
export function axisLabel(p: Point, range: TrendRange): string {
  if (range === "w26") return p.label;
  if (range === "y") return p.key;
  return `${p.key.slice(2, 4)}.${p.key.slice(5, 7)}`;
}

export type TrendSummary = {
  first: Point | null;
  last: Point | null;
  /** 첫 점 대비 마지막 점 증감(명). */
  change: number | null;
  /** 첫 점 대비 증감률(%, 소수 1자리) — 첫 점이 0이면 null. */
  changeRate: number | null;
  peak: Point | null;
  low: Point | null;
};

export function summarize(points: readonly Point[]): TrendSummary {
  if (!points.length) return { first: null, last: null, change: null, changeRate: null, peak: null, low: null };
  const first = points[0]!;
  const last = points.at(-1)!;
  const change = last.count - first.count;
  let peak = first;
  let low = first;
  for (const p of points) {
    if (p.count > peak.count) peak = p;
    if (p.count < low.count) low = p;
  }
  return { first, last, change, changeRate: first.count ? Math.round((change / first.count) * 1000) / 10 : null, peak, low };
}

/** 점마다 직전 점 대비 증감(첫 점은 null). */
export function withDeltas(points: readonly Point[]): (Point & { delta: number | null })[] {
  return points.map((p, i) => ({ ...p, delta: i === 0 ? null : p.count - points[i - 1]!.count }));
}

/** 선 하나를 끄고 켠다 — 마지막 남은 선은 끄지 않는다(빈 그래프 방지). */
export function toggleSeries(off: readonly string[], key: string, keys: readonly string[]): string[] {
  if (off.includes(key)) return off.filter((k) => k !== key);
  const visible = keys.filter((k) => !off.includes(k));
  if (visible.length <= 1 && visible[0] === key) return [...off];
  return [...off, key];
}

/** 학원 전체 선의 색 토큰 — 과목 색이 이 토큰이면 다른 색으로 비켜 준다. */
export const TOTAL_TOKEN: PillColor = "primary";
/** 과목 색이 겹칠 때 고르는 차례(학원설정 색 팔레트 안에서) — 과목 이름을 코드에 적지 않는다. */
const FALLBACK_TOKENS: readonly PillColor[] = ["blue", "rose", "green", "gold", "purple", "amber", "danger", "neutral"];

/** 색 토큰 → CSS 색(그래프 SVG에 그대로 넣는다 — 학원 팔레트 변수). */
export function tokenColor(token: PillColor): string {
  return token === "neutral" ? "var(--color-neutral-fill)" : `var(--color-${token})`;
}

/**
 * 과목별 선 색 — **학원설정 과목 색이 먼저**(운영 enum 단일 소스), 그 색을 앞 과목이나 학원 전체 선이 이미 쓰면 팔레트에서
 * 아직 안 쓴 색으로 비켜 준다(원장 2026-10-20 *"색깔별로"* — 같은 색 두 줄은 구분이 안 된다).
 */
export function distinctSubjectTokens(subjects: readonly { key: string; color: PillColor }[]): Map<string, PillColor> {
  const used = new Set<PillColor>([TOTAL_TOKEN]);
  const out = new Map<string, PillColor>();
  for (const s of subjects) {
    const token = used.has(s.color) ? (FALLBACK_TOKENS.find((t) => !used.has(t)) ?? s.color) : s.color;
    used.add(token);
    out.set(s.key, token);
  }
  return out;
}

/** `startedOnly` = 그달 등록 칸이 수업을 시작한 등록만 셌나(`MonthChange`와 같은 뜻 · 안내는 `startedNote`). */
export type FlowRow = { month: string; enrolled: number; withdrawn: number; startedOnly?: boolean };

/** 등록·퇴원 합계와 순증. */
export function flowTotals(rows: readonly FlowRow[]): { enrolled: number; withdrawn: number; net: number } {
  const enrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const withdrawn = rows.reduce((s, r) => s + r.withdrawn, 0);
  return { enrolled, withdrawn, net: enrolled - withdrawn };
}

/** 월별 기록 범위 — 셀 수 있는 달 전은 빼고, 최근 12개월이면 뒤에서 12개. */
export function flowRowsFor(rows: readonly FlowRow[], range: FlowRange, from: string | null): FlowRow[] {
  const clipped = from ? rows.filter((r) => r.month >= from) : [...rows];
  return range === "m12" ? clipped.slice(-12) : clipped;
}

/** 등록이나 퇴원이 처음 있는 달 — 퇴원 기록이 아직 없는 새 지점의 월별 기록 아래 경계. */
export function firstFlowMonth(rows: readonly FlowRow[]): string | null {
  return rows.find((r) => r.enrolled > 0 || r.withdrawn > 0)?.month ?? null;
}
