import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIOSK_COOKIE } from "../constants";
import { summarizeUserAgent } from "../device-info";

export type KioskDeviceRow = {
  id: string;
  deviceNo: number; // 등록 순번(기기 #N) — 폐기 기기 포함해 안정적
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

/** 이 테넌트의 키오스크 기기 목록(RLS 스코프). 등록 순(오래된 것=기기 #1)으로 번호 부여. */
export async function getKioskDevices(): Promise<KioskDeviceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("kiosk_devices")
    .select("id, name, is_active, registered_ip, last_seen_ip, user_agent, last_seen_at, created_at")
    .order("created_at", { ascending: true });
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
  const { data } = await supabase
    .from("attendance_checkins")
    .select("id, checkin_date, checked_in_at, checked_out_at, student:student_id(name)")
    .order("checked_in_at", { ascending: false, nullsFirst: false })
    .limit(limit);
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
  const { data } = await supabase
    .from("attendance_notifications")
    .select("id, kind, recipient_masked, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    recipientMasked: n.recipient_masked,
    message: n.message,
    status: n.status,
    createdAt: n.created_at,
  }));
}

/** 출석번호 발급 현황(전체 기준 count — 페이지 rows 아님). */
export async function getAttendanceCodeStats(): Promise<{ withCode: number; total: number }> {
  const supabase = await createClient();
  const totalQ = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .neq("status", "withdrawn");
  const withQ = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .neq("status", "withdrawn")
    .not("attendance_code", "is", null);
  return { withCode: withQ.count ?? 0, total: totalQ.count ?? 0 };
}

/**
 * 키오스크 페이지용 — 현재 기기 쿠키가 유효한 등록 기기인지 검증하고 학원명을 돌려준다.
 * service_role로 조회(키오스크 페이지는 비로그인이라 RLS 컨텍스트가 없음).
 */
export async function resolveKioskDevice(): Promise<{ tenantId: string; academyName: string; deviceName: string } | null> {
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

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", device.tenant_id)
    .maybeSingle();

  return {
    tenantId: device.tenant_id,
    academyName: tenant?.name ?? "학원",
    deviceName: device.name,
  };
}
