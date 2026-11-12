/**
 * 저장 순간의 '바뀌었다' 신호(s2_0080) — 원 표 트리거가 지점 채널에 보낸다(내용 없음). 화면은 받으면 다시 받는다.
 * 채널 이름 · 사건 이름은 SQL(`duties_private.mark_dirty`)과 같은 글자여야 한다(가드 `live-sync-wiring.test.ts`).
 */
export const DUTY_PING_EVENT = "changed";
export const dutyPingChannel = (tenantId: string) => `duties:${tenantId}`;
