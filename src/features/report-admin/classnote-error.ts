// ClassNote 발송 실패 사유(워커의 기술 에러 원문)를 원장이 읽을 수 있는 한글로 변환(순수).
// UI 규칙: 기술 에러 원문을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.

/**
 * **워커가 사람 읽으라고 쓴 한글 안내문인가** — 그렇다면 요약하지 말고 그대로 보여준다.
 * 2026-07-21 실사례: 워커가 `첨부 목록 조회 실패 — 인증 실패(CLASSNOTE_INTERNAL_SECRET 불일치/미설정)`처럼
 * 원인을 정확히 짚어 보내는데, 아래 패턴표가 "인증"이라는 단어만 보고 **"ClassNote 로그인 실패 — 아이디·
 * 비밀번호 확인"이라는 엉뚱한 안내로 덮어썼다**(오진 유발). 반대로 패턴에 안 걸리는 한글 문장은 "발송 실패 —
 * 자세한 내용은 마우스를 올려 확인"으로 뭉개져 정보가 통째로 사라졌다.
 * 판정: 한글이 충분히 들어 있고 **기술 원문 신호**(스택트레이스·URL·영문 에러코드)가 없으면 사람 문장으로 본다.
 */
function isHumanKorean(text: string): boolean {
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  if (hangul < 4) return false; // 한글이 거의 없으면 기술 원문
  // 기술 원문 신호 = 스택트레이스·URL·영문 Error 접두. ⚠️ **환경변수 이름은 실격 사유가 아니다** —
  // "CLASSNOTE_INTERNAL_SECRET 불일치" 같은 문장은 원장이 고쳐야 할 대상을 정확히 지목하는 실행 가능한 안내다.
  if (/\bat\s+\S+:\d+|Error:|net::|https?:\/\//.test(text)) return false;
  return hangul / text.length >= 0.15; // 영문 식별자가 섞여도 설명이 한글이면 통과
}

export function humanizeClassnoteError(raw: string | null | undefined): string | null {
  const r = (raw ?? "").trim();
  if (!r) return null;
  // ⚠️ isHumanKorean보다 **먼저** — ClassNote(상류) API가 주는 짧은 한글 코드성 메시지다. 한글이라 그대로
  // 통과하지만("해당 학생 없음") 무엇을 해야 하는지는 말해주지 않는다. 실제 뜻은 "그 알림장에 이 아이가 없다"
  // = 학부모 미연결이고, 조치는 **학부모 초대**다(2026-07-23 손민우 사례).
  // ⚠️ 이 문구는 발송 실패 알림(0142a 트리거 본문)과 **같은 뜻으로 유지**할 것 — 두 표면이 같은 실패를
  //    다르게 설명하면 원장과 강사가 서로 다른 조치를 하게 된다.
  if (/해당 학생 없음/.test(r))
    return "학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요";
  // ⚠️ 패턴 매칭보다 **먼저** — 아래 표는 영문/기술 원문 전용이다(위 주석 참조).
  if (isHumanKorean(r)) return r;
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION|ECONNREFUSED|net::/i.test(r))
    return "발송 PC가 보고서 주소에 접속하지 못함 — 발송 PC의 주소 설정·인터넷 연결 확인";
  if (/timeout|ETIMEDOUT|시간 ?초과/i.test(r)) return "처리 시간 초과 — 재발송하면 대부분 해결됩니다";
  if (/login|credential|password|인증|비밀번호|로그인/i.test(r))
    return "ClassNote 로그인 실패 — 발송 PC의 ClassNote 아이디·비밀번호 확인";
  if (/board|보드|찾지 못|not found/i.test(r))
    return "ClassNote에서 학생 알림장(보드)을 찾지 못함 — 학생 이름(동명 접미사) 확인";
  if (/screenshot|스크린샷|이미지/i.test(r)) return "보고서 이미지 생성 실패 — 재발송으로 재시도";
  return "발송 실패 — 아래 ‘자세히’를 눌러 원문 확인";
}
