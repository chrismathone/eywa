/**
 * 강의실 라벨 → **비교 토큰** — `본원303`·`303`·` 303 `을 한 방으로 본다.
 *
 * 시트·DB에 같은 방이 여러 표기로 들어 있어(`본원303` / `303`) 문자열 그대로 비교하면 **같은 방을 다른 방으로**
 * 보고 겹침을 놓친다([[#115]]). 가져오기 충돌 체크리스트(`import/structure/conflicts.ts`)가 쓰던 규약을
 * 그대로 올린 것이고, 반 블록 이동 판정(`class-move.ts`)도 **같은 함수**를 쓴다 — 갈리면 두 화면이 다른 답을 낸다.
 *
 * ⚠️ 토큰은 층·건물을 지운다 — `본원602`와 `바른602`가 같은 토큰이 된다([[#122]]). 그래서 FK(`classroom_id`)가
 *    **양쪽에 다 있으면 FK가 이긴다**(`class-move.ts` `sameRoom`). 토큰은 한쪽이 라벨뿐일 때의 폴백이다.
 */
export function roomToken(label: string | null | undefined): string {
  if (!label) return "";
  const s = String(label).trim();
  if (!s) return "";
  return (s.match(/\b(\d{3}|SKY)\b/i)?.[1] ?? s).toUpperCase();
}
