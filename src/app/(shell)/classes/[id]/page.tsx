import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarClock, ClipboardCheck, Info, MapPin, Pencil, User, Users } from "@/components/icons/eywa-icon-compat";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { EditableAttendanceCell } from "@/features/enrollments/components/editable-attendance-cell";
import { kstToday } from "@/lib/date-kst";
import {
  getClassAttendanceStats,
  getClassDetail,
  getClassStudents,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import {
  DAY_LABEL,
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
import { DelegateAction, DelegationBanner } from "./_components/class-delegation";
import { getClassDelegationList } from "@/features/classes/server/delegation";
import { ScheduleSummaryView } from "./_components/schedule-summary-view";

export const metadata = { title: "수업 상세 — eywa" };

function todayIso(): string {
  return kstToday();
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("classes");
  const { id } = await params;
  const [klass, students, stats, allEnrolledStudents, settings, teacherOptions, delegations] =
    await Promise.all([
      getClassDetail(id),
      getClassStudents(id),
      getClassAttendanceStats(id, 30),
      getStudentsList({ status: "enrolled" }),
      getTenantSettings(),
      getClassTeacherOptions(),
      // 임시 위임(0173a) — 아직 안 끝난 것만. 독립 조회라 같은 Promise.all(B4).
      getClassDelegationList(id),
    ]);
  if (!klass) notFound();

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
          ? "이 반 과목"
          : t.subjects.length
            ? t.subjects.map((s) => subjects.labelOf(s)).join("·")
            : "과목 미지정",
      };
    })
    .sort((a, b) => Number(b.isSubjectMatch) - Number(a.isSubjectMatch));
  const today = todayIso();
  const handoverDue = !!klass.pendingTeacherDate && klass.pendingTeacherDate <= today;
  // 위임 가능 판정 = 서버 게이트(requireDelegationWrite)와 **같은 모양**이어야 한다.
  // full(원장·부원장·실장)은 학원 전체 반, scoped(강사)는 자기 담당 반만 — 결근을 아는 사람은 본인이라
  // 미리 맡기고 갈 수 있어야 한다. 두 판정이 갈라지면 "버튼은 보이는데 누르면 거절"이 된다.
  const classLevel = await accessLevelTenant(user.systemRole, "classes");
  const canDelegate =
    classLevel === "full" || (classLevel === "scoped" && klass.teacherId === user.id);

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
      ? DAY_ORDER.filter((d) => days.includes(d))
          .map((d) => DAY_LABEL[d])
          .join("·") + "만"
      : null;

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label="수업목록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">수업 · 반</p>
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{klass.className}</h1>
            <Pill color={subjects.colorOf(klass.subject)}>{subjects.labelOf(klass.subject)}</Pill>
            {!klass.isActive ? (
              <span className="text-muted-foreground bg-muted border-border inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                폐지
              </span>
            ) : klass.closedAt ? (
              <span className="text-amber border-amber/30 bg-amber/10 inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                종강 {klass.closedAt}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {klass.teacherName ?? "담임 미정"}
            </span>
            {klass.classroomName ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {klass.classroomName}
              </span>
            ) : null}
            <span>· 재원생 <span className="num">{klass.studentCount}</span>명</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="outline" render={<WindowLink href={`/classes/${klass.id}/edit`} title="반 수정" />}>
            <Pencil className="size-4" />
            반 수정
          </Button>
          {klass.subject === "english" ? (
            // English Class Sheet — 영어 반만(진입 조건은 requireEcsClassAccess가 재검증: skillAreas 설정 기반)
            <Button
              variant="outline"
              render={<WindowLink href={`/ecs/${klass.id}`} title="English Class Sheet" />}
            >
              Class Sheet
            </Button>
          ) : null}
          <Button render={<WindowLink href={`/attendance/${todayIso()}/${klass.id}`} title="출석 입력" />}>
            <ClipboardCheck className="size-4" />
            오늘 출석 입력
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
          {klass.isActive ? (
            <ClassTermButton classId={klass.id} className={klass.className} closedAt={klass.closedAt} />
          ) : null}
          <ArchiveClassButton
            classId={klass.id}
            isActive={klass.isActive}
            className={klass.className}
            enrolledCount={students.length}
          />
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
            <h2 className="text-foreground text-sm font-bold">반 정보</h2>
          </header>
          <Card title="시간표" icon={<CalendarClock className="size-3.5" />}>
            <ScheduleSummaryView schedule={schedule} />
          </Card>

          <Card title="최근 30일 출결">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="출석률" value={`${stats.rate.toFixed(1)}%`} highlight="text-chart-2" />
              <Stat label="총 건수" value={String(stats.total)} unit="건" />
              <Stat label="결석" value={String(stats.absent)} unit="건" highlight="text-chart-4" />
              <Stat label="지각" value={String(stats.late)} unit="건" highlight="text-chart-3" />
            </dl>
          </Card>

          {klass.notes ? (
            <Card title="메모">
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
              <h2 className="text-foreground text-sm font-bold">수강 중인 학생</h2>
            </div>
            <p className="text-muted-foreground num text-xs">{students.length}명</p>
          </header>
          <section className="bg-card border-border rounded-2xl border">
            {students.length === 0 ? (
              <div className="text-muted-foreground px-5 py-8 text-center text-sm">
                활성 재원생이 없습니다
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
                      <p className="text-foreground text-sm font-medium">{s.name}</p>
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
                            <span className="text-muted-foreground text-xs">모두</span>
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
                        ~ 현재
                      </span>
                      {s.onHold ? (
                        <span className="text-chart-3 bg-chart-3/10 border-chart-3/20 rounded-md border px-2 py-0.5 text-xs font-medium">
                          휴원
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
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
