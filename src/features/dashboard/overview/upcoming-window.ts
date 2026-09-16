/**
 * 운영실 **'오늘부터 한 달'** 창 — 단일 소스(원장 2026-09-16 *"오늘 기준으로 1달 이내로 바꿔줘"* ·
 * *"배선 오류 없이 아주 모든 곳에서 일치하도록"*). 순수 함수라 서버 조회와 화면 문구가 **같은 답**을 낸다.
 *
 * 소비처(가드 `kpi-wiring.test.ts` ⑦·⑧):
 *   · KPI '보강예정' — 서버 조회 창 · 카드 접근 이름(보조 줄은 화면에 안 그린다) · 팝업 머리·빈 문구·각주
 *   · '레벨테스트 및 첫수업 일정' — 서버 일정 조회(`getDateRangeEvents`)·첫 수업 연결 후보 창 · 패널 머리 · 빈 문구
 *
 * 창 = 오늘 ~ **다음 달 같은 날의 전날**(9/16 → 10/15). 옛 '오늘부터 7일'이 오늘+6(끝날 포함)이던 것과 같은 셈법이다.
 * 다음 달에 같은 날이 없으면(1/29~1/31 → 2월) **다음 달 말일**까지 — 말일에서 하루를 또 빼면 그 달 마지막 날이 빠진다.
 * 🔴 화면 문구는 창의 이름('한 달')만 적지 말고 **끝 날짜**를 함께 적는다([[#121]] — 이름은 맞는데 날짜가 틀리는 일이 없게).
 */
import { formatShortKoreanDate, isValidYmd } from "@/lib/date-kst";

export type DateWindow = { start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** 오늘부터 한 달 창. 날짜가 아니면 오늘 하루만(지어낸 범위로 조회하지 않는다). */
export function monthAheadWindow(today: string): DateWindow {
  if (!isValidYmd(today)) return { start: today, end: today };
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  if (d > last) return { start: today, end: `${ny}-${pad(nm)}-${pad(last)}` };
  const end = new Date(Date.UTC(ny, nm - 1, d - 1));
  return { start: today, end: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}` };
}

/** 끝 날짜 표기 — `10/15 (목)까지`. 카드 보조 줄·팝업 머리가 이 한 문장을 쓴다. */
export function windowUntilLabel(range: DateWindow): string {
  return `${formatShortKoreanDate(range.end)}까지`;
}

/** 패널 머리 — `오늘부터 한 달 · 10/15 (목)까지`. */
export function monthAheadNote(range: DateWindow): string {
  return `오늘부터 한 달 · ${windowUntilLabel(range)}`;
}
