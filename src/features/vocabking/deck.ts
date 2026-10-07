/**
 * 이 시험이 **보카킹**인가 — 인재원 단어장 이름으로 판정(실측 2026-10-07: `[보카킹] 26년 9월`).
 * 보카킹이면 학부모 카드의 `{시험결과지}` 자리에 종합평가 리포트를, 아니면 종전 결과지를 그린다.
 * ⚠️ 단어장 이름이 유일한 근거다(인재원 계약에 시험 종류 칸이 없다). 이름 규칙이 바뀌면 여기만 고친다.
 */
export function isVocabkingDeck(deckName: string | null | undefined): boolean {
  return /보카킹|vocab\s*king/i.test(deckName ?? "");
}
