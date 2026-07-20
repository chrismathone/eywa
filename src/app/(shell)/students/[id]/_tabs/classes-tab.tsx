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
import { buildSubjectMaps, type SubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { AssignDialogClass } from "@/components/enrollment-assign-dialog";
import { StudentAssignAction } from "../_components/student-assign-action";
import { EndEnrollmentButton } from "../_components/end-enrollment-button";
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
}: {
  student: StudentDetail;
  canEnd: boolean;
  canEditDates: boolean;
  /** 분리등원 요일(스케줄 셀) 더블클릭 편집 노출 — canWriteTenant("classes"). */
  canEditSchedule: boolean;
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

  const activeClassIds = new Set(current.map((r) => r.classId));
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
        moveTargets={candidateClasses}
        moveStudent={{ id: student.id, name: student.name, grade: student.grade }}
        action={
          <StudentAssignAction
            student={{ id: student.id, name: student.name, grade: student.grade }}
            classes={candidateClasses}
          />
        }
        note="실제 학생이 등원하는 요일만 표기됩니다"
      />
      <Section title="배정 예정 수업" rows={scheduled} kind="scheduled" studentId={student.id} subjects={subjects} canEnd={canEnd} canEditDates={canEditDates} canEditSchedule={canEditSchedule} />
      <Section title="지난 수업" rows={past} kind="past" studentId={student.id} subjects={subjects} canEnd={canEnd} canEditDates={canEditDates} canEditSchedule={canEditSchedule} />
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
                {showEndCol ? <th className="px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={r.enrollmentId} className="hover:bg-bg-soft/40">
                  <td className="px-4 py-2.5">
                    <Pill color={subjects.colorOf(r.subject)}>{subjects.labelOf(r.subject)}</Pill>
                  </td>
                  <td className="text-foreground px-4 py-2.5 font-medium">
                    <WindowLink href={`/classes/${r.classId}`} title={r.className} className="hover:text-primary hover:underline">
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
                      <span className="text-primary font-medium">재원중</span>
                    )}
                    {r.onHold ? <span className="text-amber ml-1">(휴원)</span> : null}
                  </td>
                  {showEndCol ? (
                    <td className="px-2 py-2.5 text-right">
                      {r.endDate == null ? (
                        <div className="inline-flex items-center gap-1.5">
                          {moveTargets && moveStudent ? (
                            <MoveEnrollmentButton
                              enrollmentId={r.enrollmentId}
                              student={moveStudent}
                              currentClassName={r.className}
                              classes={moveTargets}
                            />
                          ) : null}
                          <EndEnrollmentButton enrollmentId={r.enrollmentId} studentId={studentId} className={r.className} />
                        </div>
                      ) : null}
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
