// 등하원 알림톡 템플릿 변수 빌드 + kind→templateId 선택 — 순수함수(테스트 강제).
// ⚠️ 변수 키(#{학원명} 등)는 카카오 비즈채널에 등록한 템플릿의 치환자와 정확히 일치해야 한다.
//    템플릿 본문은 정보성만(광고 문구 금지 — message.ts 주석 참고).

export type AlimtalkKind = "checkin" | "checkout";

/**
 * 등하원 알림톡 치환 변수. 키는 솔라피 알림톡 변수 표기(#{변수명}), 값은 모두 문자열.
 * 등록 템플릿 예: "[#{학원명}] #{학생명} 학생이 #{시각}에 등원하였습니다."
 */
export function buildAlimtalkVariables(opts: {
  studentName: string;
  time: string; // "HH:MM"
  academyName: string;
}): Record<string, string> {
  return {
    "#{학원명}": opts.academyName || "학원",
    "#{학생명}": opts.studentName,
    "#{시각}": opts.time,
  };
}

/** 등원/하원 종류에 맞는 승인 템플릿 ID를 고른다. */
export function pickTemplateId(
  kind: AlimtalkKind,
  channel: { checkinTemplateId: string; checkoutTemplateId: string },
): string {
  return kind === "checkin" ? channel.checkinTemplateId : channel.checkoutTemplateId;
}
