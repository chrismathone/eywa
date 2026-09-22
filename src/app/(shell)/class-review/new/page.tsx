import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getStaffOptions } from "@/features/meetings/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getChecklistTemplates, getReviewViewer } from "@/features/class-review/server/queries";
import { NewReviewForm } from "../_components/new-review-form";

export const metadata = { title: "새 평가 — aywa" };

/**
 * 새 평가 건 — 강사·과목·문항 세트 + 평가자 지정. 날짜는 생성 당일 자동(원장 지시 2026-08-05).
 * 강사 직급은 자기 평가 전용(원장 2026-08-19)이라 개설은 사무실 몫 — 서버 액션이 거절하므로
 * 폼(직원 명단이 다 보이는 화면)을 아예 열지 않는다.
 */
export default async function NewClassReviewPage() {
  const viewer = await requireAccess("class_review");
  if ((await getReviewViewer()).selfOnly) redirect("/class-review");
  const [staff, settings, templates] = await Promise.all([
    getStaffOptions(),
    getTenantSettings(),
    getChecklistTemplates(viewer.tenantId),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader eyebrow="수업 평가" title="새 평가" description="평가 대상과 평가자 방식을 정합니다." embedLabel="새 평가" />
      <NewReviewForm
        staff={staff.map((s) => ({ value: s.id, label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name }))}
        subjects={subjects.options}
        templates={templates.map((t) => ({ value: t.id, label: t.name }))}
      />
    </div>
  );
}
