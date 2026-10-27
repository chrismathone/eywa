import "server-only";
import { getLessonProfile } from "@/features/owner/server/lesson-profile";

/**
 * 보강 예약 **이행·되돌림** — 보강일에 그 (학생·반) 출결이 찍히면 예약을 `done`으로 넘기고 메모를 잇고 시수를 맞춘다.
 * 그 출결이 지워지거나 결석으로 고쳐지면 예약을 `reserved`로 **되돌린다**(이행이 한 방향뿐이면 오클릭 출석 한 번에
 * 예약이 갇힌다 — 취소도 재예약도 못 하게 된다, 적대 리뷰 2026-09-14).
 *
 * 원장 2026-09-14: *"10/5에 보강하면 되니까. 메모도 자동 입력되고"* + *"보강이 실제로 실시 되었을때 출결을 체크한다면,
 * 1시간당 0.5 즉 2개를 고르면 1이 입력되는 자동화"* — 예약된 학생은 그날 출석부에 미리 서 있고, 강사가 평소처럼 칸을
 * 찍으면(출석·보강·숫자) 그것으로 끝이다. 따로 '이행' 버튼을 누르지 않는다.
 *
 * 🔴 **판정은 호출부가 보낸 상태가 아니라 DB의 그날 유효 행**이다(`pickFulfillingRow`) — 시수 상태 행이 있으면 이행,
 *    없으면(지워졌다·결석으로 고쳤다) 되돌림. 호출부의 칸 목록은 "어느 (학생·반·날짜)를 다시 볼 것인가"만 말한다.
 * 🔴 **이행 행 고르기**: 그날 전체 행(교시 없음, 수학) 최신 → 없으면 **예약 구간 안에서 시작하는 교시 행**(영어·자리) 최신.
 *    영어처럼 교시 행만 있는 반에서 정규 16:20 출석이 17:20 보강 예약을 이행시키면 안 된다.
 * 🔴 **쓰는 것 넷**: ① 예약 행 `status=done` + 그날 출결 행 연결 ② 보강 칸 메모 `makeupMemo`("9/30 결석분 보강", 멱등)
 *    ③ 결석 칸 메모 "10/5 보강 예정" → "보강 완료" ④ **시수 자동값** — 강사가 숫자를 안 쳤을 때만(`unitsExplicit=false`),
 *    새 행 또는 시수가 아직 기본(null)인 행에만, 수학 자동 시수와 같은 식(`reservationAutoUnits`: 교시 하나 0.5).
 *    **그날 그 반이 실제로 돌고** 그 학생이 정규로 오는 날이면 정규 자동값(수업 길이) **+ 보강값**(한 칸이라 합),
 *    반이 안 도는 날(다른 요일·토요일 보강)이나 예약으로만 온 학생이면 **보강값만**. 🔴 "정규 수강생"만 보고 1을 더하면
 *    화요일(반 수업 없음) 보강이 1.5로 부푼다(리뷰 2026-09-14) — 수업 길이를 모르면(조회 실패) 시수는 손대지 않는다.
 *    🔴 강사가 친 숫자는 그대로다(원장 2026-09-01 *"입력된 숫자가 입력되도록"*).
 * 🔴 **fail-soft** — 0264a 미적용·조회 실패면 조용히 아무것도 안 한다(출결 저장은 이미 끝났다). 예약이 없는
 *    칸이 대부분이라 조회 한 번(인덱스 `(tenant, class, makeup_date)`)이 전부다.
 * ⚠️ 호출부(출결 쓰기·지우기 경로 전부)는 저장 **성공 뒤**에 부른다. 실패는 로그만 — 출결 저장을 되돌리지 않는다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { appendMemo, hasMemoLine, unitsAfterMakeup } from "@/features/onescreen/makeup-absence-link";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { DOW_KEYS } from "../calendar";
import { weekdayIndexOf } from "@/lib/date-kst";
import { toAutoUnitsSchedule, unitsFromMinutes } from "../auto-units";
import {
  absenceClassOf,
  markAbsenceMemoDone,
  markAbsenceMemoPlanned,
  pickFulfillingRow,
  removeMemoLine,
  reservationAbsenceDoneMemo,
  reservationAbsenceMemo,
  reservationAutoUnits,
  reservationMakeupMemo,
  type MakeupReservation,
} from "../makeup-reservation";
import { effectiveAttendanceRecords } from "../effective-records";
import { MAX_SESSION_UNITS, round1 } from "../session-units";
import { isMissingColumn, isMissingReservationTable, toReservation } from "./makeup-reservation-queries";
import { classifyLegacyReservations } from "@/features/makeups/server/adapters/completion";
import { effectGapsOf, noteEffectGap, type EffectGap } from "@/features/makeups/server/adapters/effects";
import { handleMappedAbsence, handleMappedFulfill } from "@/features/makeups/server/adapters/mapped-save";
import { loadRegularAttendanceTeacher } from "@/features/makeups/server/adapters/regular-attendance";
import { calendarTeacherHold, loadCurrentCalendar } from "./calendar-teacher";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { taughtByColumnReady } from "./taught-by-db";

export type CompletionCell = {
  studentId: string;
  classId: string;
  date: string;
  /** 이번 저장이 찍은 상태 — null = 지우기. 판정은 DB 행으로 다시 하므로 여기 값은 참고일 뿐이다. */
  status: string | null;
  /**
   * 강사가 시수를 **직접 쳤나**(빈칸이 아닌 원문) — true면 시수를 건드리지 않는다. 안 넘기면 false(자동값 대상).
   * ⚠️ "1"도 명시다(auto-units.ts 규약과 같다).
   */
  unitsExplicit?: boolean;
  /**
   * 이번 저장이 **새 행**을 만들었나 — 자동값은 새 행, 또는 시수가 아직 기본(null)인 행에만 넣는다. 있는 행의 숫자를
   * (이번엔 안 쳤어도) 예전에 친 값일 수 있어 덮지 않는다(auto-units.ts "INSERT에만"과 같은 결).
   */
  created?: boolean;
  /**
   * 이미 있는 칸에 보강분을 **지금 값 위에 더한다**(`unitsAfterMakeup` — '+ 보강 학생 추가' 합침과 같은 규칙). 정규 반으로 옮겨 합친 예약
   * (`moveReservationToRegular`, 원장 2026-10-27)만 싣는다 — 그 칸은 예약보다 먼저 찍혀 있어 '새 칸·빈 칸에만 자동값' 규칙으로는 보강분이
   * 빠지고(3교시 반 1.5), 시간표로 다시 매기면 사람이 친 값이 덮인다. 🔴 예약을 done으로 바꾼 **이 호출만** 더한다(①의 0행 검사) —
   * 동시 저장이 먼저 이행했으면 그쪽 값 그대로(두 번 더하지 않는다, 적대 리뷰 2026-10-27).
   */
  addToCurrent?: boolean;
};

/** 이행이 **시수를 바꾼** 칸 → 저장된 시수(null = 1). 호출부(단건 저장)가 화면 낙관값을 이 값으로 맞춘다. */
export type CompletionUnits = Map<string, number | null>;
export const completionKey = (c: { studentId: string; classId: string; date: string }) => `${c.studentId}|${c.classId}|${c.date}`;

type Admin = ReturnType<typeof createAdminClient>;

type AttRow = {
  id: string;
  student_id: string;
  class_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  note: string | null;
  session_units: number | string | null;
  recorded_at: string;
};

const ATT_SELECT = "id, student_id, class_id, session_date, slot_start, status, note, session_units, recorded_at";

/**
 * 그날 그 반의 **정규 수강생으로 오는 날**인가 — 로스터와 같은 판정(수강 유효 + 분리등원 요일).
 * null = 조회 실패. 연결 경로는 그때 시수를 쓰지 않고, 미연결 이행은 예전처럼 정규가 아닌 것으로 둔다.
 */
async function isRegularAttendee(admin: Admin, tenantId: string, r: MakeupReservation): Promise<boolean | null> {
  const { data, error } = await admin
    .from("enrollments")
    .select("start_date, end_date, on_hold, is_transferred, attendance_days")
    .eq("tenant_id", tenantId)
    .eq("class_id", r.classId)
    .eq("student_id", r.studentId);
  if (error) return null;
  const dow = DOW_KEYS[weekdayIndexOf(r.makeupDate)] ?? "";
  return (data ?? []).some(
    (e) =>
      isEnrollmentActiveOn(
        {
          startDate: (e.start_date as string | null) ?? "0000-01-01",
          endDate: (e.end_date as string | null) ?? null,
          onHold: (e.on_hold as boolean | null) ?? false,
          isTransferred: e.is_transferred === true,
        },
        r.makeupDate,
      ) && enrollmentAttendsOnDay(e.attendance_days as string[] | null, dow),
  );
}

/**
 * 그날 그 반의 **실제 수업 분** — 자리(LAB·JJ) 제외·같은 시작 시각 한 번(수학 자동 시수와 같은 `liveSlotMinutesOn`).
 * 0 = 그날 반이 안 돈다(다른 요일 보강). null = 모름(조회 실패 — 시수를 지어내지 않는다).
 */
async function classDayMinutes(admin: Admin, tenantId: string, classId: string, date: string): Promise<number | null> {
  const { data, error } = await admin
    .from("class_schedules")
    .select("day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  if (error) return null;
  let total = 0;
  for (const m of liveSlotMinutesOn(date, (data ?? []).map(toAutoUnitsSchedule)).values()) total += m;
  return total;
}

/**
 * 보강일이 그 학생의 **정규 수업일**인가 — 이행이 시수를 "정규 + 보강"으로 합치는 조건과 같은 두 판정(수강 유효 + 등원 요일 ·
 * 그날 반이 실제로 돈다). 예약 창이 '함께/따로 발송'을 물을지 정한다(원장 2026-10-22). null = 모름(조회 실패).
 */
export async function isRegularLessonDay(
  tenantId: string,
  at: { studentId: string; classId: string; date: string },
): Promise<boolean | null> {
  const admin = createAdminClient();
  // isRegularAttendee는 학생·반·보강일만 읽는다.
  const attendee = await isRegularAttendee(admin, tenantId, { studentId: at.studentId, classId: at.classId, makeupDate: at.date } as MakeupReservation);
  if (attendee !== true) return attendee;
  const minutes = await classDayMinutes(admin, tenantId, at.classId, at.date);
  return minutes === null ? null : minutes > 0;
}

const SCHEDULE_SELECT = "day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label";

/** 연결 시수의 수업 길이. 페이지가 하나라도 실패하면 null(없는 수업으로 보지 않는다). */
async function mappedClassMinutes(admin: Admin, tenantId: string, classId: string, date: string): Promise<number | null> {
  try {
    const rows = await fetchAllPaged<{
      day_of_week: string; start_time: string; end_time: string; valid_from: string; valid_to: string | null; slot_teacher_label: string | null;
    }>((from, to) =>
      admin.from("class_schedules").select(SCHEDULE_SELECT)
        .eq("tenant_id", tenantId).eq("class_id", classId).lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`).order("id").range(from, to),
    );
    let total = 0;
    for (const minutes of liveSlotMinutesOn(date, rows.map(toAutoUnitsSchedule)).values()) total += minutes;
    return total;
  } catch {
    return null;
  }
}

/** 그날 그 칸의 행 전부(정정 이력 포함) → 유효 행. 한 페이지가 실패하면 null(없는 출결로 보지 않는다). */
async function loadDay(admin: Admin, tenantId: string, r: MakeupReservation, date: string): Promise<AttRow[] | null> {
  try {
    const rows = await fetchAllPaged<AttRow>((from, to) =>
      admin
        .from("attendance_records")
        .select(ATT_SELECT)
        .eq("tenant_id", tenantId)
        .eq("class_id", r.classId)
        .eq("student_id", r.studentId)
        .eq("session_date", date)
        .order("id")
        .range(from, to),
    );
    return effectiveAttendanceRecords(rows);
  } catch {
    return null;
  }
}

/**
 * 찍힌·지운 칸들 중 예약이 걸린 것을 이행하거나 되돌린다. 시수를 바꾼 칸을 돌려준다(호출부는 무시해도 된다).
 * @param cells 이번 저장이 손댄 칸 — 상태가 무엇이든 그 (학생·반·날짜)의 예약을 DB 행으로 다시 판정한다.
 */
export { effectGapsOf };

const MIXED_TEACHERS = "같은 날 정규 수업의 담당이 서로 달라 같은 날에 함께 기록할 수 없습니다";
const UNKNOWN_TEACHERS = "정규 출결을 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";
const DAY_UNREAD = "출결 기록을 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";
const ACTUAL_DIFFERS = "출결에 찍힌 담당 강사가 보강 강사와 달라 시수와 참여를 기록하지 않았습니다";
const ENROLLMENT_UNREAD = "수강 정보를 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";
const MINUTES_UNREAD = "수업 시간을 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";

type CountedTeacher = { teacherId: string | null; hold: string | null; stamped: boolean };

/** 연결 효과 전에 그날의 현재 교시 담당을 모두 본다. taught_by 칸이 아직 없으면 반 담임으로 둔다. */
async function regularTeacherOf(
  admin: Admin,
  tenantId: string,
  classTeacherId: string | null,
  studentId: string,
  classId: string,
  date: string,
): Promise<CountedTeacher> {
  if (!(await taughtByColumnReady(admin))) return { teacherId: classTeacherId, hold: null, stamped: false };
  const found = await loadRegularAttendanceTeacher(admin, tenantId, studentId, classId, date);
  if (found.status === "conflict") return { teacherId: null, hold: MIXED_TEACHERS, stamped: true };
  if (found.status === "unknown") return { teacherId: null, hold: UNKNOWN_TEACHERS, stamped: true };
  if (found.status === "none") return { teacherId: classTeacherId, hold: null, stamped: false };
  return { teacherId: found.teacherId, hold: null, stamped: true };
}

/** 찍힌 담당이 보강 강사와 다르거나 비어 있으면 시수 앞에 멈춘다. 정규일만 비교하지 않는다. */
function countedTeacherHold(teacher: CountedTeacher, makeupTeacherId: string | null): string | null {
  if (teacher.hold) return teacher.hold;
  if (teacher.stamped) {
    if (!teacher.teacherId || teacher.teacherId !== makeupTeacherId) return teacher.teacherId ? ACTUAL_DIFFERS : UNKNOWN_TEACHERS;
    return null;
  }
  return teacher.teacherId ? null : UNKNOWN_TEACHERS;
}

function withGaps(units: CompletionUnits, gaps: EffectGap[]): CompletionUnits {
  Object.defineProperty(units, "effectGaps", { value: gaps, enumerable: false });
  return units;
}

export async function completeMakeupReservations(
  ctx: { tenantId: string; observeOnly?: boolean },
  cells: readonly CompletionCell[],
): Promise<CompletionUnits> {
  const changedUnits: CompletionUnits = new Map();
  const gaps: EffectGap[] = [];
  if (cells.length === 0) return withGaps(changedUnits, gaps);
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return withGaps(changedUnits, gaps);
  }
  // (반·날짜)로 묶어 학생 id 목록으로 묻는다 — 단건 저장은 1행, 일괄 저장은 반 하나에 수십 명.
  const byClassDate = new Map<string, { classId: string; date: string; cells: Map<string, CompletionCell> }>();
  for (const c of cells) {
    if (!c.studentId || !c.classId || !c.date) continue;
    const k = `${c.classId}|${c.date}`;
    const g = byClassDate.get(k) ?? { classId: c.classId, date: c.date, cells: new Map<string, CompletionCell>() };
    g.cells.set(c.studentId, c);
    byClassDate.set(k, g);
  }
  for (const g of byClassDate.values()) {
    const ids = [...g.cells.keys()];
    // 학생 수십 명이라 한 번에(100 넘는 반은 없다 — 넘으면 앞 100명만 보고 나머지는 다음 저장이 잇는다).
    // 결석난 반(0440a)까지 — 결석일 칸 메모('예정' → '완료')를 그 반에 쓴다. 칸이 없으면(적용 전) 칸 없이 다시 읽는다.
    const readReservations = (extra: string) =>
      admin
        .from("makeup_reservations")
        .select(`id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by${extra}`)
        .eq("tenant_id", ctx.tenantId)
        .eq("class_id", g.classId)
        .eq("makeup_date", g.date)
        .in("status", ["reserved", "done"])
        .in("student_id", ids.slice(0, 100));
    let { data, error } = await readReservations(", absence_class_id");
    if (error && isMissingColumn(error, "absence_class_id")) ({ data, error } = await readReservations(""));
    if (error) {
      if (!isMissingReservationTable(error)) console.error("[makeup-reservation] 이행 조회 실패", error.message);
      continue;
    }
    const list = ((data ?? []) as unknown as Parameters<typeof toReservation>[0][]).map(toReservation);
    if (list.length === 0) continue;
    // 시수 자동값 재료(과목)·감사로그 '대상'(학생 · 반) — 반 하나에 한 번.
    const [{ data: cls }, { data: stus }] = await Promise.all([
      admin.from("classes").select("subject, class_name, teacher_id").eq("tenant_id", ctx.tenantId).eq("id", g.classId).maybeSingle(),
      admin
        .from("students")
        .select("id, name")
        .eq("tenant_id", ctx.tenantId)
        .in("id", [...new Set(list.map((r) => r.studentId))]),
    ]);
    const subject = (cls?.subject as string | null) ?? null;
    const className = (cls?.class_name as string | null) ?? null;
    const nameOf = new Map((stus ?? []).map((s) => [s.id as string, s.name as string]));
    const labelOf = (r: MakeupReservation) => {
      const name = nameOf.get(r.studentId);
      return name && className ? { targetLabel: `${name} · ${className}` } : {};
    };
    const disposition = await classifyLegacyReservations(ctx.tenantId, list.map((r) => ({
      id: r.id, studentId: r.studentId, classId: r.classId, makeupDate: r.makeupDate,
    })));
    const calendar = disposition.kind === "split"
      ? await loadCurrentCalendar(admin, ctx.tenantId, g.classId, g.date)
      : null;

    for (const r of list) {
      try {
        const live = await loadDay(admin, ctx.tenantId, r, r.makeupDate);
        if (!live) {
          if (disposition.kind === "split") {
            const missed = disposition.project.get(r.id);
            gaps.push(await noteEffectGap({
              effectKey: missed?.effectKey ?? `day:${r.id}`, kind: "teacher_hold",
              participantId: missed?.participantId ?? null, reservationId: r.id, error: DAY_UNREAD,
            }));
          }
          continue;
        }
        const cell = pickFulfillingRow(
          live.map((x) => ({ ...x, slotStart: x.slot_start, recordedAt: x.recorded_at })),
          r,
        );
        if (cell && r.status === "reserved") {
          if (disposition.kind === "blocked") {
            gaps.push(await noteEffectGap({
              effectKey: `kiosk:${r.studentId}:${r.classId}:${r.makeupDate}`, kind: ctx.observeOnly ? "observation" : "classify_blocked",
              participantId: null, reservationId: r.id, error: disposition.error,
            }));
            if (!ctx.observeOnly) continue;
          }
          if (disposition.kind === "split" && disposition.hold.has(r.id)) {
            gaps.push(await noteEffectGap({
              effectKey: `hold:${r.id}`, kind: "split_hold", participantId: null, reservationId: r.id,
              error: "같은 학생의 연결 예약이 둘이라 이행을 멈추었습니다",
            }));
            continue;
          }
          const projected = disposition.kind === "split" ? disposition.project.get(r.id) : undefined;
          if (projected && disposition.kind === "split") {
            const src = g.cells.get(r.studentId);
            const makeupUnits = calendar && calendar.status !== "unknown" && calendar.profile.autoUnits
              ? reservationAutoUnits(r, subject) : null;
            const storedNumber = typeof cell.session_units === "number" ? cell.session_units : Number(cell.session_units);
            const storedUnits = cell.session_units == null || cell.session_units === "" || !Number.isFinite(storedNumber) ? null : storedNumber;
            const teacher = await regularTeacherOf(
              admin, ctx.tenantId, (cls?.teacher_id as string | null) ?? null, r.studentId, r.classId, r.makeupDate,
            );
            const teacherHold = countedTeacherHold(teacher, projected.teacherId);
            if (teacherHold) {
              gaps.push(await noteEffectGap({
                effectKey: projected.effectKey, kind: "teacher_hold", participantId: projected.participantId,
                reservationId: r.id, error: teacherHold,
              }));
              continue;
            }
            // 휴강·휴원·현재 교시 없음은 보강 시수만. 시간표를 모르면 수강 여부와 상관없이 시수 앞에 멈춘다.
            if (calendar?.status === "unknown") {
              const calendarHold = calendarTeacherHold(calendar, projected.teacherId);
              if (calendarHold) {
                gaps.push(await noteEffectGap({
                  effectKey: projected.effectKey, kind: "teacher_hold", participantId: projected.participantId,
                  reservationId: r.id, error: calendarHold,
                }));
                continue;
              }
            }
            let enrolled = false;
            if (calendar?.status === "ready" && subject) {
              const regular = await isRegularAttendee(admin, ctx.tenantId, r);
              if (regular === null) {
                gaps.push(await noteEffectGap({
                  effectKey: projected.effectKey, kind: "teacher_hold", participantId: projected.participantId,
                  reservationId: r.id, error: ENROLLMENT_UNREAD,
                }));
                continue;
              }
              enrolled = regular;
            }
            if (enrolled && calendar) {
              const calendarHold = calendarTeacherHold(calendar, projected.teacherId);
              if (calendarHold) {
                gaps.push(await noteEffectGap({
                  effectKey: projected.effectKey, kind: "teacher_hold", participantId: projected.participantId,
                  reservationId: r.id, error: calendarHold,
                }));
                continue;
              }
            }
            const classMinutes = enrolled ? await mappedClassMinutes(admin, ctx.tenantId, r.classId, r.makeupDate) : 0;
            if (enrolled && classMinutes === null) {
              gaps.push(await noteEffectGap({
                effectKey: projected.effectKey, kind: "teacher_hold", participantId: projected.participantId,
                reservationId: r.id, error: MINUTES_UNREAD,
              }));
              continue;
            }
            const saved = await handleMappedFulfill({
              observeOnly: ctx.observeOnly === true, mode: disposition.mode, pilotSubjects: disposition.pilotSubjects,
              subject, regularTeacherId: teacher.teacherId,
              projected, reservationId: r.id, studentId: r.studentId, classId: r.classId, makeupDate: r.makeupDate,
              slotStart: r.slotStart, slotEnd: r.slotEnd,
              cell: { id: cell.id, status: cell.status, slotStart: cell.slot_start, sessionUnits: storedUnits },
              unitsExplicit: src?.unitsExplicit === true, created: src?.created === true, makeupUnits,
              regularAttendee: enrolled, classMinutes,
              patchUnits: async (units) => {
                const { error: patchErr } = await admin.from("attendance_records").update({ session_units: units }).eq("tenant_id", ctx.tenantId).eq("id", cell.id);
                return !patchErr;
              },
            });
            if (saved.units !== undefined) changedUnits.set(completionKey({ studentId: r.studentId, classId: r.classId, date: r.makeupDate }), saved.units);
            if (saved.gap) gaps.push(saved.gap);
            continue;
          }
          const units = await fulfil(admin, ctx.tenantId, r, cell, g.cells.get(r.studentId), subject, labelOf(r));
          if (units !== undefined) changedUnits.set(completionKey({ studentId: r.studentId, classId: r.classId, date: r.makeupDate }), units);
        } else if (!cell && r.status === "done") {
          const projected = disposition.kind === "split" ? disposition.project.get(r.id) : undefined;
          if (disposition.kind === "blocked" && !ctx.observeOnly) {
            gaps.push(await noteEffectGap({
              effectKey: `classify:${r.id}`, kind: "classify_blocked", participantId: null, reservationId: r.id, error: disposition.error,
            }));
            continue;
          }
          if (projected) {
            const absent = live.find((row) => row.status === "absent" || row.status === "excused");
            const missed = await handleMappedAbsence({
              observeOnly: ctx.observeOnly === true, projected, reservationId: r.id, studentId: r.studentId,
              subject, classId: r.classId, makeupDate: r.makeupDate, attendanceRecordId: absent?.id ?? null,
            });
            if (missed) gaps.push(missed);
            continue;
          }
          await revert(admin, ctx.tenantId, r, live, labelOf(r));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "보강 이행을 마치지 못했습니다";
        gaps.push(await noteEffectGap({
          effectKey: `complete:${r.id}`, kind: "complete_failed", participantId: null, reservationId: r.id, error: message,
        }));
        console.error("[makeup-reservation] 이행·되돌림 실패", e);
      }
    }
  }
  return withGaps(changedUnits, gaps);
}

/** 이행 — 예약 `done` + 보강 칸 메모·시수 + 결석 칸 "예정 → 완료" + 감사로그. 시수를 바꿨으면 그 값(null = 1). */
async function fulfil(
  admin: Admin,
  tenantId: string,
  r: MakeupReservation,
  cell: AttRow,
  src: CompletionCell | undefined,
  subject: string | null,
  label: { targetLabel?: string },
): Promise<number | null | undefined> {
  // ① 예약 행 — 이행 표식 + 연결. 🔴 status 조건 + `select`로 **0행이면 그만둔다**(두 쓰기 경로가 같이 들어오면 한쪽만
  //    메모·시수·로그를 남긴다 — 0행을 못 알아채면 `makeup_reserve_done`이 두 번 남는다, 재리뷰 2026-09-14).
  const { data: updated, error: updErr } = await admin
    .from("makeup_reservations")
    .update({ status: "done", attendance_record_id: cell.id, done_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", r.id)
    .eq("status", "reserved")
    .select("id");
  if (updErr || (updated ?? []).length === 0) return undefined;

  // ② 보강 칸 메모(멱등) + ③ 시수 자동값(강사가 숫자를 안 쳤을 때만 · 그날 전체 행에만).
  const makeupLine = reservationMakeupMemo(r);
  const patch: Record<string, unknown> = {};
  if (!hasMemoLine(cell.note, makeupLine)) patch.note = appendMemo(cell.note, makeupLine);
  let autoUnits: number | null = null;
  let unitsChanged: number | null | undefined = undefined;
  const explicit = src?.unitsExplicit === true;
  // 새 행이거나 시수가 아직 기본(null)인 행에만 — 예전에 친 숫자를 덮지 않는다.
  const untouched = src?.created === true || cell.session_units == null;
  // 자동값은 학원 수업 규칙을 따른다(새 학원 = 자동 시수 없음). 침산은 종전과 같다.
  const resUnits = (await getLessonProfile(tenantId)).autoUnits ? reservationAutoUnits(r, subject) : null;
  if (!explicit && src?.addToCurrent === true && resUnits !== null && cell.slot_start == null) {
    const next = round1(unitsAfterMakeup(cell.session_units == null ? null : Number(cell.session_units), resUnits));
    if (next <= MAX_SESSION_UNITS) {
      autoUnits = next;
      patch.session_units = next === 1 ? null : next;
    } else {
      console.error("[makeup-reservation] 보강분을 더하면 시수 상한을 넘어 더하지 않았습니다", cell.id, next);
    }
  } else if (!explicit && untouched && resUnits !== null && cell.slot_start == null) {
    // 그날 정규 수업도 듣는 학생(수강 유효 + 등원 요일 + **그날 반이 실제로 돈다**)이면 정규 자동값 위에 보강값을 더한다.
    let base: number | null = 0;
    if (await isRegularAttendee(admin, tenantId, r)) {
      const minutes = await classDayMinutes(admin, tenantId, r.classId, r.makeupDate);
      base = minutes === null ? null : minutes > 0 ? (unitsFromMinutes(minutes) ?? 1) : 0;
    }
    if (base !== null) {
      autoUnits = round1(base + resUnits);
      patch.session_units = autoUnits === 1 ? null : autoUnits;
    }
  }
  if (Object.keys(patch).length > 0) {
    const { error: patchErr } = await admin.from("attendance_records").update(patch).eq("tenant_id", tenantId).eq("id", cell.id);
    if (!patchErr && "session_units" in patch) unitsChanged = patch.session_units as number | null;
  }
  // ④ 결석 칸 메모 "예정" → "완료" — 그 줄이 있는 유효 행만.
  const absDay = await loadDay(admin, tenantId, { ...r, classId: absenceClassOf(r) }, r.absenceDate);
  const plannedLine = reservationAbsenceMemo(r);
  for (const a of absDay ?? []) {
    if (!hasMemoLine(a.note, plannedLine)) continue;
    await admin
      .from("attendance_records")
      .update({ note: markAbsenceMemoDone(a.note, r.makeupDate) })
      .eq("tenant_id", tenantId)
      .eq("id", a.id);
  }
  await logAction({
    action: "makeup_reserve_done",
    targetType: "attendance",
    ...label,
    metadata: {
      reservationId: r.id,
      studentId: r.studentId,
      classId: r.classId,
      absenceDate: r.absenceDate,
      makeupDate: r.makeupDate,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
      attendanceRecordId: cell.id,
      status: cell.status,
      ...(autoUnits !== null ? { autoUnits } : {}),
    },
  });
  return unitsChanged;
}

/**
 * 되돌림 — 보강일에 시수 상태 행이 더 없다(지웠다·결석으로 고쳤다): 예약 `reserved` + 연결 해제, 결석 칸 "완료 → 예정",
 * 남은 보강일 행(결석 등)의 "결석분 보강" 줄 제거. 시수는 손대지 않는다(그 행은 이제 시수 상태가 아니다).
 */
async function revert(
  admin: Admin,
  tenantId: string,
  r: MakeupReservation,
  liveMakeupDay: AttRow[],
  label: { targetLabel?: string },
): Promise<void> {
  const { data: reverted, error } = await admin
    .from("makeup_reservations")
    .update({ status: "reserved", attendance_record_id: null, done_at: null })
    .eq("tenant_id", tenantId)
    .eq("id", r.id)
    .eq("status", "done")
    .select("id");
  if (error || (reverted ?? []).length === 0) return; // 0행 = 남이 먼저 되돌렸다(로그를 두 번 안 남긴다)
  // 보강 확인(0458a)도 지운다 — 이행이 풀렸는데(결석으로 고침·칸 지움) '보강 완료' 표식·발송 통과로 남지 않게(적대 리뷰 2026-10-27).
  // 칸이 없는 지점(미적용)은 오류로 돌아온다 — 조용히 넘긴다(되돌림 자체는 끝났다).
  await admin.from("makeup_reservations").update({ checked_at: null, checked_by: null }).eq("tenant_id", tenantId).eq("id", r.id);
  const makeupLine = reservationMakeupMemo(r);
  for (const x of liveMakeupDay) {
    if (!hasMemoLine(x.note, makeupLine)) continue;
    await admin.from("attendance_records").update({ note: removeMemoLine(x.note, makeupLine) }).eq("tenant_id", tenantId).eq("id", x.id);
  }
  const absDay = await loadDay(admin, tenantId, { ...r, classId: absenceClassOf(r) }, r.absenceDate);
  // "M/D 보강 완료" 줄 = 이행이 적은 줄(`markAbsenceMemoDone` = `reservationAbsenceDoneMemo`) — 그 줄이 있는 유효 행만 되돌린다.
  const doneLine = reservationAbsenceDoneMemo(r);
  for (const a of absDay ?? []) {
    if (!hasMemoLine(a.note, doneLine)) continue;
    await admin
      .from("attendance_records")
      .update({ note: markAbsenceMemoPlanned(a.note, r.makeupDate) })
      .eq("tenant_id", tenantId)
      .eq("id", a.id);
  }
  await logAction({
    action: "makeup_reserve_revert",
    targetType: "attendance",
    ...label,
    metadata: {
      reservationId: r.id,
      studentId: r.studentId,
      classId: r.classId,
      absenceDate: r.absenceDate,
      makeupDate: r.makeupDate,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
    },
  });
}
