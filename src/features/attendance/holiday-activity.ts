/**
 * **휴원일에 실제로 입력된 것** 접기 — 순수(Vitest). 조회는 [`server/holiday-activity.ts`](./server/holiday-activity.ts).
 *
 * 학원설정 휴원일에는 예정 명단·확인 큐·처리 현황(분모·완료율)을 만들지 않는다. 그래도 그날 수업을 하고 찍은
 * 출결·잡아 둔 보강 예약은 **사실**이라 화면에서 사라지면 안 된다 — 이 모듈이 그 사실만 날짜 기준으로 센다.
 *
 * 🔴 세는 축에 **이름을 따로 붙인다**(합의 2026-10-03): `students` = 학생 수(반이 달라도 한 사람은 한 번) ·
 *    `classes` = 반 수 · `cells` = 유효 출결 칸 수(교시마다 한 칸 — 일별 출석부 '전체 N건'과 같은 축).
 *    영어는 교시마다 한 행이고 정정도 행으로 쌓여서, 원본 행 수를 '명'이라 적으면 숫자가 부푼다.
 * 🔴 **분모가 없다.** 예정 인원·완료율·'완료'를 여기서 만들지 않는다(22명 중 5명만 찍힌 날을 100%로 읽게 된다).
 * 🔴 정정 줄은 최신 하나만 — 판정을 새로 짓지 않고 공용 `effectiveAttendanceRecords`를 그대로 쓴다.
 * 🔴 연락처를 받지도 싣지도 않는다(좌석표가 연락처를 지우는 것과 같은 이유 — 읽기 전용 목록에 쓸 일이 없다).
 * ⚠️ 테스트 학생(`is_test`)은 오늘 출결·처리 현황과 같은 규칙으로 뺀다. 일별 출석부는 테스트 학생을 빼지 않으므로
 *    뺀 칸 수(`excludedTestCells`)를 함께 돌려줘 화면이 그 차이를 문구로 밝힌다.
 */
import { effectiveAttendanceRecords } from "./effective-records";

/** 그날 출결 원본 한 줄(연락처·메모 없음). */
export type HolidayRecordRow = {
  id: string;
  class_id: string;
  student_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  recorded_at: string;
};

/** 그날 보강 예약 한 줄(예약 상태만). */
export type HolidayReservationRow = {
  id: string;
  classId: string;
  studentId: string;
  slotStart: string;
  slotEnd: string;
};

export type HolidayActivityStudent = {
  studentId: string;
  /** 표시 이름 — 못 찾으면 null(화면이 raw id를 내보내지 않게). */
  name: string | null;
  /** 그 반에서 그날 찍힌 상태들(교시 순, 중복 제거). */
  statuses: string[];
};

export type HolidayActivityReservation = {
  id: string;
  studentId: string;
  name: string | null;
  slotStart: string;
  slotEnd: string;
};

export type HolidayActivityClass = {
  classId: string;
  className: string | null;
  subject: string | null;
  students: HolidayActivityStudent[];
  reservations: HolidayActivityReservation[];
};

export type HolidayActivity = {
  date: string;
  /** 출결이 입력된 학생 수(중복 제거). */
  students: number;
  /** 출결이 입력된 반 수. */
  classes: number;
  /** 유효 출결 칸 수(학생·반·교시별 최신 정정 한 줄) — 일별 출석부 '전체 N건'과 같은 축. */
  cells: number;
  /** 보강 예약 건수(예약 상태). */
  reservations: number;
  /** 테스트 학생이라 세지 않은 유효 출결 칸 수 — 0보다 크면 일별 출석부의 건수와 그만큼 다르다. */
  excludedTestCells: number;
  /** 반별 읽기 전용 목록(반 이름순). 출결이 없고 예약만 있는 반도 선다. */
  rows: HolidayActivityClass[];
};

/** 화면 요약용 숫자만(운영실 스냅샷·출석부 요약) — 이름·목록 없이. */
export type HolidayActivityCounts = Pick<HolidayActivity, "students" | "classes" | "reservations">;

export const hasHolidayActivity = (a: HolidayActivityCounts | null | undefined): boolean =>
  !!a && (a.students > 0 || a.reservations > 0);

const slotKey = (slot: string | null) => (slot ? String(slot).slice(0, 5) : "");

export function foldHolidayActivity(input: {
  date: string;
  records: readonly HolidayRecordRow[];
  reservations: readonly HolidayReservationRow[];
  /** 테스트 학생 id — 못 읽었으면 빈 집합(아무도 안 뺀다, fail-open). */
  testStudentIds: ReadonlySet<string>;
  /** 강사 범위면 그 강사가 가르치는 반. null = 지점 전체(사무실). */
  classScope: ReadonlySet<string> | null;
  /** 과목으로 좁힐 때(출석부 요약의 과목 필터). null = 전 과목. 반 과목을 모르면(메타 없음) 좁힐 때 뺀다. */
  subject?: string | null;
  classById: ReadonlyMap<string, { className: string; subject: string }>;
  studentNameById: ReadonlyMap<string, string>;
}): HolidayActivity {
  const inScope = (classId: string) => {
    if (input.classScope && !input.classScope.has(classId)) return false;
    if (input.subject) return input.classById.get(classId)?.subject === input.subject;
    return true;
  };

  // 날짜가 다른 줄은 버린다(조회가 날짜로 좁히지만, 접는 쪽에서도 한 번 더 — 호출부 실수로 다른 날이 섞이지 않게).
  const effective = effectiveAttendanceRecords(
    input.records.filter((r) => String(r.session_date).slice(0, 10) === input.date && inScope(r.class_id)),
  );
  const visible = effective.filter((r) => !input.testStudentIds.has(r.student_id));

  const byClass = new Map<string, Map<string, { slot: string; status: string }[]>>();
  for (const r of visible) {
    const students = byClass.get(r.class_id) ?? new Map<string, { slot: string; status: string }[]>();
    const marks = students.get(r.student_id) ?? [];
    marks.push({ slot: slotKey(r.slot_start), status: r.status });
    students.set(r.student_id, marks);
    byClass.set(r.class_id, students);
  }

  const reservedByClass = new Map<string, HolidayReservationRow[]>();
  const seenReservation = new Set<string>();
  for (const r of input.reservations) {
    if (seenReservation.has(r.id) || !inScope(r.classId) || input.testStudentIds.has(r.studentId)) continue;
    seenReservation.add(r.id);
    (reservedByClass.get(r.classId) ?? reservedByClass.set(r.classId, []).get(r.classId)!).push(r);
  }

  const nameOf = (id: string) => input.studentNameById.get(id) ?? null;
  const byName = (a: { name: string | null; studentId: string }, b: { name: string | null; studentId: string }) =>
    (a.name ?? "").localeCompare(b.name ?? "", "ko") || a.studentId.localeCompare(b.studentId);

  const rows: HolidayActivityClass[] = [...new Set([...byClass.keys(), ...reservedByClass.keys()])].map((classId) => {
    const meta = input.classById.get(classId);
    const students = [...(byClass.get(classId) ?? new Map<string, { slot: string; status: string }[]>())]
      .map(([studentId, marks]) => ({
        studentId,
        name: nameOf(studentId),
        statuses: [...new Set([...marks].sort((a, b) => a.slot.localeCompare(b.slot)).map((m) => m.status))],
      }))
      .sort(byName);
    const reservations = (reservedByClass.get(classId) ?? [])
      .map((r) => ({ id: r.id, studentId: r.studentId, name: nameOf(r.studentId), slotStart: r.slotStart, slotEnd: r.slotEnd }))
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart) || byName(a, b));
    return { classId, className: meta?.className ?? null, subject: meta?.subject ?? null, students, reservations };
  });
  rows.sort(
    (a, b) => (a.className ?? "").localeCompare(b.className ?? "", "ko") || a.classId.localeCompare(b.classId),
  );

  return {
    date: input.date,
    students: new Set(visible.map((r) => r.student_id)).size,
    classes: byClass.size,
    cells: visible.length,
    reservations: seenReservation.size,
    excludedTestCells: effective.length - visible.length,
    rows,
  };
}

/** 목록 없이 숫자만 — 클라이언트로 내려가는 요약(운영실 스냅샷·출석부 요약)에는 이름을 싣지 않는다. */
export function holidayActivityCounts(a: HolidayActivity): HolidayActivityCounts {
  return { students: a.students, classes: a.classes, reservations: a.reservations };
}
