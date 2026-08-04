import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getStaffOptions } from "@/features/meetings/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NewReviewForm } from "../_components/new-review-form";

export const metadata = { title: "새 참관 — eywa" };

/** 새 참관 건 — 헤더(강사·과목·반·회차 등) + 참관자 지정. 생성 후 상세에서 각자 채점. */
export default async function NewClassReviewPage() {
  await requireAccess("class_review");
  const [staff, settings] = await Promise.all([getStaffOptions(), getTenantSettings()]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader eyebrow="수업 평가" title="새 참관" description="참관 정보를 입력하고 평가자를 지정합니다." embedLabel="새 참관" />
      <NewReviewForm
        staff={staff.map((s) => ({ value: s.id, label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name }))}
        subjects={subjects.options}
      />
    </div>
  );
}
