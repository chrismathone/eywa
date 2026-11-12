import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { kakaoLicenseActive } from "./kakao-license";
import { sendAlimtalk } from "./solapi";
import { buildAlimtalkVariables, pickTemplateId } from "./templates";

// 등하원 알림 실발송 단일 진입점. 라이선스(kakao_messaging) ON + 학원 채널(pfId·템플릿) 설정이
// 모두 갖춰졌을 때만 발송한다. 미설정/OFF면 resolveKakaoChannel이 null → 호출부(checkin.ts)는
// 현행 시뮬레이션(status="simulated")을 유지한다(회귀 0). operator 키는 전역 env(solapi.ts).

export type KakaoSendConfig = {
  pfId: string;
  checkinTemplateId: string;
  checkoutTemplateId: string;
  smsFallback: boolean;
};

/**
 * 이 테넌트가 실발송 가능한 상태인지 resolve. service_role로 조회(키오스크 체크인은 비로그인 컨텍스트).
 * 라이선스 행 없음·조회 실패·비활성·만료 / 채널 미설정(pfId·템플릿 누락)·조회 실패·비활성이면 null(=시뮬 유지).
 */
export async function resolveKakaoChannel(tenantId: string): Promise<KakaoSendConfig | null> {
  const admin = createAdminClient();
  const [lic, ch] = await Promise.all([
    admin
      .from("tenant_licenses")
      .select("is_active, expires_at")
      .eq("tenant_id", tenantId)
      .eq("feature", "kakao_messaging")
      .maybeSingle(),
    admin
      .from("kakao_channels")
      .select("pf_id, checkin_template_id, checkout_template_id, sms_fallback, is_active")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (!kakaoLicenseActive(lic.data, !!lic.error) || ch.error) return null;
  const c = ch.data;
  if (!c || !c.is_active || !c.checkin_template_id || !c.checkout_template_id) return null;
  // 발신프로필 키(pfId)는 kakao_channels가 우선, 비어 있으면 학원 설정 콘솔의 alimtalkSenderKey로 폴백.
  // 핫패스(체크인)라 pf_id가 있으면 설정 조회를 건너뛴다(지연 폴백).
  let pfId = c.pf_id?.trim() ?? "";
  if (!pfId) {
    const settings = await getTenantSettingsByTenantId(tenantId);
    pfId = settings.notifications.alimtalkSenderKey.trim();
  }
  if (!pfId) return null;
  return {
    pfId,
    checkinTemplateId: c.checkin_template_id,
    checkoutTemplateId: c.checkout_template_id,
    smsFallback: c.sms_fallback ?? true,
  };
}

export type AttendanceNotificationPayload = {
  channel: KakaoSendConfig;
  recipientPhone: string; // unmasked
  studentName: string;
  time: string; // "HH:MM"
  academyName: string;
  kind: "checkin" | "checkout";
};

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

/** 등하원 알림톡 실발송 — 변수 빌드 + 템플릿 선택 후 solapi 위임. */
export function sendAttendanceNotification(p: AttendanceNotificationPayload): Promise<SendResult> {
  const templateId = pickTemplateId(p.kind, p.channel);
  const variables = buildAlimtalkVariables({
    studentName: p.studentName,
    time: p.time,
    academyName: p.academyName,
  });
  return sendAlimtalk({
    pfId: p.channel.pfId,
    templateId,
    to: p.recipientPhone,
    variables,
    disableSms: !p.channel.smsFallback,
  });
}
