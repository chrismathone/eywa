/**
 * 진도맵 **원형 기하** — 순수(Vitest). 화면은 여기서 나온 path 문자열·좌표만 그린다.
 *
 * 각도 규약: **0° = 12시 방향, 시계 방향으로 증가**(1월이 맨 위 오른쪽으로 시작해 12월이 맨 위 왼쪽에서 끝난다 —
 * 레퍼런스 이미지와 같다). 한 달 = 30°(달의 길이와 무관하게 **같은 폭** — 그래야 바깥 링의 달 칸과 안쪽 링의 주·일
 * 칸이 방사형으로 **정확히 겹친다**). 그 달 안의 하루 = 30° ÷ 그 달 일수.
 *
 * 🔴 링 반지름은 **여기 한 곳**(`RINGS`)이다 — 링 컴포넌트가 자기 숫자를 적으면 링끼리 겹치거나 틈이 생긴다.
 * ⚠️ 분기 띠는 열두 달 링의 **바깥**이다(지시서의 "연간 / 분기"는 한 묶음이고, 레퍼런스 이미지가 얇은 분기 호를 달 링
 *    바깥에 두고 분기 이름을 그 밖에 적는다) — 안쪽으로 옮기면 분기 이름이 주 칸과 겹친다.
 */
import { daysInMonth, parseYmd, weeksOfMonth } from "./calendar";

export const VIEWBOX = 1040;
export const CX = VIEWBOX / 2;
export const CY = VIEWBOX / 2;

export type Band = readonly [inner: number, outer: number];

/** 안쪽부터 바깥으로. 값은 viewBox 단위. */
export const RINGS = {
  /** 가운데 흰 원(현재 위치 글) */
  center: 132,
  /** 연간 진도율 가는 호 */
  yearArc: [136, 142] as Band,
  /** '일간' 라벨 알약(높이 28)이 12시에 앉는 반지름 — 가운데 원(132)과 일간 링(162) 사이에 딱 들어간다 */
  dayLabel: 147,
  /** 일간 — 초점 주 7일을 넓혀 그린다 */
  day: [162, 230] as Band,
  /** 주간 — 그 해 모든 날을 가는 눈금으로 */
  week: [238, 298] as Band,
  /** 월간 — 달마다 주 칸 */
  month: [306, 378] as Band,
  /** 연간 — 열두 달 */
  year: [386, 470] as Band,
  /** 분기 — 바깥 가는 띠 */
  quarter: [478, 486] as Band,
  quarterLabel: 504,
} as const;

/** 단계별 확대 지도 — 현재 단계의 칸을 원 전체에 펼친다. */
export const DRILL_RINGS = {
  period: [310, 470] as Band,
  rim: [478, 486] as Band,
  center: 256,
  progress: [272, 278] as Band,
  label: 390,
} as const;

/** 달 칸 사이 틈(도). 주·일 칸은 더 좁다. */
export const GAP = { month: 0.6, week: 0.5, dayTick: 0.28, dayRing: 1.2, quarter: 1.5 } as const;

/** 일간 링 — 하루 한 칸의 각도(7일 = 77°). */
export const DAY_RING_STEP = 11;

/**
 * 극좌표 → 화면 좌표. 🔴 **소수 둘째 자리로 반올림**한다 — `Math.sin/cos`의 마지막 자릿수가 서버(Node)와 브라우저(V8 빌드)
 * 사이에 1ulp 갈려 SVG 속성(`x="843.6172842225682"` vs `…683`)이 하이드레이션 불일치를 냈다(실측 2026-09-14).
 */
export function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: round2(CX + r * Math.cos(rad)), y: round2(CY + r * Math.sin(rad)) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fx(n: number): string {
  return round2(n).toString();
}

/** 고리 조각(annular sector) path. a0 < a1, 360° 미만. */
export function arcPath(inner: number, outer: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 0) return "";
  const large = span > 180 ? 1 : 0;
  const o0 = polar(outer, a0);
  const o1 = polar(outer, a1);
  const i1 = polar(inner, a1);
  const i0 = polar(inner, a0);
  return [
    `M ${fx(o0.x)} ${fx(o0.y)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${fx(o1.x)} ${fx(o1.y)}`,
    `L ${fx(i1.x)} ${fx(i1.y)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${fx(i0.x)} ${fx(i0.y)}`,
    "Z",
  ].join(" ");
}

/** 원호 선(채움 없이 stroke로 그리는 진도율 호). */
export function strokeArcPath(r: number, a0: number, a1: number): string {
  const span = Math.min(359.99, Math.max(0, a1 - a0));
  if (span <= 0) return "";
  const p0 = polar(r, a0);
  const p1 = polar(r, a0 + span);
  return `M ${fx(p0.x)} ${fx(p0.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${fx(p1.x)} ${fx(p1.y)}`;
}

/** 달의 각도 구간 [시작, 끝]. */
export function monthAngles(month: number): [number, number] {
  return [(month - 1) * 30, month * 30];
}

export function quarterAngles(q: number): [number, number] {
  return [(q - 1) * 90, q * 90];
}

/** 하루의 각도 구간 — 그 달 30°를 일수로 등분. */
export function dayAngles(date: string): [number, number] {
  const { y, m, d } = parseYmd(date);
  const [m0] = monthAngles(m);
  const step = 30 / daysInMonth(y, m);
  return [m0 + (d - 1) * step, m0 + d * step];
}

/** 주의 각도 구간 — 첫날 시작 ~ 마지막 날 끝. */
export function weekAngles(year: number, month: number, weekIndex: number): [number, number] | null {
  const week = weeksOfMonth(year, month).find((w) => w.index === weekIndex);
  if (!week) return null;
  return [dayAngles(week.start)[0], dayAngles(week.end)[1]];
}

export function midAngle([a0, a1]: readonly [number, number]): number {
  return (a0 + a1) / 2;
}

/**
 * 일간 링의 칸 각도 — 기준 칸의 중심을 anchorAngle에 맞추고 하루 `DAY_RING_STEP`°씩 펼친다.
 * anchorIndex는 월=0 ~ 일=6. 달 첫·마지막 주의 빈 요일도 포함해 선택한 날짜가 원래 눈금과 같은 방향에 선다.
 * 기준 칸을 생략하면 전체 묶음의 가운데를 맞춘다.
 */
export function dayRingAngles(anchorAngle: number, dayCount: number, anchorIndex = (dayCount - 1) / 2): [number, number][] {
  const start = anchorAngle - (anchorIndex + 0.5) * DAY_RING_STEP;
  return Array.from({ length: dayCount }, (_, i) => [start + i * DAY_RING_STEP, start + (i + 1) * DAY_RING_STEP]);
}

/** 칸 각도에서 틈을 뺀 그리기 각도. 폭이 틈보다 좁으면 그대로(사라지지 않게). */
export function withGap([a0, a1]: readonly [number, number], gap: number): [number, number] {
  if (a1 - a0 <= gap * 2) return [a0, a1];
  return [a0 + gap / 2, a1 - gap / 2];
}

/** 각도 정규화 0~360. */
export function normAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}
