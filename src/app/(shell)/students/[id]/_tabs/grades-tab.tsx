import {
  getStudentGrades,
  getStudentGradeComments,
  getStudentGradeGoals,
  getStudentLevelTests,
} from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { aggregateBy } from "@/features/grades/unified/model";
import { getStudentUnifiedRows } from "@/features/grades/unified/server/student-records";
import { StudentGradeStats } from "@/app/(shell)/exams/_components/student-stats";
import { TrendChart } from "@/app/(shell)/exams/_components/trend-chart";
import { GradeForm } from "../_components/grade-form";
import { GoalsSection } from "../_components/goals-section";
import { GradeCommentsSection } from "../_components/grade-comments-section";
import { LevelTests } from "../_components/level-tests";
import { StudentGradeRecords } from "../_components/student-grade-records";

/**
 * 학생 상세 '성적' — 통합 성적관리와 **같은 기록·같은 계산**(원장 2026-09-24 *"꼼꼼히 배선해서 모든 면에서 일치"*).
 * 지표 4칸·추이는 통합 성적관리 '학생 추이'와 같은 부품이고, 목록엔 수업보고서 일일·확인테스트도 선다.
 * 입력은 여전히 이 탭의 폼(성적 입력 표 — 통합 성적관리와 같은 저장 경로 `writeGradeCells`).
 */
export async function GradesTab({ studentId }: { studentId: string }) {
  const [rows, grades, levelTests, settings, goals, comments] = await Promise.all([
    getStudentUnifiedRows(studentId),
    getStudentGrades(studentId),
    getStudentLevelTests(studentId),
    getTenantSettings(),
    getStudentGradeGoals(studentId),
    getStudentGradeComments(studentId),
  ]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectLabels = subjectLabelRecord(settings.operations.subjects);
  const notesById = Object.fromEntries(grades.map((g) => [g.id, g.notes]));
  const points = aggregateBy(rows, "academy")[0]?.points ?? [];

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold">성적 기록</h2>
        <p className="text-muted-foreground num text-xs">{rows.length}건</p>
      </header>

      {rows.length > 0 ? (
        <>
          <StudentGradeStats rows={rows} />
          {points.length >= 2 ? (
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="micro">성적 흐름 · 월별 평균 정답률</p>
              <TrendChart points={points} />
            </div>
          ) : null}
        </>
      ) : null}

      {/* JJ실 학습(인재원)은 2026-09-21에 **'SRS 성적' 탭**으로 옮겼다(원장 지시: 일반 성적과 분리).
          이 탭에 다시 끌어오지 말 것 — 두 탭이 같은 구역을 그리면 기간 칩이 서로를 튕겨 낸다. */}
      <div className="border-border border-t pt-4">
        <GoalsSection studentId={studentId} goals={goals} />
      </div>

      <GradeForm studentId={studentId} subjectOptions={subjectMaps.options} />

      <StudentGradeRecords rows={rows} studentId={studentId} notesById={notesById} subjectLabel={subjectLabels} />

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
