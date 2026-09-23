/**
 * 공개 랜딩(`/`) 문의 문구. 학원·지점 이름이나 실데이터는 넣지 않는다.
 * 🔴 무료·베타·요금 약속 금지 — 도입·요금은 '문의' 말투, 연결(메일·전화) 없이 문구만(원장 2026-09-22).
 *    연락처가 정해지면 이 문구에 연결만 단다. 문의 띠 제목은 두 줄로 끊어 쓴다.
 */
export const INQUIRY_TITLE_LINES = ["도입과 이용 요금은", "문의해 주세요."] as const;
export const INQUIRY_NOTE = INQUIRY_TITLE_LINES.join(" ");
