// ClassNote 발송 실패 사유(워커의 기술 에러 원문)를 원장이 읽을 수 있는 한글로 변환(순수).
// UI 규칙: 기술 에러 원문을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
export function humanizeClassnoteError(raw: string | null | undefined): string | null {
  const r = (raw ?? "").trim();
  if (!r) return null;
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION|ECONNREFUSED|net::/i.test(r))
    return "발송 PC가 보고서 주소에 접속하지 못함 — 발송 PC의 주소 설정·인터넷 연결 확인";
  if (/timeout|ETIMEDOUT|시간 ?초과/i.test(r)) return "처리 시간 초과 — 재발송하면 대부분 해결됩니다";
  if (/login|credential|password|인증|비밀번호|로그인/i.test(r))
    return "ClassNote 로그인 실패 — 발송 PC의 ClassNote 아이디·비밀번호 확인";
  if (/board|보드|찾지 못|not found/i.test(r))
    return "ClassNote에서 학생 알림장(보드)을 찾지 못함 — 학생 이름(동명 접미사) 확인";
  if (/screenshot|스크린샷|이미지/i.test(r)) return "보고서 이미지 생성 실패 — 재발송으로 재시도";
  return "발송 실패 — 자세한 내용은 마우스를 올려 확인";
}
