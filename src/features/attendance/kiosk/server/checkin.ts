import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveKakaoChannel, sendAttendanceNotification } from "@/lib/messaging/provider";
import { notifyIfClassAttendanceComplete } from "../../server/complete-notify";
import { isMissingViaColumn } from "../../live/server/write-policy";
import {
  classesInWindow,
  decideCheckinAction,
  timeToMinutes,
  type CheckinAction,
} from "../checkin-logic";
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
      reflectedClassName?: string | null; // 등원 시 출석부(present) 반영된 수업명(없으면 null)
    }
  | { ok: false; reason: "not_found" | "ambiguous" | "error"; detail?: string };

const WEEKDAY_KEY: Record<string, string> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/** UTC Date → KST 요일 키(mon..sun). */
function kstWeekday(now: Date): string {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(
    now,
  );
  return WEEKDAY_KEY[wd] ?? "mon";
}

/**
 * 등원을 기존 출석부(attendance_records)에 present로 best-effort 반영.
 * 그날·현재 시각에 해당하는 학생의 활성 수업이 "정확히 1개"일 때만 기록(0/다중=모호 → 스킵).
 * 기존 출결 기록이 있으면 덮지 않는다(강사 수동 입력 보존). recorded_by=null, access_method='kiosk'.
 * 반환: 반영한 수업명(없으면 null).
 */
async function reflectPresent(
  admin: SupabaseClient,
  tenantId: string,
  studentId: string,
  date: string,
  nowTime: string,
  now: Date,
): Promise<string | null> {
  const weekday = kstWeekday(now);
  const nowMin = timeToMinutes(nowTime);

  // 활성 enrollment → class_id
  const { data: enrs } = await admin
    .from("enrollments")
    .select("class_id")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("on_hold", false)
    .lte("start_date", date)
    .or(`end_date.is.null,end_date.gte.${date}`);
  const classIds = [...new Set((enrs ?? []).map((e) => e.class_id as string))];
  if (classIds.length === 0) return null;

  // 오늘·유효한 스케줄(수업명 포함)
  const { data: scheds } = await admin
    .from("class_schedules")
    .select("class_id, start_time, end_time, class:class_id(class_name)")
    .eq("tenant_id", tenantId)
    .in("class_id", classIds)
    .eq("day_of_week", weekday)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);

  const nameByClass = new Map<string, string>();
  const windowInput = (scheds ?? []).map((s) => {
    const klass = (Array.isArray(s.class) ? s.class[0] : s.class) as { class_name?: string } | undefined;
    if (klass?.class_name) nameByClass.set(s.class_id, klass.class_name);
    return {
      classId: s.class_id as string,
      startMin: timeToMinutes(s.start_time as string),
      endMin: timeToMinutes(s.end_time as string),
    };
  });

  const matching = classesInWindow(windowInput, nowMin);
  if (matching.length !== 1) return null; // 모호 → 스킵
  const classId = matching[0];

  // 기존 기록 있으면 보존(덮지 않음).
  // 🔴 `.maybeSingle()` 금지(2026-08-17 감사) — 2행 이상이면 maybeSingle이 **에러 + data null**을 주는데
  //    error를 안 보면 "기록 없음"으로 오판해 세 번째 행을 INSERT한다(교시별 기록이 있는 날 재태그).
  //    그 중복 행은 시수·회차를 부풀리고, 최신 행이 되어 강사가 찍은 결석을 화면에서 덮는다.
  //    올바른 프로브는 "정확히 1행"이 아니라 **"한 행이라도 있나"**다. 확인 실패도 안 쓴다(중복 위험 > 누락 —
  //    best-effort 경로라 다음 태그·강사 입력이 채운다).
  const { data: existingRows, error: existErr } = await admin
    .from("attendance_records")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", date)
    .limit(1);
  if (existErr || (existingRows?.length ?? 0) > 0) return null;

  // 🔴 0212a(recorded_via)가 아직 안 걸린 DB에서도 출결은 남아야 한다(#95) —
  //    여기 실패는 `return null`로 삼켜지므로, 폴백이 없으면 **조용히** 출결이 안 찍힌다.
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    class_id: classId,
    student_id: studentId,
    session_date: date,
    status: "present",
    access_method: "kiosk",
    recorded_by: null,
    recorded_via: "kiosk",
  };
  const first = await admin.from("attendance_records").insert(row);
  let error = first.error;
  if (error && isMissingViaColumn(error.message)) {
    const rest = { ...row };
    delete rest.recorded_via;
    error = (await admin.from("attendance_records").insert(rest)).error;
  }
  if (error) return null; // best-effort — 실패해도 등하원/발송은 그대로
  // G4: 이 삽입이 (반,날짜) 완료 전이일 수 있음 — 키오스크 완결도 벨(적대 리뷰: 미훅 갭). actorId=null(시스템 이벤트).
  after(() => notifyIfClassAttendanceComplete({ tenantId, classId, date, actorId: null }));
  return nameByClass.get(classId) ?? "수업";
}

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

  // 2. 학원명(메시지용) — owner 설정(profile.name) 우선, 미설정 시 테넌트명/폴백.
  const academyName = (await getTenantSettingsByTenantId(opts.tenantId)).profile.name || "학원";

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
  let reflectedClassName: string | null = null;
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
    // 등원을 기존 출석부에 present로 반영(best-effort, 현재 시각 수업 정확히 1개일 때만)
    reflectedClassName = await reflectPresent(admin, opts.tenantId, student.id, date, time, opts.now);
  } else {
    // check_out
    const { error } = await admin
      .from("attendance_checkins")
      .update({ checked_out_at: nowIso, updated_at: nowIso })
      .eq("id", existing!.id);
    if (error) return { ok: false, reason: "error", detail: error.message };
  }

  // 5. 발송 — 카카오 연동(라이선스 ON + pfId·템플릿 설정)이면 실발송, 아니면 현행 시뮬레이션 로그.
  //    어느 쪽이든 체크인 응답을 블로킹하지 않는다(반응속도 1순위): 실발송은 행을 queued로 먼저
  //    기록하고 응답을 즉시 반환한 뒤 after()로 발송→status 갱신(키오스크 UI는 낙관적 표시).
  const kind = action === "check_in" ? "checkin" : "checkout";
  const recipient = student.student_phone ?? student.parent_phone ?? null;
  const recipientMasked = maskPhone(recipient) || null;
  const message = buildAttendanceMessage({ studentName: student.name, kind, time, academyName });

  const channel = recipient ? await resolveKakaoChannel(opts.tenantId) : null;
  if (!channel) {
    // 미설정/OFF(기본) 또는 수신번호 없음 → 시뮬레이션(회귀 0).
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
  } else {
    const { data: notif } = await admin
      .from("attendance_notifications")
      .insert({
        tenant_id: opts.tenantId,
        student_id: student.id,
        checkin_id: checkinId,
        kind,
        recipient_masked: recipientMasked,
        message,
        channel: "kakao",
        status: "queued",
      })
      .select("id")
      .single();
    const notifId = notif?.id as string | undefined;
    if (notifId) {
      const recipientPhone = recipient;
      const studentName = student.name;
      after(async () => {
        const result = await sendAttendanceNotification({
          channel,
          recipientPhone,
          studentName,
          time,
          academyName,
          kind,
        });
        if (result.ok) {
          await admin
            .from("attendance_notifications")
            .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() })
            .eq("id", notifId);
        } else {
          await admin
            .from("attendance_notifications")
            .update({ status: "failed", error: result.error })
            .eq("id", notifId);
        }
      });
    }
  }

  return { ok: true, action, studentName: student.name, time, message, recipientMasked, reflectedClassName };
}
