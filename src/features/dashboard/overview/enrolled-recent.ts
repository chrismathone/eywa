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

/**
 * **반 배정으로 '등록 완료' 칸에 선 때**(원장 2026-10-22 *"KPI 일치하지 않는건에 대해 KPI 일치시킬것"*) — 칸반은 상태가 아니라
 * 반 배정으로도 카드를 '등록 완료'에 세운다(`stageOfCard`: 연결 학생에게 그 과목 미종료 수강이 있으면). QR 자동 연결은 상태를
 * 바꾸지 않으므로(결정 — `outcome` 강제 안 함) 이런 상담엔 '등록 완료로 옮긴' 상태 로그가 없다 → 운영실이 못 셌다(장윤건 10/16).
 * 그 때 = 그 과목 반에 **처음** 배정된 때(끝난 수강 포함 — 반 이동으로 새 수강이 생겨도 신규로 다시 세지 않게) · 상담 접수보다
 * 앞이면 접수 때(이미 다니던 학생의 새 상담은 들어오자마자 그 칸이다). 지금 배정이 없으면 null(칸반도 그 칸이 아니다).
 * 과목 판정은 칸반 배지와 같다(`assignedQuery` — 상담 과목이 있으면 그 과목 반만 · 없으면 전 과목).
 */
export function assignedEntryAt(input: {
  consultCreatedAt: string;
  subject: string | null;
  enrollments: readonly { subject: string | null; createdAt: string; endDate: string | null }[];
  today: string;
}): string | null {
  const mine = input.enrollments.filter((e) => !input.subject || e.subject === input.subject);
  if (!mine.some((e) => !e.endDate || e.endDate >= input.today)) return null;
  const first = mine.map((e) => e.createdAt).sort()[0]!;
  return Date.parse(first) > Date.parse(input.consultCreatedAt) ? first : input.consultCreatedAt;
}
