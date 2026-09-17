/** 회차 확정 표 메모의 최대 길이 — 한 줄 칸에 서는 메모라 길게 받지 않는다(전문은 마우스 오버 카드). */
export const TERM_NOTE_MAX = 300;

/** 메모 정규화 — 앞뒤 공백을 지우고 줄바꿈은 공백 하나로 접는다(한 줄 칸). 빈 값은 null(=메모 없음). */
export function normalizeTermNote(raw: string): string | null {
  const text = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text === "" ? null : text;
}
