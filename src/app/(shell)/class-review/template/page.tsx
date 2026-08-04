import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getChecklistAreas, getReviewPrivileges } from "@/features/class-review/server/queries";
import { TemplateEditor } from "../_components/template-editor";

export const metadata = { title: "수업 평가 문항 편집 — eywa" };

/** 문항 편집 — 원장 + class_review 개인 예외 인원만(원장 지시 2026-08-04). */
export default async function ClassReviewTemplatePage() {
  const viewer = await requireAccess("class_review");
  const priv = await getReviewPrivileges(viewer);
  if (!priv.editTemplate) redirect("/class-review");
  const areas = await getChecklistAreas(viewer.tenantId);

  return (
    <div className="space-y-5 p-6">
      <div>
        <Link
          href="/class-review"
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 목록으로
        </Link>
        <PageHeader
          eyebrow="수업 평가"
          title="문항 편집"
          description="영역 제목과 문항을 수정합니다 — 저장하면 새 채점부터 적용됩니다."
          embedLabel="수업 평가 문항 편집"
        />
      </div>
      <TemplateEditor initialAreas={areas} />
    </div>
  );
}
