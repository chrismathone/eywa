import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { mondayOf } from "@/features/timetable/lib/week";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { hiddenSeatOf } from "../lib/grid";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { dowKeyOf, normalizeSlotTime, YMD_RE } from "../lib/week";
import { readEcsShowSelfStudy } from "../view-prefs";
import { ecsVisibleClassFilter } from "./access";

/**
 * **오늘 ECS** — 영어 강사의 원스크린(원장 지시 2026-08-07 "영어 강사는 ECS를 기반으로 한 원스크린").
 *
 * 주간 시트가 "반 하나 × 주 하나"라면 여기는 그 직교 방향 — **날짜 하나 × 내 반 전부**다.
 * 그 날 수업이 있는 내 영어 반만, 교시 순서대로 한 화면에 쌓는다.
 *
 * 🔑 **반별로 `getClassSheetWeek`을 N번 부르지 않는다**(그게 제일 쉬운 길이지만 반 6개면 쿼리가 30개를
 *    넘는다 — 홈 화면이라 첫 페인트가 곧 체감 속도다). 랜딩(`getSheetLanding`)과 같은 방식으로
 *    **반 전체를 한 번에 묶어** 조회하고(B3 청크), 날짜를 하루로 좁혀 행 수를 줄인다.
 * ⚠️ 스코프·자리 판정·작성 여부는 전부 **기존 단일 소스를 재사용**한다(`ecsVisibleClassFilter`·
 *    `hiddenSeatOf`·`isMeaningfulPlanLine`) — 여기서 다시 구현하면 주간 시트와 숫자가 갈린다.
 */

/**
 * 계획 한 줄 — **주간 시트와 같은 모양**(`PlanLineDTO`)이다. 오늘 보드가 그 줄을 그대로 편집하고
 * 같은 CAS 경로로 저장하므로, 화면만 다르고 데이터·충돌 처리는 한 벌이다.
 */
export type TodayPlanLine = {
  id: string;
  planDate: string;
  slotStart: string;
  termMode: string;
  lineNo: number;
  skillArea: string | null;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
  updatedAt: string;
  /** 이 줄에 실제 내용이 있는가(작성률과 **같은 판정**). */
  filled: boolean;
};

export type TodaySlot = {
  slotStart: string;
  slotEnd: string | null;
  /** "N교시"(요일별 교시표로 확정) — 못 찾으면 null(지어내지 않는다). */
  periodLabel: string | null;
  roomLabel: string | null;
  lines: TodayPlanLine[];
};

export type TodayStudent = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 출결 effective 상태(없으면 null=미기록). */
  attendance: string | null;
  /** 사유 메모가 붙어 있으면 여기(있으면 ECS에서 취소 못 함 — 출석부가 진실). */
  attendanceNote: string | null;
  /** 이 학생의 그 날 수업보고서가 작성됐는가(lesson_reports 존재). */
  reportWritten: boolean;
  /** ClassNote 발송 상태(성공만 true — 대기·실패는 false). */
  reportSent: boolean;
};

export type TodayClassCard = {
  classId: string;
  className: string;
  teacherName: string | null;
  /** 그 날 첫 교시 시작(정렬 키이자 카드 머리 시각). */
  startsAt: string;
  endsAt: string | null;
  slots: TodaySlot[];
  students: TodayStudent[];
  /** 계획 작성 = 그 날 교시 중 내용이 있는 교시 수 / 전체 교시 수. */
  fill: { total: number; filled: number };
  /** 출석 입력 가능(권한 + 강사 7일 창) — false면 화면이 체크를 잠그고 이유를 말한다. */
  canMarkAttendance: boolean;
  /**
   * 오늘 화면이 **안 그리는** 계획 행 수 — 살아있는 배치에 없는 시각(시간 변경된 기록)이거나 자리(LAB·숨긴 JJ).
   * ⚠️ 0이 아니면 반드시 각주로 알린다. 화면에서 빼는 것과 DB에서 지우는 건 다르고, 침묵하면
   *    **"분명히 썼는데 안 보인다"**가 된다(주간 시트가 같은 것을 '시간 변경된 기록 N건'으로 말한다).
   */
  hiddenLines: number;
};

export type EcsTodayResult =
  | {
      ok: true;
      date: string;
      today: string;
      weekMonday: string;
      cards: TodayClassCard[];
      /** 내 스코프에 영어 반이 아예 없는가 — 빈 화면 문구를 원인별로 가르기 위한 값. */
      hasAnyClass: boolean;
      /** 계획 편집 가능(ecs full|scoped) — 출결과 별개 게이트다. */
      canWrite: boolean;
      /** 영역(구분) 정의 — 라벨·색의 **단일 소스는 학원설정**(주간 시트와 같은 값). */
      skillAreas: SkillAreaSetting[];
      /** 저널·presence 식별자(주간 시트와 같은 키를 써야 같은 문서로 인식된다). */
      userId: string;
      tenantId: string;
    }
  | { ok: false; error: string };

export async function getEcsToday(dateParam?: string | null): Promise<EcsTodayResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };
  // 계획 편집 게이트는 주간 시트와 동일(full|scoped). 출결은 별도 게이트(아래 attendanceWritable).
  const canWrite = level === "full" || level === "scoped";

  const today = kstToday();
  const date = dateParam && YMD_RE.test(dateParam) ? dateParam : today;
  const dow = dowKeyOf(date);

  const settings = await getTenantSettings();
  const english = settings.operations.subjects.find((s) => s.key === "english");
  const skillAreas = resolveSkillAreas(english);
  if (skillAreas.length === 0) {
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: false, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // 반 목록 + 내 보기 설정(JJ 표시) — 서로 독립이라 병렬(B4). 필터가 뒤의 무거운 조회를 좁힌다.
  const [{ data: allClasses, error: classError }, prefsRes] = await Promise.all([
    supabase
      .from("classes")
      .select("id, class_name, teacher_id")
      .eq("subject", "english")
      .eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${date}`)
      .order("class_name"),
    admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle(),
  ]);
  if (classError) return { ok: false, error: `반 목록을 불러오지 못했습니다: ${classError.message}` };

  // 강사 스코프는 JS 교집합(스코프 id를 .in에 넣지 않는다 — 대량 .in 회피, B3). 게이트와 같은 세 갈래.
  const { classIds: visibleIds } = await ecsVisibleClassFilter();
  const scopeSet = visibleIds ? new Set(visibleIds) : null;
  const scoped = (allClasses ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string));
  const showSelfStudy = readEcsShowSelfStudy(prefsRes.data?.ui_prefs);
  if (scoped.length === 0) {
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: false, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId };
  }
  const scopedIds = scoped.map((c) => c.id as string);

  // ── 그 날짜에 살아 있는 배치만(#88 — class_schedules는 운영 이력을 함께 담는다) ────────────────
  const schedules = await fetchInChunks<{
    class_id: string;
    start_time: string;
    end_time: string | null;
    slot_teacher_label: string | null;
    classroom_id: string | null;
  }>(scopedIds, (chunk) =>
    supabase
      .from("class_schedules")
      .select("class_id, start_time, end_time, slot_teacher_label, classroom_id")
      .in("class_id", chunk)
      .eq("day_of_week", dow)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
  );

  // 자리(LAB·숨긴 JJ)는 화면에서 뺀다 — 주간 시트·작성률과 **같은 판정**(hiddenSeatOf).
  const slotsByClass = new Map<string, typeof schedules>();
  for (const s of schedules) {
    if (hiddenSeatOf(s.slot_teacher_label, showSelfStudy)) continue;
    const arr = slotsByClass.get(s.class_id) ?? [];
    arr.push(s);
    slotsByClass.set(s.class_id, arr);
  }
  const todayIds = scopedIds.filter((id) => (slotsByClass.get(id)?.length ?? 0) > 0);
  if (todayIds.length === 0) {
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: true, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId };
  }

  // ── 계획·수강·출결·보고서·강의실·담당자 — 서로 독립이라 한 번에(B4) ────────────────────────────
  const [planLines, enrollments, attendanceRaw, rooms, teachers] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      plan_date: string;
      slot_start: string;
      term_mode: string;
      line_no: number;
      skill_area: string | null;
      textbook: string | null;
      page_range: string | null;
      progress: string | null;
      homework: string | null;
      updated_at: string;
    }>(todayIds, (chunk, from, to) =>
      admin
        .from("class_sheet_plan_lines")
        // id·updated_at은 **CAS 저장의 열쇠**다(주간 시트와 같은 경로로 고치려면 없어선 안 된다).
        .select(
          "id, class_id, plan_date, slot_start, term_mode, line_no, skill_area, textbook, page_range, progress, homework, updated_at",
        )
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("plan_date", date)
        .order("id")
        .range(from, to),
    ),
    // 🔴 **출결 게이트(`checkStudentEligibleOn`)와 같은 조건이어야 한다** — 날짜·요일만 보고 명단을 만들면
    //    보류(on_hold)·전출(is_transferred)·퇴원(students.withdrawn_at) 학생이 목록에 뜨고, 출결을 찍는
    //    순간 서버가 "그 날짜에 이 반을 수강하지 않는 학생입니다"로 거절한다 = **"목록엔 뜨는데 못 찍음"**.
    //    (2026-08-07 적대적 리뷰. 실측 당시 해당 학생 0명이라 화면상 멀쩡했지만, 한 명만 생기면 바로 터진다.)
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      attendance_days: string[] | null;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean | null;
      // PostgREST 임베드는 **배열**로 타이핑된다(!inner라 실제론 0~1개) — 아래에서 [0]로 읽는다.
      students: { withdrawn_at: string | null }[] | null;
    }>(todayIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select(
          "class_id, student_id, attendance_days, start_date, end_date, on_hold, is_transferred, students!inner(withdrawn_at)",
        )
        .in("class_id", chunk)
        .lte("start_date", date)
        .or(`end_date.is.null,end_date.gte.${date}`)
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      status: string;
      note: string | null;
      recorded_at: string;
      id: string;
      session_date: string;
    }>(todayIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, class_id, student_id, status, note, recorded_at, session_date")
        .in("class_id", chunk)
        .eq("session_date", date)
        .order("id")
        .range(from, to),
    ),
    fetchInChunks<{ id: string; name: string }>(
      [
        ...new Set(
          todayIds.flatMap((id) =>
            (slotsByClass.get(id) ?? []).map((s) => s.classroom_id).filter((v): v is string => !!v),
          ),
        ),
      ],
      (chunk) => supabase.from("classrooms").select("id, name").in("id", chunk),
    ),
    fetchInChunks<{ id: string; display_name: string | null }>(
      [
        ...new Set(
          scoped
            .filter((c) => todayIds.includes(c.id as string))
            .map((c) => c.teacher_id as string | null)
            .filter((v): v is string => !!v),
        ),
      ],
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
  ]);

  // 학생 이름은 수강 목록이 나온 뒤에야 알 수 있다(위 병렬의 결과에 의존) — 여기만 순차.
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const studentRows = await fetchInChunks<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
  }>(studentIds, (chunk) => supabase.from("students").select("id, name, school, grade").in("id", chunk));

  // 보고서 상태 — 그 날짜·그 학생들.
  // ⚠️ **`class_id`로만 매칭하면 보강 보고서를 놓친다** — 원스크린은 보강을 `class_id=null` + `subject`로
  //    저장한다(unit_key가 `coalesce(class_id, subject)`라 같은 반 정규 보고서와 충돌하기 때문).
  //    그래서 학생 기준으로 한 번 더 훑어 `class_id is null AND subject='english'`도 '작성'으로 센다
  //    (2026-08-07 적대적 리뷰 — 안 그러면 보강을 써 놓고도 배지가 '미작성'이라 다시 쓰게 만든다).
  const [reports, subjectReports] = await Promise.all([
    fetchAllPagedInChunks<{ student_id: string; class_id: string | null; classnote_status: string | null }>(
      todayIds,
      (chunk, from, to) =>
        supabase
          .from("lesson_reports")
          .select("student_id, class_id, classnote_status")
          .in("class_id", chunk)
          .eq("report_date", date)
          .order("id")
          .range(from, to),
    ),
    fetchAllPagedInChunks<{ student_id: string; classnote_status: string | null }>(
      studentIds,
      (chunk, from, to) =>
        supabase
          .from("lesson_reports")
          .select("student_id, classnote_status")
          .in("student_id", chunk)
          .is("class_id", null)
          .eq("subject", "english")
          .eq("report_date", date)
          .order("id")
          .range(from, to),
    ),
  ]);

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));
  const studentMeta = new Map(studentRows.map((s) => [s.id, s]));
  // 교시 라벨 표 — 주간 시트(queries.ts)와 **같은 폴백 체인**(과목 전용 → english 내장 → 전역).
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor("english", periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const weekend = isWeekendDow(dow);

  // 출결 effective(최신 recorded_at, tie는 id) — 출석부·시트와 **같은 축약 함수**를 쓴다.
  const effective = effectiveAttendanceRecords(attendanceRaw);
  const attByKey = new Map(effective.map((r) => [`${r.class_id}|${r.student_id}`, r]));
  const reportByKey = new Map<string, { written: boolean; sent: boolean }>();
  for (const r of reports) {
    const key = `${r.class_id}|${r.student_id}`;
    const prev = reportByKey.get(key);
    reportByKey.set(key, {
      written: true,
      sent: (prev?.sent ?? false) || r.classnote_status === "success",
    });
  }
  // 반이 없는(보강) 영어 보고서 — 학생 단위라 그 학생이 오늘 듣는 **모든 영어 반**에 같은 상태를 얹는다.
  // 과목 단위 저장이라 그게 그 값의 의미다(어느 반의 보강인지 DB가 구분하지 않는다).
  const subjectReportByStudent = new Map<string, { written: boolean; sent: boolean }>();
  for (const r of subjectReports) {
    const prev = subjectReportByStudent.get(r.student_id);
    subjectReportByStudent.set(r.student_id, {
      written: true,
      sent: (prev?.sent ?? false) || r.classnote_status === "success",
    });
  }

  const attendanceWritable =
    (await canWriteTenant(user.systemRole, "attendance")) &&
    (user.systemRole !== "teacher" || isWithinAttendanceEditWindow(date, today));

  const linesByKey = new Map<string, typeof planLines>();
  for (const l of planLines) {
    const key = `${l.class_id}|${normalizeSlotTime(l.slot_start)}`;
    const arr = linesByKey.get(key) ?? [];
    arr.push(l);
    linesByKey.set(key, arr);
  }

  const cards: TodayClassCard[] = todayIds
    .map((classId) => {
      const cls = scoped.find((c) => c.id === classId)!;
      const slotRows = (slotsByClass.get(classId) ?? [])
        .slice()
        .sort((a, b) => normalizeSlotTime(a.start_time).localeCompare(normalizeSlotTime(b.start_time)));
      const slots: TodaySlot[] = slotRows.map((s) => {
        const start = normalizeSlotTime(s.start_time);
        const end = s.end_time ? normalizeSlotTime(s.end_time) : null;
        const lines = (linesByKey.get(`${classId}|${start}`) ?? [])
          .slice()
          .sort((a, b) => a.line_no - b.line_no)
          .map((l) => ({
            id: l.id,
            planDate: l.plan_date,
            slotStart: start,
            termMode: l.term_mode,
            lineNo: l.line_no,
            skillArea: l.skill_area,
            textbook: l.textbook,
            pageRange: l.page_range,
            progress: l.progress,
            homework: l.homework,
            updatedAt: l.updated_at,
            filled: isMeaningfulPlanLine({
              textbook: l.textbook,
              pageRange: l.page_range,
              progress: l.progress,
              homework: l.homework,
            }),
          }));
        return {
          slotStart: start,
          slotEnd: end,
          periodLabel: resolvePeriodLabel(start, end, periodTables, weekend),
          roomLabel: s.classroom_id ? (roomName.get(s.classroom_id) ?? null) : null,
          lines,
        };
      });

      // 그 날 실제 수강 대상 — **출결 게이트와 같은 판정**(기간·보류·전출·퇴원 + 분리등원 요일).
      const roster = enrollments
        .filter(
          (e) =>
            e.class_id === classId &&
            !((e.students?.[0]?.withdrawn_at ?? null) !== null && e.students![0]!.withdrawn_at! < date) &&
            isEnrollmentActiveOn(
              {
                startDate: e.start_date,
                endDate: e.end_date,
                onHold: e.on_hold,
                isTransferred: e.is_transferred ?? undefined,
              },
              date,
            ) &&
            enrollmentAttendsOnDay(e.attendance_days, dow),
        )
        .map((e) => {
          const meta = studentMeta.get(e.student_id);
          const att = attByKey.get(`${classId}|${e.student_id}`);
          const rep = reportByKey.get(`${classId}|${e.student_id}`);
          const subjRep = subjectReportByStudent.get(e.student_id);
          return {
            studentId: e.student_id,
            name: meta?.name ?? "(이름 없음)",
            school: meta?.school ?? null,
            grade: meta?.grade ?? null,
            attendance: att?.status ?? null,
            attendanceNote: att?.note ?? null,
            reportWritten: (rep?.written ?? false) || (subjRep?.written ?? false),
            reportSent: (rep?.sent ?? false) || (subjRep?.sent ?? false),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));

      return {
        classId,
        className: cls.class_name as string,
        teacherName: cls.teacher_id ? (teacherName.get(cls.teacher_id as string) ?? null) : null,
        startsAt: slots[0]?.slotStart ?? "00:00",
        endsAt: slots.at(-1)?.slotEnd ?? null,
        slots,
        students: roster,
        fill: { total: slots.length, filled: slots.filter((s) => s.lines.some((l) => l.filled)).length },
        canMarkAttendance: attendanceWritable,
        // 그 반의 오늘 계획 행 중 위 slots에 실리지 않은 것 = 안 그리는 기록(고아 시각 or 자리).
        hiddenLines:
          planLines.filter((l) => l.class_id === classId).length -
          slots.reduce((n, s) => n + s.lines.length, 0),
      };
    })
    // 시간표 순서 = 그 날 일과 순서. 같은 시각이면 반 이름으로 안정 정렬.
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className, "ko"));

  return { ok: true, date, today, weekMonday: mondayOf(date), cards, hasAnyClass: true, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId };
}
