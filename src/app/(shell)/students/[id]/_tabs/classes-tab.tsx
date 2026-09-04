import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { kstToday } from "@/lib/date-kst";
import { Pill } from "@/components/atoms/pill";
import {
  getStudentClassesDetail,
  type StudentClassRow,
  type StudentDetail,
} from "@/features/students/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { enrollmentAssignBlockReason } from "@/features/enrollments/eligibility";
import { buildSubjectMaps, type SubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { AssignDialogClass } from "@/components/enrollment-assign-dialog";
import { StudentAssignAction } from "../_components/student-assign-action";
import { EndEnrollmentAction } from "@/features/enrollments/components/end-enrollment-action";
import { DeleteEnrollmentButton } from "../_components/delete-enrollment-button";
import { MoveEnrollmentButton } from "../_components/move-enrollment-button";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { EditableAttendanceCell } from "@/features/enrollments/components/editable-attendance-cell";
import { WindowLink } from "@/components/workspace/window-link";
import { StudentWeekGrid } from "./student-week-grid";

const DAY_CODE_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_CODE_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 반 운영 요일(+시작시각) → "월·목 14:20 · 화 16:00"(같은 시각 요일 묶음). 반 옵션 힌트용. */
function formatClassSchedule(days: { day: string; start: string | null }[]): string {
  if (!days.length) return "";
  const byTime = new Map<string, string[]>();
  for (const d of [...days].sort((a, b) => DAY_CODE_ORDER.indexOf(a.day) - DAY_CODE_ORDER.indexOf(b.day))) {
    const t = d.start ? d.start.slice(0, 5) : "";
    (byTime.get(t) ?? byTime.set(t, []).get(t)!).push(DAY_CODE_LABEL[d.day] ?? d.day);
  }
  return [...byTime.entries()].map(([t, ds]) => `${ds.join("·")}${t ? ` ${t}` : ""}`).join(" · ");
}

// 요일 chip 색(ijw DAY_COLORS 대응 — eywa 토큰).
const DAY_CHIP: Record<string, string> = {
  "월": "bg-amber/15 text-amber",
  "화": "bg-rose/15 text-rose",
  "수": "bg-blue/15 text-blue",
  "목": "bg-primary/15 text-primary",
  "금": "bg-purple/15 text-purple",
  "토": "bg-danger/15 text-danger",
  "일": "bg-purple/15 text-purple",
};

/** 수업 탭(ijw CoursesTab 이식) — 수강 중/배정 예정/지난 3섹션 + 스케줄(요일+교시)·강사. */
export async function ClassesTab({
  student,
  canEnd,
  canEditDates,
  canEditSchedule,
  canDeleteEnrollment,
}: {
  student: StudentDetail;
  canEnd: boolean;
  canEditDates: boolean;
  /** 분리등원 요일(스케줄 셀) 더블클릭 편집 노출 — canManageTenant("classes", 서버 액션과 같은 축). */
  canEditSchedule: boolean;
  /**
   * 잘못 만든 수업 이력 **삭제**(원장·super_admin) 노출 — 서버 `deleteEnrollment` 게이트와 같은 모양(#77).
   * ⚠️ '수강 종료'(canEnd)와 다른 축이다: 종료는 데스크 업무, 삭제는 원장 정정이다.
   */
  canDeleteEnrollment: boolean;
}) {
  const [rows, allActiveClasses, settings] = await Promise.all([
    getStudentClassesDetail(student.id),
    getClassesList({ active: "active" }),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const periodsConfig = settingsToPeriodsConfig(settings.operations);

  const today = kstToday();
  const hasEnded = (r: StudentClassRow) => (r.endDate ? r.endDate < today : false);
  const current = rows.filter((r) => !hasEnded(r) && r.startDate <= today);
  const scheduled = rows.filter((r) => !hasEnded(r) && r.startDate > today);
  const past = rows.filter((r) => hasEnded(r));

  // 🔴 휴원·퇴원·상담 단계 학생에겐 '반 배정' 대신 **이유**를 보여준다 — 서버(createEnrollment)가
  //    같은 판정으로 거절하므로, 버튼만 감추면 "왜 못 하는지"를 알 수 없다(#77: 둘 다 필요).
  const assignBlockedReason = enrollmentAssignBlockReason(student.status);

  const activeClassIds = new Set(current.map((r) => r.classId));
  // 반별 기존 수강 기간(지난 것 포함) — 배정 다이얼로그가 DB GiST(같은 학생·같은 반 기간 겹침)를
  // **저장 전에** 감지해 알려주는 재료. 없으면 "배정 예정"인 반을 골라도 저장 순간에야 거부됐다
  // (2026-07-28 조현준 배정 실패 — 8/4부터 예정 배정된 반에 7/28 시작으로 다시 배정 시도).
  const periodsByClass = new Map<string, { start: string; end: string | null }[]>();
  for (const r of rows) {
    const list = periodsByClass.get(r.classId) ?? [];
    list.push({ start: r.startDate, end: r.endDate });
    periodsByClass.set(r.classId, list);
  }
  // 배정/이동 대상 = 현재 수강 중이 아닌 활성 반. 스케줄(요일·시각)·요일코드 포함.
  const candidateClasses: AssignDialogClass[] = allActiveClasses
    .filter((c) => !activeClassIds.has(c.id))
    .map((c) => ({
      id: c.id,
      className: c.className,
      subject: c.subject,
      teacherName: c.teacherName,
      studentCount: c.studentCount,
      days: c.days.map((d) => d.day),
      scheduleLabel: formatClassSchedule(c.days),
      existingPeriods: periodsByClass.get(c.id),
      isSpecial: c.isSpecial, // 반 이동 다이얼로그의 특강 기본 숨김(판정은 isSpecialLecture — 이름 폴백 포함)
    }));

  return (
    <div className="space-y-5">
      {/* 주간 시간표(읽기전용) — 수강 중 반의 전 과목·전 강사 통합 + 과목별 교시 기본뷰 탭. 슬롯 없으면 null. */}
      <StudentWeekGrid rows={current} config={periodsConfig} />
      <Section
        title="수강 중인 수업"
        rows={current}
        kind="current"
        studentId={student.id}
        subjects={subjects}
        canEnd={canEnd}
        canEditDates={canEditDates}
        canEditSchedule={canEditSchedule}
        canDeleteEnrollment={canDeleteEnrollment}
        moveTargets={candidateClasses}
        moveStudent={{ id: student.id, name: student.name, grade: student.grade }}
        action={
          // 반 배정도 학생 기록 변경 — 강사(열람 전용)에겐 숨긴다. 서버 createEnrollment 게이트(full)와 한 쌍(#77).
          canEnd ? (
            <StudentAssignAction
              student={{ id: student.id, name: student.name, grade: student.grade }}
              classes={candidateClasses}
              blockedReason={assignBlockedReason}
            />
          ) : undefined
        }
        note="실제 학생이 등원하는 요일만 표기됩니다"
      />
      <Section title="배정 예정 수업" rows={scheduled} kind="scheduled" studentId={student.id} subjects={subjects} canEnd={canEnd} canEditDates={canEditDates} canEditSchedule={canEditSchedule} canDeleteEnrollment={canDeleteEnrollment} />
      <Section title="지난 수업" rows={past} kind="past" studentId={student.id} subjects={subjects} canEnd={canEnd} canEditDates={canEditDates} canEditSchedule={canEditSchedule} canDeleteEnrollment={canDeleteEnrollment} />
    </div>
  );
}

function Section({
  title,
  rows,
  kind,
  studentId,
  subjects,
  canEnd,
  canEditDates,
  canEditSchedule,
  canDeleteEnrollment,
  moveTargets,
  moveStudent,
  action,
  note,
}: {
  title: string;
  rows: StudentClassRow[];
  kind: "current" | "scheduled" | "past";
  studentId: string;
  subjects: SubjectMaps;
  canEnd: boolean;
  canEditDates: boolean;
  canEditSchedule: boolean;
  canDeleteEnrollment: boolean;
  /** 반 이동 대상 후보(수강 중 섹션에서만) — 있으면 행에 '반 이동' 버튼. */
  moveTargets?: AssignDialogClass[];
  /** 반 이동 다이얼로그 헤더용 학생 정보. */
  moveStudent?: { id: string; name: string; grade: string | null };
  action?: React.ReactNode;
  note?: string;
}) {
  // 수강 종료/반 이동 컬럼: 쓰기 권한 + 비-지난 섹션에서만. 셀 버튼은 재원중(end_date==null)에만 —
  // 이미 종료일이 있는 행엔 버튼을 숨겨 "종료된 행 재클릭 시 팝업 반복" 버그를 막는다.
  const showEndCol = canEnd && kind !== "past";
  // 🔴 삭제(원장 정정)는 **세 구획 전부**에 선다 — 잘못 만든 이력은 대개 '지난 수업'(시작=종료)에 있다.
  //    그래서 액션 열은 '수강 종료'가 없는 구획에서도 열려야 한다.
  const showActionCol = showEndCol || canDeleteEnrollment;
  return (
    <section className="bg-card border-border rounded-2xl border">
      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">
            {title} <span className="text-muted-foreground num font-normal">({rows.length})</span>
          </h2>
          {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
        </div>
        {action}
      </header>
      {rows.length === 0 ? (
        <div className="text-muted-foreground px-5 py-8 text-center text-sm">해당 수업이 없습니다</div>
      ) : (
        <DragScrollArea>
          <table className="w-full min-w-[720px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="border-border text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium">과목</th>
                <th className="px-4 py-2 text-left font-medium">수업명</th>
                <th className="px-4 py-2 text-left font-medium">강사</th>
                <th className="px-4 py-2 text-left font-medium">스케줄</th>
                <th className="px-4 py-2 text-left font-medium">시작</th>
                <th className="px-4 py-2 text-left font-medium">종료</th>
                {showActionCol ? <th className="px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={r.enrollmentId} className="hover:bg-bg-soft/40">
                  <td className="px-4 py-2.5">
                    <Pill color={subjects.colorOf(r.subject)}>{subjects.labelOf(r.subject)}</Pill>
                  </td>
                  {/* 수업명은 길면 **잘라내고 hover 툴팁**으로 보여준다(원장 2026-07-23) — 반 이름이 길어지면
                      (특강·병합반) 표가 옆으로 밀려 다른 열이 화면 밖으로 나갔다. `title`이 이미 전체 이름을
                      담고 있어 잘라도 정보 손실이 없다.
                      ⚠️ 표에 `[&_td]:whitespace-nowrap`이 걸려 있어 td만으론 안 잘린다 — 잘림은
                      **block + max-width**를 가진 안쪽 요소에 걸어야 먹는다. */}
                  <td className="text-foreground max-w-[200px] px-4 py-2.5 font-medium">
                    <WindowLink
                      href={`/classes/${r.classId}`}
                      title={r.className}
                      className="hover:text-primary block overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
                    >
                      {r.className}
                    </WindowLink>
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.teacherName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {canEditSchedule ? (
                      <EditableAttendanceCell enrollmentId={r.enrollmentId} classDays={r.classDays} attendanceDays={r.attendanceDays}>
                        <ScheduleCell schedule={r.schedule} />
                      </EditableAttendanceCell>
                    ) : (
                      <ScheduleCell schedule={r.schedule} />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {canEditDates ? (
                      <EditableDateCell enrollmentId={r.enrollmentId} field="start" value={r.startDate} />
                    ) : (
                      <span className="text-text-dim num">{r.startDate}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {canEditDates ? (
                      <EditableDateCell enrollmentId={r.enrollmentId} field="end" value={r.endDate} />
                    ) : kind === "scheduled" ? (
                      <span className="text-text-faint">—</span>
                    ) : r.endDate ? (
                      <span className="text-amber num font-medium">~{r.endDate}</span>
                    ) : (
                      /* 재원중 = positive(green) — 학생 상태 배지와 같은 뜻·같은 색. */
                      <span className="text-green font-medium">재원중</span>
                    )}
                    {r.onHold ? <span className="text-amber ml-1">(휴원)</span> : null}
                  </td>
                  {showActionCol ? (
                    <td className="px-2 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {showEndCol && r.endDate == null ? (
                          <>
                            {moveTargets && moveStudent ? (
                              <MoveEnrollmentButton
                                enrollmentId={r.enrollmentId}
                                student={moveStudent}
                                currentClassName={r.className}
                                currentClassId={r.classId}
                                currentSubject={r.subject}
                                classes={moveTargets}
                              />
                            ) : null}
                            <EndEnrollmentAction
                              enrollmentId={r.enrollmentId}
                              studentId={studentId}
                              className={r.className}
                              currentEndDate={r.endDate}
                              startDate={r.startDate}
                            />
                          </>
                        ) : null}
                        {canDeleteEnrollment ? (
                          <DeleteEnrollmentButton
                            enrollmentId={r.enrollmentId}
                            className={r.className}
                            periodLabel={r.endDate ? `${r.startDate} ~ ${r.endDate}` : `${r.startDate}부터`}
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </DragScrollArea>
      )}
    </section>
  );
}

function ScheduleCell({ schedule }: { schedule: StudentClassRow["schedule"] }) {
  if (schedule.length === 0) {
    return (
      <span className="text-text-faint inline-flex items-center gap-1 text-xs italic">
        <CalendarDays className="size-3" /> 시간 미정
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {schedule.map((g, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="flex gap-0.5">
            {g.days.map((d) => (
              <span
                key={d}
                className={`inline-flex size-5 items-center justify-center rounded-sm text-[11px] font-bold ${DAY_CHIP[d] ?? "bg-bg-soft text-text-dim"}`}
              >
                {d}
              </span>
            ))}
          </span>
          <span className="text-text-dim text-xs">{g.label}</span>
          {i < schedule.length - 1 ? <span className="text-text-faint">/</span> : null}
        </span>
      ))}
    </div>
  );
}
