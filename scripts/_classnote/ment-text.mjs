/**
 * 워커 최종 빈 멘트 가드용 — 자리 줄(그림 `[시험결과지]`·`[학습분석지]`, 첨부 `[첨부: 이름]`)을 빼고도 **학부모에게 나갈 글**이 있는가.
 * 앱 쪽 `hasTextBesidesMarkers`(src/features/report-templates/image-slots.ts)와 **같은 판정**이다 — 워커는 앱 모듈을
 * import하지 못하므로(연동 PC zip에 src가 없다) 줄 규칙만 옮겨 둔다. 규칙을 고치면 양쪽을 함께 고칠 것(ment-text.test.mjs가 같은 사례를 잠근다).
 * 영어 발송을 켜면서 추가(2026-09-28) — 전엔 자리 줄도 글자로 세서, 자리 줄뿐인 영어 글이 앱 게이트를 우회해 큐에 들어오면 그대로 나갈 수 있었다.
 */
const IMAGE_SLOT_KEYS = ["시험결과지", "학습분석지"];
const ATTACHMENT_LINE = /^\[\s*첨부\s*[:：]\s*(.+?)\s*\]$/;

export function isMarkerLine(line) {
  const t = String(line).replace(/\s+/g, "");
  if (IMAGE_SLOT_KEYS.some((k) => t === `[${k}]`)) return true;
  return ATTACHMENT_LINE.test(String(line).trim());
}

export function hasMentText(notes) {
  return String(notes ?? "")
    .split(/\r?\n/)
    .some((line) => line.trim() && !isMarkerLine(line));
}
