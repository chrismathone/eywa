/**
 * "학부모에게 실제로 나간 보고서" 판정 — 진도 레일·교재 진도가 **같은 기록**만 센다(원장 2026-10-19
 * *"실제 클래스노트 발송에 보면 진도에 따라서 학생 현 진도도 표시"*). 저장만 하고 안 보낸 초안은 사실이 아니다.
 * PostgREST `.or()` 문자열 — 클래스노트 발송 성공 · 발송 시각 있음 · 옛 edutrix 공유 · 데모 이력. `revoked_at is null`과 함께 쓴다.
 */
export const SENT_REPORT_OR =
  "classnote_status.eq.success,classnote_sent_at.not.is.null,edutrix_share_token.not.is.null,source.eq.demo_history";
