import "server-only";

// 등하원 알림 실발송 단일 진입점(향후). 현재는 미구현 스텁 — 데모는 attendance_notifications에
// status="simulated" 로그만 남긴다(실제 전송 없음). AI generate.ts의 단일 진입점 패턴을 미러링.
//
// 실발송 활성화 시(카카오 비즈채널 인증·발신프로필·템플릿 심사 완료 후):
//   1) tenant_licenses 'kakao_messaging' 토글 확인
//   2) tenant별 sender_key/channel_id(암호화 저장)를 resolve
//   3) Solapi 등 중계사 REST 호출(알림톡 → 실패 시 SMS 대체발송)
//   4) 결과를 attendance_notifications.status = "sent" | "failed" 로 갱신
//   5) 발송 결과 콜백은 /api/webhooks/kakao 에서 수신(assemblyai 웹훅의 secretMatches 패턴 재사용)

export type AttendanceNotificationPayload = {
  tenantId: string;
  recipientPhone: string;
  message: string;
  kind: "checkin" | "checkout";
};

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

export function sendAttendanceNotification(
  _payload: AttendanceNotificationPayload,
): Promise<SendResult> {
  return Promise.resolve({
    ok: false,
    error: "messaging provider not configured (demo: simulated only)",
  });
}
