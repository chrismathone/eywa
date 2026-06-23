import { getStudentLessonReports } from "@/features/students/server/queries";

// ijw StudentDetail ProgressTab 이식 — 최근 수업보고서 표(날짜·선생님·진도·시험·숙제).
// 숙제: assignment_score>0 이면 ○, 아니면 ✕(ijw 동일). 데이터는 Edutrix 이식.
function homeworkMark(score: string | null): string {
  if (score == null) return "—";
  const n = parseInt(score, 10);
  return isNaN(n) || n > 0 ? "○" : "✕";
}

export async function ProgressTab({ studentId }: { studentId: string }) {
  const reports = await getStudentLessonReports(studentId, 12);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">수업 진도</h2>
        <p className="text-muted-foreground num text-xs">최근 {reports.length}건</p>
      </header>

      {reports.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 진도가 없습니다</p>
      ) : (
        <div className="bg-card border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left">날짜</th>
                <th className="micro px-4 py-2 text-left">선생님</th>
                <th className="micro px-4 py-2 text-left">진도</th>
                <th className="micro px-4 py-2 text-center">시험</th>
                <th className="micro px-4 py-2 text-center">숙제</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/30 align-top">
                  <td className="num text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{r.reportDate}</td>
                  <td className="text-foreground px-4 py-2 text-xs whitespace-nowrap">{r.teacherName ?? "—"}</td>
                  <td className="text-foreground break-keep px-4 py-2 text-xs">{r.progress ?? "—"}</td>
                  <td className="num px-4 py-2 text-center text-xs whitespace-nowrap">{r.examInfo ?? "—"}</td>
                  <td className="px-4 py-2 text-center text-xs">{homeworkMark(r.homeworkScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-text-faint text-center text-[11px]">진도 데이터는 Edutrix 수업보고서에서 이식됩니다.</p>
    </div>
  );
}
