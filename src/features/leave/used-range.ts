/**
 * 연차 조정의 **휴가 사용 기간 표기** — 순수 함수 단일 소스(관리자 조정 창 · 내 정보 카드 공용, Vitest).
 *
 * 🔑 두 화면이 같은 글자를 써야 한다 — 한쪽이 `2026-08-15 ~ 2026-08-17`, 다른 쪽이 `8/15~17`이면 같은
 *    줄을 보고도 다른 기록처럼 읽힌다.
 * ⚠️ 끝이 비었거나 시작과 같으면 **하루**다(칸을 비워 두는 것이 정상 — 0270b).
 * ⚠️ 같은 해·같은 달이면 뒤쪽을 줄여 적는다(좁은 칸에서 두 줄로 접히지 않게). 해가 다르면 통째로 적는다.
 */

import { addDays, weekdayIndexOf } from "@/lib/date-kst";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SUNDAY = 0;
/**
 * 가감 일수에 맞는 **종료일 상한** — 시작일부터 세어 `leaveDays`번째로 차감되는 날
 * (원장 2026-09-21: *"-4일이면 시작 … 9월21일이면 해당 일로부터 4일 까지 최대로 선택가능하게"*).
 *
 * 🔑 **일요일은 세지 않는다** — 휴가 신청([`countLeaveDays`](./request-days.ts))과 같은 규칙이라 "4일
 *    차감"의 4일이 두 화면에서 같은 날들을 가리킨다. 그래서 일요일이 끼면 달력으로는 5일이 될 수 있다.
 * ⚠️ 1일 이하(반차 0.5·반반차 0.25 포함)면 **시작일 그대로** — 하루짜리다.
 * ⚠️ 시작일이 일요일이면 그날은 차감에서 빠지므로 세지 않는다(기간의 첫날이긴 하다).
 */
export function maxUsedEnd(start: string, leaveDays: number): string {
  if (!YMD.test(start)) return start;
  const need = Math.max(1, Math.ceil(leaveDays));
  if (need <= 1) return start;
  let cursor = start;
  let counted = weekdayIndexOf(start) === SUNDAY ? 0 : 1;
  // 상한 400회 = 1년 조금 넘는 안전장치(연차 구간은 1년이라 여기 닿지 않는다).
  // 날짜 산술은 앱 공용 `addDays`(UTC 고정)를 쓴다 — 여기서 새로 만들면 말일·윤년이 자리마다 갈린다.
  for (let i = 0; counted < need && i < 400; i += 1) {
    cursor = addDays(cursor, 1);
    if (weekdayIndexOf(cursor) !== SUNDAY) counted += 1;
  }
  return cursor;
}

export function usedRangeLabel(start: string, end?: string | null): string {
  if (!end || end === start) return start;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7);
  if (sameMonth) return `${start}~${end.slice(8)}`;
  if (sameYear) return `${start}~${end.slice(5)}`;
  return `${start}~${end}`;
}
