import { ClassStudentActions } from "./_components/class-student-actions";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";

import { SheetRoomName, SheetText } from "@/features/teacher-view/interface-label";
import { reportError } from "@/lib/observability/report-error";
import { isModuleEnabled } from "@/lib/modules";
import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarClock, ClipboardCheck, Info, MapPin, Pencil, User, Users } from "@/components/icons/aywa-icon-compat";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { getEnrollmentDateAccess } from "@/features/enrollments/server/date-access";
import { canEditEnrollmentDateClass } from "@/features/enrollments/date-access";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { EditableAttendanceCell } from "@/features/enrollments/components/editable-attendance-cell";
import { LabSeparateToggle } from "@/features/enrollments/components/lab-separate-toggle";
import { getClassLabSeparateEnrollmentIds } from "@/features/enrollments/server/lab-separate";
import { kstToday } from "@/lib/date-kst";
import {
  getClassAttendanceStats,
  getClassDetail,
  getClassStudents,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import {
  DAY_ORDER,
  summarizeSchedule,
} from "@/features/classes/schedule-summary";
import { getStudentsList } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ClassAssignAction } from "./_components/class-assign-action";
import { ClassLevelAction } from "./_components/class-level-action";
import { ArchiveClassButton } from "./_components/archive-class-button";
import { ClassTermButton } from "./_components/class-term-button";
import { HandoverAction, HandoverBanner } from "./_components/teacher-handover";
import { getScheduledClassChanges, scheduledClassChangeLabel } from "@/features/timetable/server/scheduled-class-change";
import { monthDay } from "@/features/timetable/scheduled-import";
import { getScheduledForClass } from "@/features/enrollments/server/scheduled-queries";
import { ScheduledChangeBanner } from "@/components/scheduled-change-banner";
import { ScheduledChangeActions } from "@/components/scheduled-change-actions";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { DelegateAction, DelegationBanner } from "./_components/class-delegation";
import { getClassDelegationList } from "@/features/classes/server/delegation";
import { canWriteLoadedClass } from "@/features/classes/server/class-scope";
import { ScheduleSummaryView } from "./_components/schedule-summary-view";
import { ClassPeriodView } from "./_components/class-period-view";
import { classOperatingPeriod } from "@/features/classes/class-period";
import { isLabSeparateSlot, LAB_SEPARATE_LABEL, LAB_SEPARATE_TEXT_CLASS } from "@/features/timetable/lib/lab-separate";
import { slotPhase } from "@/features/classes/schedule-summary";
import { ClassHistorySection } from "./_components/history-section";
import { getClassHistory } from "@/features/classes/server/history-queries";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { classNameFor } from "@/features/teacher-view/class-name";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
import { sheetDowLabel, sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { seatMarkLabelOf } from "@/features/attendance/live/mark-state";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { JjClassLink } from "@/app/(shell)/exams/_components/jj-class-link";
import { PAGE_TITLE_SUFFIX } from "@/lib/config/site-metadata";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "cls.d.title")}${PAGE_TITLE_SUFFIX}` };
}

function todayIso(): string {
  return kstToday();
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("classes");
  const lang = await getTeacherViewLang();
  const { id } = await params;
  const [klass, students, stats, allEnrolledStudents, settings, teacherOptions, delegations, history] =
    await Promise.all([
      getClassDetail(id),
      getClassStudents(id),
      // 부가 패널 — 조회가 실패해도 반 상세는 연다(0 통계 + 기록).
      getClassAttendanceStats(id, 30).catch((e: unknown) => {
        reportError(e, { scope: "classes.detail.attendanceStats", classId: id });
        return null;
      }),
      getStudentsList({ status: "enrolled" }),
      getTenantSettings(),
      getClassTeacherOptions(),
      // 임시 위임(0173a) — 아직 안 끝난 것만. 독립 조회라 같은 Promise.all(B4).
      getClassDelegationList(id),
      // 이력(배치 구간·감사로그·위임) — 반 이름은 안에서 읽어 여기 병렬에 들어온다.
      getClassHistory(id),
    ]);
  if (!klass) notFound();

  // 아직 시작 안 한 수강(예약된 합류) — 목록엔 함께 두되 **오늘 수와 섞어 세지 않는다**.
  const upcoming = students.filter((s) => s.phase === "upcoming");
  // 폐지 확인 다이얼로그가 "N명이 수강 중입니다"라고 경고하는 수 — 예정분을 세면 **오늘은 아무도 없는
  // 반**을 "학생이 있다"며 못 지우게 막는다(반대로도 위험: 실제 재원생을 못 보고 지우는 것).
  const onRosterCount = students.length - upcoming.length;

  const canEditDates = canEditEnrollmentDateClass(await getEnrollmentDateAccess(), id);
  // 분리등원 요일 더블클릭 편집 — 서버 `updateEnrollmentsAttendanceBatch`는 **관리자(full)만** 통과시킨다.
  // ⚠️ 종전 `canWriteTenant`는 scoped(강사)도 통과시켜, 강사에게 편집 칸이 열리고 저장만 거절됐다(#77 반대 꼴).
  const canEditSchedule = await canManageTenant(user.systemRole, "classes");

  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);

  // 인수인계 대상 강사 풀 — 활성 강사/실장/원장 전원(현재 담임 제외).
  // 과목 담당자를 상단에 정렬하고, 나머지(신입·타 과목)는 검색으로 선택할 수 있게 hint를 붙인다.
  // ⚠️ 과목으로 하드 필터하면 subjects[] 미지정 신입 강사가 후보에서 통째로 빠져 인계 불가 → 필터 대신 정렬로.
  const handoverPool = teacherOptions
    .filter((t) => t.id !== klass.teacherId)
    .map((t) => {
      const isSubjectMatch = t.subjects.includes(klass.subject);
      return {
        id: t.id,
        name: t.name,
        isSubjectMatch,
        hint: isSubjectMatch
          ? sheetT(lang, "cls.d.sameSubject")
          : t.subjects.length
            ? t.subjects.map((s) => subjects.labelOf(s)).join("·")
            : sheetT(lang, "cls.d.noSubject"),
      };
    })
    .sort((a, b) => Number(b.isSubjectMatch) - Number(a.isSubjectMatch));
  const today = todayIso();
  // 시간표 요약의 기준일 — 종강일이 지난 반은 **종강일**. 종강이 배치를 그날로 닫아(2026-11-02) 오늘 기준이면
  // '현재' 배치가 비고 옛 학기 요일이 섞인다(적대 리뷰 2026-11-02). 랩 분리 판정·요약·등원 요일이 같은 날을 쓴다.
  const scheduleDay = klass.closedAt && klass.closedAt.slice(0, 10) < today ? klass.closedAt.slice(0, 10) : today;
  const handoverDue = !!klass.pendingTeacherDate && klass.pendingTeacherDate <= today;
  // '따로 수업(*LAB)' 교시(오늘 유효 + 아직 시작 전) — 아래 시간표 요약과 EiE 토글이 **같은 판정**을 쓴다.
  //    ⚠️ **지난 배치(만료 행)는 빼지 않는다** — 그건 '지난 배치 N개는 숨김' 숫자의 재료라(아래 요약 주석).
  const isLiveLabSeparate = (s: (typeof klass.scheduleSlots)[number]) =>
    isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate) && slotPhase(s, scheduleDay) !== "past";
  const labSeparateSlots = klass.scheduleSlots.filter(isLiveLabSeparate);
  // EiE 토글(LAB '따로 수업(*LAB)' 학생 배정, 0271b) — **EiE 반이고 *LAB 교시가 있을 때만** 세운다(원장 2026-09-17
  // *"EiE 수업이 아니면 EiE 토글은 없어도"*). *LAB 교시가 없는 반에선 켜도 아무 일이 없어 거짓 약속이 된다(lab-split.ts).
  // EiE 구분(모듈)이 꺼진 학원엔 토글이 없다(2026-09-30 "꺼지면 흔적 없이") — 저장된 english_track이 남아 있어도.
  const showLabSeparate =
    isModuleEnabled(settings.modules.disabled, "eie") &&
    klass.subject === "english" && klass.englishTrack === "eie" && labSeparateSlots.length > 0;
  // 가져오기가 미뤄 둔 반 자체 변경(담임·강의실·**반 이름**) + 예약된 명단 변동 + EiE 토글의 켠 수강(따로·fail-soft,
  // null = 모름 → 토글을 안 세운다). 예약이 없으면 각각 쿼리 한 번으로 끝난다. 독립이라 병렬(B4).
  const [scheduledClass, scheduledRoster, labSeparateIds] = await Promise.all([
    getScheduledClassChanges(klass.id, {
      teacherId: klass.teacherId,
      classroomId: klass.classroomId,
      className: klass.className,
    }),
    getScheduledForClass(klass.id),
    showLabSeparate ? getClassLabSeparateEnrollmentIds(klass.id) : Promise.resolve(null),
  ]);
  const scheduledByEnrollment = new Map(scheduledRoster.map((change) => [change.enrollmentId, change]));
  // 위임 가능 판정 = 서버 게이트(requireDelegationWrite)와 **같은 모양**이어야 한다.
  // full(원장·부원장·실장)은 학원 전체 반, scoped(강사)는 자기 담당 반만 — 결근을 아는 사람은 본인이라
  // 미리 맡기고 갈 수 있어야 한다. 두 판정이 갈라지면 "버튼은 보이는데 누르면 거절"이 된다.
  const classLevel = await accessLevelTenant(user.systemRole, "classes");
  // 🔴 반을 **바꾸는** 것(반 수정·레벨 변경·인수인계·위임)은 전부 같은 판정 하나를 본다
  //    — 서버 게이트(`requireClassWrite`/`requireDelegationWrite`)와 같은 순수 함수라 갈릴 수 없다.
  //    강사(scoped)는 자기 담임 반만. 부담임·위임으로 화면을 여는 사람은 **읽기만** 한다.
  const canEditClass = await canWriteLoadedClass(klass.teacherId);
  const canDelegate = canEditClass;
  // 반 배정 = 학생 기록 변경 — 서버 createEnrollment 게이트(classes full ∥ students full)와 같은 모양(#77).
  // 강사(양쪽 scoped)는 열람 전용(원장 2026-08-18)이라 버튼 자체를 숨긴다.
  // 수강 종료 = 학생 기록 변경 — 서버 endSingleEnrollment의 게이트(canManageStudentRecords =
  // students full)와 **같은 모양**이어야 한다(#77: 버튼은 보이는데 누르면 거절 방지).
  const canManageStudents = await canManageTenant(user.systemRole, "students");
  const canManageStatus = await canManageStudentStatusNow();
  const canAssign = classLevel === "full" || canManageStudents;
  // 인재원 학습(JJ실)을 이 반으로 좁혀 여는 입구(2026-09-11 "학생별 반별 유기적으로") — 연동 학원 · 영어 반 ·
  // 성적관리 열람 권한일 때만. JJ 화면 자체의 게이트(강사 = 담당 영어 반)는 그쪽이 다시 본다(#77).
  const showJjLink =
    klass.subject === "english" &&
    !!ijwConfigFor(user.tenantId) &&
    (await accessLevelTenant(user.systemRole, "exams")) !== "none";

  // 이 반에 이미 활성 등록된 학생 제외
  const enrolledIds = new Set(students.map((s) => s.studentId));
  const candidateStudents = allEnrolledStudents.filter((s) => !enrolledIds.has(s.id));

  // 시간표 요약 — `class_schedules`는 운영 이력을 함께 담는다(만료 행 480/1068). 전 행을 그리면
  // 이미 끝난 교시가 아직 있는 것처럼 보이고 줄 수도 폭발한다(DP5 실측 25줄 → 2줄). 상세 = schedule-summary.ts.
  // 🔴 '따로 수업(*LAB)' 교시는 **산정에서 뺀다**(원장 2026-09-17 *"토글된 랩은 시간표에서 산정하지 않고 다른
  //    시간표만 산정"*) — 반 전체가 앉는 시간이 아니라서 요일·회차·주 시간·등원 요일 후보에 넣지 않는다.
  //    뺀 회차는 카드 아래에 밝힌다(조용히 숨기지 않는다 — schedule-summary.ts 규약).
  //    ⚠️ **지난 배치(만료 행)는 빼지 않는다** — 그건 '지난 배치 N개는 숨김' 숫자의 재료라, 여기서 빼면 그 수가
  //    조용히 줄어든다(재리뷰 2026-09-17). 표식을 끄면 켜진 채 마감된 행이 실제로 남는다. 판정 = 위 `isLiveLabSeparate`.
  const schedule = summarizeSchedule(
    klass.scheduleSlots.filter((s) => !isLiveLabSeparate(s)),
    scheduleDay,
  );
  // 회차는 **오늘 유효한** 교시만 센다 — 아직 시작 전인 표식 교시뿐이면 0이라, 그땐 교시 수로 적는다(빼고 침묵 금지).
  const labSeparateSessions = labSeparateSlots.length > 0 ? summarizeSchedule(labSeparateSlots, scheduleDay).sessions : 0;
  // 반 운영 요일(분리등원 후보) — 배정 다이얼로그 + 학생별 등원요일 배지에 사용.
  // ⚠️ **현재 유효한 슬롯 기준**. 만료 요일까지 세면 이제 안 하는 요일이 등원 후보로 뜬다(실측 1반).
  // ⚠️ 등원 요일 후보는 **전체 시간표**(따로 수업 LAB 포함) 기준 그대로 — 산정에서 뺀 건 요약 숫자뿐이다
  //    (LAB으로만 도는 요일을 후보에서 지우면 그날 오는 학생의 등원 요일을 못 고른다, 리뷰 2026-09-17).
  const classDays =
    labSeparateSlots.length > 0 ? summarizeSchedule(klass.scheduleSlots, scheduleDay).days : schedule.days;
  /**
   * 운영 기간(반 수정의 운영 기간 그대로 — 원장 2026-09-18). 카드와 학생 줄이 **같은 값**을 쓴다.
   * 🔑 기간이 아직 안 끝났으면 수강 종료일은 **저장하지 않고**(0274a — 앱 26곳이 "종료일 비었음 = 수강 중"으로 판정한다)
   *    학생 줄의 빈 종료일 자리에 "~ 9/21 (운영 종료)"로 **표시만** 한다. 끝나면 매일 밤 cron이 그 날로 닫는다.
   */
  const classPeriod = classOperatingPeriod(klass.scheduleSlots, today);
  const plannedEnd = classPeriod && !classPeriod.ended ? classPeriod.validTo : null;
  /** 종료일이 빈 학생 줄의 끝 표기 — 운영 종료일이 있고 그 전에 시작한 수강이면 그 날, 아니면 종전 "~ 현재". */
  const openEndLabel = (startDate: string) =>
    plannedEnd && startDate <= plannedEnd
      ? sheetTf(lang, "cls.d.toPlannedEnd", { date: plannedEnd })
      : sheetT(lang, "cls.d.toNow");
  const attendanceBadge = (days: string[]) =>
    days.length > 0 && days.length < classDays.length
      ? sheetTf(lang, "cls.d.onlyDays", {
          days: DAY_ORDER.filter((d) => days.includes(d))
            .map((d) => sheetDowLabel(d, lang))
            .join("·"),
        })
      : null;

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label={sheetT(lang, "cls.d.back")} />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">{sheetT(lang, "cls.d.eyebrow")}</p>
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{classNameFor(klass.className, lang)}</h1>
            <Pill color={subjects.colorOf(klass.subject)}><SheetText value={subjects.labelOf(klass.subject)} /></Pill>
            {!klass.isActive ? (
              <span className="text-muted-foreground bg-muted border-border inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                {sheetT(lang, "cls.status.retired")}
              </span>
            ) : klass.closedAt ? (
              <span className="text-amber border-amber/30 bg-amber/10 inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                {sheetTf(lang, "cls.d.endedAt", { date: klass.closedAt })}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {klass.teacherName ?? sheetT(lang, "cls.card.teacherNone")}
            </span>
            {klass.classroomName ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                <SheetRoomName value={klass.classroomName} />
              </span>
            ) : null}
            <span>
              {sheetT(lang, "cls.d.enrolledPre")}
              <span className="num">{klass.studentCount}</span>
              {sheetT(lang, "cls.d.enrolledPost")}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAssign ? (
            <ClassAssignAction
              klass={{
                id: klass.id,
                className: klass.className,
                subject: klass.subject,
                teacherName: klass.teacherName,
                studentCount: klass.studentCount,
                days: classDays,
              }}
              studentOptions={candidateStudents.map((s) => ({
                id: s.id,
                name: s.name,
                grade: s.grade,
                // 단체 배정 목록의 학교·학년 표기·검색(원장 2026-09-18 — 특강은 학교·학년 단위로 모은다).
                school: s.school,
              }))}
              // 배정 창은 students full로도 열린다 — 그 안의 '반이동'은 서버(moveEnrollmentsBatch)가 classes full만
              // 받으므로 같은 판정으로 따로 내린다(수업목록 '읽기'면 토글을 그리지 않는다, lib/write-lock.ts).
              allowTransfer={classLevel === "full"}
            />
          ) : null}
          {canEditClass ? (
            <Button
              variant="outline"
              render={<WindowLink href={`/classes/${klass.id}/edit`} title={sheetT(lang, "cls.d.edit")} />}
            >
              <Pencil className="size-4" />
              {sheetT(lang, "cls.d.edit")}
            </Button>
          ) : null}
          {/* 영어 강사 시트(ecs) 기능(모듈)이 꺼진 학원엔 버튼이 없다(2026-09-30 "꺼지면 흔적 없이"). 권한 판정은 종전대로 열린 뒤 게이트가. */}
          {klass.subject === "english" && isModuleEnabled(settings.modules.disabled, "ecs") ? (
            // English Class Sheet — 영어 반만(진입 조건은 requireEcsClassAccess가 재검증: skillAreas 설정 기반)
            <Button
              variant="outline"
              render={<WindowLink href={`/ecs/${klass.id}`} title={sheetT(lang, "cls.d.sheetWin")} />}
            >
              Class Sheet
            </Button>
          ) : null}
          {showJjLink ? <JjClassLink classId={klass.id} lang={lang} /> : null}
          <Button
            render={
              <WindowLink
                href={`/attendance/${todayIso()}/${klass.id}`}
                title={sheetT(lang, "cls.d.attendanceWin")}
              />
            }
          >
            <ClipboardCheck className="size-4" />
            {sheetT(lang, "cls.d.attendance")}
          </Button>
          {canEditClass ? (
            <ClassLevelAction classId={klass.id} className={klass.className} subject={klass.subject} />
          ) : null}
          {canDelegate ? (
            <DelegateAction
              classId={klass.id}
              className={klass.className}
              currentTeacherName={klass.teacherName}
              teacherOptions={handoverPool}
            />
          ) : null}
          {canEditClass && !klass.pendingTeacherId ? (
            <HandoverAction
              classId={klass.id}
              currentTeacherName={klass.teacherName}
              teacherOptions={handoverPool}
            />
          ) : null}
          {/* 종강·폐지 = 반 전원 수강 일괄 종료(학생 기록 대량 변경) — 관리자(full)만. 서버 게이트와 한 쌍(#77). */}
          {classLevel === "full" && klass.isActive ? (
            <ClassTermButton classId={klass.id} className={klass.className} closedAt={klass.closedAt} />
          ) : null}
          {classLevel === "full" ? (
            <ArchiveClassButton
              classId={klass.id}
              isActive={klass.isActive}
              className={klass.className}
              enrolledCount={onRosterCount}
            />
          ) : null}
        </div>
      </header>

      {/* 임시 위임(0173a) — 담임 교체(아래 인수인계)와 **다른 톤**으로 둔다. 기간이 항상 보여야 한다. */}
      <DelegationBanner
        rows={delegations.map((d) => ({
          id: d.id,
          delegateName: d.delegateName,
          fromDate: d.fromDate,
          toDate: d.toDate,
          reason: d.reason,
        }))}
        todayYmd={today}
        canRevoke={canDelegate}
      />

      {/* 시간표 가져오기가 예약해 둔 반 자체 변경(담임·강의실·반 이름) — **읽기 전용**.
          적용은 기한 cron이, 취소는 시간표 툴바 배지의 ×가 한다(배치·명단까지 한 덩이라 반 하나만
          되돌리면 어긋난다). 수동 인수인계와는 별개 축이라 함께 설 수 있다. */}
      {scheduledClass.length > 0 ? (
        <div className="border-blue/30 bg-blue-soft/50 rounded-xl border px-4 py-3">
          <p className="text-blue inline-flex items-center gap-1.5 text-sm font-bold">
            <CalendarClock className="size-4" aria-hidden="true" />
            {sheetT(lang, "cls.d.schedTitle")}
          </p>
          <ul className="mt-2 space-y-1">
            {scheduledClass.map((c) => (
              <li key={`${c.kind}:${c.effectiveDate}`} className="text-foreground text-sm">
                {scheduledClassChangeLabel(c, lang)}
              </li>
            ))}
          </ul>
          <p className="text-text-dim mt-1.5 text-xs">{sheetT(lang, "cls.d.schedHint")}</p>
        </div>
      ) : null}

      {/* 학생 상세로 이동하지 않고 해당 예약 줄에서 수정·취소한다. 서버와 같은 classes full 권한. */}
      <ScheduledChangeBanner
        changes={scheduledRoster}
        today={today}
        subject="class"
        lang={lang}
        actions={canEditSchedule ? (change) => <ScheduledChangeActions change={change} today={today} /> : undefined}
      />

      {klass.pendingTeacherId ? (
        <HandoverBanner
          classId={klass.id}
          currentTeacherName={klass.teacherName}
          pendingTeacherName={klass.pendingTeacherName}
          pendingDate={klass.pendingTeacherDate}
          reason={klass.pendingTeacherReason}
          due={handoverDue}
          canAct={canEditClass}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          {/* 좌 그룹 제목 — 우측 '수강 중인 학생'과 대칭(영역 구분 규약). */}
          <header className="flex items-center gap-2">
            <Info className="text-primary size-4" />
            <h2 className="text-foreground text-sm font-bold">{sheetT(lang, "cls.d.info")}</h2>
          </header>
          {/* 운영 기간(시작·종강) — 반 수정의 운영 기간 그대로(원장 2026-09-18). 종료일이 있으면 수강이 그날 끝난다(0274a). */}
          <Card title={sheetT(lang, "cls.d.period")}>
            <ClassPeriodView period={classPeriod} lang={lang} />
          </Card>
          <Card title={sheetT(lang, "cls.d.timetable")} icon={<CalendarClock className="size-3.5" />}>
            <ScheduleSummaryView
              schedule={schedule}
              lang={lang}
              labSeparateSessions={labSeparateSessions}
              labSeparateSlots={labSeparateSlots.length}
            />
          </Card>

          <Card title={sheetT(lang, "cls.d.att30")}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label={sheetT(lang, "cls.d.rate")} value={stats ? `${stats.rate.toFixed(1)}%` : "—"} highlight="text-chart-2" />
              <Stat
                label={sheetT(lang, "cls.d.records")}
                value={stats ? String(stats.total) : "—"}
                unit={sheetT(lang, "cls.d.unitCount")}
              />
              {/* 🔴 출결 상태 이름은 `seatMarkLabelOf` 단일 소스 — 여기서 낱말을 새로 짓지 않는다. */}
              <Stat
                label={seatMarkLabelOf("absent", lang)}
                value={stats ? String(stats.absent) : "—"}
                unit={sheetT(lang, "cls.d.unitCount")}
                highlight="text-chart-4"
              />
              <Stat
                label={seatMarkLabelOf("late", lang)}
                value={stats ? String(stats.late) : "—"}
                unit={sheetT(lang, "cls.d.unitCount")}
                highlight="text-chart-3"
              />
            </dl>
          </Card>

          {klass.notes ? (
            <Card title={sheetT(lang, "cls.col.notes")}>
              <p className="text-foreground text-sm whitespace-pre-wrap leading-relaxed">
                {klass.notes}
              </p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {/* 우 그룹 제목 — 좌측 '반 정보'와 대칭. 내부 헤더바 제거하고 컬럼 제목으로 올림. */}
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="text-primary size-4" />
              <h2 className="text-foreground text-sm font-bold">{sheetT(lang, "cls.d.roster")}</h2>
            </div>
            {/* 🔴 예정(아직 안 온 학생)을 오늘 수와 **합쳐 세지 않는다**(2026-08-29) — 미래 시작 수강이
                이미 DB에 있어서(실측 28건) 합치면 9/1부터 올 학생이 오늘 재원생으로 보인다. */}
            <p className="text-muted-foreground num text-xs">
              {sheetTf(lang, "cls.d.rosterCount", {
                n: students.filter((s) => s.phase !== "upcoming").length,
              })}
              {upcoming.length > 0 ? (
                <span className="text-blue ml-1.5 font-medium">
                  {sheetTf(lang, "cls.d.upcomingCount", { n: upcoming.length })}
                </span>
              ) : null}
            </p>
          </header>
          <section className="bg-card border-border rounded-2xl border">
            {students.length === 0 ? (
              <div className="text-muted-foreground px-5 py-8 text-center text-sm">
                {sheetT(lang, "cls.d.rosterEmpty")}
              </div>
            ) : (
              <ul className="divide-border divide-y">
                {students.map((s) => (
                  <li key={s.enrollmentId} className="flex items-center justify-between px-5 py-3">
                    <WindowLink
                      href={`/students/${s.studentId}`}
                      title={studentDisplayName(s.name, s.englishName, lang)}
                      className="hover:underline"
                    >
                      <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                        {studentDisplayName(s.name, s.englishName, lang)}
                        {/* 아직 안 온 학생 — 표시가 없으면 오늘 다니는 학생과 구분이 안 된다. */}
                        {s.phase === "upcoming" ? (
                          <span className="text-blue bg-blue-soft num rounded-md px-1.5 py-0.5 text-xs font-semibold">
                            {sheetTf(lang, "cls.d.fromDate", { md: monthDay(s.enrolledAt) })}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {sheetSchoolGrade(s.school, s.grade, lang) || "—"}
                      </p>
                    </WindowLink>
                    <div className="flex items-center gap-2">
                      {canEditSchedule && classDays.length > 1 ? (
                        <EditableAttendanceCell enrollmentId={s.enrollmentId} classDays={classDays} attendanceDays={s.attendanceDays}>
                          {attendanceBadge(s.attendanceDays) ? (
                            <span className="text-chart-1 bg-chart-1/10 border-chart-1/20 rounded-md border px-2 py-0.5 text-xs font-medium">
                              {attendanceBadge(s.attendanceDays)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">{sheetT(lang, "cls.d.allDays")}</span>
                          )}
                        </EditableAttendanceCell>
                      ) : attendanceBadge(s.attendanceDays) ? (
                        <span className="text-chart-1 bg-chart-1/10 border-chart-1/20 rounded-md border px-2 py-0.5 text-xs font-medium">
                          {attendanceBadge(s.attendanceDays)}
                        </span>
                      ) : null}
                      {/* EiE 토글 — 요일 다음 자리(원장 2026-09-17 *"요일 / EiE토글 / 수강기간 / 수강 종료"*).
                          고칠 수 있는 사람(옆 요일 칸과 같은 게이트)은 스위치, 못 고치면 켠 학생에게만 `*LAB` 표식. */}
                      {labSeparateIds ? (
                        canEditSchedule ? (
                          <LabSeparateToggle
                            enrollmentId={s.enrollmentId}
                            studentName={s.name}
                            initialOn={labSeparateIds.has(s.enrollmentId)}
                          />
                        ) : labSeparateIds.has(s.enrollmentId) ? (
                          <span
                            className={`text-blue bg-blue-soft rounded-md px-2 py-0.5 text-xs font-bold ${LAB_SEPARATE_TEXT_CLASS}`}
                            title={sheetT(lang, "cls.d.labSepTitle")}
                          >
                            {LAB_SEPARATE_LABEL}
                          </span>
                        ) : null
                      ) : null}
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        {canEditDates ? (
                          <EditableDateCell enrollmentId={s.enrollmentId} field="start" value={s.enrolledAt} />
                        ) : (
                          <span className="num">{s.enrolledAt}</span>
                        )}
                        {/* 종료일이 있어도 **당일까지는 재원**이라 목록에 남는다(eligibility 단일 소스).
                            그때 "~ 현재"라고 쓰면 거짓말이라 실제 종료일을 보여준다 — 개별(JJ·BS) 반은
                            하루짜리 수강이 흔해 이 표기가 곧 "오늘까지"라는 뜻이 된다.
                            🔴 종료일도 시작일과 **같이** 더블클릭으로 고친다(원장 제보 2026-09-10:
                            *"더블클릭으로 시작날짜는 수정되는데 종료날짜는 수정이 안되네"*). 2026-06-30에
                            일부러 뺐던 건 그때 이 명단이 `end_date is null`만 세워서 종료일을 넣는 순간
                            학생이 사라졌기 때문인데, 그 전제는 이제 없다 — 명단은 `leaving`(종료 예정)을
                            그대로 세우고, 옆의 '수강 종료'가 이미 같은 값을 쓴다. 학생 상세 수업 탭·퇴원
                            상세와 같은 한 벌([EditableDateCell])이라 화면마다 갈리지 않는다. */}
                        {canEditDates ? (
                          /* ⚠️ `emptyLabel`로 **이 화면이 쓰던 말**(`~ 현재`, 강사뷰 영어 전환 대상)을 그대로
                             넘긴다 — 편집을 여는 것과 라벨을 바꾸는 것은 다른 일이고, 안 쓰던 `재원중`이
                             명단 전 줄에 새로 서면 원장이 요청하지 않은 화면 변화가 된다. */
                          <EditableDateCell
                            enrollmentId={s.enrollmentId}
                            field="end"
                            value={s.endDate}
                            isTransferred={s.isTransferred}
                            emptyLabel={openEndLabel(s.enrolledAt)}
                          />
                        ) : s.endDate ? (
                          <>
                            {"~"}
                            <span className="num">{enrollmentLastDate(s.endDate, s.isTransferred)}</span>
                          </>
                        ) : (
                          openEndLabel(s.enrolledAt)
                        )}
                      </span>
                      {/* 휴원 = caution(amber) — 학생목록·상세 배지와 같은 색(종전엔 chart-3 직접 참조). */}
                      {s.onHold ? (
                        <span className="text-amber bg-amber-soft border-amber/25 rounded-md border px-2 py-0.5 text-xs font-medium">
                          {sheetT(lang, "cls.d.onHold")}
                        </span>
                      ) : null}
                      {/* 반에서 바로 끝낸다(원장 2026-09-01) — 학생 상세까지 들어가지 않게.
                          다니는 학생 = **수강 종료**(학생 상세 수업 탭과 같은 한 벌) /
                          예정 학생 = **배정 취소**(행 삭제). 둘을 섞지 말 것 — 종료는 기록을 남기고
                          취소는 없던 일로 되돌린다. */}
                      <ClassStudentActions student={s} className={klass.className} today={today} lang={lang}
                        permissions={{ basic: canManageStudents, status: canManageStatus, schedule: canEditSchedule }}
                        scheduled={scheduledByEnrollment.get(s.enrollmentId)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* 이력 — 이 반의 배치·담당·강의실이 바뀐 기록(원장 2026-08-04). 전 폭을 쓰는 마지막 블록. */}
      <ClassHistorySection entries={history} />
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border-border rounded-2xl border p-5">
      <h3 className="eyebrow mb-3 inline-flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-bold ${highlight ?? ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span> : null}
      </p>
    </div>
  );
}
