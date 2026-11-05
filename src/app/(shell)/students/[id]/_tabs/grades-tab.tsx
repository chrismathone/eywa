
import { SheetText } from "@/features/teacher-view/interface-label";
import {
  getStudentGrades,
  getStudentGradeComments,
  getStudentGradeGoals,
  getStudentLevelTests,
} from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { KIND_LABEL } from "@/features/grades/unified/model";
import { subjectSeriesOf } from "@/features/grades/unified/subject-series";
import { applyLedgerView, parseLedgerView } from "@/features/grades/unified/ledger-view";
import { Pagination } from "@/components/pagination";
import { getStudentUnifiedRows } from "@/features/grades/unified/server/student-records";
import { goalViewsForRows } from "@/features/grades/server/goals";
import { StudentGradeStats } from "@/app/(shell)/exams/_components/student-stats";
import { SubjectTrendChart } from "@/app/(shell)/exams/_components/subject-trend-chart";
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
const PAGE_SIZE = 20;
/** 성적 목록 열 머리 필터·정렬·쪽 — 주소에 싣는 키(탭을 옮기면 탭 링크가 `?tab=`만 실어 저절로 풀린다). */
export const GRADES_QUERY_KEYS = ["subject", "kind", "sort", "dir", "fScore", "fDelta", "page"] as const;

/**
 * canWrite = `canWriteTenant(role, "students")` — 성적·목표·코멘트·레벨테스트 서버 액션 게이트와 같은 판정(page.tsx가 계산).
 * 읽기 권한이면 입력 폼은 비활성 + 안내, 추가·수정·삭제 단추는 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export async function GradesTab({ studentId, query, back, embed, canWrite }: {
  studentId: string; query: Partial<Record<(typeof GRADES_QUERY_KEYS)[number], string>>; back: string | null; embed: boolean; canWrite: boolean;
}) {
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
  // 과목별 선(원장 2026-10-30 — 영어·수학을 색으로 가른다). 통합 성적관리 '학생 추이'와 같은 함수.
  const series = subjectSeriesOf(rows, subjectMaps);
  const pointCount = new Set(series.flatMap((s) => s.points.map((p) => p.month))).size;

  // 목록 — 지표·추이는 **학생 전체**, 목록만 열 머리 필터·정렬·쪽(통합 성적관리 원장과 같은 판정 `applyLedgerView`).
  const subject = query.subject ?? "";
  const kind = query.kind ?? "";
  const view = parseLedgerView(query);
  const listed = applyLedgerView(rows.filter((r) => (!subject || r.subject === subject) && (!kind || r.kind === kind)), view);
  const totalPages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), totalPages);
  const pageRows = listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // 줄마다 목표 대비 — /exams 성적 현황과 같은 함수(원장 2026-09-24 "모든 면에서 일치").
  const goalViews = await goalViewsForRows(pageRows);
  // 🔴 창(iframe) 안이면 링크가 embed=1을 싣는다([[#133]]) · back은 페이지가 검증한 내부 경로만 온다.
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: "grades", ...query, ...(back ? { back } : {}), ...(embed ? { embed: "1" } : {}), ...patch })) if (v) q.set(k, v);
    return `/students/${studentId}?${q.toString()}`;
  };
  const filterOptions = {
    subject, kind,
    subjects: [...new Set(rows.map((r) => r.subject))].map((s) => ({ value: s, label: subjectLabels[s] ?? s })).sort((a, b) => a.label.localeCompare(b.label, "ko")),
    kinds: (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).filter((k) => rows.some((r) => r.kind === k)).map((k) => ({ value: k, label: KIND_LABEL[k] })),
  };

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"성적 기록"} /></h2>
        <p className="text-muted-foreground num text-xs">{rows.length}<SheetText value={"건"} /></p>
      </header>

      {rows.length > 0 ? (
        <>
          <StudentGradeStats rows={rows} subjectLabelOf={subjectMaps.labelOf} />
          <div className="bg-card border-border rounded-2xl border p-4">
            <p className="micro"><SheetText value={"성적 흐름 · 과목별 월별 평균 정답률"} /></p>
            {pointCount >= 2 || series.length > 1 ? <SubjectTrendChart series={series} /> : (
              <p className="text-muted-foreground mt-2 text-xs">
                {series.map((s) => `${s.label} ${s.count}건 · 평균 ${s.average ?? "—"}${s.average == null ? "" : "%"}`).join(" · ")} — 두 달 이상 쌓이면 흐름을 그립니다.
              </p>
            )}
          </div>
        </>
      ) : null}

      {/* JJ실 학습(인재원)은 2026-09-21에 **'SRS 성적' 탭**으로 옮겼다(원장 지시: 일반 성적과 분리).
          이 탭에 다시 끌어오지 말 것 — 두 탭이 같은 구역을 그리면 기간 칩이 서로를 튕겨 낸다. */}
      <div className="border-border border-t pt-4">
        <GoalsSection studentId={studentId} goals={goals} canWrite={canWrite} />
      </div>

      <GradeForm studentId={studentId} subjectOptions={subjectMaps.options} canWrite={canWrite} />

      <StudentGradeRecords rows={pageRows} studentId={studentId} notesById={notesById} subjectLabel={subjectLabels}
        view={view} href={href} filters={filterOptions} goals={goalViews} canWrite={canWrite} />
      {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} total={listed.length} hrefForPage={(p) => href({ page: String(p) })} /> : null}

      {/* 성적 코멘트 · 레벨테스트 — 둘 다 짧은 목록이라 세로로만 쌓으면 넓은 창에서 오른쪽이 통째로 빈다.
          폭이 되면 나란히(auto-fit), 좁으면 접힘. 구분선은 두 줄이 겹치지 않게 그리드 바깥에 한 번만.
          (목표 섹션은 입력폼·성적표 위라 인접하지 않아 그대로 둔다 — 순서를 바꾸면 입력 흐름이 깨진다.) */}
      <div className="border-border grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-x-6 gap-y-4 border-t pt-4">
        <GradeCommentsSection studentId={studentId} comments={comments} canWrite={canWrite} />
        <LevelTests studentId={studentId} tests={levelTests} canWrite={canWrite} />
      </div>
    </div>
  );
}
