"use server";

/**
 * 보강 예약 **서버 액션** — 예약·취소·교시 선택지. 규칙은 순수부 [`makeup-reservation.ts`](../makeup-reservation.ts),
 * 조회는 [`makeup-reservation-queries.ts`](./makeup-reservation-queries.ts), 이행은 출결 쓰기 경로가 부르는
 * [`makeup-reservation-complete.ts`](./makeup-reservation-complete.ts).
 *
 * 흐름(원장 2026-09-14 *"9/30 결석할거니까 10/5에 보강수업을 미리 잡는다 … 9/30에 0으로 처리되고, 메모도 자동"*):
 *   ① 예약 행 INSERT(0264a, admin + 명시 tenant_id)
 *   ② 결석일 칸 — 기록이 없으면 **결석(시수 0)** 으로 찍고 메모 "10/5 보강 예정" / 이미 결석·공결이면 메모만 잇는다 /
 *      **출석·지각·조퇴·보강으로 찍힌 날이면 예약 자체를 거절**한다(온 날의 보강은 사실이 아니다 — 결석으로 고친 뒤).
 *      🔴 결석 쓰기는 `setAttendanceCell`을 **그대로** 지난다(교시 축·승격·감사로그·알림 훅 두 벌 금지 — 접수 액션과
 *      같은 규약). 강사(scoped)의 7일 잠금도 그 액션이 그대로 건다(지난 결석에 예약을 거는 건 메모만이라 면제).
 *   ③ 실패하면 ①을 되돌린다(예약만 남고 결석 칸이 없는 반쪽 상태를 만들지 않는다).
 *
 * 🔴 게이트 = 출결 쓰기(`canWriteTenant("attendance")`) + 강사는 **결석일에 그 반 담당**(`userTaughtClassSet`) — 출결
 *    저장과 같은 문(#77). 🔴 교시는 서버가 **학원설정 교시표로 다시** 만든 선택지에 있어야 한다(원장 *"수기 금지"*).
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { appendMemo, hasMemoLine } from "@/features/onescreen/makeup-absence-link";
import { userTaughtClassSet } from "@/features/attendance/live/server/write-policy";
import { mappedCancelCommand, mappedReservationMutationBlock } from "@/features/makeups/server/adapters/gates";
import { effectiveAttendanceRecords } from "../effective-records";
import { isAutoUnitsSubject } from "../auto-units";
import { getLessonProfile } from "@/features/owner/server/lesson-profile";
import {
  absenceClassOf,
  completesReservation,
  pickReservationHost,
  type ReservationHost,
  contiguousPeriodRange,
  removeMemoLine,
  reservationAbsenceDoneMemo,
  reservationAbsenceMemo,
  reservationAutoUnits,
  reservationMakeupMemo,
  isMakeupReportMode,
  reservationPeriodOptions,
  validateReservationDates,
  type MakeupReportMode,
  type MakeupReservation,
  type ReservationPeriodOption,
} from "../makeup-reservation";
import { statusTextOf, type AttendanceMark } from "../cell-display";
import { setAttendanceCell } from "./actions";
import { pickAbsenceNoteTarget } from "./absence-cell";
import { isMissingColumn, isMissingReservationTable, loadReservationById, toReservation } from "./makeup-reservation-queries";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { isClassOpenOn } from "../makeup-host";
import { completeMakeupReservations, completionKey, isRegularLessonDay } from "./makeup-reservation-complete";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
import { round1 } from "../session-units";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const NOT_APPLIED = "보강 예약 표(0264a)가 아직 적용되지 않았습니다 — 관리자에게 SQL 적용을 요청하세요";

export type MakeupPeriodOptionsResult =
  | {
      ok: true;
      options: ReservationPeriodOption[];
      subjectLabel: string;
      weekend: boolean;
      /** 이 반 과목이 시수 자동값 대상인가(수학 = 교시 하나 0.5) — 확인창이 시수 예고를 적는다. */
      autoUnits: boolean;
      /**
       * 보강일이 그 학생의 이 반 **정규 수업일**인가(학생을 넘겼을 때만) — true·null(모름)이면 창이 '함께/따로 발송'을 묻는다
       * ('+ 보강 학생 추가'의 합침/분리와 같은 질문, 원장 2026-10-22). false면 정규 보고서가 없어 묻지 않는다(보강 보고서 따로).
       */
      regularDay?: boolean | null;
      /**
       * **기록할 반** 후보(학생을 넘겼을 때만 — 원장 2026-10-22 *"보강 예약에도 기록할 반 고르기를 넣자"*). '+ 보강 학생 추가'와 같은 규칙:
       * 그날 학생이 다니는 열린 반 · 결석난 반과 같은 과목 · 선생님(담당 범위)이면 그날 담당하는 반만. 결석난 반이 후보면 맨 앞.
       */
      hostChoices?: ReservationHost[];
      /** 지금 판정한 기록할 반(넘긴 반이 후보면 그 반 · 아니면 결석난 반 → 후보가 하나면 그 반 · 그 밖엔 null = 고르기 전). */
      hostClassId?: string | null;
    }
  | { error: string };


/**
 * 그 반·그 날짜에 고를 수 있는 교시 — 확인창이 날짜를 고를 때마다 부른다(서버가 단일 소스, 클라는 목록을 못 만든다).
 * 읽기 권한(출결 쓰기)만 본다 — 담당 반 판정은 예약 저장에서 한다(선택지 조회는 남의 정보가 아니다).
 */
export async function getMakeupPeriodOptions(
  /** 결석난 반(창을 연 칸의 반). */
  classId: string,
  date: string,
  studentId?: string,
  /** 창에서 고른 기록할 반 — 후보가 아니면 무시하고 기본값으로 판정한다. */
  hostClassId?: string | null,
): Promise<MakeupPeriodOptionsResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  if (!classId || !YMD.test(date)) return { error: "날짜를 고르세요" };
  const supabase = await createClient();
  const [{ data: cls, error }, settings] = await Promise.all([
    supabase.from("classes").select("id, subject").eq("id", classId).maybeSingle(),
    getTenantSettings(),
  ]);
  if (error || !cls) return { error: "반을 찾지 못했습니다" };
  const subject = String(cls.subject ?? "");
  const config = settingsToPeriodsConfig(settings.operations);
  const options = reservationPeriodOptions(subject, date, config);
  const subjectLabel = buildSubjectMaps(settings.operations.subjects).labelOf(subject);
  let hostChoices: ReservationHost[] | undefined;
  let host: string | null = classId;
  if (studentId) {
    try {
      hostChoices = await reservationHostChoices(supabase, user, { studentId, absenceClassId: classId, subject, date });
    } catch {
      return { error: "학생의 반을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
    }
    host = pickReservationHost(hostChoices, hostClassId ?? null);
  }
  const [autoUnitsOn, regularDay] = await Promise.all([
    getLessonProfile().then((p) => p.autoUnits),
    studentId && host ? isRegularLessonDay(user.tenantId, { studentId, classId: host, date }) : Promise.resolve(undefined),
  ]);
  return {
    ok: true,
    options,
    subjectLabel,
    weekend: options.length > 0 && isWeekend(date),
    autoUnits: isAutoUnitsSubject(subject) && autoUnitsOn,
    ...(regularDay !== undefined ? { regularDay } : {}),
    ...(hostChoices ? { hostChoices, hostClassId: host } : {}),
  };
}

/**
 * 보강 예약을 **기록할 반** 후보 — '+ 보강 학생 추가'의 수업 선택과 같은 규칙(원장 2026-09-21·09-30 · 2026-10-22 예약에도):
 * 그날 학생이 다니는 반(수강 유효 · 휴원 아님) · 종강 전·활성 · 결석난 반과 같은 과목 · 선생님(담당 범위)이면 그날 담당하는 반만(#77).
 * 결석난 반이 후보면 맨 앞, 나머지는 이름순. 조회 실패는 throw(빈 후보로 읽으면 "고를 반이 없다"는 거짓이 된다).
 */
async function reservationHostChoices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; systemRole: Parameters<typeof accessLevelTenant>[0] },
  at: { studentId: string; absenceClassId: string; subject: string; date: string },
): Promise<ReservationHost[]> {
  const { data: ens, error } = await supabase
    .from("enrollments")
    .select("class_id, start_date, end_date, on_hold, is_transferred")
    .eq("student_id", at.studentId);
  if (error) throw new Error(error.message);
  const ids = [
    ...new Set(
      (ens ?? [])
        .filter((e) =>
          isEnrollmentActiveOn(
            {
              startDate: (e.start_date as string | null) ?? "0000-01-01",
              endDate: (e.end_date as string | null) ?? null,
              onHold: (e.on_hold as boolean | null) ?? false,
              isTransferred: e.is_transferred === true,
            },
            at.date,
          ),
        )
        .map((e) => e.class_id as string),
    ),
  ];
  if (ids.length === 0) return [];
  const { data: classes, error: cErr } = await supabase
    .from("classes")
    .select("id, class_name, subject, is_active, closed_at")
    .in("id", ids);
  if (cErr) throw new Error(cErr.message);
  let list = (classes ?? []).filter(
    (c) => c.is_active !== false && String(c.subject ?? "") === at.subject && isClassOpenOn(c.closed_at as string | null, at.date),
  );
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const teaching = await userTaughtClassSet(supabase, user.id, at.date);
    list = list.filter((c) => teaching.has(c.id as string));
  }
  return list
    .map((c) => ({ classId: c.id as string, className: String(c.class_name ?? ""), absenceClass: c.id === at.absenceClassId }))
    .sort((a, b) => Number(b.absenceClass) - Number(a.absenceClass) || a.className.localeCompare(b.className, "ko"));
}

function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return dow === 0 || dow === 6;
}

export type ReserveMakeupResult =
  | {
      ok: true;
      id: string;
      /** 결석일 칸에 한 일 — created(결석으로 새로 찍음) · noted(이미 결석이라 메모만) */
      absence: "created" | "noted";
      span: string;
    }
  | { error: string };

type AttRow = {
  id: string;
  student_id: string;
  class_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  note: string | null;
  recorded_at: string;
};

/** 그날 그 칸의 유효 행(정정 이력 접은 뒤) — 결석 판정·메모 대상. 실패는 throw(호출부가 한글로 접는다). */
async function loadEffectiveDay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: { studentId: string; classId: string; date: string },
): Promise<AttRow[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, student_id, class_id, session_date, slot_start, status, note, recorded_at")
    .eq("class_id", key.classId)
    .eq("student_id", key.studentId)
    .eq("session_date", key.date)
    .order("recorded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return effectiveAttendanceRecords((data ?? []) as AttRow[]).sort((a, b) =>
    a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id.localeCompare(a.id),
  );
}

/**
 * 결석 칸 **그 행**의 메모만 갈아끼운다 — 예약·취소는 메모 줄이 있는 행을 이미 골라 두었으므로 `setAttendanceCell(noteOnly)`
 * (그날 최신 1행·강사 보기는 첫 행)을 지나면 **다른 행**에 쓴다(적대 리뷰 2026-09-14: 16:20 행의 예정 줄을 지우려다
 * 17:20 행 메모를 덮어썼다). 세션 클라이언트(RLS) — `noteMakeupAgainstAbsence`와 같은 쓰기 모양.
 */
async function writeNoteOnRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rowId: string,
  note: string | null,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.from("attendance_records").update({ note }).eq("id", rowId);
  if (error) {
    console.error("[makeup-reservation] 결석 칸 메모 쓰기 실패", error.message);
    return { error: "결석 칸 메모를 쓰지 못했습니다" };
  }
  return { ok: true };
}

export async function reserveMakeup(input: {
  studentId: string;
  classId: string;
  /** 결석한(할) 날 — 팝오버를 연 칸의 날짜. */
  absenceDate: string;
  makeupDate: string;
  /**
   * 교시표 식별자들(`getMakeupPeriodOptions`가 준 `id`) — **이어진 교시 여러 개**(원장 2026-09-14). 시각은 서버가 표에서
   * 다시 읽고, 연속이 아니면 거절한다(`contiguousPeriodRange`).
   */
  periodIds: string[];
  note?: string | null;
  /** 강사 전체 보기의 주인 — 결석 칸 쓰기에 그대로 실린다(`setAttendanceCell` 규약). */
  scopeTeacherId?: string | null;
  /**
   * 보고서 발송 방식 — 보강일이 그 학생의 정규 수업일이면 **필수**('+ 보강 학생 추가'의 합침/분리, 원장 2026-10-22).
   * 정규 수업일이 아니면 버린다(합칠 정규 보고서가 없다 — 보강 보고서가 따로 나간다).
   */
  reportMode?: MakeupReportMode | null;
  /**
   * **기록할 반**(원장 2026-10-22) — 창이 고른 반. 결석난 반(`classId`)과 다르면 결석일 칸은 결석난 반에, 예약(보강이 서는 반)은 이 반에.
   * 넘기면 서버가 후보(`reservationHostChoices`)로 다시 확인한다. 안 넘기면 결석난 반(이 칸 전의 호출 모양).
   */
  hostClassId?: string | null;
}): Promise<ReserveMakeupResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  const { studentId, classId, absenceDate, makeupDate } = input;
  if (!studentId || !classId) return { error: "필수 값이 누락되었습니다" };
  const today = kstToday();
  const dates = validateReservationDates({ absenceDate, makeupDate, today });
  if (!dates.ok) return { error: dates.error };
  const note = (input.note ?? "").trim().slice(0, 300) || null;

  const supabase = await createClient();
  // 강사(scoped) = 결석일에 그 반 담당이어야 한다(출결 저장과 같은 문).
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const teaching = await userTaughtClassSet(supabase, user.id, absenceDate);
    if (!teaching.has(classId)) return { error: "담당 반이 아닙니다" };
  }

  const [{ data: cls, error: clsErr }, { data: stu, error: stuErr }, settings] = await Promise.all([
    supabase.from("classes").select("id, class_name, subject").eq("id", classId).maybeSingle(),
    supabase.from("students").select("id, name").eq("id", studentId).maybeSingle(),
    getTenantSettings(),
  ]);
  if (clsErr || !cls) return { error: "반을 찾지 못했습니다" };
  if (stuErr || !stu) return { error: "학생을 찾지 못했습니다" };

  // 🔴 교시는 서버가 설정 교시표로 다시 만든 선택지 안에서만(수기 금지·#77).
  const config = settingsToPeriodsConfig(settings.operations);
  const options = reservationPeriodOptions(String(cls.subject ?? ""), makeupDate, config);
  const range = contiguousPeriodRange(options, input.periodIds ?? [], makeupDate);
  if (!range) {
    return {
      error:
        (input.periodIds ?? []).length > 1
          ? "이어진 교시만 한 예약으로 잡을 수 있습니다 — 중간이 빈 선택은 나눠서 예약하세요"
          : "교시를 고르세요 — 학원설정 교시표에 있는 시간만 예약할 수 있습니다",
    };
  }
  const option = { startTime: range.startTime, endTime: range.endTime };
  const periodLabel = range.label;

  // 기록할 반 — 창이 고른 반을 후보로 다시 확인한다(#77 — 화면 목록을 믿지 않는다). 안 넘겼으면 결석난 반(종전).
  let hostId = classId;
  let hostName = String(cls.class_name ?? "");
  if (input.hostClassId) {
    let hosts: ReservationHost[];
    try {
      hosts = await reservationHostChoices(supabase, user, { studentId, absenceClassId: classId, subject: String(cls.subject ?? ""), date: makeupDate });
    } catch {
      return { error: "학생의 반을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
    }
    const host = hosts.find((h) => h.classId === input.hostClassId);
    if (!host) return { error: "기록할 반을 다시 골라 주세요 — 보강일에 이 학생이 다니는 같은 과목 반만 고를 수 있습니다" };
    hostId = host.classId;
    hostName = host.className;
  }

  // 보고서 발송 방식 — 정규 수업일이면 반드시 고른다(보강 추가 확인창과 같은 질문). 모르면(조회 실패) 고른 값을 그대로 둔다.
  const regularDay = await isRegularLessonDay(user.tenantId, { studentId, classId: hostId, date: makeupDate });
  const reportMode = regularDay === false ? null : isMakeupReportMode(input.reportMode) ? input.reportMode : null;
  if (regularDay === true && !reportMode) {
    return { error: "그날은 이 학생의 정규 수업일입니다 — 보고서를 정규와 합칠지(합침) 따로 보낼지(분리) 고르세요" };
  }

  // 결석일 칸의 현재 사실 — 온 날(출석·지각·조퇴·보강)이면 예약이 거짓이 된다.
  let day: AttRow[];
  try {
    day = await loadEffectiveDay(supabase, { studentId, classId, date: absenceDate });
  } catch (e) {
    console.error("[makeup-reservation] 결석일 칸 조회 실패", e);
    return { error: "결석일 기록을 읽지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  const attended = day.find((r) => completesReservation(r.status));
  if (attended) {
    return {
      error: `${absenceDate}은(는) 이미 '${statusTextOf(attended.status as AttendanceMark)}'으로 기록된 날입니다 — 결석으로 고친 뒤 예약하세요`,
    };
  }
  const absentCells = day.filter((r) => r.status === "absent" || r.status === "excused");

  // ① 예약 행 — admin + 명시 tenant_id. 같은 축(학생·반·보강일·교시)이 이미 있으면 유니크가 막는다.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "서버 설정 오류 — 관리자에게 알려 주세요" };
  }
  const { data: inserted, error: insErr } = await admin
    .from("makeup_reservations")
    .insert({
      tenant_id: user.tenantId,
      student_id: studentId,
      // 기록할 반(보강이 서는 반) — 결석난 반과 다를 때만 결석난 반을 따로 적는다(0440a · 같으면 비운다 = 종전 행 모양).
      class_id: hostId,
      ...(hostId !== classId ? { absence_class_id: classId } : {}),
      absence_date: absenceDate,
      makeup_date: makeupDate,
      slot_start: option.startTime,
      slot_end: option.endTime,
      period_label: periodLabel,
      note,
      status: "reserved",
      created_by: user.id,
      // 칸(0438a)이 없는 지점에서도 묻지 않은 예약은 그대로 저장되게 — 값이 있을 때만 싣는다.
      ...(reportMode ? { report_mode: reportMode } : {}),
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    if (isMissingReservationTable(insErr)) return { error: NOT_APPLIED };
    if (insErr?.code === "23505") return { error: "같은 날 같은 교시에 이미 이 학생의 보강 예약이 있습니다" };
    if (isMissingColumn(insErr, "absence_class_id")) return { error: "다른 반에 기록하는 보강 예약은 아직 준비 중입니다 — 결석난 반으로 잡아 주세요" };
    console.error("[makeup-reservation] 예약 저장 실패", insErr?.message);
    return { error: "보강 예약을 저장하지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  const reservationId = inserted.id as string;
  const memo = reservationAbsenceMemo({ makeupDate, absenceDate });

  // ② 결석일 칸 — 기존 출결 액션을 그대로 지난다(교시 축·승격·감사로그·데스크 알림은 그쪽 몫).
  let absence: "created" | "noted";
  let cellRes: Awaited<ReturnType<typeof setAttendanceCell>>;
  if (absentCells.length === 0) {
    absence = "created";
    cellRes = await setAttendanceCell({
      studentId,
      classId,
      sessionDate: absenceDate,
      status: "absent",
      units: "",
      note: memo,
      quiet: true,
      scopeTeacherId: input.scopeTeacherId ?? null,
    });
  } else {
    absence = "noted";
    // 붙일 칸 하나 = 기존 보강 연결과 같은 규약(`pickAbsenceNoteTarget`: 이미 이 줄이 있는 칸 → 아직 어떤 보강도 안 적힌 칸 →
    // 최신 칸). 멱등(같은 줄을 두 번 안 붙인다) + **그 행에 직접** 쓴다.
    const target = pickAbsenceNoteTarget(absentCells, memo)!;
    cellRes = hasMemoLine(target.note, memo) ? { ok: true } : await writeNoteOnRow(supabase, target.id, appendMemo(target.note, memo));
  }
  if ("error" in cellRes) {
    // ③ 반쪽 상태를 남기지 않는다 — 예약을 되돌리고 그 사유를 그대로 돌려준다. 되돌리기가 실패하면 그 사실도 말한다
    //    (조용히 넘기면 결석 칸 없는 예약 행이 남는다).
    const { error: rbErr } = await admin.from("makeup_reservations").delete().eq("tenant_id", user.tenantId).eq("id", reservationId);
    if (rbErr) console.error("[makeup-reservation] 예약 되돌리기 실패 — 결석 칸 없는 예약 행이 남았습니다", reservationId, rbErr.message);
    return {
      error: rbErr
        ? `결석일(${absenceDate}) 칸을 처리하지 못했고 예약도 되돌리지 못했습니다 — 관리자에게 알려 주세요 (${cellRes.error})`
        : `결석일(${absenceDate}) 칸을 처리하지 못해 예약을 취소했습니다 — ${cellRes.error}`,
    };
  }

  const span = `${makeupDate} ${periodLabel ? `${periodLabel} · ` : ""}${option.startTime}~${option.endTime}${hostId !== classId ? ` · ${hostName}` : ""}`;
  await logAction({
    action: "makeup_reserve",
    targetType: "attendance",
    targetLabel: `${stu.name} · ${hostName}`,
    metadata: {
      reservationId,
      studentId,
      // classId = 기록할 반(예약 행의 class_id) · absenceClassId = 결석난 반(다를 때만) — 취소가 결석 칸을 되돌릴 때 이 둘로 찾는다.
      classId: hostId,
      ...(hostId !== classId ? { absenceClassId: classId } : {}),
      absenceDate,
      makeupDate,
      slotStart: option.startTime,
      slotEnd: option.endTime,
      periodLabel,
      periodCount: range.count,
      absence,
      ...(reportMode ? { reportMode } : {}),
      ...(note ? { hasNote: true } : {}),
    },
  });
  revalidateSurfaces();
  return { ok: true, id: reservationId, absence, span };
}

export type CancelMakeupResult = { ok: true } | { error: string };

/**
 * 그 결석일 칸을 **예약이 새로 찍었나** — 예약 감사로그(`makeup_reserve`) 중 같은 (학생·반·결석일)에 `absence: "created"`가 하나라도.
 * 🔴 "이 예약이 만들었나"가 아니다 — 한 결석에 예약 둘(다른 보강일)을 걸면 첫 예약만 `created`라 둘째를 마지막으로 취소할 때
 *    사람이 안 만든 결석(0)이 남는다(재리뷰 2026-09-14). 예약 행엔 그 사실이 없고(0264a에 칸을 더하면 미적용 창에서 조회가
 *    죽는다, [[#95]]) 감사로그는 append-only라 근거로 믿을 만하다. 모르면 false.
 */
async function absenceCreatedByAnyReservation(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  key: { studentId: string; classId: string; absenceDate: string },
): Promise<boolean> {
  // 결석난 반 = 감사로그 `absenceClassId`(다른 반에 기록한 예약 — 2026-10-22) ?? `classId`(종전 = 같은 반).
  const { data, error } = await admin
    .from("audit_logs")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("action", "makeup_reserve")
    .eq("metadata->>studentId", key.studentId)
    .eq("metadata->>absenceDate", key.absenceDate)
    .eq("metadata->>absence", "created")
    .limit(50);
  if (error) return false;
  return (data ?? []).some((row) => {
    const m = (row.metadata ?? {}) as { classId?: string; absenceClassId?: string };
    return (m.absenceClassId ?? m.classId) === key.classId;
  });
}

/**
 * 예약 취소 — 행을 **지운다**(0264a 유니크 규약) + 결석 칸 되돌리기: 예약이 그 결석을 **새로 찍은 것**이고 칸에 다른
 * 정보(사유·다른 보강 줄)가 없으면 **칸(0)째 지운다**(원장 2026-09-14 *"초기화시켜서 0까지 없어져야하는데 메모만 사라졌어"*),
 * 이미 결석이던 날이나 사유가 적힌 칸은 "M/D 보강 예정" 줄만 뺀다(사람이 적은 것은 지우지 않는다). 이행된 예약(`done`)은
 * 못 지운다 — 보강일 칸을 지우면 되돌아온다.
 */
export async function cancelMakeupReservation(input: { id: string }): Promise<CancelMakeupResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  if (!input.id) return { error: "예약을 찾지 못했습니다" };
  const r = await loadReservationById(user.tenantId, input.id);
  if (!r) return { error: "예약을 찾지 못했습니다(이미 취소됐을 수 있습니다)" };
  if (r.status === "done") return { error: "이미 이행된 예약은 취소할 수 없습니다 — 보강일 출결을 고치세요" };
  const mappedBlock = await mappedReservationMutationBlock(mappedCancelCommand(r.id));
  if (mappedBlock) return { error: mappedBlock };

  const supabase = await createClient();
  // 결석일 칸의 반 — 기록할 반과 다르게 잡은 예약은 결석난 반이 따로 적혀 있다(0440a).
  const absenceClassId = absenceClassOf(r);
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const teaching = await userTaughtClassSet(supabase, user.id, r.absenceDate);
    // 결석난 반 담당(종전) — 다른 반에 기록한 예약이면 보강일에 기록할 반을 맡은 선생님도 취소할 수 있다.
    const hostTeaching = absenceClassId !== r.classId ? await userTaughtClassSet(supabase, user.id, r.makeupDate) : null;
    if (!teaching.has(absenceClassId) && !hostTeaching?.has(r.classId)) return { error: "담당 반이 아닙니다" };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "서버 설정 오류 — 관리자에게 알려 주세요" };
  }
  // 🔴 `select`로 **지운 행 수**를 본다 — 위에서 읽은 뒤 강사가 보강일 출결을 찍어 `done`이 됐으면 0행이고, 그때 메모·결석 칸을
  //    지우면 이행된 예약이 남은 채 결석 칸만 사라진다(재리뷰 2026-09-14).
  const { data: deleted, error: delErr } = await admin
    .from("makeup_reservations")
    .delete()
    .eq("tenant_id", user.tenantId)
    .eq("id", r.id)
    .eq("status", "reserved")
    .select("id");
  if (delErr) {
    console.error("[makeup-reservation] 예약 취소 실패", delErr.message);
    return { error: "예약을 취소하지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  if ((deleted ?? []).length === 0) {
    return { error: "그 사이 이행된 예약이라 취소할 수 없습니다 — 보강일 출결을 고치세요" };
  }

  // 결석 칸의 예정 줄 제거 — 메모만(상태·시수 불변). 실패해도 취소는 이미 됐으니 알리기만 한다.
  // 🔴 같은 결석일 → 같은 보강일의 **다른 예약**(다른 교시를 따로 잡은 것)이 남아 있으면 줄은 그대로 둔다 — 그 줄은
  //    "10/5 보강 예정" 하나라 예약마다 있지 않다. 🔴 쓰기는 줄이 있는 **그 행에 직접**(`writeNoteOnRow`).
  let memoCleared = true;
  let memoKept = false;
  let absenceCleared = false;
  try {
    const memo = reservationAbsenceMemo(r);
    // 같은 결석일의 남은 예약 — 같은 보강일이면 '예정' 줄을 남기고, 하나라도 남아 있으면 결석 칸은 지우지 않는다.
    // 🔴 같은 **결석 칸**(결석난 반 · 결석일)에 걸린 예약 — 기록할 반은 예약마다 다를 수 있어 반으로 거르지 않고 결석난 반으로 거른다.
    const readSiblings = (select: string) =>
      admin
        .from("makeup_reservations")
        .select(select)
        .eq("tenant_id", user.tenantId)
        .eq("student_id", r.studentId)
        .eq("absence_date", r.absenceDate)
        .returns<{ makeup_date: string; class_id: string; absence_class_id?: string | null }[]>();
    let { data: remaining, error: remErr } = await readSiblings("makeup_date, class_id, absence_class_id");
    if (remErr && isMissingColumn(remErr, "absence_class_id")) ({ data: remaining, error: remErr } = await readSiblings("makeup_date, class_id"));
    if (remErr) throw new Error(remErr.message);
    const remainingRows = (remaining ?? []).filter((x) => (x.absence_class_id ?? x.class_id) === absenceClassId);
    const siblings = remainingRows.filter((x) => String(x.makeup_date).slice(0, 10) === r.makeupDate).length;
    if (siblings > 0) {
      memoKept = true;
    } else {
      const day = await loadEffectiveDay(supabase, { studentId: r.studentId, classId: absenceClassId, date: r.absenceDate });
      const targets = day.filter((c) => hasMemoLine(c.note, memo));
      // 칸에 이 예약 말고 아무것도 없다(전 행이 결석·공결 + 이 줄뿐) → 예약이 만든 칸이면 칸째 지운다(출결 지우기 액션 그대로).
      const bare =
        targets.length > 0 &&
        day.every(
          (c) => (c.status === "absent" || c.status === "excused") && hasMemoLine(c.note, memo) && removeMemoLine(c.note, memo) === null,
        );
      const erase =
        bare &&
        remainingRows.length === 0 &&
        (await absenceCreatedByAnyReservation(admin, user.tenantId, { studentId: r.studentId, classId: absenceClassId, absenceDate: r.absenceDate }));
      const erased = erase
        ? await setAttendanceCell({ studentId: r.studentId, classId: absenceClassId, sessionDate: r.absenceDate, status: null, quiet: true })
        : null;
      if (erased && !("error" in erased)) {
        absenceCleared = true;
      } else {
        for (const target of targets) {
          const res = await writeNoteOnRow(supabase, target.id, removeMemoLine(target.note, memo));
          if ("error" in res) memoCleared = false;
        }
      }
    }
  } catch {
    memoCleared = false;
  }

  const [{ data: stu }, { data: cls }] = await Promise.all([
    supabase.from("students").select("name").eq("id", r.studentId).maybeSingle(),
    supabase.from("classes").select("class_name").eq("id", r.classId).maybeSingle(),
  ]);
  await logAction({
    action: "makeup_reserve_cancel",
    targetType: "attendance",
    ...(stu?.name && cls?.class_name ? { targetLabel: `${stu.name} · ${cls.class_name}` } : {}),
    metadata: {
      reservationId: r.id,
      studentId: r.studentId,
      classId: r.classId,
      absenceDate: r.absenceDate,
      makeupDate: r.makeupDate,
      slotStart: r.slotStart,
      memoCleared,
      ...(memoKept ? { memoKept: true } : {}),
      ...(absenceCleared ? { absenceCleared: true } : {}),
    },
  });
  revalidateSurfaces();
  return { ok: true };
}

/** 예약이 보이는 화면 — 출석부(월별·일별·오늘)·시간표(보강 탭)·원스크린·ECS. */
/**
 * 보강 예약의 **보고서 발송 방식**을 바꾼다 — 원스크린의 보강 보고서 합치기 ↔ 나누기(원장 2026-10-22). 예약 줄이면 새로고침이 예약대로
 * 다시 세우므로(reserved-makeup.ts) 화면에서 바꾼 방식을 예약에도 적어야 유지된다. 그 학생 · 그 반 · 그날의 예약(예약·이행 둘 다).
 * 게이트 = 출결 쓰기 + 강사는 그날 그 반 담당(예약 저장과 같은 문, #77). 감사로그 `makeup_reserve_report_mode`.
 */
export async function setReservationReportMode(input: {
  studentId: string;
  classId: string;
  date: string;
  mode: MakeupReportMode;
}): Promise<{ ok: true; updated: number } | { error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  if (!input?.studentId || !input.classId || !YMD.test(input.date) || !isMakeupReportMode(input.mode)) return { error: "잘못된 요청입니다" };
  const supabase = await createClient();
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const teaching = await userTaughtClassSet(supabase, user.id, input.date);
    if (!teaching.has(input.classId)) return { error: "담당 반이 아닙니다" };
  }
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "서버 설정 오류 — 관리자에게 알려 주세요" };
  }
  const { data, error } = await admin
    .from("makeup_reservations")
    .update({ report_mode: input.mode, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId)
    .eq("student_id", input.studentId)
    .eq("class_id", input.classId)
    .eq("makeup_date", input.date)
    .in("status", ["reserved", "done"])
    .select("id");
  if (error) {
    if (isMissingReservationTable(error) || isMissingColumn(error, "report_mode")) return { error: NOT_APPLIED };
    console.error("[makeup-reservation] 발송 방식 저장 실패", error.message);
    return { error: "보강 예약의 발송 방식을 바꾸지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length) {
    await logAction({
      action: "makeup_reserve_report_mode",
      targetType: "attendance",
      metadata: { studentId: input.studentId, classId: input.classId, date: input.date, mode: input.mode, reservationIds: ids },
    });
    revalidateSurfaces();
  }
  return { ok: true, updated: ids.length };
}

/**
 * 보강 예약을 **그날 정규 반으로 옮겨 합친다** — 원스크린 '(보강)' 줄의 '정규에 합치기'(원장 2026-10-27 박지호 건 *"예약 보강도 정규 반으로
 * 옮겨 합치기"*). 예약 창에서 기록할 반 = 그 정규 반 + '함께 발송'으로 다시 잡은 것과 같은 행 모양: `class_id` = 정규 반 ·
 * `absence_class_id` = 결석난 반(같으면 비움) · `report_mode` = merge. 결석 칸·'보강 예정' 메모는 결석난 반 그대로(`absenceClassOf`).
 * 🔴 이행된 예약·기록된 반 출석부에 이미 보강이 찍힌 날은 막는다(옮기면 시수가 두 반에 두 번 선다).
 * 🔴 합칠 반 = 예약 창의 기록할 반 후보(`reservationHostChoices` — 학생이 그날 다니는 열린 같은 과목 반 · 강사는 그날 담당 반) + 그날 정규 수업일.
 * 시수: 합칠 반 출석이 이미 찍혀 있으면 지금 이행하고(`completeMakeupReservations` `addToCurrent` — '보강 완료' 메모·결석 칸 '예정 → 완료')
 * 시수는 '+ 보강 학생 추가' 합침과 같은 규칙으로 **지금 값 + 보강분**. 아직이면 출석을 찍을 때 이행된다(새 칸 = 정규 + 보강 자동값).
 * 게이트 = 출결 쓰기 + 강사(scoped)는 합칠 반을 그날 맡고, 기록된 반을 그날 맡거나 결석난 반을 결석일에 맡았다(취소와 같은 축) + 출결 수정 기간
 * (시수는 급여 값 — `setAttendanceCell`과 같은 잠금 · 같은 scoped 기준). 감사로그 `makeup_reserve_host_move`.
 */
export async function moveReservationToRegular(input: {
  studentId: string;
  date: string;
  /** 지금 예약이 기록된 반(원스크린 보강 줄의 앵커). */
  fromClassId: string;
  /** 합칠 정규 반. */
  toClassId: string;
}): Promise<{ ok: true; moved: number; units?: number | null } | { error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  const { studentId, date, fromClassId, toClassId } = input ?? ({} as typeof input);
  if (!studentId || !fromClassId || !toClassId || fromClassId === toClassId || !YMD.test(date ?? "")) return { error: "잘못된 요청입니다" };
  // 🔴 강사(scoped) 출결 수정 기간 — 옮기면 합칠 반 칸의 시수가 바뀐다(적대 리뷰 2026-10-27: 2주 전 날짜를 열고 합치면 옛 칸 시수가 바뀌었다).
  //    기준은 `setAttendanceCell`과 같은 권한 매트릭스 scoped(역할 이름이 아니다).
  const scoped = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  const today = kstToday();
  if (scoped && !isWithinAttendanceEditWindow(date, today)) return { error: attendanceLockMessage(date, today) };
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "서버 설정 오류 — 관리자에게 알려 주세요" };
  }
  // 칸(0438a·0440a)이 없으면 옮길 수 없다 — 다른 반 기록·합침을 적을 자리가 없다.
  const { data: rows, error: readErr } = await admin
    .from("makeup_reservations")
    .select("id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by, report_mode, absence_class_id")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", studentId)
    .eq("class_id", fromClassId)
    .eq("makeup_date", date)
    .in("status", ["reserved", "done"]);
  if (readErr) {
    if (isMissingReservationTable(readErr)) return { error: NOT_APPLIED };
    if (isMissingColumn(readErr, "absence_class_id") || isMissingColumn(readErr, "report_mode")) {
      return { error: "다른 반에 기록하는 보강 예약은 아직 준비 중입니다 — 관리자에게 알려 주세요" };
    }
    console.error("[makeup-reservation] 옮길 예약 조회 실패", readErr.message);
    return { error: "보강 예약을 읽지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  const list = ((rows ?? []) as unknown as Parameters<typeof toReservation>[0][]).map(toReservation);
  if (list.length === 0) return { error: "옮길 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요" };
  const DONE_ERROR = "이 보강은 이미 기록된 반 출석부에 찍혀 있어 다른 반으로 옮길 수 없습니다 — 출석부에서 보강 칸을 먼저 고쳐 주세요";
  if (list.some((r) => r.status === "done")) return { error: DONE_ERROR };

  const supabase = await createClient();
  if (scoped) {
    const teaching = await userTaughtClassSet(supabase, user.id, date);
    if (!teaching.has(toClassId)) return { error: "담당 반이 아닙니다" };
    if (!teaching.has(fromClassId)) {
      for (const r of list) {
        const then = await userTaughtClassSet(supabase, user.id, r.absenceDate);
        if (!then.has(absenceClassOf(r))) return { error: "담당 반이 아닙니다" };
      }
    }
  }
  for (const r of list) {
    const block = await mappedReservationMutationBlock({ reservationId: r.id, action: "reschedule" });
    if (block) return { error: block };
  }

  const [{ data: fromCls }, { data: stu }] = await Promise.all([
    admin.from("classes").select("subject").eq("tenant_id", user.tenantId).eq("id", fromClassId).maybeSingle(),
    admin.from("students").select("name").eq("tenant_id", user.tenantId).eq("id", studentId).maybeSingle(),
  ]);
  if (!fromCls) return { error: "반을 찾지 못했습니다" };
  let hosts: ReservationHost[];
  try {
    hosts = await reservationHostChoices(supabase, user, { studentId, absenceClassId: absenceClassOf(list[0]!), subject: String(fromCls.subject ?? ""), date });
  } catch {
    return { error: "학생의 반을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  const host = hosts.find((h) => h.classId === toClassId);
  if (!host) return { error: "합칠 반을 다시 확인해 주세요 — 그날 이 학생이 다니는 같은 과목 반만 됩니다" };
  const regularDay = await isRegularLessonDay(user.tenantId, { studentId, classId: toClassId, date });
  if (regularDay === null) return { error: "그날 정규 수업인지 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  if (!regularDay) return { error: `그날은 ${host.className} 정규 수업일이 아니라 합칠 수 없습니다` };

  // 기록된 반에 그날 보강이 이미 찍혀 있으면(예약 이행 전 다른 경로로) 옮기면 시수가 두 번 선다. 강사 RLS에 가리지 않게 admin + tenant.
  const { data: fromDay, error: dayErr } = await admin
    .from("attendance_records")
    .select("id, student_id, class_id, session_date, slot_start, status, note, recorded_at")
    .eq("tenant_id", user.tenantId)
    .eq("class_id", fromClassId)
    .eq("student_id", studentId)
    .eq("session_date", date);
  if (dayErr) return { error: "출석부를 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  if (effectiveAttendanceRecords((fromDay ?? []) as AttRow[]).some((c) => completesReservation(c.status))) return { error: DONE_ERROR };

  const now = new Date().toISOString();
  const moved: typeof list = [];
  const undo = async () => {
    for (const r of moved) {
      const { error: undoErr } = await admin
        .from("makeup_reservations")
        .update({ class_id: r.classId, absence_class_id: r.absenceClassId ?? null, report_mode: r.reportMode ?? null, updated_at: now })
        .eq("tenant_id", user.tenantId)
        .eq("id", r.id)
        .eq("status", "reserved");
      if (undoErr) console.error("[makeup-reservation] 옮긴 예약을 되돌리지 못했습니다 — 관리자 확인 필요", r.id, undoErr.message);
    }
  };
  for (const r of list) {
    const absenceId = absenceClassOf(r);
    const { data: upd, error: updErr } = await admin
      .from("makeup_reservations")
      .update({ class_id: toClassId, absence_class_id: absenceId === toClassId ? null : absenceId, report_mode: "merge", updated_at: now })
      .eq("tenant_id", user.tenantId)
      .eq("id", r.id)
      .eq("status", "reserved")
      .eq("class_id", fromClassId)
      .select("id");
    if (updErr || (upd ?? []).length === 0) {
      await undo().catch(() => undefined);
      if (updErr?.code === "23505") return { error: `${host.className}에 같은 교시 보강 예약이 이미 있습니다` };
      if (!updErr) return { error: "그 사이 예약이 바뀌어 옮기지 못했습니다 — 새로고침 뒤 확인해 주세요" };
      console.error("[makeup-reservation] 예약 옮기기 실패", updErr.message);
      return { error: "보강 예약을 옮기지 못했습니다 — 잠시 후 다시 시도하세요" };
    }
    moved.push(r);
  }

  // 합칠 반 출석이 이미 찍혀 있으면 지금 이행('보강 완료' 메모 · 결석 칸 '예정 → 완료') — 아직이면 출석을 찍을 때 이행된다(새 칸 = 정규 + 보강 자동값).
  // 🔴 시수 = 지금 값 + 보강분(`addToCurrent`) — 이행 모듈의 '새 칸·빈 칸에만 자동값'으로는 이미 찍힌 칸에서 보강분이 빠지거나(3교시 반 1.5)
  //    시간표로 다시 매겨 사람이 친 값이 덮인다. 더하기는 예약을 done으로 바꾼 호출만 한다(동시 출석 저장과 두 번 더하지 않게) — 적대 리뷰 2026-10-27.
  const completed = await completeMakeupReservations({ tenantId: user.tenantId }, [
    { studentId, classId: toClassId, date, status: null, unitsExplicit: false, created: false, addToCurrent: true },
  ]);
  const units = completed.get(completionKey({ studentId, classId: toClassId, date }));
  await logAction({
    action: "makeup_reserve_host_move",
    targetType: "attendance",
    ...(stu?.name ? { targetLabel: `${stu.name} · ${host.className}` } : {}),
    metadata: {
      studentId,
      date,
      fromClassId,
      classId: toClassId,
      reservationIds: moved.map((r) => r.id),
      reportMode: "merge",
      ...(units !== undefined ? { units } : {}),
    },
  });
  revalidateSurfaces();
  return { ok: true, moved: moved.length, ...(units !== undefined ? { units } : {}) };
}

/**
 * 못 했음 — 정규 수업이 없는 날의 보강 칸이 남아 있다(칸째 지워야 시수·보고서가 함께 정리된다). 코드 `makeup_only`를 받은 화면은 그
 * '(보강)' 줄을 '보강 빼기'와 같은 길(`removeMakeupEntry` — 보강 칸·명단·미발송 보고서)로 지우고 다시 묻는다. 문구는 그 길이 막혔을 때만 보인다.
 */
const MISSED_MAKEUP_ONLY_ERROR = "정규 수업이 없는 날의 보강 출결이 남아 있습니다 — 출석부에서 그 칸을 지운 뒤 다시 눌러 주세요";
/** 못 했음 — 정규 수업일인데 칸이 '보강'으로 찍혔거나 시수가 보강분뿐이라 정규분을 가려낼 수 없다. */
const MISSED_MAKEUP_STATUS_ERROR =
  "그날 출결 칸에서 정규 수업분을 가려낼 수 없습니다(출결이 '보강'이거나 시수가 보강분뿐) — 출석부에서 출결·시수를 고친 뒤 다시 눌러 주세요";

export type CheckMakeupResult =
  | {
      ok: true;
      outcome: "done" | "missed";
      /** 보강 했음 — 이행이 시수를 바꿨으면 그 값(null = 1). 못 했음 — 보강분을 뺀 값. */
      units?: number | null;
      /** 보강 했음 — 그날 칸이 없어 새로 찍은 출결(정규 수업일 = 출석 · 아니면 보강). 화면이 출결 알약을 맞춘다. */
      marked?: "present" | "makeup";
      /** 못 했음인데 시수를 사람이 고쳐 둬서(또는 근거를 몰라) 손대지 않았다 — 출석부에서 확인하라고 알린다. */
      unitsLeft?: true;
      /** 확인 칸(0458a)이 아직 없어 '했음'을 남기지 못했다(이행·시수는 했다). */
      checkUnsaved?: true;
    }
  | { error: string; code?: "makeup_only" };

/**
 * **보강 진행 여부 확인** — 원스크린 보강 표식에서 '보강 했음 / 보강 못 했음'(원장 2026-10-27 *"보강을 실제로 진행했는지도 선생님이
 * 체크할 수 있도록 … 보강 예약을 누르면 보강을 했다 안했다 체크"* · *"보강체크를 하지 않으면 보고서 발송 비활성화"*).
 * 대상 = 그 학생 · 그 반(예약이 기록된 반) · 그날의 예약 전부.
 *  · 했음: 아직 이행 전이면 지금 이행한다 — 그 반 그날 칸이 이미 찍혀 있으면 그 칸에 얹는다: 정규 수업일의 정규 칸이면 `addToCurrent`
 *    (지금 값 + 보강분 — 박지호 10/27처럼 출석이 예약보다 먼저 찍힌 칸), 보강 칸·정규 수업일이 아니면 시수는 두고 이행만(이미 보강분이 든 칸에
 *    또 더하지 않는다 — 적대 리뷰). 칸이 없으면 찍는다(정규 수업일 = 출석 · 아니면 보강 — 그 이행 훅이 자동값). 결석·공결 날은 막는다.
 *    그 뒤 `checked_at`·`checked_by`(0458a — 칸이 없으면 이행만 하고 알린다).
 *  · 못 했음: 예약을 지운다 — 이행된 예약이면 칸마다 묶어 보강분 시수를 뺀다(그 칸의 지금 값이 마지막 이행 값 그대로이고 이행 순서대로
 *    누적됐을 때만 · 아니면 두고 알린다 — 사람이 고쳤거나 근거를 모른다). '결석분 보강' 메모와 결석 칸의 '보강 예정/완료' 줄을 뺀다
 *    (결석은 '보강 안 된 결석' — 다시 예약).
 *    🔴 정규 수업이 없는 날의 보강 칸이 남아 있으면 칸째 지워야 해서 막고 '(보강)' 줄의 '보강 빼기'로 안내한다(칸이 이미 없으면 예약만 지운다).
 *       정규 수업일인데 칸이 '보강'이면 정규분을 가려낼 수 없어 막고 출석부에서 고치게 한다.
 *    🔴 조회가 하나라도 실패하면 쓰기 전에 멈춘다(시수는 그대로인 채 예약만 지우면 과지급이 남는다).
 * 게이트 = 출결 쓰기 + 강사(scoped)는 출결 수정 기간 + **그날 그 반 담당**(시수를 바꾸는 칸의 반 — 출결 저장과 같은 축) · 연결 예약은 막는다.
 * 감사로그 `makeup_reserve_check`.
 */
export async function checkMakeupReservation(input: {
  studentId: string;
  /** 예약이 기록된 반(정규+보강 줄의 반 · '(보강)' 줄의 앵커 반). */
  classId: string;
  date: string;
  outcome: "done" | "missed";
}): Promise<CheckMakeupResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  const { studentId, classId, date, outcome } = input ?? ({} as typeof input);
  if (!studentId || !classId || !YMD.test(date ?? "") || (outcome !== "done" && outcome !== "missed")) return { error: "잘못된 요청입니다" };
  const scoped = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  const today = kstToday();
  if (scoped && !isWithinAttendanceEditWindow(date, today)) return { error: attendanceLockMessage(date, today) };
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "서버 설정 오류 — 관리자에게 알려 주세요" };
  }
  const cols = "id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by, report_mode, absence_class_id";
  const readList = (select: string) =>
    admin
      .from("makeup_reservations")
      .select(select)
      .eq("tenant_id", user.tenantId)
      .eq("student_id", studentId)
      .eq("class_id", classId)
      .eq("makeup_date", date)
      .in("status", ["reserved", "done"]);
  let checkColumn = true;
  let { data: rows, error: readErr } = await readList(`${cols}, checked_at`);
  if (readErr && isMissingColumn(readErr, "checked_at")) {
    checkColumn = false;
    ({ data: rows, error: readErr } = await readList(cols));
  }
  if (readErr) {
    if (isMissingReservationTable(readErr)) return { error: NOT_APPLIED };
    console.error("[makeup-reservation] 확인할 예약 조회 실패", readErr.message);
    return { error: "보강 예약을 읽지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  const list = ((rows ?? []) as unknown as Parameters<typeof toReservation>[0][]).map(toReservation);
  if (list.length === 0) return { error: "확인할 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요" };

  const supabase = await createClient();
  if (scoped && !(await userTaughtClassSet(supabase, user.id, date)).has(classId)) return { error: "담당 반이 아닙니다" };
  for (const r of list) {
    const block = await mappedReservationMutationBlock({ reservationId: r.id, action: outcome === "done" ? "reschedule" : "cancel" });
    if (block) return { error: block };
  }
  const [{ data: cls }, { data: stu }, regularDay, profile] = await Promise.all([
    admin.from("classes").select("subject, class_name").eq("tenant_id", user.tenantId).eq("id", classId).maybeSingle(),
    admin.from("students").select("name").eq("tenant_id", user.tenantId).eq("id", studentId).maybeSingle(),
    isRegularLessonDay(user.tenantId, { studentId, classId, date }),
    getLessonProfile(user.tenantId),
  ]);
  if (regularDay === null) return { error: "그날 정규 수업인지 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  const subject = (cls?.subject as string | null) ?? null;
  const label = stu?.name && cls?.class_name ? { targetLabel: `${stu.name} · ${cls.class_name}` } : {};
  const log = (meta: Record<string, unknown>) =>
    logAction({
      action: "makeup_reserve_check",
      targetType: "attendance",
      ...label,
      metadata: { studentId, classId, date, outcome, reservationIds: list.map((r) => r.id), ...meta },
    });

  if (outcome === "done") {
    let units: number | null | undefined;
    let marked: "present" | "makeup" | undefined;
    if (list.some((r) => r.status === "reserved")) {
      // 그 반 그날 칸 — 시수 상태(출석·지각·조퇴·보강)가 있으면 그 칸에 얹고, 결석·공결이면 막고, 없으면 찍는다.
      const { data: dayRows, error: dayErr } = await admin
        .from("attendance_records")
        .select("id, student_id, class_id, session_date, slot_start, status, note, recorded_at")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", date);
      if (dayErr) return { error: "출석부를 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" };
      const day = effectiveAttendanceRecords((dayRows ?? []) as AttRow[]);
      const counted = day.filter((c) => completesReservation(c.status));
      if (counted.length > 0) {
        // 정규 수업일의 정규 칸에만 보강분을 얹는다 — 이미 '보강' 칸이거나 정규 수업일이 아니면 그 칸 시수에 보강분이 들어 있다(이행만).
        const addOn = regularDay && !counted.some((c) => c.status === "makeup");
        const completed = await completeMakeupReservations({ tenantId: user.tenantId }, [
          addOn
            ? { studentId, classId, date, status: null, unitsExplicit: false, created: false, addToCurrent: true }
            : { studentId, classId, date, status: null, unitsExplicit: true, created: false },
        ]);
        units = completed.get(completionKey({ studentId, classId, date }));
      } else if (day.some((c) => c.status === "absent" || c.status === "excused")) {
        return { error: "그날 출결이 결석이라 보강을 했다고 기록할 수 없습니다 — 출결을 먼저 고쳐 주세요" };
      } else {
        marked = regularDay ? "present" : "makeup";
        const cell = await setAttendanceCell({ studentId, classId, sessionDate: date, status: marked, units: "", quiet: true });
        if ("error" in cell) return { error: cell.error };
        if ("autoUnits" in cell && cell.autoUnits !== undefined) units = cell.autoUnits;
      }
      const { data: still, error: stillErr } = await admin
        .from("makeup_reservations")
        .select("id")
        .eq("tenant_id", user.tenantId)
        .in("id", list.map((r) => r.id))
        .eq("status", "reserved");
      if (stillErr || (still ?? []).length > 0) return { error: "보강을 처리하지 못했습니다 — 출석부에서 그날 출결을 확인해 주세요" };
    }
    const extra = { ...(units !== undefined ? { units } : {}), ...(marked ? { marked } : {}) };
    if (!checkColumn) {
      await log({ checkUnsaved: true, ...extra });
      revalidateSurfaces();
      return { ok: true, outcome, checkUnsaved: true, ...extra };
    }
    const now = new Date().toISOString();
    const { error: chkErr } = await admin
      .from("makeup_reservations")
      .update({ checked_at: now, checked_by: user.id, updated_at: now })
      .eq("tenant_id", user.tenantId)
      .in("id", list.map((r) => r.id))
      .eq("status", "done");
    if (chkErr) {
      console.error("[makeup-reservation] 보강 확인 저장 실패", chkErr.message);
      return { error: "보강 확인을 저장하지 못했습니다 — 잠시 후 다시 시도하세요" };
    }
    await log(extra);
    revalidateSurfaces();
    return { ok: true, outcome, ...extra };
  }

  // ── 못 했음 ── 막힐 일과 조회를 모두 본 뒤에 쓴다(반쪽 상태 금지 · 조회 실패면 멈춘다).
  const READ_FAIL = { error: "보강 기록을 읽지 못했습니다 — 잠시 후 다시 시도하세요" } as const;
  type CellRow = { id: string; slot_start: string | null; status: string; session_units: number | string | null; note: string | null };
  const doneList = list.filter((r) => r.status === "done");
  let cellIdOf = new Map<string, string | null>();
  let cells = new Map<string, CellRow>();
  /** 연결이 끊긴 이행 예약이 있는데 그 반 그날에 연결 밖 시수 칸이 남아 있다(보강분이 거기 들었는지 모른다). */
  let orphanCounted = false;
  if (doneList.length) {
    const { data: links, error: linkErr } = await admin
      .from("makeup_reservations")
      .select("id, attendance_record_id")
      .eq("tenant_id", user.tenantId)
      .in("id", doneList.map((r) => r.id));
    if (linkErr) return READ_FAIL;
    cellIdOf = new Map(((links ?? []) as { id: string; attendance_record_id: string | null }[]).map((l) => [l.id, l.attendance_record_id]));
    const cellIds = [...new Set([...cellIdOf.values()].filter((x): x is string => !!x))];
    if (cellIds.length) {
      const { data: cellRows, error: cellErr } = await admin
        .from("attendance_records")
        .select("id, slot_start, status, session_units, note")
        .eq("tenant_id", user.tenantId)
        .in("id", cellIds);
      if (cellErr) return READ_FAIL;
      cells = new Map(((cellRows ?? []) as CellRow[]).map((c) => [c.id, c]));
    }
    // 연결이 끊긴 이행 예약(연결된 칸이 지워졌다 — '보강 빼기' 등) — 그 반 그날에 다른 시수 칸이 남았는지 다시 본다(다른 교시 · 정정 이력에서
    // 올라온 행 · '보강 빼기'가 안 지우는 출석 칸). 남았으면 보강분이 거기 들었는지 알 수 없다 — 경고 없이 예약만 지우면 과지급이 숨는다(재리뷰).
    if (doneList.some((r) => !cells.has(cellIdOf.get(r.id) ?? ""))) {
      const { data: dayRows, error: dayErr } = await admin
        .from("attendance_records")
        .select("id, student_id, class_id, session_date, slot_start, status, note, recorded_at")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", date);
      if (dayErr) return READ_FAIL;
      orphanCounted = effectiveAttendanceRecords((dayRows ?? []) as AttRow[]).some((c) => completesReservation(c.status) && !cells.has(c.id));
    }
    // 🔴 보강만 있던 칸 — 그날 정규 수업일이 아니면 그 칸 시수가 보강분뿐이라 칸째 지워야 한다(감사로그와 무관하게 판정).
    //    칸이 이미 없으면('보강 빼기'로 지웠다) 뺄 시수가 없다 — 예약만 지운다(막으면 막다른 길이다, 적대 리뷰 2026-10-27).
    if ((cells.size > 0 || orphanCounted) && !regularDay) return { error: MISSED_MAKEUP_ONLY_ERROR, code: "makeup_only" };
    // 정규 수업일인데 칸이 '보강'으로 찍혔다 — 정규분·보강분을 가려낼 수 없다(칸을 지우라고 하면 정규 출석까지 사라진다).
    if ([...cells.values()].some((c) => c.status === "makeup")) return { error: MISSED_MAKEUP_STATUS_ERROR };
  }
  // 이행이 적은 시수(감사로그 `makeup_reserve_done.autoUnits` · 최신) — 칸마다 묶어 본다.
  const autoOf = new Map<string, { auto: number; at: string }>();
  const autoOn = profile.autoUnits;
  if (autoOn) {
    for (const r of doneList) {
      const { data: logs, error: logErr } = await admin
        .from("audit_logs")
        .select("metadata, created_at")
        .eq("tenant_id", user.tenantId)
        .eq("action", "makeup_reserve_done")
        .eq("metadata->>reservationId", r.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (logErr) return READ_FAIL;
      const auto = (logs?.[0]?.metadata as { autoUnits?: unknown } | undefined)?.autoUnits;
      if (typeof auto === "number") autoOf.set(r.id, { auto, at: String(logs?.[0]?.created_at ?? "") });
    }
  }
  type CellPlan = { id: string; units?: number | null; note: string | null; noteChanged: boolean };
  const plans: CellPlan[] = [];
  // 정규 수업일에 연결 밖 시수 칸이 남았으면 시수는 두고 알린다(정규 칸일 수도, 보강분이 든 칸일 수도 있다).
  let unitsLeft = orphanCounted && autoOn;
  const byCell = new Map<string, typeof doneList>();
  for (const r of doneList) {
    const cellId = cellIdOf.get(r.id);
    if (!cellId || !cells.has(cellId)) continue;
    byCell.set(cellId, [...(byCell.get(cellId) ?? []), r]);
  }
  for (const [cellId, rs] of byCell) {
    const cell = cells.get(cellId)!;
    const plan: CellPlan = { id: cell.id, note: cell.note, noteChanged: false };
    for (const r of rs) {
      const line = reservationMakeupMemo(r);
      if (hasMemoLine(plan.note, line)) {
        plan.note = removeMemoLine(plan.note, line);
        plan.noteChanged = true;
      }
    }
    if (autoOn && cell.slot_start == null) {
      // 이 칸에 얹힌 예약이 모두 자동값으로 이행됐고, 이행 순서대로 **누적**됐고(k번째 = k−1번째 + 그 보강분), 칸이 마지막 이행 값
      // 그대로일 때만 — 그 값에서 보강분 합을 뺀다. 🔴 같은 날 새 칸에 두 예약이 이행되면 두 번째가 `정규 + 자기 보강분`으로 덮어
      // 감사로그가 누적이 아니다 — 그때 합을 빼면 과차감(정규 출석까지 깎인다)이라 두고 알린다(적대 리뷰 2026-10-27).
      const resOf = (r: MakeupReservation) => reservationAutoUnits(r, subject) ?? 0;
      const resSum = round1(rs.reduce((sum, r) => sum + resOf(r), 0));
      const chain = rs.map((r) => ({ r, log: autoOf.get(r.id) }));
      const known = chain.every((c) => !!c.log);
      chain.sort((a, b) => (a.log?.at ?? "").localeCompare(b.log?.at ?? ""));
      const cumulative = known && chain.every((c, k) => k === 0 || round1(c.log!.auto - chain[k - 1].log!.auto) === round1(resOf(c.r)));
      const latest = known ? chain[chain.length - 1].log! : undefined;
      const current = cell.session_units == null ? 1 : Number(cell.session_units);
      if (latest && cumulative && resSum > 0 && current === latest.auto) {
        const next = round1(latest.auto - resSum);
        if (next <= 0) return { error: MISSED_MAKEUP_STATUS_ERROR };
        plan.units = next === 1 ? null : next;
      } else if (resSum > 0) {
        unitsLeft = true;
      }
    }
    plans.push(plan);
  }
  let units: number | null | undefined;
  for (const plan of plans) {
    const patch: Record<string, unknown> = {};
    if (plan.noteChanged) patch.note = plan.note;
    if (plan.units !== undefined) patch.session_units = plan.units;
    if (Object.keys(patch).length === 0) continue;
    const { error: cellErr } = await admin.from("attendance_records").update(patch).eq("tenant_id", user.tenantId).eq("id", plan.id);
    if (cellErr) {
      console.error("[makeup-reservation] 보강 못 함 — 칸 고치기 실패", plan.id, cellErr.message);
      return { error: "출석부 칸을 고치지 못했습니다 — 잠시 후 다시 시도하세요" };
    }
    if (plan.units !== undefined) units = plan.units;
  }
  const { error: delErr } = await admin
    .from("makeup_reservations")
    .delete()
    .eq("tenant_id", user.tenantId)
    .in("id", list.map((r) => r.id))
    .in("status", ["reserved", "done"]);
  if (delErr) {
    console.error("[makeup-reservation] 보강 못 함 — 예약 지우기 실패", delErr.message);
    return { error: "보강 예약을 지우지 못했습니다 — 잠시 후 다시 시도하세요" };
  }
  // 결석 칸 메모 — 이 보강의 '예정/완료' 줄을 뺀다. 같은 결석 · 같은 보강일의 다른 예약(다른 반)이 남아 있으면 그 줄은 둔다.
  for (const r of list) {
    const absenceClassId = absenceClassOf(r);
    const { data: siblings } = await admin
      .from("makeup_reservations")
      .select("id, class_id, absence_class_id, makeup_date")
      .eq("tenant_id", user.tenantId)
      .eq("student_id", studentId)
      .eq("absence_date", r.absenceDate)
      .eq("makeup_date", r.makeupDate);
    const kept = ((siblings ?? []) as { class_id: string; absence_class_id: string | null }[]).some(
      (x) => (x.absence_class_id ?? x.class_id) === absenceClassId,
    );
    if (kept) continue;
    const { data: absRows } = await admin
      .from("attendance_records")
      .select("id, note")
      .eq("tenant_id", user.tenantId)
      .eq("class_id", absenceClassId)
      .eq("student_id", studentId)
      .eq("session_date", r.absenceDate);
    for (const a of (absRows ?? []) as { id: string; note: string | null }[]) {
      let note = a.note;
      for (const line of [reservationAbsenceDoneMemo(r), reservationAbsenceMemo(r)]) {
        if (hasMemoLine(note, line)) note = removeMemoLine(note, line);
      }
      if (note !== a.note) await admin.from("attendance_records").update({ note }).eq("tenant_id", user.tenantId).eq("id", a.id);
    }
  }
  await log({ ...(units !== undefined ? { units } : {}), ...(unitsLeft ? { unitsLeft: true } : {}) });
  revalidateSurfaces();
  return { ok: true, outcome, ...(units !== undefined ? { units } : {}), ...(unitsLeft ? { unitsLeft: true as const } : {}) };
}

function revalidateSurfaces() {
  revalidatePath("/attendance");
  revalidatePath("/timetable");
  revalidatePath("/onescreen");
  revalidatePath("/ecs");
}
