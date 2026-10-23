/**
 * 직전 보고서 교재를 오늘 교재 칸으로 가져올 때 **끝의 쪽수만 뗀다**(원장 2026-10-23 — "개념원리 중2-1 16쪽~21쪽"이
 * 한 달 넘게 매 보고서에 따라와 학부모에게 지난 쪽수가 오늘 쪽수로 보였다). 순수 모듈(Vitest).
 *
 * 🔴 **쪽 단위(쪽·페이지·p)가 붙은 끝부분만** 뗀다 — `중2-1`·`4-1-2`·`2권`은 학년·권이라 손대지 않는다
 *    (2026-10-23 실측: 6월 이후 교재 칸 8,770건 중 쪽 단위가 있는 값은 2종류 3건, 숫자-숫자 꼴은 수백 종류가 전부 학년·권).
 * 🔴 가져올 때만 쓴다 — 강사가 오늘 칸에 직접 적은 값·저장된 보고서·발송본은 그대로다.
 */

const UNIT = String.raw`(?:쪽|페이지|[pP](?![a-zA-Z]))`;
const NUM = String.raw`(?:[pP]\.?\s*)?\d+\s*${UNIT}?`;
const PAGE_TAIL = new RegExp(String.raw`\s*${NUM}(?:\s*[~\-–]\s*${NUM})?\s*$`);

/** "개념원리 중2-1 16쪽~21쪽" → "개념원리 중2-1". 쪽 단위가 없는 끝 숫자는 그대로. 다 떼면 "". */
export function stripTextbookPages(textbook: string): string {
  const t = textbook.trim();
  const m = t.match(PAGE_TAIL);
  if (!m || !/(쪽|페이지|[pP])/.test(m[0])) return t;
  return t.slice(0, m.index).trim();
}
