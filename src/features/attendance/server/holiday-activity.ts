import "server-only";
/**
 * **휴원일에 실제로 입력된 출결·보강 예약** — 날짜 기준 읽기 전용 조회(2026-10-03 운영점검 합의 A01).
 *
 * 학원설정 휴원일에는 오늘 출결(좌석표·확인 큐)도 처리 현황(예정 분모·완료율)도 만들지 않는다. 그런데 그날 수업을 하고
 * 찍은 출결이 있으면 한쪽 화면은 "5/22명", 다른 화면은 "수업 없음"이라 말했다. 이 조회는 **분모 없이 사실만** 센다:
 * 입력된 학생 수 · 반 수 · 보강 예약 건수와 반별 목록. 오늘 출결 휴원일 화면 · 출석부 요약 · 운영실 · 강사 출결 모드가
 * 같은 함수를 읽어 같은 숫자를 말한다.
 *
 * 🔴 `session_date`(예약은 `makeup_date`)로 **직접** 읽는다 — 요일 시간표·예정 명단·지금 수강 여부로 거르지 않는다.
 *    요일 슬롯이 없는 반의 기록·정규 교시가 없는 시각의 보강도 빠지지 않는다.
 * 🔴 **일반 큐를 되살리지 않는다** — 여기서 나온 기록·예약을 근거로 반 전체의 미입력 명단을 만들지 않는다(읽기 전용).
 * 🔴 강사 범위는 **앱에서** 건다 — `attendance_records`·`makeup_reservations`의 RLS는 지점 단위라, 좁히지 않으면
 *    강사가 남의 반 이름·학생 이름을 본다(#77). 반 집합은 좌석표와 같은 함수(`liveTeacherClassIds`, 요일 무관).
 * 🔴 조회 실패를 0건으로 삼키지 않는다(throw) — "입력 0명"이 사실처럼 보이면 안 된다. 호출부가 실패를 따로 그린다.
 *    예외는 보강 예약 조회뿐(표 없음·실패 = 예약 없음, 기존 fail-soft 규약).
 * ⚠️ 연락처·메모는 select에도 없다. 테스트 학생은 오늘 출결·처리 현황과 같은 규칙으로 뺀다.
 * ⚠️ 쓰기 0 · 마이그레이션 0 · 알림 0.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTestStudentIds } from "@/features/students/server/test-students";
import { liveTeacherClassIds } from "@/features/attendance/live/server/scope";
import { getReservationsOn, getReservationsOnDate } from "./makeup-reservation-queries";
import { foldHolidayActivity, type HolidayActivity, type HolidayRecordRow } from "../holiday-activity";

export type ScopedHolidayActivity = HolidayActivity & {
  /**
   * 지점 전체를 본 결과인가 — 강사 범위(실 강사·겸직 강사뷰·'다른 강사 뷰')면 false.
   * 🔴 일별 출석부 링크는 **true일 때만** 건다: 일별 출석부의 기록 목록은 강사 범위로 좁혀지지 않으므로
   *    강사 화면에서 그리로 보내면 범위가 넓어진다. 강사의 입력·확인 경로는 월별 출석부다.
   */
  officeScope: boolean;
};

const RECORD_SELECT = "id, class_id, student_id, session_date, slot_start, status, recorded_at";

const empty = (date: string, officeScope: boolean): ScopedHolidayActivity => ({
  date,
  students: 0,
  classes: 0,
  cells: 0,
  reservations: 0,
  excludedTestCells: 0,
  rows: [],
  officeScope,
});

/**
 * @param selfOnly 권한과 무관하게 **내 수업만** — 강사 출결 모드처럼 화면의 성격이 정한다(`getLiveBoard`와 같은 뜻).
 * @param subject 과목으로 좁힌다(출석부 요약의 과목 필터). null = 전 과목.
 *
 * React `cache` — 한 요청에서 같은 (날짜·범위·과목)을 다시 물으면 조회를 재사용한다(인자가 원시값이라 키가 맞는다).
 */
export const getHolidayDayActivity = cache(async function getHolidayDayActivity(
  date: string,
  selfOnly: boolean = false,
  subject: string | null = null,
): Promise<ScopedHolidayActivity> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty(date, false);
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return empty(date, false);
  const level = await accessLevelTenant(user.systemRole, "attendance");
  if (level === "none") return empty(date, false);

  const supabase = await createClient();
  // 범위 판정은 좌석표(`getLiveBoard`)와 같은 식 — 강사(scoped)·내 수업만 = 그 강사, '다른 강사 뷰'·겸직 강사뷰 = 그 강사.
  const viewTeacherId = await effectiveTeacherId();
  const scopedTeacherId = level === "scoped" || selfOnly ? (viewTeacherId ?? user.id) : viewTeacherId;
  const officeScope = !scopedTeacherId;
  const classIds = scopedTeacherId ? await liveTeacherClassIds(supabase, scopedTeacherId, date) : null;
  if (classIds && classIds.length === 0) return empty(date, false);

  // 그날 출결 · 그날 보강 예약 · 테스트 학생 — 서로 독립이라 병렬(B4). 출결은 페이징(B2), 강사 범위는 청크 × 페이징(B3).
  const [records, reservations, testStudentIds] = await Promise.all([
    classIds
      ? fetchAllPagedInChunks<HolidayRecordRow>(classIds, (chunk, from, to) =>
          supabase
            .from("attendance_records")
            .select(RECORD_SELECT)
            .eq("session_date", date)
            .in("class_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : fetchAllPaged<HolidayRecordRow>((from, to) =>
          supabase
            .from("attendance_records")
            .select(RECORD_SELECT)
            .eq("session_date", date)
            .order("id", { ascending: true })
            .range(from, to),
        ),
    classIds ? getReservationsOn(date, classIds) : getReservationsOnDate(date),
    // 조회 실패 = 빈 집합(아무도 안 뺀다) — 테스트 기록이 섞여 보일 뿐이라 fail-open이 안전하다.
    getTestStudentIds(supabase),
  ]);

  // 이름을 붙일 반·학생 — 실제로 화면에 설 것만(테스트 학생 제외). 둘은 독립이라 병렬(B4), id는 청크(B3).
  const shownRecords = records.filter((r) => !testStudentIds.has(r.student_id));
  const shownReservations = reservations.filter((r) => !testStudentIds.has(r.studentId));
  const wantedClassIds = [...new Set([...records.map((r) => r.class_id), ...shownReservations.map((r) => r.classId)])];
  const wantedStudentIds = [
    ...new Set([...shownRecords.map((r) => r.student_id), ...shownReservations.map((r) => r.studentId)]),
  ];
  const [classRows, studentRows] = await Promise.all([
    // 활성 여부로 거르지 않는다 — 보이지 않는 '보강' 반·그날 뒤 종강한 반의 기록도 그날의 사실이다.
    fetchInChunks<{ id: string; class_name: string | null; subject: string | null }>(wantedClassIds, (chunk) =>
      supabase.from("classes").select("id, class_name, subject").in("id", chunk),
    ),
    fetchInChunks<{ id: string; name: string | null }>(wantedStudentIds, (chunk) =>
      supabase.from("students").select("id, name").in("id", chunk),
    ),
  ]);

  const activity = foldHolidayActivity({
    date,
    records,
    reservations: reservations.map((r) => ({
      id: r.id,
      classId: r.classId,
      studentId: r.studentId,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
    })),
    testStudentIds,
    classScope: classIds ? new Set(classIds) : null,
    subject,
    classById: new Map(
      classRows.map((c) => [c.id, { className: c.class_name ?? "", subject: String(c.subject ?? "") }]),
    ),
    studentNameById: new Map(studentRows.flatMap((s) => (s.name ? [[s.id, s.name] as const] : []))),
  });
  return { ...activity, officeScope };
});
