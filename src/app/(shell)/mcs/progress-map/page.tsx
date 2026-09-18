import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MathProgressDashboard } from "@/features/math-progress-map/components/math-progress-dashboard";
import { buildSampleProgress } from "@/features/math-progress-map/sample";
import { canPreviewProgressMap } from "@/features/math-progress-map/server/access";
import { requireAccess } from "@/lib/auth/require-access";
import { EmbedLink } from "@/components/embed-link";
import { getStudentLearningMap } from "@/features/math-progress-map/server/learning-map-query";
import { LinkedLearningMap } from "@/features/math-progress-map/components/linked-learning-map";
import { learningSheetHref } from "@/features/math-progress-map/learning-map";

export const metadata: Metadata = { title: "수학 학습 진도맵 — eywa" };

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
    if (result.status !== "ok") return <div className="space-y-4 p-6">
      <PageHeader title={`${result.student.name} 학습 진도맵`} />
      <p role="status">{result.status === "failed" ? "목표 또는 발송 보고서를 불러오지 못했습니다. 다시 새로고침해 주세요." : "MCS에서 전체 학습 목표를 설정해 주세요."}</p>
      <EmbedLink href={learningSheetHref(result.classId, result.student.studentId, result.month)}>MCS로 돌아가기</EmbedLink>
    </div>;
    const initialQuery = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
    const sourceKey = JSON.stringify([result.classId, result.student.studentId, result.month, result.goal,
      result.progress.referenceDate, result.progress.currentBlock, result.progress.history?.start]);
    return <LinkedLearningMap key={sourceKey} {...result} initialQuery={initialQuery} />;
  }
  if (!(await canPreviewProgressMap())) notFound();
  const progress = buildSampleProgress();
  return (
    <div className="flex flex-col gap-4">
      <div className="compact-chrome:hidden">
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
