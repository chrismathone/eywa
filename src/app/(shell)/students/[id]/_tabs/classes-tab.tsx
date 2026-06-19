import { CalendarDays } from "lucide-react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { Pill, type PillColor } from "@/components/atoms/pill";
import {
  getStudentClassesDetail,
  type StudentClassRow,
  type StudentDetail,
} from "@/features/students/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { StudentAssignAction } from "../_components/student-assign-action";
import { EndEnrollmentButton } from "../_components/end-enrollment-button";

const SUBJECT_COLOR: Record<string, PillColor> = {
  math: "primary",
  highmath: "primary",
  english: "blue",
  korean: "rose",
  science: "purple",
  arts: "amber",
};

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

/** 수업 탭(ijw CoursesTab 이식) — 수강 중/배정 예정/지난 3섹션 + 스케줄(요일+교시)·강사·인원. */
export async function ClassesTab({ student }: { student: StudentDetail }) {
  const [rows, allActiveClasses, settings] = await Promise.all([
    getStudentClassesDetail(student.id),
    getClassesList({ active: "active" }),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  // eslint-disable-next-line react-hooks/purity -- 서버 컴포넌트는 요청당 1회 렌더(today는 안정)
  const today = new Date().toISOString().slice(0, 10);
  const hasEnded = (r: StudentClassRow) => (r.endDate ? r.endDate < today : false);
  const current = rows.filter((r) => !hasEnded(r) && r.startDate <= today);
  const scheduled = rows.filter((r) => !hasEnded(r) && r.startDate > today);
  const past = rows.filter((r) => hasEnded(r));

  const activeClassIds = new Set(current.map((r) => r.classId));
  const candidateClasses = allActiveClasses.filter((c) => !activeClassIds.has(c.id));

  return (
    <div className="space-y-5">
      <Section
        title="수강 중인 수업"
        rows={current}
        kind="current"
        studentId={student.id}
        subjects={subjects}
        action={
          <StudentAssignAction
            student={{ id: student.id, name: student.name, grade: student.grade }}
            classes={candidateClasses.map((c) => ({
              id: c.id,
              className: c.className,
              subject: c.subject,
              teacherName: c.teacherName,
              studentCount: c.studentCount,
            }))}
          />
        }
        note="실제 학생이 등원하는 요일만 표기됩니다"
      />
      <Section title="배정 예정 수업" rows={scheduled} kind="scheduled" studentId={student.id} subjects={subjects} />
      <Section title="지난 수업" rows={past} kind="past" studentId={student.id} subjects={subjects} />
    </div>
  );
}

function Section({
  title,
  rows,
  kind,
  studentId,
  subjects,
  action,
  note,
}: {
  title: string;
  rows: StudentClassRow[];
  kind: "current" | "scheduled" | "past";
  studentId: string;
  subjects: { labelOf: (k: string) => string };
  action?: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
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
                <th className="px-4 py-2 text-right font-medium">인원</th>
                <th className="px-4 py-2 text-left font-medium">시작</th>
                <th className="px-4 py-2 text-left font-medium">종료</th>
                {kind !== "past" ? <th className="px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={r.enrollmentId} className="hover:bg-bg-soft/40">
                  <td className="px-4 py-2.5">
                    <Pill color={SUBJECT_COLOR[r.subject] ?? "neutral"}>{subjects.labelOf(r.subject)}</Pill>
                  </td>
                  <td className="text-foreground px-4 py-2.5 font-medium">{r.className}</td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.teacherName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <ScheduleCell schedule={r.schedule} />
                  </td>
                  <td className="text-text-dim num px-4 py-2.5 text-right text-xs">{r.studentCount}명</td>
                  <td className="text-text-dim num px-4 py-2.5 text-xs">{r.startDate}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {kind === "scheduled" ? (
                      <span className="text-text-faint">—</span>
                    ) : r.endDate ? (
                      <span className="text-amber num font-medium">~{r.endDate}</span>
                    ) : (
                      <span className="text-primary font-medium">재원중</span>
                    )}
                    {r.onHold ? <span className="text-amber ml-1">(휴원)</span> : null}
                  </td>
                  {kind !== "past" ? (
                    <td className="px-2 py-2.5 text-right">
                      <EndEnrollmentButton enrollmentId={r.enrollmentId} studentId={studentId} className={r.className} />
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
                className={`inline-flex size-5 items-center justify-center rounded-sm text-[11px] font-semibold ${DAY_CHIP[d] ?? "bg-bg-soft text-text-dim"}`}
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
