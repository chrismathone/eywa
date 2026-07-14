import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { Pill } from "@/components/atoms/pill";
import { getDocumentById } from "@/features/documents/server/queries";
import { CATEGORY_LABEL, fileTypeLabel, formatFileSize, formViewHref } from "@/features/documents/categories";
import { DocumentDetailClient } from "./_components/document-detail-client";

export const metadata = { title: "문서 상세 — eywa" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("documents");
  const { id } = await params;
  const [doc, canWrite] = await Promise.all([
    getDocumentById(id),
    canWriteTenant(user.systemRole, "documents"),
  ]);
  if (!doc) notFound();
  // 폼 문서(직원 이력서·환불 요청서 등)는 전용 뷰가 따로 — 텍스트 상세/수정 폼으로 열면 body가 없어 깨진다.
  if (doc.kind === "form") redirect(formViewHref(doc.formType, doc.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <BackLink href="/documents" label="데이터베이스로" />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill color="neutral">{CATEGORY_LABEL[doc.category]}</Pill>
          <Pill color={doc.kind === "file" ? "blue" : "primary"}>
            {fileTypeLabel(doc.kind, doc.fileName, doc.mimeType)}
          </Pill>
        </div>
        <h1 className="text-foreground text-xl font-bold">{doc.title}</h1>
        <p className="text-text-dim text-sm">
          {new Date(doc.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 등록
          {doc.uploaderName ? ` · ${doc.uploaderName}` : ""}
          {doc.kind === "file" ? ` · ${formatFileSize(doc.fileSize)}` : ""}
        </p>
      </header>

      <DocumentDetailClient
        doc={{
          id: doc.id,
          title: doc.title,
          category: doc.category,
          kind: doc.kind,
          description: doc.description,
          fileName: doc.fileName,
          body: doc.body,
        }}
        canWrite={canWrite}
      />
    </div>
  );
}
