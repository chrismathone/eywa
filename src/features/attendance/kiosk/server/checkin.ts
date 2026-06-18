import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideCheckinAction, type CheckinAction } from "../checkin-logic";
import { buildAttendanceMessage, maskPhone } from "../message";

// 키오스크 셀프 체크인 코어 — 디바이스 토큰 검증을 통과한 API에서만 호출.
// service_role(admin client)로 기록하되, 모든 쿼리를 tenantId로 스코프(테넌트 누수 방지).
// 데모: 발송은 attendance_notifications에 status="simulated" 로그만(실제 전송 없음).

export type KioskCheckinResult =
  | {
      ok: true;
      action: CheckinAction; // check_in | check_out | noop
      studentName: string;
      time: string; // "HH:MM" (KST)
      message: string | null; // 시뮬 발송 본문(noop이면 null)
      recipientMasked: string | null;
    }
  | { ok: false; reason: "not_found" | "ambiguous" | "error"; detail?: string };

/** UTC Date → KST 날짜("YYYY-MM-DD")·시각("HH:MM"). */
function kstParts(now: Date): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time };
}

export async function processKioskCheckin(opts: {
  tenantId: string;
  deviceId: string;
  code: string;
  now: Date;
}): Promise<KioskCheckinResult> {
  const admin = createAdminClient();
  const { date, time } = kstParts(opts.now);
  const nowIso = opts.now.toISOString();

  // 1. 학생 조회 — tenant 스코프 + 비퇴원. 부분 유니크 인덱스로 활성 1명 보장이나 방어적으로 다중 처리.
  const { data: students, error: sErr } = await admin
    .from("students")
    .select("id, name, parent_phone, student_phone")
    .eq("tenant_id", opts.tenantId)
    .eq("attendance_code", opts.code)
    .neq("status", "withdrawn");
  if (sErr) return { ok: false, reason: "error", detail: sErr.message };
  if (!students || students.length === 0) return { ok: false, reason: "not_found" };
  if (students.length > 1) return { ok: false, reason: "ambiguous" };
  const student = students[0];

  // 2. 학원명(메시지용)
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", opts.tenantId)
    .maybeSingle();
  const academyName = tenant?.name ?? "학원";

  // 3. 오늘 등하원 레코드 → 등/하원 자동판단
  const { data: existing } = await admin
    .from("attendance_checkins")
    .select("id, checked_in_at, checked_out_at")
    .eq("tenant_id", opts.tenantId)
    .eq("student_id", student.id)
    .eq("checkin_date", date)
    .maybeSingle();

  const action = decideCheckinAction(
    existing ? { checkedInAt: existing.checked_in_at, checkedOutAt: existing.checked_out_at } : null,
  );

  if (action === "noop") {
    return { ok: true, action, studentName: student.name, time, message: null, recipientMasked: null };
  }

  // 4. 등하원 기록
  let checkinId = existing?.id ?? null;
  if (action === "check_in") {
    if (existing?.id) {
      const { error } = await admin
        .from("attendance_checkins")
        .update({ checked_in_at: nowIso, updated_at: nowIso })
        .eq("id", existing.id);
      if (error) return { ok: false, reason: "error", detail: error.message };
    } else {
      const { data: ins, error } = await admin
        .from("attendance_checkins")
        .insert({
          tenant_id: opts.tenantId,
          student_id: student.id,
          checkin_date: date,
          checked_in_at: nowIso,
          access_method: "kiosk",
          device_id: opts.deviceId,
        })
        .select("id")
        .single();
      if (error) return { ok: false, reason: "error", detail: error.message };
      checkinId = ins.id;
    }
  } else {
    // check_out
    const { error } = await admin
      .from("attendance_checkins")
      .update({ checked_out_at: nowIso, updated_at: nowIso })
      .eq("id", existing!.id);
    if (error) return { ok: false, reason: "error", detail: error.message };
  }

  // 5. 발송 시뮬레이션 로그 (실제 전송 없음). 카카오 승인 후 provider 실발송으로 교체.
  const kind = action === "check_in" ? "checkin" : "checkout";
  const recipient = student.student_phone ?? student.parent_phone ?? null;
  const recipientMasked = maskPhone(recipient) || null;
  const message = buildAttendanceMessage({ studentName: student.name, kind, time, academyName });
  await admin.from("attendance_notifications").insert({
    tenant_id: opts.tenantId,
    student_id: student.id,
    checkin_id: checkinId,
    kind,
    recipient_masked: recipientMasked,
    message,
    channel: "simulated",
    status: "simulated",
  });

  return { ok: true, action, studentName: student.name, time, message, recipientMasked };
}
