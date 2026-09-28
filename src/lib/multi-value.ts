/**
 * 쉼표로 적는 **다중 선택 값**(`math,english`) — 열 머리 필터(FilterSelect `multiple`)·원생목록 서버·계정 저장값이 같은 풀이를 쓴다.
 * 원장 2026-09-28 *"이런 류의 드랍다운 선택은 중복 선택가능하게"*. 옛 단일 값(`math`)은 원소 하나짜리 목록이다(호환).
 * 서버·클라 공용 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것.
 */

/** 쉼표로 적힌 다중 값 → 목록(빈 값·`all`·중복 제거). 옛 단일 값은 원소 하나짜리 목록이다. */
export function parseMulti(raw: unknown, allValue = "all"): string[] {
  const parts = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const out: string[] = [];
  for (const part of parts) {
    const v = part.trim();
    if (!v || v === allValue || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

/** 목록 → URL·저장값(빈 목록 = `all`). */
export function joinMulti(values: readonly string[], allValue = "all"): string {
  return values.length > 0 ? values.join(",") : allValue;
}

/** 고른 값들을 **선택지 순서**로 정규화 — 같은 집합이 두 URL로 갈리지 않게(저장 비교도 같은 순서). 선택지 밖 값은 뒤에 그대로. */
export function orderMulti(values: readonly string[], optionOrder: readonly string[]): string[] {
  const known = optionOrder.filter((v) => values.includes(v));
  return [...known, ...values.filter((v) => !optionOrder.includes(v))];
}
