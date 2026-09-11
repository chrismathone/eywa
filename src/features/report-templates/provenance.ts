/**
 * 영어 템플릿 글의 **출처 지문** — 순수 함수(Vitest로 잠금).
 *
 * 🔴 왜 필요한가(적대 재리뷰 2026-09-10): "강사가 손대지 않은 자동 글"을 `draft === autoDraft`로 판정했더니,
 *    '이전 회차 가져오기'처럼 **다른 곳에서 넣은 글**도 같은 모양이라 저장 직전 템플릿으로 다시 조립되며 가져온
 *    코멘트가 조용히 사라졌다. 그래서 "템플릿이 마지막으로 만든 글"의 지문을 **따로** 적어 두고 그것과만 비교한다.
 * 🔴 AI 코멘트는 그때 넘긴 사실(진도·테스트·숙제…)로 쓰였다 — 그 사실의 지문도 적어 두면, 강사가 점수를 고친 뒤
 *    "코멘트는 옛 점수를 말한다"를 저장해도 사라지지 않는 경고로 띄울 수 있다.
 * ⚠️ 지문은 비교용 짧은 문자열(FNV-1a 32비트)이다 — 보안용이 아니다. 세션에 글을 한 벌 더 싣지 않으려고 쓴다.
 */

/** FNV-1a 32비트 → 8자리 16진수. 같은 글이면 같은 값(다른 글이 우연히 같을 확률은 무시할 만하다). */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type EnglishFacts = {
  progress: string;
  testText: string;
  homeworkToday: string;
  nextTest: string;
  attitude: string;
  homework: string;
  specialNote: string;
};

/** AI에 넘긴 사실의 지문 — 칸 사이 구분자를 둬서 "ab|c"와 "a|bc"가 같아지지 않게 한다. */
export function englishFactsKey(f: EnglishFacts): string {
  const norm = (v: string) => (v ?? "").replace(/\s+/g, " ").trim();
  return textHash(
    [f.progress, f.testText, f.homeworkToday, f.nextTest, f.attitude, f.homework, f.specialNote].map(norm).join("␞"),
  );
}
