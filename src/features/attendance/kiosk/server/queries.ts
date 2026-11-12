import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { kakaoLicenseActive } from "@/lib/messaging/kakao-license";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { KIOSK_COOKIE } from "../constants";
import { summarizeUserAgent } from "../device-info";

export type KioskDeviceRow = {
  id: string;
  deviceNo: number; // 등록 순번(기기 #N) — 차단된 기기는 포함하지만, 기기를 삭제하면 뒤 번호가 당겨진다(표시용)
  name: string;
  isActive: boolean;
  registeredIp: string | null;
  lastSeenIp: string | null;
  deviceType: string; // UA 요약(아이패드/안드로이드/…)
  lastSeenAt: string | null;
  createdAt: string;
};

export type CheckinRow = {
  id: string;
  studentName: string;
  checkinDate: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

export type NotificationRow = {
  id: string;
  kind: string;
  recipientMasked: string | null;
  message: string;
  status: string;
  createdAt: string;
};

/**
 * 🔴 아래 조회들은 실패하면 **던진다**(감사 E1) — 예전엔 `data ?? []`로 삼켜 조회 실패가 "등록된 기기가 없습니다"로
 *    보였고, 원장이 기기를 다시 등록하는 등 엉뚱한 조치를 했다. 페이지가 섹션마다 받아 한글 배너로 알린다.
 */
/** 이 테넌트의 키오스크 기기 목록(RLS 스코프). 등록 순(오래된 것=기기 #1)으로 번호 부여. */
export async function getKioskDevices(): Promise<KioskDeviceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kiosk_devices")
    .select("id, name, is_active, registered_ip, last_seen_ip, user_agent, last_seen_at, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`kiosk_devices: ${error.message}`);
  return (data ?? []).map((d, i) => ({
    id: d.id,
    deviceNo: i + 1,
    name: d.name,
    isActive: d.is_active,
    registeredIp: d.registered_ip,
    lastSeenIp: d.last_seen_ip,
    deviceType: summarizeUserAgent(d.user_agent),
    lastSeenAt: d.last_seen_at,
    createdAt: d.created_at,
  }));
}

/** 최근 등하원(현재 기기/브라우저에 쿠키가 있으면 그 기기로 보이지만 목록은 tenant 전체). */
export async function getRecentCheckins(limit = 20): Promise<CheckinRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_checkins")
    .select("id, checkin_date, checked_in_at, checked_out_at, student:student_id(name)")
    .order("checked_in_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`attendance_checkins: ${error.message}`);
  return (data ?? []).map((r) => {
    const s = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
    return {
      id: r.id,
      studentName: s?.name ?? "?",
      checkinDate: r.checkin_date,
      checkedInAt: r.checked_in_at,
      checkedOutAt: r.checked_out_at,
    };
  });
}

/** 최근 발송 시뮬레이션 로그. */
export async function getRecentNotifications(limit = 20): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_notifications")
    .select("id, kind, recipient_masked, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`attendance_notifications: ${error.message}`);
  return (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    recipientMasked: n.recipient_masked,
    message: n.message,
    status: n.status,
    createdAt: n.created_at,
  }));
}

export type KakaoChannelStatus = {
  configured: boolean; // pfId + 등하원 템플릿 모두 있음
  isActive: boolean; // 채널 행 활성
  licenseActive: boolean; // tenant_licenses 'kakao_messaging'가 켜져 있고 만료되지 않음
  live: boolean; // 실제 실발송 조건 충족(=configured && isActive && licenseActive)
  pfId: string | null;
  checkinTemplateId: string | null;
  checkoutTemplateId: string | null;
  smsFallback: boolean;
  lastError: string | null;
};

/** 카카오 연동 상태(설정 페이지 표시용). RLS로 이 테넌트 행만 보임. */
export async function getKakaoChannelStatus(): Promise<KakaoChannelStatus> {
  const supabase = await createClient();
  const [{ data: ch, error: chErr }, { data: lic, error: licErr }] = await Promise.all([
    supabase
      .from("kakao_channels")
      .select("pf_id, checkin_template_id, checkout_template_id, sms_fallback, is_active, last_error")
      .maybeSingle(),
    supabase
      .from("tenant_licenses")
      .select("is_active, expires_at")
      .eq("feature", "kakao_messaging")
      .maybeSingle(),
  ]);
  if (chErr) throw new Error(`kakao_channels: ${chErr.message}`);
  const pfId = ch?.pf_id ?? null;
  const checkinTemplateId = ch?.checkin_template_id ?? null;
  const checkoutTemplateId = ch?.checkout_template_id ?? null;
  const configured = Boolean(pfId && checkinTemplateId && checkoutTemplateId);
  const isActive = ch?.is_active ?? false;
  const licenseActive = kakaoLicenseActive(lic, !!licErr);
  return {
    configured,
    isActive,
    licenseActive,
    live: configured && isActive && licenseActive,
    pfId,
    checkinTemplateId,
    checkoutTemplateId,
    smsFallback: ch?.sms_fallback ?? true,
    lastError: ch?.last_error ?? null,
  };
}

/** 출석번호 발급 현황(전체 기준 count — 페이지 rows 아님). */
export async function getAttendanceCodeStats(): Promise<{ withCode: number; total: number }> {
  const supabase = await createClient();
  // 서로 독립 — 함께 보낸다(B4).
  const [totalQ, withQ] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).neq("status", "withdrawn"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .neq("status", "withdrawn")
      .not("attendance_code", "is", null),
  ]);
  if (totalQ.error || withQ.error) throw new Error(`students count: ${(totalQ.error ?? withQ.error)?.message}`);
  return { withCode: withQ.count ?? 0, total: totalQ.count ?? 0 };
}

/**
 * 키오스크 페이지용 — 현재 기기 쿠키가 유효한 등록 기기인지 검증하고 학원명을 돌려준다.
 * service_role로 조회(키오스크 페이지는 비로그인이라 RLS 컨텍스트가 없음).
 */
export async function resolveKioskDevice(): Promise<{ state: "ready"; tenantId: string; academyName: string; deviceName: string } | { state: "off" } | null> {
  const jar = await cookies();
  const token = jar.get(KIOSK_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const admin = createAdminClient();
  const { data: device } = await admin
    .from("kiosk_devices")
    .select("id, tenant_id, name, is_active")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!device || !device.is_active) return null;

  const settings = await getTenantSettingsByTenantId(device.tenant_id);
  // 출석 키오스크 모듈이 꺼진 학원(새 학원 기본)은 등록된 기기가 남아 있어도 체크인을 받지 않는다(2026-09-22 방향 B).
  // 같은 설정 조회를 쓰므로 추가 왕복 없음 · 침산은 켜져 있어 종전과 같다.
  if (!isModuleEnabled(settings.modules.disabled, "kiosk")) return { state: "off" };
  if (!(await isLaboratoryMenuAvailable(device.tenant_id, "kiosk_settings"))) return { state: "off" };
  const academyName = settings.profile.name || "학원";

  return {
    state: "ready",
    tenantId: device.tenant_id,
    academyName,
    deviceName: device.name,
  };
}
