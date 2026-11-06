/**
 * 글자 수로 자르되 이모지 같은 서러게이트 쌍을 반으로 가르지 않는다 — 반쪽 글자는 Postgres jsonb가 거절해 저장·감사 기록이 통째로 실패한다
 * (적대 리뷰 2026-11-06). 잘렸을 때만 `suffix`를 붙인다.
 */
export function clipText(text: string, max: number, suffix = ""): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${suffix}`;
}
