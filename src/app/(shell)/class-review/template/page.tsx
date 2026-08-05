import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getChecklistTemplates, getReviewPrivileges } from "@/features/class-review/server/queries";
import { CHECKLIST_AREAS } from "@/features/class-review/checklist";
import { TemplateEditor } from "../_components/template-editor";

export const metadata = { title: "수업 평가 문항 편집 — eywa" };

/**
 * 문항 세트 관리 — 원장 + class_review 개인 예외 인원만(원장 지시 2026-08-04).
 * 세트 여러 개(원장 지시 2026-08-05 "1번 문항세트 2번 문항세트") — 위 칩에서 고르고 아래에서 편집.
 * 새 세트의 시작 문항은 내장 기본 30문항(빈 종이보다 고쳐 쓰는 게 빠르다).
 */
export default async function ClassReviewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string; new?: string }>;
}) {
  const viewer = await requireAccess("class_review");
  const priv = await getReviewPrivileges(viewer);
  if (!priv.editTemplate) redirect("/class-review");

  const { set, new: isNew } = await searchParams;
  const templates = await getChecklistTemplates(viewer.tenantId);
  const creating = isNew === "1" || templates.length === 0;
  const selected = creating ? null : (templates.find((t) => t.id === set) ?? templates[0]);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <div>
        <Link
          href="/class-review"
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 목록으로
        </Link>
        <PageHeader
          eyebrow="수업 평가"
          title="문항 세트 관리"
          description="문항 세트를 여러 개 두고, 새 평가를 만들 때 골라 씁니다 — 기존 평가지는 만들 당시 문항을 그대로 유지합니다."
          embedLabel="수업 평가 문항 세트"
        />
      </div>

      {/* 세트 선택 칩 — 편집 대상 전환 + 새 세트 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/class-review/template?set=${t.id}`}
            aria-current={selected?.id === t.id ? "true" : undefined}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              selected?.id === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-card text-text-dim hover:text-primary shadow-card"
            }`}
          >
            {t.name}
          </Link>
        ))}
        <Link
          href="/class-review/template?new=1"
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition ${
            creating
              ? "bg-primary text-primary-foreground"
              : "border-line-strong text-text-dim hover:text-primary border border-dashed"
          }`}
        >
          <Plus className="size-3" /> 새 세트
        </Link>
      </div>

      <TemplateEditor
        key={selected?.id ?? "new"}
        templateId={selected?.id}
        initialName={selected?.name ?? `${templates.length + 1}번 문항 세트`}
        initialAreas={selected?.areas ?? CHECKLIST_AREAS}
      />
    </div>
  );
}
