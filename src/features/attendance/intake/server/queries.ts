import "server-only";
/**
 * 결석 통보 접수 — **미리보기 조립**(저장 전에 "어느 반 몇 칸"을 눈으로 확인시키는 자리).
 *
 * 🔴 이 함수는 저장 액션도 **다시 부른다**. 화면이 보낸 칸 목록을 그대로 믿지 않고 서버가 같은 규칙으로
 *    재계산해 교집합만 저장한다(화면 조건은 게이트가 아니다 — #77). 클라가 보낼 수 있는 건 "이 칸은 빼자"
 *    (exclude)뿐이라, 위조해도 **더 적게** 저장될 뿐이다.
 * ⚠️ 이미 기록이 있는 칸도 목록에서 **빼지 않는다** — 빼면 "출석으로 잘못 찍힌 칸"을 접수로 못 고친다.
 *    대신 현재 상태를 함께 실어 화면이 "이미 결석"·"출석으로 입력됨"을 구분해 보이게 한다([[#103]] 계열:
 *    값 적용만 건너뛰고 목록에서는 빼지 말 것).
 */
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "../../calendar";
import { effectiveAttendanceRecords } from "../../effective-records";
import {
  INTAKE_MAX_CELLS,
  INTAKE_MAX_RANGE_DAYS,
  buildAbsenceCells,
  cellKey,
  expandDateRange,
  hhmm,
  isYmd,
  type IntakeCell,
  type IntakeEnrollment,
  type IntakeSlot,
} from "../absence-intake";

export type IntakeExisting = { status: string; note: string | null; slotStart: string | null };

export type IntakePreviewCell = IntakeCell & {
  key: string;
  teacherName: string | null;
  /** 이 칸에 이미 있는 유효 기록(없으면 null). 화면이 "이미 결석"·"출석으로 입력됨"을 구분한다. */
  existing: IntakeExisting | null;
};

export type IntakePreview = {
  student: { id: string; name: string; label: string } | null;
  cells: IntakePreviewCell[];
  /** 화면에 그대로 띄울 한글 사유(정상이면 null) — raw 코드·영문 원문을 내보내지 않는다. */
  error: string | null;
};

const EMPTY: IntakePreview = { student: null, cells: [], error: null };

export async function loadIntakePreview(input: {
  studentId: string;
  from: string;
  to: string;
}): Promise<IntakePreview> {
  const { studentId } = input;
  if (!studentId) return EMPTY;
  if (!isYmd(input.from) || !isYmd(input.to)) return { ...EMPTY, error: "날짜를 확인해 주세요" };
  if (input.to < input.from) return { ...EMPTY, error: "종료일이 시작일보다 빠릅니다" };

  const dates = expandDateRange(input.from, input.to);
  if (dates.length === 0) {
    return { ...EMPTY, error: `한 번에 접수할 수 있는 기간은 최대 ${INTAKE_MAX_RANGE_DAYS}일입니다` };
  }

  const supabase = await createClient();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;

  // 학생 + 그 기간과 겹치는 수강행 + 학원설정(공휴일) — 서로 독립이라 병렬(B4).
  const [studentRes, enrollRes, settings] = await Promise.all([
    supabase.from("students").select("id, name, school, grade").eq("id", studentId).maybeSingle(),
    // ⚠️ `start_date`는 **NULL일 수 있다** — `.lte("start_date", to)`만 걸면 그 행이 통째로 빠져
    //    "수업이 없다"로 보인다(setAttendanceCell의 수강 판정도 같은 이유로 `.or`를 쓴다).
    supabase
      .from("enrollments")
      .select("class_id, start_date, end_date, on_hold, attendance_days")
      .eq("student_id", studentId)
      .or(`start_date.is.null,start_date.lte.${to}`)
      .or(`end_date.is.null,end_date.gte.${from}`),
    getTenantSettings(),
  ]);

  // 🔴 조회 실패를 "없음"으로 접지 않는다 — 그러면 화면이 "그 기간에 수업이 없습니다"라고 **거짓말**을
  //    하고 데스크는 접수를 포기한다([[#89]] 계열: 삼켜지는 실패 경로를 따로 드러낼 것).
  if (studentRes.error) return { ...EMPTY, error: "학생 정보를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  if (enrollRes.error) return { ...EMPTY, error: "수강 정보를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" };

  const student = studentRes.data
    ? {
        id: studentRes.data.id as string,
        name: studentRes.data.name as string,
        label: schoolGradeLabel(
          (studentRes.data.school as string | null) ?? null,
          (studentRes.data.grade as string | null) ?? null,
        ),
      }
    : null;
  if (!student) return { ...EMPTY, error: "학생을 찾을 수 없습니다" };

  // 🔴 휴원(on_hold)은 제외 — 안 오기로 이미 정해진 반에 결석을 쌓으면 출석률이 두 번 깎인다.
  const enrollRows = (enrollRes.data ?? []).filter((e) => !e.on_hold);
  const classIds = [...new Set(enrollRows.map((e) => e.class_id as string))];
  if (classIds.length === 0) return { student, cells: [], error: null };

  // 반·교시·기존 기록 — 서로 독립(B4). id가 수십+ 가능하면 청크(B3).
  const [classRows, slotRows, recordRows] = await Promise.all([
    fetchInChunks<{ id: string; class_name: string; subject: string | null; teacher_id: string | null }>(
      classIds,
      (chunk) => supabase.from("classes").select("id, class_name, subject, teacher_id").in("id", chunk),
    ),
    // ⚠️ 교시는 **배치 이력**까지 함께 산다(만료 행 보존, 실측 1,068행 중 480행 만료) — 한 학생 몫이라
    //    작지만 세거나 판정에 쓰는 값이라 페이지네이션으로 silent 절단을 원천 차단한다(B2/[[#54]]).
    fetchAllPagedInChunks<{
      class_id: string;
      day_of_week: string;
      start_time: string;
      valid_from: string | null;
      valid_to: string | null;
    }>(classIds, (chunk, rangeFrom, rangeTo) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, valid_from, valid_to")
        .in("class_id", chunk)
        .lte("valid_from", to)
        .or(`valid_to.is.null,valid_to.gte.${from}`)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    ),
    // ⚠️ 출결은 정정을 **새 행으로 남기는** append-only라 한 칸에 여러 행이 있다 — 잘리면 "기록 없음"으로
    //    오판해 미리보기가 거짓말을 한다(그 칸을 빈 칸으로 보여준다). 페이지네이션 필수(B2).
    fetchAllPagedInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      session_date: string;
      slot_start: string | null;
      status: string;
      note: string | null;
      recorded_at: string;
    }>(classIds, (chunk, rangeFrom, rangeTo) =>
      supabase
        .from("attendance_records")
        .select("id, student_id, class_id, session_date, slot_start, status, note, recorded_at")
        .eq("student_id", studentId)
        .in("class_id", chunk)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    ),
  ]);

  const classById = new Map(classRows.map((c) => [c.id, c]));
  const teacherIds = [...new Set(classRows.map((c) => c.teacher_id).filter((v): v is string => !!v))];
  const teacherRows = await fetchInChunks<{ id: string; display_name: string }>(teacherIds, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  const teacherName = new Map(teacherRows.map((t) => [t.id, t.display_name]));

  const enrollments: IntakeEnrollment[] = enrollRows.map((e) => {
    const cls = classById.get(e.class_id as string);
    return {
      classId: e.class_id as string,
      className: cls?.class_name ?? "(반 미상)",
      subject: cls?.subject ?? null,
      startDate: (e.start_date as string | null) ?? null,
      endDate: (e.end_date as string | null) ?? null,
      attendanceDays: (e.attendance_days as string[] | null) ?? null,
    };
  });
  const slots: IntakeSlot[] = slotRows.map((s) => ({
    classId: s.class_id,
    dayOfWeek: s.day_of_week,
    startTime: s.start_time,
    validFrom: s.valid_from,
    validTo: s.valid_to,
  }));

  const holidays = new Set(Object.keys(buildHolidayMap(settings.operations.holidays)));
  const cells = buildAbsenceCells({ dates, enrollments, slots, holidays });
  if (cells.length > INTAKE_MAX_CELLS) {
    return {
      student,
      cells: [],
      error: `대상이 ${cells.length}칸으로 너무 많습니다 — 기간을 나눠 접수해 주세요(최대 ${INTAKE_MAX_CELLS}칸)`,
    };
  }

  // 기존 기록 — 교시까지 본 유효 행(정정은 append-only라 최신 행만 진실).
  const effective = effectiveAttendanceRecords(recordRows);
  const byKey = new Map<string, IntakeExisting>();
  for (const r of effective) {
    const key = `${r.class_id}|${r.session_date}|${hhmm(r.slot_start)}`;
    byKey.set(key, { status: r.status, note: r.note, slotStart: hhmm(r.slot_start) || null });
  }

  return {
    student,
    error: null,
    cells: cells.map((c) => ({
      ...c,
      key: cellKey(c),
      teacherName: teacherName.get(classById.get(c.classId)?.teacher_id ?? "") ?? null,
      // 교시 축 칸은 그 교시 행을 먼저 보고, 없으면 옛 "그날 전체" 행으로 폴백(0196a 이전 기록과 공존).
      existing: byKey.get(`${c.classId}|${c.date}|${c.saveSlot ?? ""}`) ?? byKey.get(`${c.classId}|${c.date}|`) ?? null,
    })),
  };
}
