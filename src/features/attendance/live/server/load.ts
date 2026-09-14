import "server-only";
/**
 * 당일 출결 보드 적재 — 강사 화면(오늘 내 수업)과 데스크 큐(오늘 전 반)가 **공유하는 단일 소스**.
 *
 * 두 화면이 서로 다른 명단 규약을 쓰면 "강사 화면엔 12명인데 데스크엔 14명"이 되고, 그 차이가 곧
 * 거짓 전화가 된다. 그래서 예정 명단 판정은 기존 규약(`isEnrollmentActiveOn` + `enrollmentAttendsOnDay`
 * — 처리현황·완료 벨과 같은 함수)을 그대로 쓴다.
 *
 * 성능(B2~B4): 오늘 슬롯 104개·반 43개 규모(실측). 반 id는 청크(`fetchInChunks`, B3), 수강행은
 * 페이지네이션 청크(B2 — 1000행 절단 방지), 서로 독립인 조회는 `Promise.all`(B4).
 */
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { fixedHolidaysForYear } from "@/features/billing/tuition-calc";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { weekdayIndexOf } from "@/lib/date-kst";
import { classifySignal, hhmm, resolveSlotStatus } from "../signals";
import { saveSlotFor } from "../slot-axis";
import { canonicalRoomName, resolveRoomName } from "../seating-floors";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
// 출결 강사 귀속 축 단일 소스(자리는 담임 폴백 금지 · 담당 없으면 담임) — 월간 출석부와 같은 규칙.
import { taughtByForSlot } from "@/features/attendance/teacher-axis";
// 보강 예약(0264a) — 그 교시 칸에 예약된 학생을 미리 세운다(fail-soft, 표 없음 = 없음).
import { getReservationsOn } from "@/features/attendance/server/makeup-reservation-queries";
import type { LiveSlot, LiveStudent } from "../types";

export type { LiveSlot, LiveStudent };

const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * 그날이 쉬는 날이면 이름(아니면 null) — 호출부가 "휴원일입니다"로 화면을 대신 채운다.
 *
 * 🔴 학원설정 `operations.holidays`**만** 보면 안 된다 — 실측(2026-08-14) 그 목록엔 **2건**(둘 다 과거)뿐이라
 *    사실상 비어 있다. 같은 리포의 청구는 법정공휴일을 코드로 갖고 있어(`fixedHolidaysForYear`) **돈 쪽은
 *    쉬는 날로 빼는데** 이 화면만 수업으로 그리면, 8/15·10/3·10/9 같은 날 그날 열리는 슬롯 전체가
 *    "출결 미입력"으로 데스크에 쏟아진다(10/9은 금요일이라 104슬롯 전부).
 * ⚠️ 음력 명절(설·추석)은 양쪽 다 모른다 — **학원설정 휴일에 등록**해야 잡힌다(운영 조건).
 * ⚠️ 학원설정이 이긴다: 법정공휴일이어도 학원이 수업하면 그날을 목록에서 빼는 게 아니라… 반대로
 *    "쉬는 날인데 수업한다"는 표현 수단이 지금 스키마엔 없다. 그런 날은 화면이 비므로 사람이
 *    월별 출석부에서 찍는다(오탐으로 전화가 나가는 것보다 안전한 방향).
 */
export async function holidayNameOf(date: string): Promise<string | null> {
  const settings = await getTenantSettings();
  const named = buildHolidayMap(settings.operations.holidays)[date];
  if (named) return named;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && fixedHolidaysForYear(year).includes(date) ? "공휴일" : null;
}

type SlotRow = {
  class_id: string;
  start_time: string;
  end_time: string | null;
  teacher_id: string | null;
  period_label: string | null;
  slot_teacher_label: string | null;
  classroom_id: string | null;
  slot_room_label: string | null;
};

/**
 * @param classIds 이 반들로 좁힌다(강사 화면). 넘기지 않으면 그날 열리는 **전 활성 반**(데스크).
 */
export async function loadLiveSlots(date: string, classIds?: readonly string[]): Promise<LiveSlot[]> {
  // ⚠️ 아래 `.or()`에 date를 보간하므로 **함수 안에서** 형식을 확정한다(방어선이 호출부에만 있으면
  //    다음 호출부에서 깨진다 — 같은 리포의 setAttendanceCell도 `.or()` 앞에 같은 가드를 둔다).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  // 🔴 **휴원일이면 아무 것도 만들지 않는다.** 시간표는 요일 반복이라 휴원일에도 슬롯이 그대로 살아 있고,
  //    그날 출결은 당연히 비어 있다 — 이 가드가 없으면 설날·개천절에 데스크 큐가 **전교생 미확인**으로
  //    터진다(그리고 그 하루가 이 기능의 신뢰를 끝낸다). 공휴일 단일 소스 = 학원설정 operations.holidays.
  if (await holidayNameOf(date)) return [];

  const supabase = await createClient();
  const dayEnum = DOW_ENUM[weekdayIndexOf(date)];

  // 1) 그 요일·그 날짜에 살아 있는 슬롯. ⚠️ valid_from/valid_to를 반드시 본다 — 행 분할로 이력이
  //    함께 담기는 표라(실측 1,068행 중 480행 만료) 안 걸면 끝난 교시가 오늘 수업으로 뜬다(#88).
  const liveSlotQuery = () =>
    supabase
      .from("class_schedules")
      .select(
        "class_id, start_time, end_time, teacher_id, period_label, slot_teacher_label, classroom_id, slot_room_label",
      )
      .eq("day_of_week", dayEnum)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`);

  let slots: SlotRow[];
  if (classIds) {
    if (classIds.length === 0) return [];
    // ⚠️ 담당 반이 수십 개면 단일 `.in()`이 414로 죽는다 → 청크(B3). 에러는 헬퍼가 throw(삼키지 않음).
    slots = await fetchInChunks<SlotRow>([...classIds], (chunk) => liveSlotQuery().in("class_id", chunk));
  } else {
    // ⚠️ 데스크(전 반) 경로는 페이지네이션으로 받는다 — 이 결과로 **총 교시·예정 인원을 센다**(B2).
    //    무페이징이면 1000행에서 **에러 없이 잘려** 큐가 조용히 일부 반을 빼먹는다. 오늘은 104행이라
    //    당장은 안 걸리지만, 조용한 절단은 걸리는 날 원인을 못 찾는 종류의 버그다.
    //    ⚠️ OFFSET 페이징은 정렬이 흔들리면 행이 겹치거나 빠진다 → **유니크 tie-break(`id`)로 정렬**한다
    //       (select에 없는 컬럼으로도 정렬된다 — 화면 정렬은 뒤에서 따로 한다).
    slots = await fetchAllPaged<SlotRow>((from, to) => liveSlotQuery().order("id").range(from, to));
  }
  if (slots.length === 0) return [];

  const slotClassIds = [...new Set(slots.map((s) => s.class_id))];

  // 2) 반 메타(활성만) + 그 반들의 수강행 + 그날 출결 — 서로 독립이라 병렬(B4).
  const [classRows, enrollRows, recordRows, reservedRaw] = await Promise.all([
    fetchInChunks<{
      id: string;
      class_name: string;
      subject: string;
      is_active: boolean;
      closed_at: string | null;
      teacher_id: string | null;
      classroom_id: string | null;
    }>(slotClassIds, (chunk) =>
      supabase
        .from("classes")
        // ⚠️ `report_optout`은 **일부러 안 읽는다** — 당일 출결 보드는 미발송 반도 그대로 그린다(아래 🔴).
        //    읽어 두면 다음 사람이 "여기도 걸러야 하나"로 되돌리기 쉽다.
        .select("id, class_name, subject, is_active, closed_at, teacher_id, classroom_id")
        .in("id", chunk)
        .eq("is_active", true),
    ),
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      start_date: string | null;
      end_date: string | null;
      on_hold: boolean | null;
      is_transferred: boolean | null;
      attendance_days: string[] | null;
    }>(slotClassIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days")
        .in("class_id", chunk)
        .lte("start_date", date)
        .order("student_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      session_date: string;
      slot_start: string | null;
      status: string;
      recorded_at: string;
      recorded_by: string | null;
      note: string | null;
    }>(slotClassIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        // `recorded_by` = **누가 눌렀나**(귀속이 아니라 입력자다 — 축은 teacher-axis가 따로 정한다).
        // 좌석표가 "담임 아닌 사람이 찍었으면 그 이름을 붙인다"에 쓴다(원장 2026-08-21).
        .select("id, class_id, student_id, session_date, slot_start, status, recorded_at, recorded_by, note")
        .eq("session_date", date)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // 그날 보강 예약(0264a, fail-soft) — 독립 조회라 함께 달린다(B4). 반 집합은 아래 activeClasses로 다시 거른다.
    getReservationsOn(date, slotClassIds),
  ]);

  const activeClasses = new Map(
    classRows.filter((c) => !c.closed_at || c.closed_at >= date).map((c) => [c.id, c]),
  );
  if (activeClasses.size === 0) return [];

  /**
   * 그날 **보강 예약**(0264a) — 예약된 학생을 **그 교시 칸**에만 미리 세운다(원장 2026-09-14 *"보강 추가 할 필요없이
   * 미리 학생이 추가되어있어야"*). 반 전체 명단(`expectedByClass`)엔 넣지 않는다 — 그러면 그 반의 다른 교시에도
   * 서고 처리현황 분모까지 는다. 이 반이 그날 도는 교시 중 예약 시각과 같은 칸이 없으면(토요일 보강 등) 이 보드엔
   * 자리가 없다(일별 출석부·원스크린이 그 학생을 세운다 — 알려진 한계).
   * 조회는 fail-soft(표 없음 = 예약 없음). 예약된 학생의 이름도 아래 학생 메타 조회에 함께 넣는다.
   */
  const reservedToday = reservedRaw.filter((r) => activeClasses.has(r.classId));
  const reservedBySlot = new Map<string, Map<string, { absenceDate: string; periodLabel: string | null }>>();
  for (const r of reservedToday) {
    const key = `${r.classId}|${r.slotStart}`;
    const m = reservedBySlot.get(key) ?? new Map<string, { absenceDate: string; periodLabel: string | null }>();
    if (!m.has(r.studentId)) m.set(r.studentId, { absenceDate: r.absenceDate, periodLabel: r.periodLabel });
    reservedBySlot.set(key, m);
  }

  // 3) 그 날짜 예정 명단(반별) — 처리현황·완료 벨과 **같은 규약**.
  const expectedByClass = new Map<string, Set<string>>();
  for (const e of enrollRows) {
    if (!activeClasses.has(e.class_id)) continue;
    // 시작일이 비어 있는 레거시 행은 "언제부터인지 모른다" — 조회에서 이미 `start_date <= date`로 좁혔고,
    // 판정 함수는 문자열 비교를 하므로 빈 값이면 항상 참이 되게 둔다(옛 행을 명단에서 떨구지 않는다).
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date ?? "0000-01-01",
          endDate: e.end_date,
          onHold: e.on_hold ?? false,
          isTransferred: e.is_transferred === true,
        },
        date,
      ) ||
      !enrollmentAttendsOnDay(e.attendance_days, dayEnum)
    ) {
      continue;
    }
    const set = expectedByClass.get(e.class_id) ?? new Set<string>();
    set.add(e.student_id);
    expectedByClass.set(e.class_id, set);
  }

  // 4) 유효 출결 — (학생·반·날짜·교시)별 최신 정정만. 교시별/그날전체 두 세대를 각각 색인.
  //
  // 🔴 **예정 명단에 있는 학생의 기록만 센다.** `hasAnyRecord`(레인 A↔B를 가르는 근거)를 "그 반에
  //    아무 행이나 있는가"로 잡으면, 보강 한 줄·키오스크 한 줄·옛 정정 한 줄만으로 그 반이 통째로
  //    "강사가 출석부를 열었다"로 뒤집히고 **나머지 11명이 전원 학부모 전화 대상**이 된다 —
  //    이 설계가 막으려던 바로 그 홍수다(적대 리뷰 M3).
  const expectedInClass = (classId: string, studentId: string) =>
    expectedByClass.get(classId)?.has(studentId) ?? false;
  const effective = effectiveAttendanceRecords(recordRows).filter((r) =>
    expectedInClass(r.class_id, r.student_id),
  );
  type RecordHit = {
    status: string;
    note: string | null;
    recordedAt: string;
    recordedBy: string | null;
    slot: string | null;
  };
  const bySlot = new Map<string, RecordHit>();
  const byDay = new Map<string, RecordHit>();
  const slotHasRecord = new Set<string>(); // `${classId}|${slot}`
  const dayHasRecord = new Set<string>(); // classId
  for (const r of effective) {
    const hit: RecordHit = {
      status: r.status,
      note: r.note,
      recordedAt: r.recorded_at,
      recordedBy: r.recorded_by,
      slot: r.slot_start ? hhmm(r.slot_start) : null,
    };
    if (r.slot_start) {
      const slot = hhmm(r.slot_start);
      bySlot.set(`${r.class_id}|${slot}|${r.student_id}`, hit);
      slotHasRecord.add(`${r.class_id}|${slot}`);
    } else {
      byDay.set(`${r.class_id}|${r.student_id}`, hit);
      dayHasRecord.add(r.class_id);
    }
  }

  // 5) 학생 메타 + 강의실 이름 — 서로 독립이라 병렬(B4). 보강 예약된 학생(수강생이 아닐 수 있다)의 이름도 함께.
  const studentIds = [
    ...new Set([
      ...[...expectedByClass.values()].flatMap((s) => [...s]),
      ...reservedToday.map((r) => r.studentId),
    ]),
  ];
  const [students, rooms] = await Promise.all([
    fetchInChunks<{
      id: string;
      name: string;
      english_name: string | null;
      school: string | null;
      grade: string | null;
      parent_phone: string | null;
      student_phone: string | null;
    }>(studentIds, (chunk) =>
      supabase
        .from("students")
        .select("id, name, english_name, school, grade, parent_phone, student_phone")
        .in("id", chunk),
    ),
    // 🔴 **테넌트 강의실 전건**(id 스코프 아님, 실측 23행). 이름 표를 다 들고 있어야 시트가 넣은
    //    맨숫자 라벨(`302`)을 등록된 이름(`본원302`)으로 맞출 수 있다(canonicalRoomName) — id로만
    //    좁히면 FK가 빈 슬롯엔 맞출 근거가 없다. 보관(archived_at)된 방도 포함해야 옛 배치가 읽힌다.
    //    ⚠️ 전건이라 무페이징 select 금지(B2) — 이름 표는 whitelist로 쓰인다.
    fetchAllPaged<{ id: string; name: string }>((from, to) =>
      supabase.from("classrooms").select("id, name").order("id").range(from, to),
    ),
  ]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));
  const roomNames = rooms.map((r) => r.name);

  // 6) 슬롯 × 학생 조립.
  const out: LiveSlot[] = [];
  for (const slot of slots) {
    const klass = activeClasses.get(slot.class_id);
    if (!klass) continue;
    // 🔴 '수업보고서 미발송' 반(0174a)을 **여기서 빼지 않는다**(2026-08-19 원장: *"보고서는 안보내지만
    //    이제부터라도 출결은 찍을것"*). 예전엔 `isReportOptout(klass)`로 건너뛰어, 담임이 원스크린에서도
    //    (반이 통째로 빠짐) 데스크가 이 보드에서도 그 반 출결을 찍을 수 없었다 — 실측 3반 전 기간 0행.
    //    보고서 쪽 제외는 보고서 표면들이 계속 맡는다(작성률·재촉·직접 발송, report-optout-surfaces.test).
    // 랩실·JJ실은 출결이 되므로 좌석표에 남긴다. 다만 담임으로 폴백하면 강사 스트립의
    // 「전원 출석」이 자리 수업에 행을 만든다 — teacher_id는 슬롯 담당만(없으면 담당 미지정).
    const special = specialSlotLabel(slot.slot_teacher_label);
    const start = hhmm(slot.start_time);
    // 그 교시에 예약된 보강 학생(0264a) — 정규 명단 뒤에 붙인다(수강생이면 정규 명단에 이미 있어 표식만 붙는다).
    const reservedHere = reservedBySlot.get(`${slot.class_id}|${start}`);
    const expected = new Set<string>([...(expectedByClass.get(slot.class_id) ?? []), ...(reservedHere?.keys() ?? [])]);
    if (expected.size === 0) continue; // 명단 0명 = 보여줄 것이 없다
    // "이 교시에 기록이 있나" — 교시별 기록이 있거나, 그날 전체 기록이 있으면 강사가 손을 댄 것이다.
    const hasAnyRecord = slotHasRecord.has(`${slot.class_id}|${start}`) || dayHasRecord.has(slot.class_id);

    const rows: LiveStudent[] = [];
    for (const sid of expected) {
      const meta = studentById.get(sid);
      if (!meta) continue;
      // 교시별 기록이 먼저, 없으면 "그날 전체" 기록(두 세대 공존 — 0196a). 메모도 그 행의 것을 따라간다.
      const hit =
        bySlot.get(`${slot.class_id}|${start}|${sid}`) ?? byDay.get(`${slot.class_id}|${sid}`) ?? null;
      const status = resolveSlotStatus(hit?.status, null);
      rows.push({
        studentId: sid,
        studentName: meta.name,
        englishName: meta.english_name ?? null,
        schoolGrade: schoolGradeLabel(meta.school, meta.grade) || null,
        parentPhone: meta.parent_phone,
        studentPhone: meta.student_phone,
        status,
        note: hit?.note ?? null,
        recordSlot: hit?.slot ?? null,
        recordedAt: hit?.recordedAt ?? null,
        // 이름은 호출부가 채운다(teacherName과 같은 이유 — 사용자 조회를 화면당 1회로 모은다).
        recordedBy: hit?.recordedBy ?? null,
        recordedByName: null,
        signal: classifySignal(status, hasAnyRecord),
        // 보강 예약(0264a) 표식 — 좌석표가 이름 옆에 '보강 예약'을 붙이고, 그 근거를 hover에 적는다.
        ...(reservedHere?.has(sid) ? { reservedMakeup: reservedHere.get(sid)! } : {}),
      });
    }
    rows.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));

    out.push({
      key: `${slot.class_id}@${start}`,
      classId: slot.class_id,
      className: klass.class_name,
      subject: klass.subject,
      slotStart: start,
      // 저장 축은 과목이 정한다 — 화면은 교시로 그리되 수학은 "그날 전체"로 쓴다(slot-axis.ts).
      saveSlot: saveSlotFor(klass.subject, start),
      slotEnd: slot.end_time ? hhmm(slot.end_time) : null,
      periodLabel: slot.period_label,
      // 슬롯 담당이 지정된 건 542개 중 207개(38%)뿐 — 나머지는 반 담임으로 폴백해야 "선생님별"이 성립한다.
      // 🔴 판정은 `teacher-axis`가 단일 소스다(2026-08-18) — 여기에 규칙을 다시 적지 말 것.
      teacherId: taughtByForSlot({
        homeroomTeacherId: klass.teacher_id,
        slot: { teacherId: slot.teacher_id, slotTeacherLabel: slot.slot_teacher_label },
      }).teacherId,
      slotTeacherLabel: slot.slot_teacher_label,
      teacherName: null, // 이름은 호출부가 채운다(사용자 조회를 화면당 1회로 모으기 위해)
      // 🔴 라벨 폴백은 **등록된 강의실 이름으로 맞춘 뒤** 내보낸다 — `302`가 그대로 나가면 층 묶음이
      //    `본원 3층`에서 갈라지고(`roomGroupOf`가 건물을 못 읽는다), 같은 방인데 이름이 둘이라
      //    `spanAdjacentEnd`의 "방이 바뀌면 끊는다"도 연강을 잘못 끊는다.
      roomName:
        canonicalRoomName(
          resolveRoomName({
            slotClassroomName: slot.classroom_id ? (roomNameById.get(slot.classroom_id) ?? null) : null,
            slotRoomLabel: slot.slot_room_label,
            classClassroomName: klass.classroom_id ? (roomNameById.get(klass.classroom_id) ?? null) : null,
          }),
          roomNames,
        ) ?? (special === "LAB" ? "랩실" : special === "JJ" ? "JJ실" : null),
      students: rows,
      hasAnyRecord,
      recordedCount: rows.filter((r) => r.status != null).length,
    });
  }

  out.sort((a, b) => (a.slotStart === b.slotStart ? a.className.localeCompare(b.className, "ko") : a.slotStart < b.slotStart ? -1 : 1));
  return out;
}
