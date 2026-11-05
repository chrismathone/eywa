import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffOptions } from "@/features/meetings/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getChecklistTemplates, getReviewViewer } from "@/features/class-review/server/queries";
import { NewReviewForm } from "../_components/new-review-form";

export const metadata = { title: "새 평가 — 에이와" };

/**
 * 새 평가 건 — 강사·과목·문항 세트 + 평가자 지정. 날짜는 생성 당일 자동(원장 지시 2026-08-05).
 * 강사 직급은 자기 평가 전용(원장 2026-08-19)이라 개설은 사무실 몫 — 서버 액션이 거절하므로
 * 폼(직원 명단이 다 보이는 화면)을 아예 열지 않는다.
 * 읽기 권한(주소로 바로 들어온 경우)은 양식을 보여 주되 칸을 잠그고 '평가 만들기'를 그리지 않는다 —
 * 판정은 서버 액션(requireWrite)과 같은 canWriteTenant("class_review")(원장 2026-11-05).
 */
export default async function NewClassReviewPage() {
  const viewer = await requireAccess("class_review");
  if ((await getReviewViewer()).selfOnly) redirect("/class-review");
  const [staff, settings, templates, canWrite] = await Promise.all([
    getStaffOptions(),
    getTenantSettings(),
    getChecklistTemplates(viewer.tenantId),
    canWriteTenant(viewer.systemRole, "class_review"),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader eyebrow="직원 평가" title="새 평가" description="평가 대상과 평가자 방식을 정합니다." embedLabel="새 평가" />
      <NewReviewForm
        staff={staff.map((s) => ({ value: s.id, label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name }))}
        subjects={subjects.options}
        templates={templates.map((t) => ({ value: t.id, label: t.name }))}
        canWrite={canWrite}
      />
    </div>
  );
}
