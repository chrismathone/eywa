import { getStudentGrades } from "@/features/students/server/queries";
import { gradeSeries, gradeStats } from "@/lib/calc/grades";
import { GradeForm } from "../_components/grade-form";
import { GradesChart } from "../_components/grades-chart";

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card border-border rounded-md border px-3 py-2.5">
      <p className="micro">{label}</p>
      <p className={`tabular mt-1 text-lg leading-none ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export async function GradesTab({ studentId }: { studentId: string }) {
  const grades = await getStudentGrades(studentId);
  const stats = gradeStats(grades);
  const series = gradeSeries(grades);
  const deltaTone =
    stats.delta == null ? undefined : stats.delta >= 0 ? "text-chart-2" : "text-chart-4";
  const deltaStr =
    stats.delta == null ? "—" : `${stats.delta >= 0 ? "+" : ""}${stats.delta}p`;

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">성적 기록</h2>
        <p className="text-muted-foreground num text-xs">{grades.length}건</p>
      </header>

      {stats.count > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Kpi label="전체 평균" value={stats.avgPct == null ? "—" : `${stats.avgPct}%`} />
            <Kpi label="최근 평균" value={stats.recentAvgPct == null ? "—" : `${stats.recentAvgPct}%`} />
            <Kpi label="향상도" value={deltaStr} tone={deltaTone} />
            <Kpi label="최고 / 최저" value={`${stats.bestPct ?? "—"} / ${stats.worstPct ?? "—"}`} />
          </div>
          {series.length >= 2 ? (
            <div className="bg-card border-border rounded-md border p-4">
              <p className="micro mb-2">점수 추이 (기준선 70%)</p>
              <GradesChart series={series} />
            </div>
          ) : null}
        </>
      ) : null}

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
