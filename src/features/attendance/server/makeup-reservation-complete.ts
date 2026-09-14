import "server-only";

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
import { appendMemo, hasMemoLine } from "@/features/onescreen/makeup-absence-link";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { DOW_KEYS } from "../calendar";
import { weekdayIndexOf } from "@/lib/date-kst";
import { toAutoUnitsSchedule, unitsFromMinutes } from "../auto-units";
import {
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
import { round1 } from "../session-units";
import { isMissingReservationTable, toReservation } from "./makeup-reservation-queries";

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

/** 그날 그 반의 **정규 수강생으로 오는 날**인가 — 로스터와 같은 판정(수강 유효 + 분리등원 요일). */
async function isRegularAttendee(admin: Admin, tenantId: string, r: MakeupReservation): Promise<boolean> {
  const { data } = await admin
    .from("enrollments")
    .select("start_date, end_date, on_hold, is_transferred, attendance_days")
    .eq("tenant_id", tenantId)
    .eq("class_id", r.classId)
    .eq("student_id", r.studentId);
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

/** 그날 그 칸의 행 전부(정정 이력 포함) → 유효 행. 실패는 null(그 예약은 건너뛴다). */
async function loadDay(admin: Admin, tenantId: string, r: MakeupReservation, date: string): Promise<AttRow[] | null> {
  const { data, error } = await admin
    .from("attendance_records")
    .select(ATT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("class_id", r.classId)
    .eq("student_id", r.studentId)
    .eq("session_date", date);
  if (error) return null;
  return effectiveAttendanceRecords((data ?? []) as AttRow[]);
}

/**
 * 찍힌·지운 칸들 중 예약이 걸린 것을 이행하거나 되돌린다. 시수를 바꾼 칸을 돌려준다(호출부는 무시해도 된다).
 * @param cells 이번 저장이 손댄 칸 — 상태가 무엇이든 그 (학생·반·날짜)의 예약을 DB 행으로 다시 판정한다.
 */
export async function completeMakeupReservations(
  ctx: { tenantId: string },
  cells: readonly CompletionCell[],
): Promise<CompletionUnits> {
  const changedUnits: CompletionUnits = new Map();
  if (cells.length === 0) return changedUnits;
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return changedUnits;
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
    const { data, error } = await admin
      .from("makeup_reservations")
      .select("id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by")
      .eq("tenant_id", ctx.tenantId)
      .eq("class_id", g.classId)
      .eq("makeup_date", g.date)
      .in("status", ["reserved", "done"])
      .in("student_id", ids.slice(0, 100));
    if (error) {
      if (!isMissingReservationTable(error)) console.error("[makeup-reservation] 이행 조회 실패", error.message);
      continue;
    }
    const list = ((data ?? []) as Parameters<typeof toReservation>[0][]).map(toReservation);
    if (list.length === 0) continue;
    // 시수 자동값 재료(과목)·감사로그 '대상'(학생 · 반) — 반 하나에 한 번.
    const [{ data: cls }, { data: stus }] = await Promise.all([
      admin.from("classes").select("subject, class_name").eq("tenant_id", ctx.tenantId).eq("id", g.classId).maybeSingle(),
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

    for (const r of list) {
      try {
        const live = await loadDay(admin, ctx.tenantId, r, r.makeupDate);
        if (!live) continue;
        const cell = pickFulfillingRow(
          live.map((x) => ({ ...x, slotStart: x.slot_start, recordedAt: x.recorded_at })),
          r,
        );
        if (cell && r.status === "reserved") {
          const units = await fulfil(admin, ctx.tenantId, r, cell, g.cells.get(r.studentId), subject, labelOf(r));
          if (units !== undefined) changedUnits.set(completionKey({ studentId: r.studentId, classId: r.classId, date: r.makeupDate }), units);
        } else if (!cell && r.status === "done") {
          await revert(admin, ctx.tenantId, r, live, labelOf(r));
        }
      } catch (e) {
        console.error("[makeup-reservation] 이행·되돌림 실패", e);
      }
    }
  }
  return changedUnits;
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
  const resUnits = reservationAutoUnits(r, subject);
  if (!explicit && untouched && resUnits !== null && cell.slot_start == null) {
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
  const absDay = await loadDay(admin, tenantId, r, r.absenceDate);
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
  const makeupLine = reservationMakeupMemo(r);
  for (const x of liveMakeupDay) {
    if (!hasMemoLine(x.note, makeupLine)) continue;
    await admin.from("attendance_records").update({ note: removeMemoLine(x.note, makeupLine) }).eq("tenant_id", tenantId).eq("id", x.id);
  }
  const absDay = await loadDay(admin, tenantId, r, r.absenceDate);
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
