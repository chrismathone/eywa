/**
 * 학부모 멘트 문단 분리/합치기 — 공지 모드 B(2문단) 전용 순수 함수.
 *
 * 저장 표면(lesson_reports.notes·학부모 카드·ClassNote 이미지·표뷰)은 전부 **단일 문자열**이 계약이라
 * 여기서 UI만 2칸으로 보여주고 값은 `\n\n` 하나로 합쳐 넘긴다(스키마·발송 경로 무변경).
 *
 * ⚠️ 라운드트립 불변식: `split(join(p1, p2))` === `{p1, p2}`.
 *   - P1만 있으면 구분자를 안 넣는다(모드 A 텍스트와 동일 모양 → 모드 전환해도 글이 안 깨짐).
 *   - P1이 비고 P2만 있으면 선행 `\n\n`을 **유지**한다(안 그러면 split이 P2를 P1칸으로 끌어올려
 *     타이핑 중 글자가 위 칸으로 튄다). 저장 직전 trim은 호출부(buildSaveInputFor) 담당.
 */

export type CommentParagraphs = { p1: string; p2: string };

const SEP = "\n\n";

/** 단일 초안 → {P1 수업 내용, P2 태도·특이사항}. 첫 빈 줄이 경계, 그 뒤는 전부 P2(3문단 이상도 보존). */
export function splitComment(draft: string): CommentParagraphs {
  const at = draft.indexOf(SEP);
  if (at === -1) return { p1: draft, p2: "" };
  return { p1: draft.slice(0, at), p2: draft.slice(at + SEP.length) };
}

/** {P1, P2} → 단일 초안. P2가 비면 구분자 없이 P1만(모드 A와 같은 모양). */
export function joinComment(p1: string, p2: string): string {
  return p2 ? `${p1}${SEP}${p2}` : p1;
}
