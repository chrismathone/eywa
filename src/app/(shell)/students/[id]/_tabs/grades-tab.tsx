import {
  getStudentGrades,
  getStudentGradeComments,
  getStudentGradeGoals,
  getStudentLevelTests,
} from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { gradeSeries, gradeStats } from "@/lib/calc/grades";
import { EXAM_SLOT_LABEL } from "@/features/grades/exam-slots";
import { termLabel } from "@/features/grades/term";
import { GradeForm } from "../_components/grade-form";
import { GradesChart } from "../_components/grades-chart";
import { GoalsSection } from "../_components/goals-section";
import { GradeCommentsSection } from "../_components/grade-comments-section";
import { LevelTests } from "../_components/level-tests";
import { DeleteGradeButton } from "../_components/delete-grade-button";
import { Suspense } from "react";
import { StudentJjSection } from "../_components/jj-section";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card border-border rounded-2xl border px-3 py-2.5">
      <p className="micro">{label}</p>
      <p className={`tabular mt-1 text-lg leading-none ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export async function GradesTab({
  studentId,
  jjFrom,
  jjTo,
}: {
  studentId: string;
  /** JJ실 학습 기간(학습일, 주소 `jjFrom`·`jjTo`) — 성적관리 JJ실이 같은 기간을 싣고 넘어온다. 없으면 최근 30일. */
  jjFrom?: string;
  jjTo?: string;
}) {
  const [grades, levelTests, settings, goals, comments] = await Promise.all([
    getStudentGrades(studentId),
    getStudentLevelTests(studentId),
    getTenantSettings(),
    getStudentGradeGoals(studentId),
    getStudentGradeComments(studentId),
  ]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectLabels = subjectLabelRecord(settings.operations.subjects);
  const stats = gradeStats(grades);
  const series = gradeSeries(grades);
  const deltaTone =
    stats.delta == null ? undefined : stats.delta >= 0 ? "text-chart-2" : "text-chart-4";
  const deltaStr =
    stats.delta == null ? "—" : `${stats.delta >= 0 ? "+" : ""}${stats.delta}p`;

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold">성적 기록</h2>
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
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="micro mb-2">점수 추이 (기준선 70%)</p>
              <GradesChart series={series} subjectLabels={subjectLabels} />
            </div>
          ) : null}
        </>
      ) : null}

      {/* JJ실 학습(인재원, 2026-09-10) — 짝이 걸린 학생만. 인재원 호출이 성적 탭 첫 페인트를 막지 않게 따로 흘린다(B7). */}
      <Suspense fallback={null}>
        <StudentJjSection studentId={studentId} jjFrom={jjFrom} jjTo={jjTo} />
      </Suspense>

      <div className="border-border border-t pt-4">
        <GoalsSection studentId={studentId} goals={goals} />
      </div>

      <GradeForm studentId={studentId} subjectOptions={subjectMaps.options} />

      {grades.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 성적이 없습니다</p>
      ) : (
        <div className="bg-card border-border overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left">시험일</th>
                <th className="micro px-4 py-2 text-left">과목</th>
                <th className="micro px-4 py-2 text-left">시험명</th>
                <th className="micro px-4 py-2 text-right">점수</th>
                <th className="micro px-4 py-2 text-left">메모</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {grades.map((g) => (
                <tr key={g.id} className="hover:bg-bg-soft/30">
                  <td className="num text-muted-foreground px-4 py-2 text-xs">{g.takenOn}</td>
                  <td className="text-foreground px-4 py-2 text-xs font-medium">
                    {subjectMaps.labelOf(g.subject)}
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs">
                    {/* 학기 축(0282a)이 있으면 `2026년 2학기 · 중간고사`. 옛 자유 입력 행·SQL 미적용 창에선
                        시험명만 선다(없는 것을 지어내지 않는다, [[#95]]). */}
                    {g.schoolYear != null && g.term != null ? (
                      <span className="text-muted-foreground">
                        {termLabel(g.schoolYear, g.term)}
                        <span className="px-1">·</span>
                      </span>
                    ) : null}
                    <span className="text-foreground">
                      {g.examSlot ? EXAM_SLOT_LABEL[g.examSlot] : g.examName}
                    </span>
                  </td>
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
                  <td className="px-4 py-2 text-right">
                    <DeleteGradeButton
                      gradeId={g.id}
                      studentId={studentId}
                      label={g.examName || subjectMaps.labelOf(g.subject)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 성적 코멘트 · 레벨테스트 — 둘 다 짧은 목록이라 세로로만 쌓으면 넓은 창에서 오른쪽이 통째로 빈다.
          폭이 되면 나란히(auto-fit), 좁으면 접힘. 구분선은 두 줄이 겹치지 않게 그리드 바깥에 한 번만.
          (목표 섹션은 입력폼·성적표 위라 인접하지 않아 그대로 둔다 — 순서를 바꾸면 입력 흐름이 깨진다.) */}
      <div className="border-border grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-x-6 gap-y-4 border-t pt-4">
        <GradeCommentsSection studentId={studentId} comments={comments} />
        <LevelTests studentId={studentId} tests={levelTests} />
      </div>
    </div>
  );
}
