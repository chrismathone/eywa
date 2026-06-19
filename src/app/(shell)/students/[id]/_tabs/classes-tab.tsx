import {
  getStudentEnrollments,
  type StudentDetail,
} from "@/features/students/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { StudentAssignAction } from "../_components/student-assign-action";

/** 수업 탭 — 학생이 수강 중인 반 목록 + 반 배정. (ijw "수업" 탭 대응) */
export async function ClassesTab({ student }: { student: StudentDetail }) {
  const [enrollments, allActiveClasses, settings] = await Promise.all([
    getStudentEnrollments(student.id),
    getClassesList({ active: "active" }),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  // 이미 활성 enrollment인 반은 배정 후보에서 제외
  const activeClassIds = new Set(enrollments.filter((e) => !e.endDate).map((e) => e.classId));
  const candidateClasses = allActiveClasses.filter((c) => !activeClassIds.has(c.id));
  const activeCount = enrollments.filter((e) => !e.endDate).length;

  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex items-center justify-between border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">수강 중인 수업</h2>
          <p className="text-muted-foreground num text-xs">
            전체 {enrollments.length}건 · 수강 중 {activeCount}건
          </p>
        </div>
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
      </header>
      {enrollments.length === 0 ? (
        <div className="text-muted-foreground px-5 py-10 text-center text-sm">
          등록된 반이 없습니다
        </div>
      ) : (
        <ul className="divide-border divide-y">
          {enrollments.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-primary mr-2 text-xs font-semibold">
                    {subjects.labelOf(e.subject)}
                  </span>
                  {e.className}
                </p>
                <p className="text-muted-foreground text-xs">
                  <span className="num">{e.startDate}</span>
                  {e.endDate ? (
                    <>
                      {" "}
                      ~ <span className="num">{e.endDate}</span>
                    </>
                  ) : (
                    <> ~ 현재</>
                  )}
                </p>
              </div>
              {e.endDate ? (
                <span className="text-muted-foreground bg-muted border-border shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium">
                  수강 종료
                </span>
              ) : e.onHold ? (
                <span className="text-chart-3 bg-chart-3/10 border-chart-3/20 shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium">
                  휴원
                </span>
              ) : (
                <span className="text-chart-2 bg-chart-2/10 border-chart-2/20 shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium">
                  수강 중
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
