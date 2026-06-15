import { getStudentGrades } from "@/features/students/server/queries";
import { GradeForm } from "../_components/grade-form";

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

export async function GradesTab({ studentId }: { studentId: string }) {
  const grades = await getStudentGrades(studentId);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">성적 기록</h2>
        <p className="text-muted-foreground num text-xs">{grades.length}건</p>
      </header>

      <GradeForm studentId={studentId} />

      {grades.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 성적이 없습니다</p>
      ) : (
        <div className="bg-card border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left">시험일</th>
                <th className="micro px-4 py-2 text-left">과목</th>
                <th className="micro px-4 py-2 text-left">시험명</th>
                <th className="micro px-4 py-2 text-right">점수</th>
                <th className="micro px-4 py-2 text-left">메모</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {grades.map((g) => (
                <tr key={g.id} className="hover:bg-bg-soft/30">
                  <td className="num text-muted-foreground px-4 py-2 text-xs">{g.takenOn}</td>
                  <td className="text-foreground px-4 py-2 text-xs font-medium">
                    {SUBJECT_LABEL[g.subject] ?? g.subject}
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs">{g.examName}</td>
                  <td className="num px-4 py-2 text-right text-xs">
                    {g.score == null ? (
                      "—"
                    ) : g.maxScore ? (
                      <>
                        <span className="text-foreground font-medium">{g.score}</span>
                        <span className="text-muted-foreground"> / {g.maxScore}</span>
                      </>
                    ) : (
                      <span className="text-foreground font-medium">{g.score}</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">{g.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
