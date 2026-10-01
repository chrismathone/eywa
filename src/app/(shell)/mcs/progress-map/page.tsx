import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MathProgressDashboard } from "@/features/math-progress-map/components/math-progress-dashboard";
import { buildSampleProgress } from "@/features/math-progress-map/sample";
import { canPreviewProgressMap } from "@/features/math-progress-map/server/access";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentLearningMap } from "@/features/math-progress-map/server/learning-map-query";
import { learningSheetHref } from "@/features/math-progress-map/learning-map";

export const metadata: Metadata = { title: "수학 학습 진도맵 — 에이와" };

/** Real maps share the MCS class gate and roster. The unbound design preview keeps its admin gate. */
export default async function ProgressMapPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("mcs");
  const params = await searchParams;
  if (params.classId !== undefined || params.student !== undefined) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof params.classId !== "string" || typeof params.student !== "string"
      || !uuid.test(params.classId) || !uuid.test(params.student)) notFound();
    const result = await getStudentLearningMap(params.classId, params.student, typeof params.month === "string" ? params.month : null);
    if (result.status === "not-found") notFound();
    // 기존 북마크도 학생 전환·목표 편집이 있는 집중 보기로 합친다.
    const selection = new URLSearchParams();
    for (const key of ["date", "view", "display", "topic", "lesson", "undated", "embed"]) {
      if (typeof params[key] === "string") selection.set(key, params[key]);
    }
    redirect(`${learningSheetHref(result.classId, result.student.studentId, result.month)}${selection.size ? `&${selection}` : ""}`);
  }
  if (!(await canPreviewProgressMap())) notFound();
  const progress = buildSampleProgress();
  return (
    <div className="flex flex-col gap-4">
      <div data-page-header-slot="" className="compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="수학 학습 진도맵"
          description="학생 한 명의 연간 커리큘럼 위치 — 시안(샘플 데이터)"
        />
      </div>
      <MathProgressDashboard progress={progress} />
    </div>
  );
}
