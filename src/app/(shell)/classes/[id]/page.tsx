import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarClock, ClipboardCheck, Info, MapPin, Pencil, User, Users } from "@/components/icons/eywa-icon-compat";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { EditableAttendanceCell } from "@/features/enrollments/components/editable-attendance-cell";
import { EndEnrollmentAction } from "@/features/enrollments/components/end-enrollment-action";
import { CancelAssignmentButton } from "@/features/enrollments/components/cancel-assignment-button";
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
import { DelegateAction, DelegationBanner } from "./_components/class-delegation";
import { getClassDelegationList } from "@/features/classes/server/delegation";
import { ScheduleSummaryView } from "./_components/schedule-summary-view";
import { ClassHistorySection } from "./_components/history-section";
import { getClassHistory } from "@/features/classes/server/history-queries";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetDowLabel, sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { seatMarkLabelOf } from "@/features/attendance/live/mark-state";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "cls.d.title")} — eywa` };
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
      getClassAttendanceStats(id, 30),
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

  // 수강 시작일 더블클릭 수정 = owner(원장) 권한 이상만(관리자 정정). 학생 상세 수업 탭과 동일 게이트.
  const canEditDates = (await accessLevelTenant(user.systemRole, "owner")) === "full";
  // 분리등원 요일 더블클릭 편집 = 반 쓰기 권한(updateEnrollmentsAttendanceBatch와 동일 게이트).
  const canEditSchedule = await canWriteTenant(user.systemRole, "classes");

  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects);

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
  const handoverDue = !!klass.pendingTeacherDate && klass.pendingTeacherDate <= today;
  // 가져오기가 미뤄 둔 반 자체 변경(담임·강의실·**반 이름**) + 예약된 명단 변동. 둘 다 예약이
  // 없으면 각각 쿼리 한 번으로 끝난다. 독립이라 병렬(B4).
  const [scheduledClass, scheduledRoster] = await Promise.all([
    getScheduledClassChanges(klass.id, {
      teacherId: klass.teacherId,
      classroomId: klass.classroomId,
      className: klass.className,
    }),
    getScheduledForClass(klass.id),
  ]);
  // 위임 가능 판정 = 서버 게이트(requireDelegationWrite)와 **같은 모양**이어야 한다.
  // full(원장·부원장·실장)은 학원 전체 반, scoped(강사)는 자기 담당 반만 — 결근을 아는 사람은 본인이라
  // 미리 맡기고 갈 수 있어야 한다. 두 판정이 갈라지면 "버튼은 보이는데 누르면 거절"이 된다.
  const classLevel = await accessLevelTenant(user.systemRole, "classes");
  const canDelegate =
    classLevel === "full" || (classLevel === "scoped" && klass.teacherId === user.id);
  // 반 배정 = 학생 기록 변경 — 서버 createEnrollment 게이트(classes full ∥ students full)와 같은 모양(#77).
  // 강사(양쪽 scoped)는 열람 전용(원장 2026-08-18)이라 버튼 자체를 숨긴다.
  // 수강 종료 = 학생 기록 변경 — 서버 endSingleEnrollment의 게이트(canManageStudentRecords =
  // students full)와 **같은 모양**이어야 한다(#77: 버튼은 보이는데 누르면 거절 방지).
  const canManageStudents = await canManageTenant(user.systemRole, "students");
  const canAssign = classLevel === "full" || canManageStudents;

  // 이 반에 이미 활성 등록된 학생 제외
  const enrolledIds = new Set(students.map((s) => s.studentId));
  const candidateStudents = allEnrolledStudents.filter((s) => !enrolledIds.has(s.id));

  // 시간표 요약 — `class_schedules`는 운영 이력을 함께 담는다(만료 행 480/1068). 전 행을 그리면
  // 이미 끝난 교시가 아직 있는 것처럼 보이고 줄 수도 폭발한다(DP5 실측 25줄 → 2줄). 상세 = schedule-summary.ts.
  const schedule = summarizeSchedule(klass.scheduleSlots, today);
  // 반 운영 요일(분리등원 후보) — 배정 다이얼로그 + 학생별 등원요일 배지에 사용.
  // ⚠️ **현재 유효한 슬롯 기준**. 만료 요일까지 세면 이제 안 하는 요일이 등원 후보로 뜬다(실측 1반).
  const classDays = schedule.days;
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
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{klass.className}</h1>
            <Pill color={subjects.colorOf(klass.subject)}>{subjects.labelOf(klass.subject)}</Pill>
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
                {klass.classroomName}
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
              }))}
            />
          ) : null}
          <Button
            variant="outline"
            render={<WindowLink href={`/classes/${klass.id}/edit`} title={sheetT(lang, "cls.d.edit")} />}
          >
            <Pencil className="size-4" />
            {sheetT(lang, "cls.d.edit")}
          </Button>
          {klass.subject === "english" ? (
            // English Class Sheet — 영어 반만(진입 조건은 requireEcsClassAccess가 재검증: skillAreas 설정 기반)
            <Button
              variant="outline"
              render={<WindowLink href={`/ecs/${klass.id}`} title={sheetT(lang, "cls.d.sheetWin")} />}
            >
              Class Sheet
            </Button>
          ) : null}
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
          <ClassLevelAction classId={klass.id} className={klass.className} subject={klass.subject} />
          {canDelegate ? (
            <DelegateAction
              classId={klass.id}
              className={klass.className}
              currentTeacherName={klass.teacherName}
              teacherOptions={handoverPool}
            />
          ) : null}
          {!klass.pendingTeacherId ? (
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
          <p className="text-blue inline-flex items-center gap-1.5 text-[13px] font-bold">
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

      {/* 예약된 명단 변동(합류·이동·종료 예정) — 학생 상세와 같은 컴포넌트·같은 문구.
          🔴 여기선 수정·취소를 주지 않는다: 한 반에서 여러 학생을 한꺼번에 다루는 자리라
             오클릭 피해가 크고, 개별 정정은 그 학생 상세에서 하는 것이 원장 확정 규약이다. */}
      <ScheduledChangeBanner changes={scheduledRoster} today={today} subject="class" lang={lang} />

      {klass.pendingTeacherId ? (
        <HandoverBanner
          classId={klass.id}
          currentTeacherName={klass.teacherName}
          pendingTeacherName={klass.pendingTeacherName}
          pendingDate={klass.pendingTeacherDate}
          reason={klass.pendingTeacherReason}
          due={handoverDue}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          {/* 좌 그룹 제목 — 우측 '수강 중인 학생'과 대칭(영역 구분 규약). */}
          <header className="flex items-center gap-2">
            <Info className="text-primary size-4" />
            <h2 className="text-foreground text-sm font-bold">{sheetT(lang, "cls.d.info")}</h2>
          </header>
          <Card title={sheetT(lang, "cls.d.timetable")} icon={<CalendarClock className="size-3.5" />}>
            <ScheduleSummaryView schedule={schedule} lang={lang} />
          </Card>

          <Card title={sheetT(lang, "cls.d.att30")}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label={sheetT(lang, "cls.d.rate")} value={`${stats.rate.toFixed(1)}%`} highlight="text-chart-2" />
              <Stat
                label={sheetT(lang, "cls.d.records")}
                value={String(stats.total)}
                unit={sheetT(lang, "cls.d.unitCount")}
              />
              {/* 🔴 출결 상태 이름은 `seatMarkLabelOf` 단일 소스 — 여기서 낱말을 새로 짓지 않는다. */}
              <Stat
                label={seatMarkLabelOf("absent", lang)}
                value={String(stats.absent)}
                unit={sheetT(lang, "cls.d.unitCount")}
                highlight="text-chart-4"
              />
              <Stat
                label={seatMarkLabelOf("late", lang)}
                value={String(stats.late)}
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
                      title={s.name}
                      className="hover:underline"
                    >
                      <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                        {s.name}
                        {/* 아직 안 온 학생 — 표시가 없으면 오늘 다니는 학생과 구분이 안 된다. */}
                        {s.phase === "upcoming" ? (
                          <span className="text-blue bg-blue-soft num rounded-md px-1.5 py-0.5 text-[11px] font-semibold">
                            {sheetTf(lang, "cls.d.fromDate", { md: monthDay(s.enrolledAt) })}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {s.grade ?? "—"}
                        {s.school ? ` · ${s.school}` : ""}
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
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        {canEditDates ? (
                          <EditableDateCell enrollmentId={s.enrollmentId} field="start" value={s.enrolledAt} />
                        ) : (
                          <span className="num">{s.enrolledAt}</span>
                        )}
                        {/* 종료일이 있어도 **당일까지는 재원**이라 목록에 남는다(eligibility 단일 소스).
                            그때 "~ 현재"라고 쓰면 거짓말이라 실제 종료일을 보여준다 — 개별(JJ·BS) 반은
                            하루짜리 수강이 흔해 이 표기가 곧 "오늘까지"라는 뜻이 된다. */}
                        {s.endDate ? (
                          <>
                            {"~"}
                            <span className="num">{s.endDate}</span>
                          </>
                        ) : (
                          sheetT(lang, "cls.d.toNow")
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
                      {canManageStudents ? (
                        s.phase === "upcoming" ? (
                          /* 예정(대기) 줄은 종료가 아니라 **배정 취소**다(원장 2026-09-01:
                             *"배정 취소 하면 아무일도 없던것처럼 되는거지"*) — 아직 아무 기록도 안 붙었으므로
                             행 자체를 지운다. 종료로 닫으면 시작일로 클램프돼 "하루짜리 수강"이 남는다. */
                          <CancelAssignmentButton
                            enrollmentId={s.enrollmentId}
                            className={klass.className}
                            startDate={s.enrolledAt}
                            studentName={s.name}
                          />
                        ) : (
                          <EndEnrollmentAction
                            enrollmentId={s.enrollmentId}
                            studentId={s.studentId}
                            studentName={s.name}
                            className={klass.className}
                            currentEndDate={s.endDate}
                            startDate={s.enrolledAt}
                            today={today}
                          />
                        )
                      ) : null}
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
