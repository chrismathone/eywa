import type { NoticeSource } from "./translate-rules";

/** 팝업 공지 영문 번역 운영 프롬프트의 단일 소스. */
export function buildNoticeTranslationPrompt(src: NoticeSource): string {
  return [
    "학원 관리 시스템의 **팝업 공지**를 한국어에서 영어로 번역한다. 읽는 사람은 이 학원의 원어민 영어 강사다.",
    "",
    "규칙:",
    "- 고유명사는 **그대로 둔다**: 사람 이름·반 이름·학원 이름·`메이크에듀`·`에이와`·`AYWA`·`ClassNote` 등 제품/서비스 이름.",
    "- 화면에 실제로 있는 메뉴 이름(예: '내 메뉴', '내 정보')은 번역하되, 그것이 버튼 이름임을 알 수 있게 자연스럽게 쓴다.",
    "- 원문에 없는 내용을 덧붙이지 않는다. 문장 수와 뜻을 그대로 옮긴다.",
    "- 줄바꿈은 원문 그대로 유지한다.",
    "- @[이름](menu:/주소) 형태의 메뉴 참조는 한 글자도 변경하거나 누락하지 않는다. 표시 이름은 읽는 지점에서 자동 변환된다.",
    "- 원문이 비어 있는 칸은 빈 문자열로 둔다.",
    "",
    "아래 JSON을 영어로 옮겨 같은 키의 JSON으로만 답한다(설명 문장 금지).",
    JSON.stringify({ title: src.title, body: src.body ?? "", linkLabel: src.linkLabel ?? "" }, null, 2),
  ].join("\n");
}
