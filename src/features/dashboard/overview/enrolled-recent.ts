/**
 * 운영실 KPI **'전일 / 이달 신규'**(옛 '금일 등록', 원장 2026-10-21 *"금일 등록의 경우 전일 신규생 및 / 이달의 신규생
 * 다나오는걸로 변경"*) — 등록 완료로 옮긴 상담을 **어제**와 **이번 달(오늘 포함)** 두 숫자로 가른다. 순수(Vitest).
 *
 * 🔑 조회 창은 둘의 합집합이다 — 1일엔 어제가 지난달이라 창이 지난달 마지막 날부터 시작한다(`enrolledRecentFrom`).
 * 🔑 카드 숫자·팝업·요약형이 **이 함수 하나**로 센다 — 갈리면 같은 칸이 화면마다 다른 수를 말한다.
 */
import { addDays } from "@/lib/date-kst";

/** 조회 시작일 — 어제와 이번 달 1일 중 이른 날. */
export function enrolledRecentFrom(today: string): string {
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  return yesterday < monthStart ? yesterday : monthStart;
}

/**
 * 어제 · 이번 달로 가른다. `date`가 없는 줄(이 칸이 '오늘'만 세던 때 저장된 스냅샷)은 오늘로 본다 — 그때 배열은 전부 오늘 것이었다.
 */
export function splitEnrolledRecent<T extends { date?: string | null }>(
  rows: readonly T[],
  today: string,
): { yesterday: T[]; month: T[] } {
  const yday = addDays(today, -1);
  const month = today.slice(0, 7);
  const dateOf = (row: T) => row.date || today;
  return {
    yesterday: rows.filter((row) => dateOf(row) === yday),
    month: rows.filter((row) => dateOf(row).slice(0, 7) === month && dateOf(row) <= today),
  };
}
