/**
 * '강사별 퇴원율 추이' 카드의 **표 | 차트** 보기(원장 2026-11-11 *"차트로 전환도 가능하게 표/차트"*) — 순수(Vitest).
 *
 * 차트 = **모든 강사를 한 차트에**(원장 2026-11-12 *"전체 선생님을 하나의 차트에 … 따로 차트 두지말고 비교가능하게"* — 11-11의
 * 강사별 작은 차트 격자를 뒤집음). 선이 15~20개라 나머지는 옅은 회색, 강조는 셋까지(고른 강사 · 없으면 마지막 달 퇴원율 높은 3명 —
 * Claude·Codex 협의). 세로 눈금 하나(0 ~ 보이는 값의 최댓값 올림).
 * 🔴 값은 표 칸과 같다 — 마감한 달의 퇴원율만 점(진행 중인 달·마감 전·담당 없음·확인 불가·재직 밖 = 점 없음, 0으로 그리지 않는다).
 * ⚠️ 일반 모듈 — 서버(초기값)와 클라(카드)가 함께 쓴다([[#61]]).
 */
import { SMALL_BASE, countsFrom, rateText, type ChurnCell, type ChurnMonth, type ChurnTeacherRow } from "./teacher-churn";

export type ChurnView = "table" | "chart";
export const DEFAULT_CHURN_VIEW: ChurnView = "table";
export function parseChurnView(raw: unknown): ChurnView {
  return raw === "chart" ? "chart" : DEFAULT_CHURN_VIEW;
}

/**
 * 재직 밖 달의 띠 — `before` = 입사 다음 달 전(퇴원율은 지난달 담당 기준이라 입사한 달도 셈하지 않는다) · `after` = 퇴사한 달 뒤.
 * 입사일보다 앞선 퇴사일은 옛 재직의 것(재입사)이라 보지 않는다(`inTenure`와 같은 규칙). 표 칸 색과 차트 띠가 같은 판정을 쓴다.
 */
export function tenureBand(row: Pick<ChurnTeacherRow, "hireDate" | "resignDate">, month: string): "before" | "after" | null {
  const from = countsFrom(row.hireDate);
  if (from !== null && month < from) return "before";
  const resign = row.resignDate?.slice(0, 10) ?? null;
  if (!resign || (row.hireDate && resign < row.hireDate.slice(0, 10))) return null;
  return month > resign.slice(0, 7) ? "after" : null;
}

/** 차트의 가로 축 — 마감할 수 있는 달만(진행 중인 달은 월초에 늘 낮아 선이 꺾여 보인다). */
export const chartMonths = (months: readonly ChurnMonth[]): ChurnMonth[] => months.filter((m) => !m.partial);

export type ChurnPoint = { rate: number; counted: number; base: number; small: boolean };
/** 한 강사의 점 — 달마다 마감한 퇴원율이 있으면 점, 아니면 null(선을 끊는다). */
export function pointsOf(row: ChurnTeacherRow, months: readonly ChurnMonth[]): (ChurnPoint | null)[] {
  return months.map((m) => {
    const c = row.cells[m.month];
    if (!c || !c.closed || c.state !== "ok" || c.rate === null) return null;
    return { rate: c.rate, counted: c.counted, base: c.base, small: c.base < SMALL_BASE };
  });
}

/** 공통 세로 눈금의 끝(%) — 보이는 점의 최댓값을 5 단위로 올림 · 가장 낮아도 10(작은 값이 칸을 꽉 채워 커 보이지 않게). */
export function chartCeil(rows: readonly ChurnTeacherRow[], months: readonly ChurnMonth[]): number {
  let max = 0;
  for (const r of rows) for (const p of pointsOf(r, months)) if (p && p.rate > max) max = p.rate;
  return Math.max(10, Math.ceil(max / 5) * 5);
}

/** 점이 이어지는 구간(이웃한 달끼리만 잇는다 — 빈 달을 건너 잇지 않는다). 값 = 달 순번. */
export function segmentsOf(points: readonly (ChurnPoint | null)[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  points.forEach((p, i) => {
    if (p) cur.push(i);
    else if (cur.length) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * 고른 달 한 줄 — 차트 칸 아래에 그 달 값을 글로(탭·키보드로 고른 달 · 마우스 오버 카드를 못 쓰는 기기에서도 읽히게).
 * 표 칸과 같은 상태 이름을 쓴다(입사 전 · 퇴사 뒤 · 평가 대상 아님 · 담당 없음 · 확인 불가 · 마감 전).
 */
export function monthBrief(row: Pick<ChurnTeacherRow, "hireDate" | "resignDate">, month: string, c: ChurnCell | undefined): string {
  if (!c) {
    const band = tenureBand(row, month);
    return band === "before" ? "입사 전" : band === "after" ? "퇴사 뒤" : "평가 대상 아님";
  }
  const body = c.state === "unreadable" ? "확인 불가" : c.state === "noBase" ? "담당 없음" : `${rateText(c.rate!)} · ${c.counted}/${c.base}명`;
  return c.closed ? body : `${body} · 마감 전`;
}

/** 같은 이름의 강사가 둘이면 뒤 사람에 번호(선 이름표·목록·범례가 겹치지 않게). */
export function dupName(rows: readonly { name: string }[], i: number): string {
  const same = rows.slice(0, i).filter((r) => r.name === rows[i]!.name).length;
  return same ? `${rows[i]!.name} (${same + 1})` : rows[i]!.name;
}

/** 저절로 강조하는 사람 수 — 계기판 색(차콜·노랑·회색) 셋과 같다. */
export const AUTO_EMPHASIS = 3;
/**
 * 고른 강사가 없을 때 강조할 강사 — `month`(차트의 마지막 달 = 표 '퇴원율 높은 순'의 기준 달)에 마감한 퇴원율이 높은 순 셋.
 * 0%는 강조하지 않는다(모두 0%면 아무도 아니다) · 같은 값이면 이름순(늘 같은 사람이 뽑히게).
 */
export function autoEmphasis(rows: readonly ChurnTeacherRow[], month: string, n = AUTO_EMPHASIS): string[] {
  const scored: { id: string; name: string; rate: number }[] = [];
  for (const r of rows) {
    const c = r.cells[month];
    if (c && c.closed && c.state === "ok" && c.rate !== null && c.rate > 0) scored.push({ id: r.id, name: r.name, rate: c.rate });
  }
  scored.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name, "ko"));
  return scored.slice(0, n).map((s) => s.id);
}

/** 마우스 자리(`target` %)에서 가장 가까운 선 — `maxDist`(%p)보다 멀면 null. 같은 거리면 앞 줄(목록 차례). */
export function nearestAt(values: readonly { id: string; rate: number | null }[], target: number, maxDist: number): string | null {
  let best: string | null = null;
  let bestDist = maxDist;
  for (const v of values) {
    if (v.rate === null) continue;
    const d = Math.abs(v.rate - target);
    if (d < bestDist || (best === null && d <= maxDist)) { best = v.id; bestDist = d; }
  }
  return best;
}

/**
 * 선 끝 이름표의 세로 자리(0=위 · 100=아래, %) — 값이 가까운 이름표끼리 `gap`만큼 벌린다(겹쳐 읽히지 않게).
 * 차례는 원래 높이 순 그대로 · 아래 끝을 넘으면 위로 되민다 · 위 끝 아래로는 못 간다.
 */
export function spreadLabels(items: readonly { id: string; y: number }[], gap: number, lo = 0, hi = 100): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const ys = sorted.map((it) => Math.min(hi, Math.max(lo, it.y)));
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + gap);
  if (ys.length && ys.at(-1)! > hi) {
    ys[ys.length - 1] = hi;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i]!, ys[i + 1]! - gap);
  }
  return new Map(sorted.map((it, i) => [it.id, Math.max(lo, ys[i]!)]));
}
