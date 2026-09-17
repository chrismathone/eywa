import { publishRecordSaved } from "@/lib/realtime/record-channel";

/**
 * "회차 확정의 **예정 시수**가 바뀌었을 수 있다"는 신호 — 수강 기간·등원 요일·반 배치·시간표·휴원/퇴원을
 * 바꾸는 화면이 **저장에 성공한 직후** 부른다(원장 2026-09-17 *"회차 확정이 반스케줄 조정에 따라 같이 반영되나"* →
 * 열려 있는 회차 확정 창이 스스로 새로고침). 받는 쪽 = `useBillingSettingsRefresh`(`billing:session-terms`).
 *
 * 🔴 저장 시점에 쏜다 — 회차 확정 창으로 **돌아올 때** 새로고침하면 그 순간 누른 '확정'의 결과를 늦게 온 옛 데이터가
 *    덮는다(돌아오며 누르는 게 바로 이 흐름이다).
 * ⚠️ 같은 브라우저의 창·탭만 받는다(BroadcastChannel). 다른 PC의 변경은 창을 새로고침해야 보인다.
 * ⚠️ 클라이언트 전용 — 서버 액션에서 부르지 말 것(아무 일도 안 일어난다).
 */
export function notifyTermPlansChanged(): void {
  publishRecordSaved("billing:session-terms");
}
