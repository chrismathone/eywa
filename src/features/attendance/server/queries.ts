import { taughtByColumnReady } from "./taught-by-db";
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstMonth, kstToday, monthRange } from "@/lib/date-kst";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { foldedReason } from "@/lib/folded-read";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import {
  enrollmentAttendsOnDay,
  isEnrollmentActiveOn,
} from "@/features/enrollments/eligibility";
import { includeInAttendanceInput, makeupStudentIds } from "@/features/attendance/input-roster";
// 월별 명단에 **수강행 없는 기록자**를 합치는 규약(2026-09-02) — 일별 로스터와 같은 판정 함수를 감싼 것.
import {
  recordedOnlyMatrixRow,
  recordedOnlyStudentIds,
} from "@/features/attendance/monthly-makeup-roster";
import { rollupDay, type GhostValue, type SlotMark } from "@/features/attendance/cell-display";
import { stripProxyMemo } from "@/features/attendance/proxy-memo";
import { buildHolidayMap, dowsFromKeys, resolveAttendDows } from "@/features/attendance/calendar";
import {
  clipToWithdrawal,
  lifecycleBadgesInRange,
  TRANSFER_GAP_DAYS,
  type EnrollSpan,
  type LifecycleBadge,
  type OtherSpan,
  type SpanRange,
} from "@/features/attendance/enrollment-span";
import { getPeriodWindow } from "@/features/periods/server/queries";
import type { PeriodWindow } from "@/features/periods/resolve";
// 출결의 강사 귀속 축 단일 소스(2026-08-18) — 담임만 보면 교시 담당 강사가 자기 수업을 못 본다.
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";
import { attendanceDb, attendanceReadContext } from "./read-context";
import type { HomeroomPeriod } from "@/features/classes/teacher-as-of";
// 교시 귀속(누구 몫인가)은 같은 축 모듈이 단일 소스다 — 여기서 규칙을 다시 적지 말 것.
import {
  attendanceSlotShare,
  classTeacherIdsInRange,
  ownsAttendanceSlot,
  teachesClassOn,
} from "@/features/attendance/teacher-axis";
import type { PeriodMode } from "@/features/attendance/view-prefs";
import {
  deriveMarksFromReports,
  isDerivedAttendanceSubject,
  REQUIRE_SENT_REPORT,
  reportEvidenceKind,
} from "@/features/attendance/derive-from-reports";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getSplitsOnDate, getSplitsTouchingClasses } from "@/features/class-splits/server/queries";
import { splitDayOf, splitRowNote } from "@/features/class-splits/attendance";
import { splitDateMarks, type SplitDateMark } from "@/features/attendance/split-marks";
import { teacherProcessing, type ProcessingRecord, type TeacherProcessing } from "../teacher-processing";
import { autoUnitsByDate, autoUnitsKey, isAutoUnitsSubject, toAutoUnitsSchedule } from "../auto-units";
import { resolveAutoUnits } from "./auto-units";
import { scopeInsertSlots } from "../scope-ownership";
import { getLessonProfile } from "@/features/owner/server/lesson-profile";
import { lessonProfileOf } from "@/features/owner/lesson-profile";
// 보강 예약(0264a) — 그 달 이 반에 예약된 보강 칸 + 예약된 학생을 명단에 합친다. 조회는 fail-soft(표 없음 = 예약 없음).
import {
  getClassReservationsInRange,
  getReservationCreatorNames,
  getReservationsOn,
} from "./makeup-reservation-queries";
// 테스트 학생(`students.is_test`) — 처리현황 명단에서 뺀다(원장 2026-09-14, 오늘 출결과 같은 축). 공용 한 벌.
import { getTestStudentIds } from "@/features/students/server/test-students";
// 휴원일 판정(학원설정 휴일 목록만) — 오늘 출결과 같은 함수. 처리 현황은 fail-soft 판을 쓴다.
import { holidayNameOrNull } from "./holiday";

const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** 일별 출결 처리 현황 — 그 요일 수업 반별 예정 학생수 vs 기록수(미처리 추적·완료율). ijw DailyAttendance 이식. */
export type ClassProcessing = {
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  expected: number; // 활성 enrollment 학생 수(예정)
  recorded: number; // 기록된 학생 수
  unprocessed: number; // 미처리
  rate: number; // 완료율 0~100
  byTeacher?: TeacherProcessing[];
};

/**
 * 그날의 반별 출결 처리 현황(예정·기록·미처리).
 * 🔑 **요청 캐시**(React `cache`) — 운영실 한 화면에서 헤더의 `처리 중 N/M`과 '오늘 출석 미기록' 신호가
 *    같은 날짜로 각각 부른다. 캐시가 없으면 **같은 무거운 계산이 한 요청에 두 번** 돈다(반응속도 1순위).
 *    인자(date)가 키라 스냅샷 날짜 조회는 그대로 따로 돈다.
 *
 * 🔴 **학원설정 휴원일이면 빈 목록이다**(2026-10-03) — 시간표는 요일 반복이라 휴원일에도 슬롯이 살아 있고, 그대로 세면
 *    "5/22명 · 완료 0개 반" 같은 **정규 예정 분모**가 쉬는 날에 선다(오늘 출결은 같은 날 통째로 비어 있어 두 화면이 어긋났다).
 *    정본에서 한 번 비우면 소비처 다섯 곳(출석부 요약 · 일별 출석부 · 운영실 출결 카드 · 운영실 오늘 타일 · '오늘 출결 처리'
 *    신호)이 함께 맞는다 — 소비처마다 접으면 한 곳을 빠뜨리고, 분모만 0으로 넣으면 아래 `rate`가 스스로 100%를 만든다.
 *    그날 **실제로 입력된 기록**은 여기서 나오지 않는다 → [`getHolidayDayActivity`](./holiday-activity.ts)(날짜 기준 별도 조회).
 *    ⚠️ 대가: 휴원일의 일별 출석부에서 '기록 없는 반'의 입력 링크가 사라진다(기록 있는 반은 남는다). 입력은 월별 출석부.
 *    ⚠️ 설정 조회가 실패하면 휴원일이 아닌 것으로 보고 계속 간다(fail-soft — 설정 하나로 처리 현황 전체가 죽지 않게).
 */
export const getDailyProcessingStatus = cache(async function getDailyProcessingStatus(
  date: string,
): Promise<ClassProcessing[]> {
  if (await holidayNameOrNull(date)) return [];
  const supabase = await createClient();
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayEnum = DOW_ENUM[dow];

  // 그 요일에 수업이 있는 반(중복 제거)
  const { data: sched, error: scheduleError } = await supabase
    .from("class_schedules")
    .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
    .eq("day_of_week", dayEnum)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  if (scheduleError) throw new Error(`daily attendance schedules: ${scheduleError.message}`);
  const classIds = [...new Set((sched ?? []).map((s) => s.class_id as string))];
  if (classIds.length === 0) return [];

  // 반 메타(활성만) — id 청크로(414 방지)
  const classes = await fetchInChunks<{
    id: string;
    class_name: string;
    subject: string;
    teacher_id: string | null;
    is_active: boolean;
    closed_at: string | null;
    teacher: { display_name?: string } | { display_name?: string }[] | null;
  }>(classIds, (chunk) =>
    supabase
      .from("classes")
      .select("id, class_name, subject, teacher_id, is_active, closed_at, teacher:teacher_id ( display_name )")
      .in("id", chunk)
      .eq("is_active", true),
  );
  const activeClasses = classes.filter((klass) => !klass.closed_at || klass.closed_at >= date);
  const activeClassIds = activeClasses.map((c) => c.id);
  if (activeClassIds.length === 0) return [];

  // 활성 enrollment(예정) + 그 날짜 기록(처리) — 둘 다 id 청크. 테스트 학생 id도 독립 조회라 함께(B4).
  const [enrollments, records, testStudentIds] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean | null;
      attendance_days: string[] | null;
    }>(
      activeClassIds,
      (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days")
          .in("class_id", chunk)
          .lte("start_date", date)
          .order("id", { ascending: true })
          .range(from, to),
    ),
    fetchAllPagedInChunks<ProcessingRecord & { id: string; class_id: string }>(activeClassIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, class_id, student_id, slot_start, seat_label")
        .eq("session_date", date)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    getTestStudentIds(supabase),
  ]);

  const expectedByClass = new Map<string, Set<string>>();
  // 🔴 테스트 학생(`is_test`)은 예정 명단에서 뺀다(원장 2026-09-14 — 오늘 출결 데스크 보드와 같은 축). 뺀 뒤 명단이
  //    비는 반은 **행째** 뺀다(아래 visibleClasses): 오늘 출결은 명단 0명 교시를 안 그리는데 여기만 '0명 반'으로
  //    남으면 일별 출석부 처리 현황·운영실 '빈 반' 수가 바로가기 목적지와 갈린다. 수강이 원래 없던 반(expected 0)은
  //    종전대로 남긴다 — 둘을 가르는 게 이 집합이다. 조회 실패 = 빈 집합(fail-open) = 지금 동작.
  const classesWithTestStudent = new Set<string>();
  for (const e of enrollments) {
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date,
          endDate: e.end_date,
          onHold: e.on_hold,
          isTransferred: e.is_transferred === true,
        },
        date,
      ) ||
      !enrollmentAttendsOnDay(e.attendance_days, dayEnum)
    ) {
      continue;
    }
    if (testStudentIds.has(e.student_id)) {
      classesWithTestStudent.add(e.class_id);
      continue;
    }
    (expectedByClass.get(e.class_id) ?? expectedByClass.set(e.class_id, new Set()).get(e.class_id)!).add(e.student_id);
  }
  const visibleClasses = activeClasses.filter(
    (c) => !(classesWithTestStudent.has(c.id) && !expectedByClass.has(c.id)),
  );
  const recordedByClass = new Map<string, Set<string>>();
  for (const r of records) {
    if (!expectedByClass.get(r.class_id)?.has(r.student_id)) continue;
    (recordedByClass.get(r.class_id) ?? recordedByClass.set(r.class_id, new Set()).get(r.class_id)!).add(r.student_id);
  }

  const rows: ClassProcessing[] = visibleClasses.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as { display_name?: string } | undefined;
    const expected = expectedByClass.get(c.id)?.size ?? 0;
    const recorded = recordedByClass.get(c.id)?.size ?? 0;
    return {
      classId: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherName: teacher?.display_name ?? null,
      byTeacher: teacherProcessing({
        date,
        homeroomTeacherId: c.teacher_id,
        slots: (sched ?? []).filter((s) => s.class_id === c.id).map((s) => ({
          dayOfWeek: s.day_of_week, startTime: s.start_time, teacherId: s.teacher_id,
          slotTeacherLabel: s.slot_teacher_label, validFrom: s.valid_from, validTo: s.valid_to,
        })),
        expectedStudents: expectedByClass.get(c.id) ?? new Set(),
        records: records.filter((r) => r.class_id === c.id),
      }),
      expected,
      recorded,
      unprocessed: Math.max(0, expected - recorded),
      rate: expected > 0 ? Math.round((Math.min(recorded, expected) / expected) * 100) : 100,
    };
  });
  // 미처리 많은 반 먼저(운영 우선순위), 동률이면 반명.
  rows.sort((a, b) => b.unprocessed - a.unprocessed || a.className.localeCompare(b.className, "ko"));
  return rows;
});

export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "excused"
  | "makeup"
  | "early_leave";

export type AttendanceRow = {
  id: string;
  status: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  classId: string;
  className: string;
  subject: string;
};

export type ClassMeta = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

export type AttendanceInputRow = {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  /** 그 반 수강행 id. **보강(수업외) 학생은 수강행이 없어 null**. */
  enrollmentId: string | null;
  /**
   * 보강(수업외) 참석 — 그 반 수강생이 아닌데 그날 와서 수업을 들은 학생.
   * 원스크린 '+ 보강 학생 추가'(보고서)와 같은 개념의 출결판. 처리현황 '예정' 분모엔 안 들어간다.
   */
  isMakeup: boolean;
  /** 그날 이 학생의 **유효 기록 전부**(교시별 최신 1건씩, 0196a). 저장이 고칠 대상 = 이 목록 전체. */
  recordIds: string[];
  /** 하위호환용 최신 1건 — 표시·판정은 아래 slots/slotCount를 볼 것. */
  existingRecordId: string | null;
  status: AttendanceStatus | null;
  note: string | null;
  homeworkRequired: boolean;
  homeworkDone: boolean;
  // 시수(정규 1회 기준 배수, 0115a). null=기본 1. 교시가 여럿이면 **그날 합**(출석부 칸과 같은 숫자).
  sessionUnits: number | null;
  /** 그날 찍힌 교시 수. 1이면 종전과 완전히 같다. */
  slotCount: number;
  /** 교시가 둘 이상일 때의 교시별 내역 — 화면 툴팁용. */
  slots: SlotMark[];
  /**
   * 이 학생의 **그날 보강 예약**(0264a) — 예약된 학생은 '보강 추가' 없이 명단에 미리 선다(수강생이 아니면 `isMakeup`
   * 행으로). 출결을 찍으면 서버가 예약을 이행 처리한다. 없으면 키 없음(대부분의 행).
   */
  reserved?: { id: string; absenceDate: string; slotStart: string; slotEnd: string; periodLabel: string | null; note: string | null };
  /**
   * 그날 **수업 나누기**(0351a) — in = 다른 반 학생이 그 시간 이 반에서 수업(수강행 없이 미리 선다, isMakeup 행) ·
   * out = 이 반 학생이 그 시간만 다른 반(명단엔 남는다 — 나머지 시간은 여기서 수업). 없으면 키 없음.
   */
  split?: { dir: "in" | "out"; note: string };
};

export async function getClassMeta(classId: string): Promise<ClassMeta | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select("id, class_name, subject, teacher:teacher_id ( display_name )")
    .eq("id", classId)
    .single();
  if (!data) return null;
  const teacher = (Array.isArray(data.teacher) ? data.teacher[0] : data.teacher) as
    | { display_name?: string }
    | undefined;
  return {
    id: data.id,
    className: data.class_name,
    subject: data.subject,
    teacherName: teacher?.display_name ?? null,
  };
}

/**
 * Active enrollments + their current attendance record for one (class, date).
 *
 * ⚠️ 수강 판정은 **공용 헬퍼**(isEnrollmentActiveOn·enrollmentAttendsOnDay)로만 한다 — 손으로 다시
 * 구현하지 말 것. 예전 이 함수는 `!on_hold && (!end_date || end_date >= date)`만 봐서 **분리등원
 * (attendance_days)을 select조차 안 했고** is_transferred도 무시했다. 그래서 같은 날짜에 대해
 * 처리현황(위 getDailyProcessingStatus, 헬퍼 사용)은 "예정 M명"인데 '입력' 화면은 M보다 많은 명단을
 * 보여주고, 그 요일에 오지 않는 학생까지 출결을 찍을 수 있었다(2026-07-22 전수검사 실측: 월7·화7·목9·금5명,
 * 17개 반 — 원스크린 로스터에서 고친 것과 **같은 숫자·같은 원인**, main 6db1c3ca). 찍힌 기록은
 * session_units(시수)를 타고 시수 검증·강사 분배로 흘러가는데 expected 집합 밖이라 완료율엔 영원히 안 잡힌다.
 *
 * ⚠️ 단 **이미 기록이 있는 학생은 등원요일 밖이어도 반드시 남긴다**(아래 `hasRecord` 합집합).
 * 필터만 걸면 과거에 이미 찍힌 기록이 화면에서 통째로 사라져 **수정·삭제할 방법이 없어진다**
 * (실측 52행: 2026-02~06, 대부분 보강 등으로 정규 요일 밖에 찍힌 present). 새 오입력은 막되
 * 기존 기록은 숨기지 않는 게 규약 — "안 보이는데 존재하는 데이터"를 만들지 말 것.
 */
export async function getAttendanceInputRows(
  classId: string,
  date: string,
): Promise<AttendanceInputRow[]> {
  const supabase = await createClient();
  const dayEnum = DOW_ENUM[new Date(`${date}T00:00:00Z`).getUTCDay()];

  // 반·날짜 단위 조회라 학생 필터 없이 받는다(한 반 명단 규모라 절단 위험 없음) — 등원요일 밖에
  // 이미 찍힌 기록을 알아야 그 행을 남길지 판단할 수 있어, 명단보다 **먼저** 읽는다.
  // 보강 예약(0264a)도 함께 — 그날 이 반에 예약된 학생은 '보강 추가' 없이 미리 선다(fail-soft, 표 없음 = 없음).
  const [{ data: enrollments }, { data: records }, reserved, splitsToday] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        `id, start_date, end_date, on_hold, is_transferred, attendance_days,
       student:student_id ( id, name, grade )`,
      )
      .eq("class_id", classId)
      .lte("start_date", date),
    supabase
      .from("attendance_records")
      .select(
        "id, student_id, slot_start, status, note, homework_required, homework_done, session_units, recorded_at",
      )
      .eq("class_id", classId)
      .eq("session_date", date)
      .order("recorded_at", { ascending: false })
      // id desc = 동률 tie-break(저장 `pickSaveTargets`·월간 조회와 같은 규약) — 빗금 칸 입력은 여러 행에 같은 시각을 찍는다.
      .order("id", { ascending: false }),
    getReservationsOn(date, [classId]),
    // 수업 나누기(0351a) — 받는 반이면 미리 서고, 원래 반이면 표식만(fail-soft).
    getSplitsOnDate(date, [classId]),
  ]);
  const splitDay = splitDayOf(classId, date, splitsToday.splits);
  /** 학생 → 그날 나눔 표식(교시 둘이면 이른 것 — 행은 학생당 한 줄). */
  const splitOf = new Map<string, NonNullable<AttendanceInputRow["split"]>>();
  for (const v of splitDay.incoming) {
    if (!splitOf.has(v.studentId)) splitOf.set(v.studentId, { dir: "in", note: splitRowNote("in", v, splitsToday.classNames.get(v.otherClassId)) });
  }
  for (const v of splitDay.outgoing) {
    if (!splitOf.has(v.studentId)) splitOf.set(v.studentId, { dir: "out", note: splitRowNote("out", v, splitsToday.classNames.get(v.otherClassId)) });
  }
  /** 학생 → 그날 예약(교시 둘이면 이른 것) — 행에 얹는다. */
  const reservedOf = new Map<string, AttendanceInputRow["reserved"]>();
  for (const r of reserved) {
    if (reservedOf.has(r.studentId)) continue;
    reservedOf.set(r.studentId, {
      id: r.id,
      absenceDate: r.absenceDate,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
      periodLabel: r.periodLabel,
      note: r.note,
    });
  }

  // 유효 기록 = (학생·**교시**)별 최신 1건(0196a, records는 recorded_at 내림차순). 이 화면은 학생당
  // 한 줄이라 교시가 여럿이면 **한 줄로 접는다**(출석부 칸과 같은 규칙 — rollupDay 단일 소스).
  // ⚠️ 접는 건 표시뿐이고 저장은 recordIds **전부**를 고친다 — 안 그러면 최근 1건만 바뀌고 나머지 교시가
  //    조용히 옛 상태로 남는다("저장했는데 안 바뀐" 칸).
  const seen = new Set<string>();
  const recordMap = new Map<
    string,
    {
      ids: string[];
      slots: SlotMark[];
      note: string | null;
      homeworkRequired: boolean;
      homeworkDone: boolean;
    }
  >();
  for (const r of records ?? []) {
    const slot = (r.slot_start as string | null) ?? null;
    const k = `${r.student_id}|${slot ?? ""}`;
    if (seen.has(k)) continue; // 같은 교시의 옛 정정본
    seen.add(k);
    const raw = r.session_units === null ? null : Number(r.session_units);
    const cur = recordMap.get(r.student_id);
    if (cur) {
      cur.ids.push(r.id);
      cur.slots.push({ slot, status: r.status as AttendanceStatus, units: raw });
      // 🔴 `대신 입력` 줄뿐인 메모는 사유가 적힌 메모에 자리를 내준다 — 이 폼은 저장 때 이 메모를 그날 **모든 행**에 되쓰므로,
      //    그 줄이 뽑히면 다른 행의 "병결"이 지워진다(빗금 칸 입력 뒤, 적대 재리뷰 2026-09-14). 규칙은 월간 조회와 같다.
      if (r.note && (cur.note === null || (stripProxyMemo(cur.note) === "" && stripProxyMemo(r.note) !== ""))) {
        cur.note = r.note;
      }
    } else {
      // 메모·숙제는 **가장 최근 기록**의 것(칸이 하나뿐이라 교시별로 다 못 싣는다).
      recordMap.set(r.student_id, {
        ids: [r.id],
        slots: [{ slot, status: r.status as AttendanceStatus, units: raw }],
        note: r.note,
        homeworkRequired: r.homework_required,
        homeworkDone: r.homework_done,
      });
    }
  }

  const active = (enrollments ?? []).filter((e) => {
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as { id: string } | undefined;
    return includeInAttendanceInput(
      {
        startDate: e.start_date,
        endDate: e.end_date,
        onHold: e.on_hold,
        isTransferred: e.is_transferred === true,
        attendanceDays: e.attendance_days,
      },
      date,
      dayEnum,
      !!(s && recordMap.has(s.id)),
    );
  });

  /** 한 학생의 기록들 → 행의 출결 칸(정규·보강 두 목록이 **같은 규칙**을 쓰게 한 곳에 둔다). */
  const recordFieldsOf = (studentId: string) => {
    const existing = recordMap.get(studentId);
    const day = existing ? rollupDay(existing.slots) : null;
    const reservedHere = reservedOf.get(studentId);
    const splitHere = splitOf.get(studentId);
    return {
      ...(reservedHere ? { reserved: reservedHere } : {}),
      ...(splitHere ? { split: splitHere } : {}),
      recordIds: existing?.ids ?? [],
      existingRecordId: existing?.ids[0] ?? null,
      status: (day?.status as AttendanceStatus | undefined) ?? null,
      note: existing?.note ?? null,
      homeworkRequired: existing?.homeworkRequired ?? false,
      homeworkDone: existing?.homeworkDone ?? false,
      // 교시가 하나면 그 기록의 값 그대로(1·null 구분 유지), 여럿이면 그날 합.
      // ⚠️ 합이 0(전부 결석)이면 null — 폼의 시수 칸에 "0"이 실리면 parseSessionUnits가 저장을 반려한다.
      sessionUnits: day
        ? day.count > 1
          ? day.units > 0
            ? day.units
            : null
          : (existing?.slots[0]?.units ?? null)
        : null,
      slotCount: day?.count ?? 0,
      slots: day?.count && day.count > 1 ? day.slots : [],
    };
  };

  const rosterRows = active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null }
        | undefined;
      if (!s) return null;
      const row: AttendanceInputRow = {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        enrollmentId: e.id,
        isMakeup: false,
        ...recordFieldsOf(s.id),
      };
      return row;
    })
    .filter((r): r is AttendanceInputRow => r !== null);

  // ── 보강(수업외) 참석 ── 그 반 수강생이 아닌데 그날 기록이 있는 학생.
  // 강사가 '+ 보강 학생 추가'로 저장하면 수강행이 없어 위 명단엔 절대 안 잡힌다 → 여기서 합쳐야
  // 저장 뒤에도 보이고 **수정·삭제가 가능**하다(안 그러면 "안 보이는데 존재하는 데이터"가 된다).
  // 이관분에도 이런 행이 다수 있어(실측 1,264행/2026-02~06) 과거 날짜를 열면 그것도 함께 드러난다.
  const enrolledIds = new Set(
    (enrollments ?? [])
      .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student) as { id: string } | undefined)
      .filter((s): s is { id: string } => !!s)
      .map((s) => s.id),
  );
  // 🔴 그날 **보강 예약된** 학생도 같은 규약으로 합친다 — 기록이 아직 없어도 오기로 한 사람이라 미리 선다
  //    (원장 2026-09-14 *"보강 추가 할 필요없이 미리 학생이 추가되어있어야"*). 수강생이면 정규 행에 예약 표식만 붙는다.
  // 🔴 그날 이 반으로 **나눠 오는** 학생(0351a)도 같은 규약 — 수강행 없이 미리 선다(출결은 이 반 몫).
  //    같은 판정 함수를 한 번 더 통과시켜 합친다(예약 줄의 판정 식은 그대로 둔다 — 가드가 그 식을 잠근다).
  const makeupIds = [
    ...new Set([
      ...makeupStudentIds([...recordMap.keys(), ...reservedOf.keys()], [...enrolledIds]),
      ...makeupStudentIds(splitDay.incoming.map((v) => v.studentId), [...enrolledIds]),
    ]),
  ];
  let makeupRows: AttendanceInputRow[] = [];
  if (makeupIds.length > 0) {
    const students = await fetchInChunks<{ id: string; name: string; grade: string | null }>(
      makeupIds,
      (chunk) => supabase.from("students").select("id, name, grade").in("id", chunk),
    );
    makeupRows = students.map((s): AttendanceInputRow => ({
      studentId: s.id,
      studentName: s.name,
      studentGrade: s.grade,
      enrollmentId: null,
      isMakeup: true,
      ...recordFieldsOf(s.id),
    }));
  }

  const byName = (a: AttendanceInputRow, b: AttendanceInputRow) => {
    const ga = a.studentGrade ?? "";
    const gb = b.studentGrade ?? "";
    if (ga !== gb) return ga.localeCompare(gb, "ko");
    return a.studentName.localeCompare(b.studentName, "ko");
  };
  // 정규 명단 먼저, 보강은 아래로 묶어 표시(섞이면 "이 반 학생"으로 오인된다).
  return [...rosterRows.sort(byName), ...makeupRows.sort(byName)];
}

// ─────────────────── ijw 스타일 월 매트릭스 ───────────────────

export type MatrixDay = {
  date: string; // "2026-05-01" (placeholder면 "pad-29" 등 합성 키)
  day: number; // 1~31
  dow: number; // 0=일, 6=토 (placeholder면 -1)
  label: string; // "일/월/화/.../토" (placeholder면 "")
  isWeekend: boolean;
  isToday: boolean;
  // 그 달에 없는 날(예 28일 달의 29~31) — 항상 31칸을 렌더해 출석률 위치를 고정하기 위한 빈 여백.
  placeholder?: boolean;
};

export type MatrixStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: string | null;
  // 등원요일(0=일~6=토) — 분리등원(enrollments.attendance_days)이 있으면 그 요일, 없으면 반 수업요일 전체.
  attendDows: number[];
  /**
   * 이 반에서의 수강 구간(재등록이면 여러 개) — 칸이 재원 기간 밖인지 판정한다.
   * ⚠️ 표시 전용이다. 재원 외라고 입력을 막지 않는다(퇴원 뒤 보강 출석이 실제로 있다).
   */
  spans: EnrollSpan[];
  /** 그 달의 신입·퇴원·반이동 표식 — 대부분의 학생은 빈 배열. */
  badges: LifecycleBadge[];
  /** 학생 퇴원일(`students.withdrawn_at`) — 이름 칸 퇴원 서식(시간표와 같은 판정). 모르면 undefined. */
  withdrawnAt?: string | null;
};

/** 월별 출석부 칸에 실리는 예약 한 건(0264a) — 칸·팝오버·툴팁이 읽는 것만(예약자 이름은 서버가 붙인다). */
export type MatrixReservation = {
  id: string;
  absenceDate: string;
  /** "HH:MM" */
  slotStart: string;
  slotEnd: string;
  periodLabel: string | null;
  note: string | null;
  createdByName: string | null;
};

export type AttendanceMatrix = {
  classes: {
    id: string;
    className: string;
    subject: string;
    /** 특강 토글(0133a) 그대로 — 표에서 '반이동' 표식을 뗄지 가른다(판정은 `isSpecialLecture()`). */
    isSpecial: boolean;
    teacherId: string | null;
    teacherName: string | null;
    // 담임 재직 여부 — 퇴직(inactive) 담임 반은 살아있는 한 노출하되, 강사 필터에 "(퇴직)" 표시.
    teacherActive: boolean;
    /**
     * **그 달에 이 반의 교시를 맡은 사람들**(`class_schedules.teacher_id`, 담임 포함될 수 있음).
     * 영어는 교시마다 담당이 따로 붙어서, 담임만 보면 실제로 가르친 강사가 자기 출석부에서
     * 그 반을 아예 못 본다(실측 2026-08-18: Florence Park = 담임 0반·교시 담당 5반).
     * ⚠️ 자리(LAB·JJ)는 사람이 아니라 여기 안 들어온다(teacher_id가 null이라 구조적으로 제외).
     */
    slotTeachers: { id: string; name: string; active: boolean }[];
    historicalTeachers?: { id: string; name: string; active: boolean }[];
    homeroomHistory?: HomeroomPeriod[];
  }[];
  selectedClassId: string | null;
  month: string; // "2026-05" — **라벨월**이다. 세션은 이 달을 넘길 수 있다(window.end 참조).
  /** 표가 실제로 그린 기간. kind="session"이면 학원이 정한 구간, "month"면 달력월(폴백 포함). */
  window: PeriodWindow;
  days: MatrixDay[];
  // 선택한 반의 수업요일(0=일~6=토) — 그 달에 유효한 class_schedules 기준. 헤더 하이라이트용.
  classDows: number[];
  students: MatrixStudent[];
  // studentId → date → status
  marks: Record<string, Record<string, AttendanceStatus>>;
  // studentId → date → note (사유) — 매트릭스 인디케이터/툴팁용
  notes: Record<string, Record<string, string>>;
  // studentId → date → 시수(배수, 0115a). 기록이 없거나 기본(1)이면 키 없음 — 셀 표시·시수 합계용.
  // ⚠️ 하루에 교시가 여럿이면 **그날 합**이다(교시 2개 출석 = 2). 회차 소비·급여가 세는 값과 같다.
  units: Record<string, Record<string, number>>;
  /**
   * studentId → date → 그날의 **교시별 기록**(0196a). 교시가 **둘 이상인 날만** 담는다 —
   * 대부분의 칸은 여기 없고 종전과 완전히 같이 그려진다.
   * 🔴 있는 이유: 격자는 학생×날짜라 칸이 하나뿐인데, 접고 나면 "몇 교시였는지"가 사라진다.
   *    칸의 줄무늬·툴팁·저장(한 칸 입력이 그날 몇 건을 고치는지)이 전부 이 수를 근거로 한다.
   */
  slots: Record<string, Record<string, SlotMark[]>>;
  /**
   * studentId → date → **이 표가 세지 않는 교시**(강사 전체 보기에서 남의 교시·자리 JJ·LAB).
   * `scopeTeacherId`를 안 넘긴 반별 보기에선 항상 비어 있다.
   * 🔴 **2026-09-17부터 강사 전체 보기에서도 늘 비어 있다**(원장 *"내가 수업한 학생의 출석만 보고 싶은것"*) — 남의 교시를
   *    빗금으로 보이던 표시를 걷었다. 그 칸은 빈칸이고 입력하면 제 교시 행이 새로 생긴다. 아래 설명은 걷기 전의 규약이다
   *    (격자·칸의 빗금 코드는 이 값이 비면 그리지 않는다).
   *
   * 🔴 왜 따로 싣나: 칸 값(marks/units)은 **주인의 교시만** 담아야 합계·출석률·격자가 한 숫자를 말한다.
   *    그렇다고 남의 교시를 통째로 숨기면 그 칸이 빈칸이 되고, 월간 출석부는 입력 격자라 사람이 거기
   *    다시 찍어 숨은 기록을 덮는다(#103). 그래서 **값에서는 빼고, 표시(빗금·툴팁)로만 남긴다**.
   * ⚠️ 여기 담기는 사유는 셋이다 — 자리(JJ·랩) · 다른 선생님 교시 · **교시를 안 남긴 옛 기록**(그날
   *    담당이 둘 이상이면 담당을 가를 수 없어 `resolveTaughtBy`가 모호로 비운다). 툴팁이 사유를
   *    단정하지 않는 이유다(카드 라벨은 `att.legend.ghost` = "이 화면 몫 아님" 한 마디).
   */
  ghosts: Record<string, Record<string, SlotMark[]>>;
  /**
   * studentId → date → **빗금 칸의 표시 값**(다른 선생님 교시 기록의 롤업) — 제 몫 값이 없고 입력하면 그 교시에 상태만
   * 옮기는 칸(`ghostCellKind` `transfer`)에만 있다(원장 2026-09-14). 격자가 **합계 밖**(`g`)으로 싣고 빗금 위에 흐리게 그린다.
   * ⚠️ 선택 필드 — 없으면(옛 픽스처·반별 보기) 빗금 위 값이 안 보일 뿐 저장은 서버가 같은 판정으로 한다.
   */
  ghostValues?: Record<string, Record<string, GhostValue>>;
  /**
   * 강사 보기에서 그 강사가 **원래 수업하는 날**(`teachesClassOn`) — 반별 보기엔 없다.
   *
   * 🔴 쓰임은 **수업요일 색 하나**다(칸·머리 줄). 원장 2026-09-17 낮엔 이 목록 밖 날짜를 잠갔지만, 같은 날 저녁에 뒤집혔다:
   *    *"화요일은 원래 수업이라 이후에 관리자가 수정가능하고, 다른 요일도 보강 등으로 수업할 수 있으니까 숫자 입력가능하게"* —
   *    **모든 날짜 칸이 열린다**(강사는 7일 수정 기간만 그대로). 값은 여전히 그 강사 몫 기록만 싣는다(`ownsAttendanceSlot`).
   * ⚠️ 수업보고서 **파생**만 이 목록 안에서만 메운다(파생은 몫 판정을 안 타서, 안 막으면 남의 보고서가 값처럼 선다).
   * ⚠️ 명단(학생 줄)은 줄이지 않는다 — 원장 전용 금액 합계가 이 명단으로 학생을 고르기 때문이다(page.tsx `money`).
   */
  ownDates?: string[];
  // ⚠️ `noOwnRecord`(제 교시 기록 없이 남의 기록만 있는 칸의 입력 막기)는 같은 날 걷었다 — 원장 2026-09-17 *"내 출석부 상에서
  //    자유롭게 숫자 설정만 하는거야"*. 그 칸은 빈칸이고, 저장이 남의 행은 두고 제 교시 행을 새로 만든다(`planScopedDay` create).
  /**
   * studentId → date → true. **교시를 안 남긴 기록(day-level)이 값에 섞인 칸**(강사 전체 보기 전용).
   *
   * 🔴 그런 행은 "그날"만 말해 담당을 가릴 수 없으므로 좁히지 않는다(`ownsAttendanceSlot`) — 대신
   *    **그 반을 맡은 강사 전원의 화면에 같은 값으로 잡힌다**(실측: 영어 day-level 31행 중 21행이
   *    2~3명에게 동시 계상). 툴바 칩은 "칸 = 이 선생님 교시"라고 단언하므로, 이 칸들에 대해서만
   *    화면이 스스로 예외를 밝혀야 거짓말이 안 된다.
   * ⚠️ 월간 격자의 **새 입력도 day-level**이라 이 집합은 계속 늘어난다(교시를 아는 입력은 ECS가 한다).
   */
  dayAxis: Record<string, Record<string, true>>;
  // studentId → date → true. **수기 기록이 아니라 수업보고서에서 파생한 칸**(derive-from-reports.ts).
  // 화면이 사실과 다른 말을 하지 않도록 셀 툴팁에 출처를 밝히는 용도 — 수기로 덮으면 이 표시는 사라진다.
  derived: Record<string, Record<string, true>>;
  // 이 반이 파생 대상인지(수학=대상, 영어=미가동). 표에 안내 문구를 띄울지 결정.
  derivedActive: boolean;
  /**
   * date → 이 반 그날의 **수학 자동 시수**(수업 길이 → 시수, auto-units.ts · 원장 2026-09-11) — 빈 칸에
   * 숫자를 안 고르고 찍으면 서버가 넣는 값. 격자 낙관값·팝오버 기본값이 이걸 보여 준다(보이는 기본값 = 저장값).
   * 1·수학 아님·배치 없음은 키가 없다. ⚠️ 선택 필드 — 없으면(옛 픽스처·보강 반) 자동값 없음과 같다.
   */
  autoUnits?: Record<string, number>;
  /**
   * studentId → date → **보강 예약**(0264a, 아직 안 한 보강). 칸에 출결 값이 없을 때 '보강 예약' 네 글자로 서고,
   * 예약된 학생이 그 달 수강생이 아니면 명단에도 합쳐진다(수강행 없는 기록자와 같은 규약, 빈 spans).
   * 🔴 값(marks/units)이 아니다 — 시수·출석률·합계 어디에도 안 들어간다. 출결이 찍히는 순간 예약은 `done`으로
   *    넘어가 여기서 사라지고 그 칸은 평범한 출결 칸이 된다. ⚠️ 선택 필드 — 없으면(옛 픽스처) 예약 없음과 같다.
   */
  reservations?: Record<string, Record<string, MatrixReservation>>;
  /**
   * studentId → date → **수업 나누기** 표식(0351a) — in = 그 시간 이 반에서 수업(수강행 없어도 명단에 선다) ·
   * out = 그 시간만 다른 반. 🔴 값이 아니다(시수·출석률·합계 무관). ⚠️ 선택 필드 — 없으면 나눔 없음.
   */
  splits?: Record<string, Record<string, SplitDateMark>>;
  /**
   * 이 표가 **못 읽어 접은 재료**(담임 변경 기록 · 학원 설정) — 접힌 것이 없으면 키가 없다(`folded-read.ts`).
   * 🔴 화면은 읽지 않는다(종전 그대로 그린다). 이 표를 **금액**으로 쓰는 자리(`loadTeacherSheet`)만 보고 산정을 멈춘다 —
   *    이력이 비면 넘긴 뒤의 칸까지 그 강사 몫이 되고, 설정이 비면 휴일에 쓴 보고서가 출석으로 살아난다.
   */
  degraded?: string[];
  stats: {
    totalStudents: number;
    presentRate: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    makeupCount: number;
    totalRecords: number;
  };
};

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 표의 날짜축 — 기간(세션 또는 달력월)의 모든 날.
 *
 * ⚠️ 세션은 달력월을 넘길 수 있어(2월 세션이 3/5까지) `day`가 1..31 순서가 아니다.
 *    화면이 날짜 칸을 `day`로 식별하면 3/1과 2/1이 같은 칸이 된다 — 식별은 항상 `date`(ISO)로.
 */
function buildPeriodDays(startIso: string, endIso: string): MatrixDay[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso) || startIso > endIso) return [];
  const todayIso = kstToday();
  const days: MatrixDay[] = [];
  const cur = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  // 가드: 어떤 세션도 1년을 넘지 않는다(깨진 행이 무한 루프가 되지 않게).
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const dateStr = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    days.push({
      date: dateStr,
      day: cur.getUTCDate(),
      dow,
      label: DOW_LABEL[dow] ?? "?",
      isWeekend: dow === 0 || dow === 6,
      isToday: dateStr === todayIso,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * 한 반의 한 달치 모든 학생 출석 — 매트릭스 형태로.
 * classId 없으면 모든 반의 통계만 반환 (학생 없음).
 */
/**
 * 학생별 신입·퇴원·반이동 표식을 채운다(제자리 변경).
 *
 * 🔴 **경계가 있는 학생이 있을 때만** 다른 반을 조회한다 — 평범한 달엔 쿼리가 0이다.
 *    반이동 판정만을 위해 매달 전 학생의 타 반 수강을 긁으면 강사 전체 보기(반 10개)에서
 *    쿼리가 반 수만큼 늘어난다(B4·반응속도 1순위).
 * ⚠️ 다른 반 조회는 **classes 임베드를 쓰지 않는다** — enrollments→classes FK가 늘어나는 순간
 *    손도 안 댄 이 화면이 PGRST201로 죽는다(#94). 두 번 나눠 받고 코드에서 잇는다.
 *    단 `student:student_id ( withdrawn_at )`는 **컬럼 힌트**라 허용한다(퇴원일 자르기의 재료 — 걷어내면 그만둔
 *    학생이 '종강'으로 뜬다).
 */
async function attachLifecycleBadges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  range: SpanRange,
  studentMap: Map<string, MatrixStudent>,
  classId: string,
  subject: string | null,
): Promise<void> {
  const students = [...studentMap.values()];
  // 1차 판정(다른 반 모름) — 여기서 아무것도 안 나오면 추가 조회 자체를 안 한다.
  const plain = new Map<string, LifecycleBadge[]>();
  for (const s of students) {
    const b = lifecycleBadgesInRange(range, s.spans, subject);
    if (b.length > 0) plain.set(s.id, b);
  }
  if (plain.size === 0) return;

  // 경계가 있는 학생만, 경계 ±14일과 겹치는 **다른 반** 수강을 본다.
  const ids = [...plain.keys()];
  const dates = [...plain.values()].flat().map((b) => b.date).sort();
  const from = addDays(dates[0]!, -TRANSFER_GAP_DAYS);
  const to = addDays(dates[dates.length - 1]!, TRANSFER_GAP_DAYS);
  const rows = await fetchInChunks(ids, (chunk) =>
    supabase
      .from("enrollments")
      // 🔴 `is_transferred`를 함께 싣는다 — 없으면 **새 반 쪽이 여전히 '신입'**으로 뜬다(같은 사건이
      //    두 화면에서 다른 이름. 적대 리뷰 2026-09-14 실측 9월 23건). 같은 날 이어받은 반이동 판정의 유일한 근거다.
      // `withdrawn_at` — 그만둔 학생의 다른 반을 퇴원일로 잘라 '종강'(계속 수강)으로 안 읽히게(clipToWithdrawal).
      //    students FK는 컬럼 힌트(`student:student_id`)라 classes FK가 늘어도 안 흔들린다(#94). 같은 행이라 왕복 0.
      .select("student_id, class_id, start_date, end_date, is_transferred, student:student_id ( withdrawn_at )")
      .in("student_id", chunk)
      .neq("class_id", classId)
      .lte("start_date", to)
      .or(`end_date.is.null,end_date.gte.${from}`),
  );
  const otherClassIds = [...new Set(rows.map((r) => r.class_id as string))];
  const metaRows = otherClassIds.length
    ? await fetchInChunks(otherClassIds, (chunk) =>
        supabase.from("classes").select("id, class_name, subject").in("id", chunk),
      )
    : [];
  const meta = new Map(
    metaRows.map((c) => [c.id as string, { name: c.class_name as string, subject: c.subject as string | null }]),
  );

  const othersById = new Map<string, OtherSpan[]>();
  for (const r of rows) {
    const m = meta.get(r.class_id as string);
    if (!m) continue;
    const list = othersById.get(r.student_id as string) ?? [];
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as { withdrawn_at: string | null } | null;
    list.push(
      clipToWithdrawal(
        {
          classId: r.class_id as string,
          className: m.name,
          subject: m.subject,
          start: r.start_date as string,
          end: (r.end_date as string | null) ?? null,
          isTransferred: r.is_transferred === true,
        },
        stu?.withdrawn_at,
      ),
    );
    othersById.set(r.student_id as string, list);
  }

  for (const id of ids) {
    const st = studentMap.get(id);
    if (st) st.badges = lifecycleBadgesInRange(range, st.spans, subject, othersById.get(id) ?? []);
  }
}

export async function getMonthlyAttendanceMatrix(
  month: string,
  requestedClassId: string | null,
  /**
   * 날짜축을 세션(0189a)으로 그릴지 달력월로 그릴지 — 개인 보기 설정(`ui_prefs.attendance.periodMode`).
   * ⚠️ 세션은 **과목별**이라 반이 확정됐을 때만 적용된다. 여러 반을 한 표에 그리는 강사 전체 보기는
   *    반마다 기간이 달라 축이 어긋나므로 호출부가 "month"를 넘긴다(1단계 한계, 화면에 명시).
   * ⚠️ 세션이 정의돼 있지 않으면 조용히 달력월로 떨어진다(정상 경로).
   */
  periodMode: PeriodMode = "month",
  /**
   * **강사 전체 보기의 주인** — 넘기면 그 강사가 맡은 교시의 출결만 칸 값으로 싣는다(안 넘기면 반 전체).
   *
   * 🔴 왜: 영어는 한 반을 교시마다 다른 강사가 나눠 맡는데, 칸 숫자가 그날 **모든 교시의 합**이라
   *    한 교시만 가르친 강사의 출석부에도 남의 교시가 함께 잡혔다(원장 제보 2026-08-18: 8/10 김근호가
   *    이다교 선생님 출석부에 **3**으로 보임 — 실제로는 16:20 정유진·17:20 이다교·18:20 JJ라 이다교 몫은 1).
   * ⚠️ 판정은 귀속 단일 소스 `resolveTaughtBy`가 한다 — 자리(LAB·JJ)는 teacherId가 null이라 **자동으로**
   *    누구에게도 안 잡히고("JJ 및 랩은 누구의 것도 아님", 원장 2026-08-18), 담당 미지정 교시는 담임에게
   *    간다(수학은 전 슬롯이 미지정이라 종전과 완전히 같다).
   * 🔴 **반별 보기(이 값이 null)는 손대지 않는다** — 반의 책은 그 반 전체를 세는 게 맞고, 자리 출결을
   *    고칠 수 있는 유일한 입력 표면이기도 하다(자리 전용 출석부는 읽기 전용). 원장 지시도 "JJ·랩 전용
   *    출석부는 지금처럼 남겨놔"였다. 급여 별지(print)도 같은 이유로 안 넘긴다 — 돈 축은 담임 그대로다.
   */
  scopeTeacherId: string | null = null,
  /**
   * **이 강사가 이 반 담임이 된 날**(YYYY-MM-DD) — 이보다 이른 칸은 이 표의 값으로 세지 않는다.
   *
   * 🔴 원장 제보 2026-08-19: *"김주현 선생님이 출결한것도 아닌데 보이는것도 같이 수정해야겠네."*
   *    담임은 반 단위 속성이라 시간 축이 없어서, 8/10·8/14 인계 **이전**인 8/3~8/10 기록(전임이 넣은
   *    27행)이 새 담임 출석부에 그대로 떴다.
   * ⚠️ **표시 축뿐이다** — 그 날짜는 그리지 않는다(`ownDates` 밖 — 값·메모 없이 격자가 입력을 막는다, 2026-09-17. 그전엔 빗금으로
   *    남겼다). 반별 보기(scopeTeacherId=null)와 급여 별지는 이 값을 안 넘긴다.
   * ⚠️ 판정(담임 폴백으로 잡힌 반인가 · 근거가 있는가)은 **호출부**가 한다 — 교시 담당으로 잡힌 반은
   *    그 사람이 실제로 가르쳤으므로 대상이 아니고, 근거가 없으면 null이라 종전대로 전부 보인다.
   */
  scopeSince: string | null = null,
  /**
   * **스코프 검사를 통과시킬 반 하나** — 강사에게 보이는 활성 반 목록엔 없지만 그 사람 것이 확실한 반.
   *
   * 🔴 지금 유일한 소비처 = 보이지 않는 '보강' 반(0241a). 그 반은 `is_active=false`라 아래
   *    `loadVisibleClassAxisRows`(활성만)에 절대 안 들어오고, 그러면 강사 화면에서 이 함수가
   *    **classId를 조용히 null로 떨어뜨려** 보강 묶음이 통째로 빈다(에러도 안 난다).
   * ⚠️ 호출부가 **그 반이 이 사람 것임을 이미 확인**했을 때만 넘긴다(`findMakeupPoolClass`는
   *    `teacher_id = 그 강사`로 조회한다). 남의 반 id를 여기 실으면 스코프가 뚫린다.
   */
  allowClassId: string | null = null,
): Promise<AttendanceMatrix> {
  // 로그인 없는 조립 문맥(강사평가 밤 집계 — read-context.ts)이면 관리 클라이언트·그 지점 설정. 아래 조회는 반·학생 id로 좁힌다.
  const readCtx = attendanceReadContext();
  const { db: supabase } = await attendanceDb();

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 selector·데이터를 본인 담당 반만(URL로 남의 classId 넘겨도 무시).
  const tId = readCtx ? null : await effectiveTeacherId();

  // 활성 반 목록 + 그 달 강사 축(담임 ∪ 교시 담당) — 조회는 축 헬퍼가 맡고 요청당 1회 캐시된다.
  // 🔴 강사 스코프를 SQL의 `.eq("teacher_id", tId)`로 걸지 **않는다**(2026-08-18). 그러면 축이 담임뿐이라
  //    교시 담당 강사의 출석부가 통째로 빈다 — 좁히는 판정은 축 단일 소스(taughtBy)가 한다.
  // ⚠️ `month`는 URL에서 온다 — 형식이 어긋나면 이번 달로 떨어뜨린다(축 조회가 날짜를 필터에 보간한다).
  const axisRange = monthRange(/^\d{4}-\d{2}$/.test(month) ? month : kstMonth());

  // 강사(또는 겸직 강사뷰)면 **자기가 가르치는 반**으로 좁힌다 — 담임 반 ∪ 그 달 교시 담당 반.
  // 🔴 좁히는 판정은 `loadVisibleClassAxisRows` **한 곳**뿐이다(허브 학생 검색도 같은 함수를 쓴다) —
  //    표면마다 따로 적으면 한쪽이 담임 축으로 되돌아가 교시 담당 강사의 반이 조용히 사라진다([[#77]]).
  const axisRows = await loadVisibleClassAxisRows(axisRange.from, axisRange.to);
  // 못 읽어 접은 재료 — 금액 조립(`loadTeacherSheet`)이 보고 멈춘다. 화면은 읽지 않는다.
  const degraded: string[] = [];
  const axisFolded = foldedReason(axisRows);
  if (axisFolded) degraded.push(axisFolded);
  const classes = axisRows
    .map((c) => ({
      id: c.id,
      className: c.className,
      subject: c.subject,
      isSpecial: c.isSpecial,
      reportOptout: c.reportOptout,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
      teacherActive: c.teacherActive,
      slotTeachers: c.slotTeachers,
      historicalTeachers: c.historicalTeachers,
      homeroomHistory: c.homeroomHistory,
    }));

  // 강사가 본인 반이 아닌 classId를 URL로 넘기면 선택 무시(스코프 위반 차단).
  const classId =
    tId &&
    requestedClassId &&
    requestedClassId !== allowClassId &&
    !classes.some((c) => c.id === requestedClassId)
      ? null
      : requestedClassId;

  // 날짜축 = 세션 기간(반이 정해졌고 그 과목에 세션이 있을 때) 또는 달력월. 폴백은 resolve가 책임진다.
  const selectedSubject = classId ? (classes.find((c) => c.id === classId)?.subject ?? null) : null;
  const periodWindow = await getPeriodWindow({
    period: month,
    subjectKey: selectedSubject,
    mode: classId ? periodMode : "month",
    todayIso: kstToday(),
  });
  const days = buildPeriodDays(periodWindow.start, periodWindow.end);
  if (!classId || days.length === 0) {
    return {
      classes,
      selectedClassId: classId,
      month,
      window: periodWindow,
      days,
      classDows: [],
      students: [],
      marks: {},
      notes: {},
      units: {},
      slots: {},
      ghosts: {},
      dayAxis: {},
      derived: {},
      derivedActive: false,
      ...(degraded.length > 0 ? { degraded } : {}),
      stats: {
        totalStudents: 0,
        presentRate: 0,
        presentCount: 0,
        absentCount: 0,
        lateCount: 0,
        makeupCount: 0,
        totalRecords: 0,
      },
    };
  }

  const startIso = days[0]!.date;
  const endIso = days[days.length - 1]!.date;

  // 해당 반의 활성 학생 + 그 반의 수업요일 + 이 기간에 기록을 남긴 학생 + 보강 예약 — 서로 독립이라 병렬로(B4).
  // 대신 보강 귀속(`taught_by`, 0316a) — 칸이 있을 때만 읽는다([[#95]]). 강사 보기의 몫 판정만 쓰므로 반별 보기는 안 본다.
  const withTaughtBy = scopeTeacherId ? await taughtByColumnReady().catch(() => false) : false;
  const [enrollRes, scheduleRes, recordedRows, reservedRows, monthSplits] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        // is_transferred = 반이동 종료 표식. 없으면 `isEnrolledOn`이 일반 종료로 보고
        // **옮겨간 학생을 옛 반에 적용일 하루 더 남긴다**(2026-09-01 실측).
        // is_transferred_in·withdrawn_at = 이름 칸 서식(신입·전입·퇴원 — 시간표와 같은 판정, name-tone.ts).
        `id, start_date, end_date, on_hold, is_transferred, is_transferred_in, attendance_days,
       student:student_id ( id, name, grade, school, withdrawn_at )`,
      )
      .eq("class_id", classId)
      .lte("start_date", endIso),
    // 그 달과 유효기간이 겹치는 스케줄만(월 중 요일이 바뀐 반은 합집합 — 표시용 하이라이트라 넉넉히).
    // ⚠️ 자리(LAB·JJ) 판정에도 이 결과를 쓴다 — 그래서 시각·담당·유효구간까지 함께 받는다(추가 왕복 0, B4).
    // end_time은 **수학 자동 시수**(수업 길이 → 시수, auto-units.ts)의 재료 — 같은 행이라 왕복 0.
    supabase
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, teacher_id, slot_teacher_label, valid_from, valid_to")
      .eq("class_id", classId)
      .lte("valid_from", endIso)
      .or(`valid_to.is.null,valid_to.gte.${startIso}`),
    /**
     * 이 반·이 기간에 **기록이 있는 학생 id** — 수강행이 없어도 명단에 세우기 위해(아래 합치기).
     * 🔴 보이지 않는 '보강' 반(0241a)은 **일부러 수강행이 없다** — 이 조회가 없으면 그 반은 영원히
     *    0명이라 출석부 묶음이 통째로 안 선다(에러도 안 난다. 원장 제보 2026-09-02: *"김은정 선생님의
     *    이윤 학생이 9/1 자 출석부에 나와야하는데 목록에도 안보이네"*).
     * B2: 명단을 만드는 조회라 무페이징 select 금지 → 페이지네이션(반 1개·한 기간이라 가볍다).
     *     PostgREST엔 distinct가 없어 행을 받아 코드에서 접는다(tie-break `id`로 OFFSET 안정).
     */
    fetchAllPaged<{
      student_id: string;
      session_date: string;
      slot_start: string | null;
      seat_label: string | null;
      recorded_via: string | null;
      taught_by?: string | null;
    }>((from, to) =>
      supabase
        .from("attendance_records")
        // 교시·자리 표식까지 — 강사 보기는 **이 보기에 보이는 기록**이 있는 방문자만 명단에 세운다(아래 `visitorRows`).
        .select(
          (withTaughtBy ? "student_id, session_date, slot_start, seat_label, recorded_via, taught_by" : "student_id, session_date, slot_start, seat_label, recorded_via") as "student_id, session_date, slot_start, seat_label, recorded_via",
        )
        .eq("class_id", classId)
        .gte("session_date", startIso)
        .lte("session_date", endIso)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    /**
     * 이 반·이 기간의 **보강 예약**(0264a, 아직 안 한 보강) — 칸에 '보강 예약'으로 서고, 예약된 학생이 수강생이
     * 아니면 명단에도 합친다(원장 2026-09-14 *"보강 날짜에 보강 추가 할 필요없이 미리 학생이 추가되어있어야"*).
     * 조회는 fail-soft(표 없음·실패 = 빈 목록) — 부가 표시 하나 때문에 출석부가 죽지 않는다.
     */
    getClassReservationsInRange(classId, startIso, endIso),
    // 수업 나누기(0351a) — 이 반이 보내거나 받는 나눔(fail-soft: 표 없음·실패 = 빈 목록).
    getSplitsTouchingClasses([classId], startIso, endIso),
  ]);

  /**
   * 🔴 **조회 실패를 빈 목록으로 삼키지 않는다**(B3). 여기서 `?? []`로 넘기면 명단 조회가 실패했을 때
   *    화면이 "이 반에 등록된 학생이 없습니다"라고 **사실 주장**을 한다 — 출석 장부에서 이건 가장
   *    위험한 거짓말이다(그 달을 통째로 비어 보이게 만든다). 던지면 `(shell)/error.tsx`가 받아
   *    "화면을 불러오지 못했습니다"로 정직하게 말하고 다시 시도할 길을 준다([[#109]]).
   * ⚠️ 위 `fetchAllPaged`는 규약대로 이미 스스로 throw한다 — 여기 둘만 맨 select라 손으로 검사한다.
   */
  if (enrollRes.error) {
    throw new Error(`출석부 명단을 불러오지 못했습니다: ${enrollRes.error.message}`);
  }
  if (scheduleRes.error) {
    throw new Error(`출석부 교시를 불러오지 못했습니다: ${scheduleRes.error.message}`);
  }
  const enrollments = enrollRes.data;
  const schedules = scheduleRes.data;

  const classDows = dowsFromKeys((schedules ?? []).map((s) => s.day_of_week as string));

  /**
   * 교시 귀속 판정에 넘길 모양 — 규칙(자리 제외·담임 폴백·유효구간)은 전부 `resolveTaughtBy` 안에 있다.
   * ⚠️ 라벨 문자열('JJ'·'랩실'·'이주희'…)을 이 파일에서 비교하지 말 것(별칭이 갈린다).
   */
  const axisSlots = (schedules ?? []).map((s) => ({
    dayOfWeek: s.day_of_week as string,
    startTime: (s.start_time as string | null) ?? null,
    teacherId: (s.teacher_id as string | null) ?? null,
    slotTeacherLabel: (s.slot_teacher_label as string | null) ?? null,
    validFrom: s.valid_from as string,
    validTo: (s.valid_to as string | null) ?? null,
  }));
  const homeroomTeacherId = classId ? (classes.find((c) => c.id === classId)?.teacherId ?? null) : null;
  const homeroomHistory = classId ? classes.find((c) => c.id === classId)?.homeroomHistory : undefined;

  /**
   * 이 교시가 **이 표의 주인 몫인가** — 규칙·근거는 축 단일 소스 `ownsAttendanceSlot` 주석.
   * (반별 보기는 scope가 없어 항상 true = 종전과 완전히 동일한 숫자.)
   */
  const slotInput = (
    date: string,
    slotStart: string | null,
    seatLabel: string | null,
    recordedVia: string | null,
    taughtBy: string | null = null,
  ) => ({
    scopeTeacherId,
    homeroomTeacherId,
    homeroomHistory,
    slots: axisSlots,
    date,
    slotStart,
    homeroomSince: scopeSince,
    // 🔴 자리 기록은 어느 강사 몫도 아니다 — 그 반 자리 교시 **밖**에 찍힌 행(교시 이동)이 담임 폴백으로
    //    담임 값에 섞이지 않게. 표식이 둘인 건 자리마다 쓰는 값이 달라서다(비대칭, 리뷰 2026-09-12):
    //    · 랩실 = `seat_label`(0208a, 정산 tier-rows도 같은 값으로 뺀다)
    //    · JJ실 = 라벨을 안 박으므로 **자리 문 표식**(`recorded_via="seat"`)이 유일한 근거일 수 있다
    seatLabel,
    recordedVia,
    // 🔴 대신 보강 칸(원장 결정 3, 2026-09-30) — 반 담임이 아니라 보강한 강사 몫(`ownsAttendanceSlot` `taughtBy`).
    taughtBy,
  });
  const ownsSlot = (
    date: string,
    slotStart: string | null,
    seatLabel: string | null = null,
    recordedVia: string | null = null,
    taughtBy: string | null = null,
  ): boolean => ownsAttendanceSlot(slotInput(date, slotStart, seatLabel, recordedVia, taughtBy));
  /**
   * 강사 보기에서 그 강사가 **원래 수업하는 날**(`AttendanceMatrix.ownDates` 주석) — 색으로만 구분한다.
   * 🔴 **입력은 어느 날에도 막지 않는다**(원장 2026-09-17 *"다른 요일도 보강 등으로 수업할 수 있으니까 숫자 입력가능하게"*) —
   *    2026-09-17 낮의 '수업하지 않는 날 잠금'은 같은 날 저녁에 걷혔다. 판정은 축 단일 소스 `teachesClassOn`, 재료는 이미 받은 슬롯.
   */
  const ownDateSet = scopeTeacherId
    ? new Set(
        days
          .filter(
            (d) =>
              !d.placeholder &&
              teachesClassOn({
                scopeTeacherId,
                homeroomTeacherId,
                homeroomHistory,
                slots: axisSlots,
                date: d.date,
                homeroomSince: scopeSince,
              }),
          )
          .map((d) => d.date),
      )
    : null;

  /**
   * 이 반을 그 기간에 맡은 강사가 **둘 이상인가** — 아래 `dayAxis` 안내를 붙일지 정한다.
   *
   * 🔴 한 사람뿐인 반에서 "다른 선생님 화면에도 같은 값"은 **거짓말**이다. 수학은 활성 68개 반 중
   *    담임 아닌 교시 담당이 있는 반이 **0개**라, 안 가르면 day-level 칸 전부에 그 문장이 붙는다
   *    (실측 2026-05~08: 수학 dayAxis 4,668칸 중 실제로 둘 이상에게 잡히는 칸은 136칸뿐 = 2.9%).
   *    거짓 문구를 없애려던 화면에 또 다른 거짓을 붙이는 꼴이라 여기서 막는다(적대적 리뷰 2026-08-19).
   * ⚠️ 판정은 가시성 축(`classTeacherIdsInRange`)과 **같은 함수**로 한다 — 화면에 뜨는 사람 수와
   *    문구가 어긋나지 않게. 추가 쿼리 0(이미 받은 슬롯으로 계산).
   */
  const monthTeachers = classTeacherIdsInRange({ homeroomTeacherId, slots: axisSlots, from: startIso, to: endIso });
  const sharedByTeachers = monthTeachers.length > 1;

  const studentMap = new Map<string, MatrixStudent>();
  // 파생 판정용 수강 구간 — 한 학생이 같은 반에 재등록해 여러 행일 수 있어 **전 구간**을 모은다
  // (studentMap은 첫 행만 담으므로 그것만 보면 재등록 이전 기간을 통째로 결석 처리한다).
  const rangesById = new Map<string, EnrollSpan[]>();
  for (const e of enrollments ?? []) {
    if (e.on_hold) continue;
    if (e.end_date && e.end_date < startIso) continue;
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
      | { id: string; name: string; grade: string | null; school: string | null; withdrawn_at?: string | null }
      | undefined;
    if (!s) continue;
    const list = rangesById.get(s.id) ?? [];
    list.push({
      start: e.start_date as string,
      end: (e.end_date as string | null) ?? null,
      isTransferred: e.is_transferred === true,
      isTransferredIn: (e as { is_transferred_in?: boolean | null }).is_transferred_in === true,
    });
    rangesById.set(s.id, list);
    if (!studentMap.has(s.id)) {
      studentMap.set(s.id, {
        id: s.id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
        attendDows: resolveAttendDows(e.attendance_days as string[] | null, classDows),
        spans: [],
        badges: [],
        withdrawnAt: s.withdrawn_at ?? null,
      });
    }
  }
  // 구간을 학생에 붙인다 — 화면이 "그날 이 반 소속이었나"를 판정할 유일한 근거.
  for (const [id, list] of rangesById) {
    const st = studentMap.get(id);
    if (st) st.spans = list;
  }
  // ⚠️ 뱃지는 **표가 그린 기간**으로 판정해야 한다 — 날짜축만 세션으로 바꾸고 여기를 월로 두면
  //    세션이 3/5까지인데 3월 퇴원 뱃지가 사라진다(표는 그 칸을 그리므로 눈에 안 띈다).
  await attachLifecycleBadges(
    supabase,
    { first: periodWindow.start, last: periodWindow.end },
    studentMap,
    classId,
    selectedSubject,
  );

  // ── 보강(수업외) 참석 ── 그 반 수강행은 없는데 그 기간에 출결 기록이 있는 학생.
  //
  // 🔴 일별 입력 명단(위 `getAttendanceInputRows`)은 예전부터 이 학생들을 합쳐서 보여 준다 — 그래야
  //    저장 뒤에도 보이고 **수정·삭제가 된다**. 그런데 **월별 표엔 그 합치기가 없었다**: 기록이 있고
  //    시수도 세는데 장부에서만 사라져 있었다(실측 2026-09-02: 최근 90일 (반,학생) 10쌍 · 출결 13행).
  // 🔴 그리고 이게 없으면 **보이지 않는 '보강' 반**(0241a)이 통째로 빈다 — 그 반은 일부러 수강행을
  //    만들지 않으므로(강사당 1개·교시 0·수강 0) 명단이 **항상 0명**이고, 에러도 없이 묶음이 안 선다.
  // ⚠️ 생애주기 뱃지를 붙인 **뒤에** 합친다(수강 구간 없는 학생에게 신입·퇴원 판정을 시키지 않는다).
  //    그리고 아래 출결 조회(`studentIds`)보다는 **앞**이어야 합친 학생의 칸이 찬다.
  // 🔑 규약(같은 판정 함수 · 빈 spans · 빈 attendDows)은 `monthly-makeup-roster.ts`에 있다.
  // 🔴 "수강행이 있나"의 기준은 **받아 온 수강행 전부**다 — `studentMap`이 아니다. studentMap은
  //    이미 `on_hold`·기간 전 종료를 걸러낸 뒤라, 그걸 기준으로 삼으면 **휴원 중인데 기록이 있는
  //    학생이 '보강'으로 둔갑**해 구간 없는 행으로 되살아난다(휴원은 숨기는 게 맞다). 일별 입력
  //    로스터(`getAttendanceInputRows`)도 같은 집합을 쓴다 — 두 화면이 같은 말을 해야 한다.
  const enrolledStudentIds = (enrollments ?? [])
    .map((e) => (Array.isArray(e.student) ? e.student[0] : e.student) as { id: string } | undefined)
    .filter((s): s is { id: string } => !!s)
    .map((s) => s.id);
  // 🔴 보강 **예약된** 학생도 같은 규약으로 합친다 — 기록이 아직 없어도 그날 이 반에 오기로 한 사람이라 명단에
  //    서야 강사가 '보강 추가' 없이 그 칸을 찍는다(예약 행이 있어 `hasReservedMakeup`이 저장 문을 연다).
  /**
   * 🔴 강사 보기 + **담임이 아닌 반**은 **이 보기에 값으로 서는 기록**이 있는 방문자만 세운다(적대 리뷰 2026-09-17 저녁) —
   *    남의 교시·자리 기록뿐인 방문자를 세우면 값 없는 빈 줄이 서고 **총원(출석률 분모)**까지 커진다. 판정은 칸 값과 **같은
   *    함수**(`ownsSlot`).
   * 🔴 **담임 반은 종전대로 전부** — 원장 전용 금액 합계가 담임 반의 명단(`matrix.students`)으로 학생을 고르므로 줄이면 돈
   *    숫자가 바뀐다(page.tsx `money` · 적대 재리뷰 2026-09-17: 자리 기록뿐인 방문자가 합계에서 빠졌다).
   * ⚠️ 날짜로는 안 좁힌다 — 보강은 원래 수업 요일 밖에도 있고(원장 2026-09-17 저녁) 그 줄이 없으면 찍을 칸이 없다.
   */
  const visitorRows =
    scopeTeacherId && homeroomTeacherId !== scopeTeacherId
      ? recordedRows.filter((r) => ownsSlot(r.session_date, r.slot_start, r.seat_label, r.recorded_via, r.taught_by ?? null))
      : recordedRows;
  // 🔴 그 달 이 반으로 **나눠 오는** 학생(0351a)도 같은 규약 — 기록이 없어도 그 시간 출결이 이 반 몫이라 명단에 선다.
  //    상대 반 이름은 표식 문장에만 쓴다(나눔이 있을 때만 묻는다 — 평소 왕복 0).
  const splitClassNames = new Map<string, { name: string; teacherName: string | null }>();
  if (monthSplits.length > 0) {
    type Cls = { id: string; class_name: string; teacher?: { display_name?: string } | { display_name?: string }[] | null };
    const otherIds = [...new Set(monthSplits.flatMap((x) => [x.sourceClassId, x.targetClassId]))];
    const cls = await fetchInChunks<Cls>(otherIds, (chunk) =>
      supabase.from("classes").select("id, class_name, teacher:teacher_id ( display_name )").in("id", chunk),
    ).catch((e: unknown) => {
      console.error("[attendance] 나눔 상대 반 이름 조회 실패 — 이름 없이 표식만 세웁니다:", e); // B16
      return [] as Cls[];
    });
    for (const c of cls) {
      const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
      splitClassNames.set(c.id, { name: c.class_name, teacherName: t?.display_name ?? null });
    }
  }
  const splitView = splitDateMarks(
    classId,
    days.filter((d) => !d.placeholder).map((d) => d.date),
    monthSplits,
    splitClassNames,
  );
  const extraIds = recordedOnlyStudentIds(
    [...visitorRows.map((r) => r.student_id), ...reservedRows.map((r) => r.studentId), ...splitView.incomingIds],
    enrolledStudentIds,
  );
  // 예약만 있는 학생(기록 없음·수강 없음) — 명단엔 서되 **총원엔 안 센다**(아직 안 온 사람, 적대 리뷰 2026-09-14).
  const recordedIdSet = new Set(visitorRows.map((r) => r.student_id));
  // 나눔으로만 서는 학생(기록 없음·수강 없음)도 같다 — 아직 안 온 사람이라 총원엔 안 센다.
  const reservedOnlyIds = new Set(
    [...reservedRows.map((r) => r.studentId), ...splitView.incomingIds].filter(
      (id) => !enrolledStudentIds.includes(id) && !recordedIdSet.has(id),
    ),
  );
  if (extraIds.length > 0) {
    const extras = await fetchInChunks<{
      id: string;
      name: string;
      grade: string | null;
      school: string | null;
    }>(extraIds, (chunk) =>
      supabase.from("students").select("id, name, grade, school").in("id", chunk),
    );
    for (const s of extras) {
      if (studentMap.has(s.id)) continue;
      studentMap.set(s.id, recordedOnlyMatrixRow(s));
    }
  }

  const students = Array.from(studentMap.values()).sort((a, b) => {
    const ga = a.grade ?? "";
    const gb = b.grade ?? "";
    if (ga !== gb) return ga.localeCompare(gb, "ko");
    return a.name.localeCompare(b.name, "ko");
  });

  // 보강 예약 칸(0264a) — studentId → date → 예약. 명단에 없는 학생(조회 실패 등)의 예약은 싣지 않는다.
  const reservations: Record<string, Record<string, MatrixReservation>> = {};
  /** 이름을 나중에 채울 자리 — [예약 칸, 예약자 id]. 출결 기록 조회와 독립이라 기록 블록 밖에서 한 번에 묻는다. */
  const reservationCreators: [MatrixReservation, string][] = [];
  if (reservedRows.length > 0) {
    for (const r of reservedRows) {
      if (!studentMap.has(r.studentId)) continue;
      // 같은 날 예약이 둘(교시 둘)이면 이른 교시가 칸을 대표한다(조회가 slot_start 오름차순).
      // ⚠️ 예약은 **모든 날**에 그린다 — 보강은 원래 수업 요일 밖에도 있다(원장 2026-09-17 저녁).
      if (reservations[r.studentId]?.[r.makeupDate]) continue;
      reservations[r.studentId] ??= {};
      const entry: MatrixReservation = {
        id: r.id,
        absenceDate: r.absenceDate,
        slotStart: r.slotStart,
        slotEnd: r.slotEnd,
        periodLabel: r.periodLabel,
        note: r.note,
        createdByName: null,
      };
      reservations[r.studentId]![r.makeupDate] = entry;
      if (r.createdBy) reservationCreators.push([entry, r.createdBy]);
    }
  }

  // 해당 월의 모든 출결 기록 (반 + 학생 + 기간)
  const studentIds = students.map((s) => s.id);
  const marks: Record<string, Record<string, AttendanceStatus>> = {};
  const notes: Record<string, Record<string, string>> = {};
  const units: Record<string, Record<string, number>> = {};
  const slots: Record<string, Record<string, SlotMark[]>> = {};
  // 2026-09-17부터 늘 비어 있다 — 남의 교시는 보여 주지 않는다(`AttendanceMatrix.ghosts` 주석).
  const ghosts: Record<string, Record<string, SlotMark[]>> = {};
  const dayAxis: Record<string, Record<string, true>> = {};
  const derived: Record<string, Record<string, true>> = {};

  if (studentIds.length > 0) {
    // 🔴 무페이징 select + raw .in() + `data ?? []`였다. 달력월(최대 31일)일 땐 여유가 있었지만
    //    세션은 공휴일로 6주까지 늘어날 수 있어(30명 × 45일 = 1,350행) **1000행에서 조용히 잘린다**
    //    — 잘린 만큼 출석이 화면에서 사라지고 에러도 안 난다(B2·B3, gotcha #54).
    //    같은 파일 아래 보고서 조회와 같은 헬퍼로 통일한다(페이지네이션 + 100개 청크 + error는 throw).
    const records = await fetchAllPagedInChunks<{
      student_id: string;
      session_date: string;
      slot_start: string | null;
      status: AttendanceStatus;
      note: string | null;
      session_units: number | string | null;
      /** 자리 시수 행 표식(0208a) — 강사 렌즈에서 이 행을 어느 강사 몫으로도 안 세는 근거(`ownsAttendanceSlot`). */
      seat_label: string | null;
      /** 그 행을 쓴 문(0212a) — JJ는 라벨이 없어 `"seat"`가 유일한 자리 표식일 수 있다(리뷰 2026-09-12). */
      recorded_via: string | null;
      /** 대신 보강 귀속 강사(0316a) — 있으면 그 강사 몫만(원장 결정 3). 칸이 없는 스키마면 안 읽는다. */
      taught_by?: string | null;
    }>(studentIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select(
          (withTaughtBy ? "student_id, session_date, slot_start, status, note, session_units, seat_label, recorded_via, taught_by" : "student_id, session_date, slot_start, status, note, session_units, seat_label, recorded_via") as "student_id, session_date, slot_start, status, note, session_units, seat_label, recorded_via",
        )
        .eq("class_id", classId)
        .in("student_id", chunk)
        .gte("session_date", startIso)
        .lte("session_date", endIso)
        .order("recorded_at", { ascending: false })
        // id desc = recorded_at 동률 tie-break — 저장(actions `pickSaveTargets`)과 같은 규약. 빗금 칸 입력은 여러 행에
        // 같은 시각을 찍어 동률이 흔해진다(적대 리뷰 2026-09-14). OFFSET 페이지도 흔들리지 않는다(B2).
        .order("id", { ascending: false })
        .range(from, to),
    );

    // 🔴 유효 기록 = (student, date, **교시**)별 최신 1건(0196a). 예전엔 교시를 안 봐서 같은 날
    //    4교시·6교시 중 **한 건만 살아남고 나머지는 화면에서 사라졌다** — 기록은 남아 있는데
    //    출석부만 모른 채 급여·회차는 둘 다 세는, 화면과 돈이 어긋나는 상태였다.
    // 페이지는 같은 order의 슬라이스라 이어붙여도 recorded_at 내림차순이 유지된다(청크는 학생 단위).
    const seen = new Set<string>();
    const byCell = new Map<
      string,
      {
        studentId: string;
        date: string;
        note: string | null;
        /**
         * 같은 날 **남의 교시에 달린 메모** — 제 교시 값이 있는 칸에서 제 메모가 없을 때만 쓴다(아래 접기 주석).
         * ⚠️ 제 교시 값이 없는 칸엔 절대 안 싣는다(그 칸은 남의 기록을 보여 주지 않는다, 원장 2026-09-17).
         */
        otherNote: string | null;
        slots: SlotMark[];
      }
    >();
    for (const r of records) {
      // ⚠️ 날짜로 거르지 않는다 — 보강은 원래 수업 요일이 아닌 날에도 한다(원장 2026-09-17 저녁). 그 대신 **몫**으로 거른다:
      //    아래 `ownsSlot`이 남의 교시·자리 기록을 값에서 뺀다(교시를 안 남긴 기록은 누구 것도 아니라 그대로 실린다).
      const slot = (r.slot_start as string | null) ?? null;
      const k = `${r.student_id}::${r.session_date}::${slot ?? ""}`;
      if (seen.has(k)) continue; // 같은 교시의 옛 정정본(append-only)
      seen.add(k);
      const cellKey = `${r.student_id}::${r.session_date}`;
      const cell =
        byCell.get(cellKey) ??
        {
          studentId: r.student_id,
          date: r.session_date,
          note: null,
          otherNote: null,
          slots: [] as SlotMark[],
        };
      // 시수(배수) — null=기본 1. numeric은 문자열로 올 수 있어 Number 변환.
      const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
      // 주인 몫이면 칸 값(marks/units/slots)으로. 반별 보기는 전부 몫이다(종전과 같은 숫자).
      const mine = ownsSlot(r.session_date, slot, r.seat_label, r.recorded_via, r.taught_by ?? null);
      if (!mine) {
        // 🔴 이 표의 몫이 아닌 교시(다른 선생님 교시·자리 JJ·랩실·담임이 되기 전 기록)는 **보여 주지 않는다**
        //    (원장 2026-09-17 *"말그대로 내가 수업한 학생의 출석만 보고 싶은것"*). 그전엔 빗금 + 흐린 값 + 입력자·메모로
        //    섰다(2026-08-19 · 09-14 · 09-15). 제 교시 기록이 없는 칸은 빈칸이고, 입력하면 제 교시 행이 새로 생긴다.
        // 남의 교시 메모는 **후보로만** 쥔다 — 같은 날 결석 사유("병결")가 다른 교시 행에만 적히는 일이 흔하다(오늘 출결이
        // 첫 교시에 사유를 적고 ECS가 제 교시에 결석만 찍는다). 제 값이 있는 칸에서 제 메모가 없을 때만 보인다.
        // 🔴 자리(JJ·랩실) 행의 메모는 후보가 아니다 — 자리 담당이 적은 메모가 강사 칸에 서면 "jj는 개인강사 출석부에 넣음
        //    안되지"(원장 2026-09-12)와 부딪힌다(적대 재리뷰 2026-09-17). 판정은 저장과 같은 함수(`attendanceSlotShare`).
        if (r.note && attendanceSlotShare(slotInput(r.session_date, slot, r.seat_label, r.recorded_via, r.taught_by ?? null)) !== "seat") {
          const hasReason = stripProxyMemo(r.note as string) !== "";
          if (cell.otherNote === null || (hasReason && stripProxyMemo(cell.otherNote) === "")) {
            cell.otherNote = r.note as string;
          }
        }
        byCell.set(cellKey, cell);
        continue;
      }
      cell.slots.push({
        slot,
        status: r.status as AttendanceStatus,
        units: raw !== null && Number.isFinite(raw) ? raw : null,
      });
      // 메모는 **가장 최근에 찍힌 것** 하나(순회가 recorded_at 내림차순이라 처음 만난 것).
      // ⚠️ 교시마다 메모가 다를 수 있지만 칸이 하나라 다 못 적는다 — 교시별 메모는 영어 수업 시트에서 본다.
      // 🔴 `대신 입력` 줄뿐인 메모는 **사유가 적힌 메모에 자리를 내준다**(원장 2026-09-14 빗금 칸 입력) — 옮기기는 그날
      //    여러 교시 행에 같은 시각으로 그 줄을 붙여서, 먼저 오는 행이 사유("병결")를 가렸다(적대 리뷰 2026-09-14).
      if (r.note) {
        const hasReason = stripProxyMemo(r.note as string) !== "";
        if (cell.note === null || (hasReason && stripProxyMemo(cell.note) === "")) cell.note = r.note as string;
      }
      byCell.set(cellKey, cell);
    }

    // 하루치를 한 칸으로 접는다 — 숫자는 시수 **합**, 색은 대표 상태(cell-display.rollupDay 단일 소스).
    for (const cell of byCell.values()) {
      // 🔴 메모는 **내 교시 메모가 우선**이고, 없으면 같은 날 남의 교시 메모(결석 사유)를 — **제 교시 값이 있는 칸에서만**
      //    보인다(적대 리뷰 2026-09-17: 막으면 내 결석 칸의 사유가 사라진다 · 제 값 없는 칸에 실으면 남의 기록을 보이는 꼴).
      const note = cell.note ?? (cell.slots.length > 0 ? cell.otherNote : null);
      if (note) {
        notes[cell.studentId] ??= {};
        notes[cell.studentId]![cell.date] = note;
      }
      const day = rollupDay(cell.slots);
      // 🔴 주인 몫이 하나도 없는 칸은 **값을 만들지 않는다** — 여기서 0을 실으면 격자·합계·복사
      //    어느 쪽도 0을 제대로 못 읽는다(units 레코드는 0을 안 담는 규약이라 합계가 1로 되살아난다).
      if (!day) continue;
      marks[cell.studentId] ??= {};
      marks[cell.studentId]![cell.date] = day.status as AttendanceStatus;
      /**
       * 교시를 안 남긴 기록이 값에 섞였나 — 강사 보기 + **그 반을 그 달에 둘 이상이 맡을 때** 뜻이 있다(반별 보기는 원래 반 전체,
       * 혼자 맡는 반은 그 값이 남의 화면에 뜨지 않는다).
       * 🔴 **날짜로 좁히지 말 것**(적대 리뷰 2026-09-17 저녁) — 모든 날짜 칸이 열린 뒤로는 어느 날에 찍혀도 교시 없는 행은
       *    그날 그 반을 맡은 다른 강사 화면에 같은 값으로 선다(`ownsAttendanceSlot`은 교시가 없으면 전부 제 몫으로 본다).
       *    '그날 그리는 강사 수'로 세던 조건은 보강(수업 요일 밖)에서 표식을 꺼 **공유 사실을 숨겼다**.
       */
      if (scopeTeacherId && sharedByTeachers && cell.slots.some((x) => x.slot === null)) {
        dayAxis[cell.studentId] ??= {};
        dayAxis[cell.studentId]![cell.date] = true;
      }
      // 기본(1)이면 키 없음 — 종전 규약 그대로. 교시가 여럿이면 합이 들어간다(2교시 출석 = 2).
      // ⚠️ 0(전부 결석)도 키를 만들지 않는다 — 결석 칸의 시수는 원래 없는 값이고, 0을 실으면
      //    격자 값이 `{u:0}`이 되어 복사·붙여넣기가 시수 "0"을 보내 저장이 반려된다(실측 773칸).
      if (day.units !== 1 && day.units > 0) {
        units[cell.studentId] ??= {};
        units[cell.studentId]![cell.date] = day.units;
      }
      if (day.count > 1) {
        slots[cell.studentId] ??= {};
        slots[cell.studentId]![cell.date] = day.slots;
      }
    }
  }

  /**
   * 🔴 **기록 블록 밖**에 둔다(재리뷰 2026-09-15) — 예약자 이름은 출결 기록과 무관한 일이라, 안에 두면
   *    '학생이 하나도 없는 달'처럼 그 블록을 안 타는 경로가 생기는 순간 예약자 이름이 **조용히** 빈 채로 나간다.
   */
  // 예약자 이름 — **한 번에** 묻는다(조회 실패·권한이면 이름만 빠진다, fail-soft).
  const nameIds = [...new Set(reservationCreators.map(([, id]) => id))];
  if (nameIds.length > 0) {
    const names = await getReservationCreatorNames(supabase, nameIds);
    for (const [entry, id] of reservationCreators) {
      const name = names.get(id)?.trim();
      if (name) entry.createdByName = name;
    }
  }

  // ── 수업보고서 파생(2026-07-21 원장 지시) — 수학 반의 **수기 기록이 없는 등원일**만 메운다.
  // 규칙·근거는 derive-from-reports.ts. 여기선 "등원일" 판정을 화면(page.tsx)과 **똑같이** 한다:
  // 학생 등원요일 ∩ 그 달 날짜, 공휴일 제외, 수강 구간 안. 어긋나면 화면과 파생이 서로 다른 말을 한다.
  const selectedClass = classes.find((c) => c.id === classId);
  // 🔴 '수업보고서 미발송' 반(0174a)은 **파생을 통째로 끈다** — 반쪽만 끄면 화면이 거짓말을 한다:
  //    보고서가 영구히 0건이라 '없음=결석'을 그대로 두면 지난 등원일이 전부 결석으로 뒤집히고,
  //    반대로 '출석'만 남기면 통계가 **출석 일방**이 되어 출석률이 100%로 굳는다(둘 다 틀린 숫자).
  //    끄면 수기 기록만 남고, 페이지가 이미 "수업보고서로 자동 표시되는 과목이 아니라서…" 안내를
  //    띄운다(derivedActive=false 분기) — 왜 비었는지가 화면에 그대로 설명된다.
  //    ⚠️ 파생은 **읽기 시점**이라 지워지는 게 아니다. 토글을 끄면 그 즉시 옛 표시가 그대로 돌아온다.
  const derivedActive =
    isDerivedAttendanceSubject(selectedClass?.subject) && selectedClass?.reportOptout !== true;
  if (derivedActive && selectedClass && studentIds.length > 0) {
    const [reports, settings] = await Promise.all([
      // 학생 수 × 최대 31일이라 청크당 1000행을 넘길 여지는 낮지만, 반 인원은 상한이 없다(B2).
      // ⚠️ 반으로 **거르지 않고** 그 달 보고서를 다 가져온 뒤 JS에서 세 갈래로 나눈다
      //    (이 반 것 / 같은 과목 다른 반 것 / 무관). 쿼리를 반으로 좁히면 "짝 반이 썼는지"를
      //    알 수 없어 판정 보류를 못 한다 — 그게 거짓 결석의 원인이었다(아래 sibling 주석).
      fetchAllPagedInChunks<{
        student_id: string;
        report_date: string;
        class_id: string | null;
        makeup: boolean | null;
      }>(
        studentIds,
        (chunk, from, to) => {
          let q = supabase
            .from("lesson_reports")
            .select("student_id, report_date, class_id, makeup")
            .in("student_id", chunk)
            .gte("report_date", startIso)
            .lte("report_date", endIso);
          // 기본은 '작성됨'. 발송 성공만 인정하려면 REQUIRE_SENT_REPORT를 켠다(근거는 그 상수 주석).
          if (REQUIRE_SENT_REPORT) q = q.eq("classnote_status", "success");
          return q
            .order("report_date", { ascending: false })
            .order("id", { ascending: false }) // OFFSET 페이지 안정용 unique tie-break
            .range(from, to);
        },
      ),
      readCtx ? Promise.resolve(readCtx.settings) : getTenantSettings(),
    ]);
    // 🔴 반 단위 분류(0134a) — 세 갈래다:
    //  · 이 반(또는 반 미상 = 이관분·보강·관리자 작성) → **출석 파생 근거**.
    //  · 같은 과목 **다른 반** → 출석도 결석도 아닌 **판정 보류**. 실데이터에 "한 수업, 두 수강행"이
    //    있어 강사는 한 번 가르치고 한 건만 쓴다. 보류가 없으면 짝 반의 그 날짜가 매주 영구히 거짓 결석.
    //  · 그 외 과목 → 무시.
    //
    // 🔴 짝 반 판정을 위 `classes`로 하면 **안 된다** — 그 목록은 강사뷰에서 `teacher_id`로 좁혀져 있다.
    //    실측(2026-07-22) 짝 반은 전부 **다른 강사** 소유였다(JJPS 마수호 ↔ PS2S 이성우, JJ1E 김은정 ↔
    //    JJ1I 이유정). 그래서 좁힌 목록으로 판정하면 **정작 그 화면을 보는 강사에게만** 짝 반이 안 보여
    //    거짓 결석이 그대로 남는다(관리자 화면에서만 고쳐진 것처럼 보인다).
    //    → 보고서에 실제로 붙어 있는 class_id들의 과목을 **직접** 조회한다(테넌트 RLS만 적용, 강사 무관).
    const otherClassIds = [
      ...new Set(
        reports
          .map((r) => r.class_id)
          .filter((c): c is string => !!c && c !== selectedClass.id),
      ),
    ];
    const otherClasses = otherClassIds.length
      ? await fetchInChunks<{ id: string; subject: string | null }>(otherClassIds, (chunk) =>
          supabase.from("classes").select("id, subject").in("id", chunk),
        )
      : [];
    const sameSubjectClassIds = new Set(
      otherClasses.filter((c) => c.subject === selectedClass.subject).map((c) => c.id),
    );
    const reportsByStudent = new Map<string, Set<string>>();
    const siblingByStudent = new Map<string, Set<string>>();
    for (const r of reports) {
      // 🔑 분류는 순수 단일 소스 `reportEvidenceKind`가 한다(보강=보류 규칙과 근거는 그 주석).
      const kind = reportEvidenceKind({
        makeup: r.makeup,
        classId: r.class_id,
        selectedClassId: selectedClass.id,
        sameSubjectClassIds,
      });
      if (kind === "ignore") continue; // 다른 과목 보고서 — 이 출석부와 무관
      const target = kind === "own" ? reportsByStudent : siblingByStudent;
      const set = target.get(r.student_id) ?? new Set<string>();
      set.add(r.report_date);
      target.set(r.student_id, set);
    }
    // 설정을 못 읽어 기본값이면 휴일이 0개다 — 휴일에 쓴 보고서가 '출석'으로 선다. 표는 그대로 그리고 표식만 싣는다.
    const settingsFolded = foldedReason(settings);
    if (settingsFolded) degraded.push(settingsFolded);
    const holidays = buildHolidayMap(settings.operations.holidays);
    const todayIso = kstToday();
    const realDays = days
      .filter((d) => !d.placeholder && !holidays[d.date])
      // 🔴 담임 이전 칸은 이 표의 값이 아니다 — **파생은 `ownsSlot`을 안 탄다**. 수기 기록만 빗금으로
      //    빼고 여기를 안 막으면, 그 날짜가 보고서 파생 '출석'으로 **되살아난다**(JJ2A는 8/3~8/10에
      //    전임이 쓴 보고서가 14건 있어 실제로 그렇게 된다).
      .filter((d) => homeroomHistory?.length || !scopeSince || d.date >= scopeSince)
      // 🔴 **파생만은 그 강사가 수업하는 날에만** 메운다 — 파생은 `ownsSlot`을 안 타므로(수기 기록이 아니라 보고서에서 도출) 안 막으면
      //    안 가르치는 요일이 남의 보고서로 '출석'·'결석'처럼 되살아난다. 입력은 그 날도 열려 있다(사람이 친 값은 위 기록 갈래).
      .filter((d) => !ownDateSet || ownDateSet.has(d.date));

    for (const s of students) {
      const dows = new Set(s.attendDows);
      const ranges = rangesById.get(s.id) ?? [];
      const attendDates = realDays
        .filter((d) => dows.has(d.dow))
        .filter((d) => ranges.some((r) => r.start <= d.date && (!r.end || r.end >= d.date)))
        .map((d) => d.date);
      const got = deriveMarksFromReports({
        attendDates,
        reportDates: reportsByStudent.get(s.id) ?? new Set(),
        siblingReportDates: siblingByStudent.get(s.id),
        manualDates: new Set(Object.keys(marks[s.id] ?? {})),
        today: todayIso,
        // 🔴 '수업보고서 미발송' 반(0174a) — 보고서가 영구히 0건이라 "없음 = 결석"을 적용하면
        //    지난 등원일이 통째로 결석으로 뒤집힌다. 결석 규칙만 끄고 '출석'(기존 보고서)은 살린다.
        reportOptoutClass: selectedClass?.reportOptout === true,
      });
      for (const [date, mark] of Object.entries(got)) {
        marks[s.id] ??= {};
        marks[s.id]![date] = mark;
        derived[s.id] ??= {};
        derived[s.id]![date] = true;
      }
    }
  }

  // 통계는 수기 + 파생을 **합친 뒤** 센다 — 파생만 있는 반이 출석률 0%로 보이면 안 된다.
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let makeupCount = 0;
  let totalRecords = 0;
  for (const byDate of Object.values(marks)) {
    for (const status of Object.values(byDate)) {
      totalRecords++;
      if (status === "present") presentCount++;
      else if (status === "absent") absentCount++;
      else if (status === "late") lateCount++;
      else if (status === "makeup") makeupCount++;
    }
  }

  const englishCells = classId && selectedSubject === "english" ? days.map((d) => ({
    classId, date: d.date,
    starts: scopeTeacherId ? scopeInsertSlots({ homeroomTeacherId, slots: axisSlots }, scopeTeacherId, d.date) : null,
  })) : [];
  const englishAuto = englishCells.length ? await resolveAutoUnits(supabase, englishCells.flatMap((c) =>
    c.starts ? c.starts.map((slotStart) => ({ classId: c.classId, date: c.date, slotStart })) : [{ classId: c.classId, date: c.date }]),
    readCtx ? { tenantId: readCtx.tenantId } : {}) : null;
  const presentRate =
    totalRecords > 0 ? Math.round(attendanceRate(attendedCount({ present: presentCount, late: lateCount }), totalRecords) * 10) / 10 : 0;

  return {
    classes,
    selectedClassId: classId,
    month,
    window: periodWindow,
    days,
    classDows,
    students,
    marks,
    notes,
    units,
    slots,
    ghosts,
    // 강사 보기 — 그리는 날(그 강사가 수업하는 날). 그 밖의 날은 격자가 입력을 막는다.
    ...(ownDateSet ? { ownDates: [...ownDateSet] } : {}),
    dayAxis,
    derived,
    derivedActive,
    // 수학 자동 시수 — 빈 칸 기본값(보이는 기본값 = 저장될 값). 판정은 서버 쓰기와 같은 함수(auto-units.ts).
    // 새 학원(일반판)은 자동 시수가 없다 — 저장(resolveAutoUnits)과 같은 프로필을 본다(보이는 기본값 = 저장될 값).
    ...(isAutoUnitsSubject(selectedSubject) && (readCtx ? lessonProfileOf(readCtx.settings) : await getLessonProfile()).autoUnits
      ? { autoUnits: autoUnitsByDate(days.map((d) => d.date), (schedules ?? []).map(toAutoUnitsSchedule)) }
      : {}),
    ...(englishAuto ? { autoUnits: Object.fromEntries(englishCells.flatMap((c) => {
      const units = c.starts
        ? c.starts.reduce((sum, start) => sum + (englishAuto.get(autoUnitsKey(c.classId, c.date, start)) ?? 1), 0)
        : englishAuto.get(autoUnitsKey(c.classId, c.date));
      return units === undefined || units === 1 ? [] : [[c.date, units]];
    })) } : {}),
    // 보강 예약 칸(0264a) — 있을 때만 싣는다(강사 전체 보기는 반마다 매트릭스라 빈 객체도 곱이 된다).
    ...(Object.keys(reservations).length > 0 ? { reservations } : {}),
    // 수업 나누기 칸(0351a) — 있을 때만(강사 전체 보기는 반마다 매트릭스라 빈 객체도 곱이 된다).
    ...(Object.keys(splitView.marks).length > 0 ? { splits: splitView.marks } : {}),
    ...(degraded.length > 0 ? { degraded } : {}),
    stats: {
      totalStudents: students.filter((st) => !reservedOnlyIds.has(st.id)).length,
      presentRate,
      presentCount,
      absentCount,
      lateCount,
      makeupCount,
      totalRecords,
    },
  };
}

export async function getAttendanceForDate(date: string): Promise<AttendanceRow[]> {
  const supabase = await createClient();
  // B2: 소비처(AI 비서 출결 집계 등)가 length·byStatus로 센다 — 하루 기록이 1000행을 넘으면
  // 무페이징 select는 silent 절단, `!data` 폴백은 에러까지 삼킨다 → fetchAllPaged(throw)로 전건.
  const data = await fetchAllPaged((from, to) =>
    supabase
      .from("attendance_records")
      .select(
        `id, status, student_id, class_id, session_date, slot_start, recorded_at,
         student:student_id ( id, name, grade ),
         class:class_id ( id, class_name, subject )`,
      )
      .eq("session_date", date)
      // OFFSET 페이지 안정화 — unique tie-break(id) 포함 order(batch.ts 계약)
      .order("class_id")
      .order("id")
      .range(from, to),
  );

  // 🔴 정정 줄은 최신 하나만(공용 `effectiveAttendanceRecords`) — 원본 줄을 세면 정정한 칸이 요약·반별 목록에
  //    두 번 잡히고 결석→출석으로 고친 칸이 결석으로 남았다(점검 2026-09-28).
  return effectiveAttendanceRecords(data).map((r) => {
    const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string; grade: string | null }
      | undefined;
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id: string; class_name: string; subject: string }
      | undefined;
    return {
      id: r.id,
      status: r.status,
      studentId: student?.id ?? "",
      studentName: student?.name ?? "?",
      studentGrade: student?.grade ?? null,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
    };
  });
}
