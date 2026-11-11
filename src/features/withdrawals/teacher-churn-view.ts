/**
 * '강사별 퇴원율 추이' 카드의 **표 | 차트** 보기(원장 2026-11-11 *"차트로 전환도 가능하게 표/차트"*) — 순수(Vitest).
 *
 * 차트 = 강사마다 작은 선 차트를 나란히(small multiples · Claude·Codex 협의 2026-11-11) — 강사 15~20명을 한 판에 겹치면
 * 누가 누군지 읽히지 않는다. 🔴 모든 강사가 **같은 세로 눈금**(0 ~ 보이는 값의 최댓값 올림)이라 칸끼리 높이로 견준다.
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
