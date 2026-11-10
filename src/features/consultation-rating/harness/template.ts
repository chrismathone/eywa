// 빈 양식 판정(순수) — '상담 내용이 한 글자도 없는 양식'만 참이다. 의심스러우면 거짓(= 모델이 읽는다).
// 🔴 화면 미리보기(`consultationPreview`)의 '상담 내용 미입력' 판정을 쓰지 않는다 — 그건 표시용 휴리스틱이라 '상담 기록 항목:' 줄에 쓴 실제 글을
//    빈 양식으로 본다(적대적 리뷰 2026-11-11). 여기서는 양식의 머리(날짜 말고 남는 글)와 항목 값이 **둘 다** 비었음을 확인한다.
//    상담자 이름이 적힌 빈 양식은 이 규칙이 아니라 모델이 1점으로 매긴다(규칙은 확실한 것만).
const HEADING = /^(?:[✅📌]\s*)?(상담\s*내용|상담\s*요약|조치\s*사항|건의\s*사항|후속\s*조치|비고)\s*[:：]\s*(.*)$/u;
const TEMPLATE_WORDS = /학생\s*상담일지|상담\s*내역|상담\s*기록\s*항목|[✅📌]|[:：]|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*[월화수목금토일]요일)?/gu;
const PLACEHOLDER_VALUE = /^(?:[xX]|없음|-+)?$/;
export function isBlankTemplate(visibleSummary: string): boolean {
  const raw = visibleSummary.trim();
  if (!raw) return true;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => HEADING.test(l));
  if (first < 0) return false; // 양식이 아니다 — 짧은 글도 모델이 읽는다
  // 양식 머리(첫 항목 앞)는 양식 문구·날짜를 걷고 **아무것도 남지 않아야** 한다. 상담자 이름 줄이 남은 양식은 이름인지 '성적'·'결석' 같은 한 단어 내용인지 가를 수 없어
  // (재리뷰 2026-11-11: 한 단어 내용이 이름으로 오판돼 모델 없이 1점) 모델이 읽게 한다 — 모델이 빈 양식은 1점으로 매긴다(기준 문안 1점).
  const head = lines.slice(0, first).join(" ").replace(TEMPLATE_WORDS, " ").replace(/\s+/g, " ").trim();
  if (head) return false;
  for (const l of lines.slice(first)) {
    const value = HEADING.exec(l)?.[2] ?? l; // 항목 줄이면 값, 이어지는 줄이면 그 줄 전체
    if (!PLACEHOLDER_VALUE.test(value.trim())) return false;
  }
  return true;
}
