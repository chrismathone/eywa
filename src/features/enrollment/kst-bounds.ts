/**
 * 콜&상담 `timestamptz` 컬럼(`created_at`·`consulted_at`)을 **KST 경계**로 자르는 단일 소스(순수 · Vitest).
 *
 * 🔴 `new Date(y, m, 1)`처럼 런타임 로컬 자정으로 만들지 말 것 — 서버(UTC)에선 KST 오전 9시가 되어 그
 *    9시간의 접수가 앞 날짜·앞 달로 샌다(2026-09-11 목록 월 필터 `monthBounds`가 그랬다).
 * 🔑 운영실 '신규문의' 카드와 목록 `received=` 필터가 **같은 경계**를 쓴다 — 갈리면 카드 숫자와 목록 건수가 다르다.
 */
import { addDays, kstMonthStartIso, shiftMonth } from "@/lib/date-kst";

/** "YYYY-MM-DD" → 그날 KST 00:00 ~ 다음 날 KST 00:00(끝 제외). */
export function kstDayBounds(date: string): { startIso: string; endIso: string } {
  return {
    startIso: new Date(`${date}T00:00:00+09:00`).toISOString(),
    endIso: new Date(`${addDays(date, 1)}T00:00:00+09:00`).toISOString(),
  };
}

/** "YYYY-MM" → 그 달 KST 1일 00:00 ~ 다음 달 KST 1일 00:00(끝 제외). */
export function kstMonthBounds(month: string): { startIso: string; endIso: string } {
  return { startIso: kstMonthStartIso(month), endIso: kstMonthStartIso(shiftMonth(month, 1)) };
}
