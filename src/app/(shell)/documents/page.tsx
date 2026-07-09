import { Folder, FolderOpen, Files } from "lucide-react";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import {
  getDocumentCategoryCounts,
  getDocumentsPage,
} from "@/features/documents/server/queries";
import {
  CATEGORY_LABEL,
  DOCUMENT_CATEGORIES,
  fileTypeLabel,
  formatFileSize,
  formViewHref,
  type DocumentCategory,
} from "@/features/documents/categories";
import { DocumentToolbar } from "./_components/document-toolbar";
import { DocumentRow } from "./_components/document-row";

export const metadata = { title: "데이터베이스 — eywa" };

const PAGE_SIZE = 50;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; page?: string }>;
}) {
  const user = await requireAccess("documents");
  const sp = await searchParams;
  const cat = (DOCUMENT_CATEGORIES as readonly string[]).includes(sp.cat ?? "")
    ? (sp.cat as DocumentCategory)
    : null;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, counts, canWrite] = await Promise.all([
    getDocumentsPage({ category: cat ?? undefined, q }, page, PAGE_SIZE),
    getDocumentCategoryCounts(),
    canWriteTenant(user.systemRole, "documents"),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 폴더/페이지 href — 필터 바꾸면 page 리셋(파라미터 미포함), pageHref만 p>1일 때 page 세팅.
  const folderHref = (c: DocumentCategory | null) => {
    const p = new URLSearchParams();
    if (c) p.set("cat", c);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (cat) params.set("cat", cat);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  const folders: { key: DocumentCategory | null; label: string; count: number }[] = [
    { key: null, label: "전체 문서", count: counts.all },
    ...DOCUMENT_CATEGORIES.map((c) => ({ key: c as DocumentCategory | null, label: CATEGORY_LABEL[c], count: counts[c] })),
  ];

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">운영 · 서식 저장소</p>
          <h1 className="text-foreground mt-1 text-xl font-bold">데이터베이스</h1>
          <p className="text-text-dim mt-1 text-sm">
            학원 각종 서식을 보관합니다 — 빈 양식을 내려받아 작성하거나, 앱에서 문서를 작성해 두세요.
          </p>
        </div>
        <DocumentToolbar canWrite={canWrite} initialQuery={q} category={cat} />
      </header>

      {/* 탐색기 레이아웃 — 넓은 창: 좌 폴더 팬 + 우 상세 테이블 / 좁은 창: 폴더가 상단 칩으로 접힘 */}
      <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-4">
        <nav aria-label="문서 분류" className="mb-3 flex flex-wrap gap-1 lg:mb-0 lg:flex-col">
          {folders.map((f) => {
            const active = f.key === cat;
            const Icon = active ? FolderOpen : Folder;
            return (
              <Link
                key={f.key ?? "all"}
                href={folderHref(f.key)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-text-dim hover:bg-bg-soft hover:text-foreground"
                }`}
              >
                <Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-amber"}`} strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                <span className="text-text-faint num text-xs whitespace-nowrap">{f.count}</span>
              </Link>
            );
          })}
        </nav>

        <section className="bg-card border-line rounded-md border">
          <div className="border-line text-text-dim flex items-center justify-between border-b px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Files className="size-3.5" />
              {cat ? CATEGORY_LABEL[cat] : "전체 문서"} · {total}건
            </span>
            {totalPages > 1 ? (
              <span className="whitespace-nowrap">
                {page}/{totalPages} 페이지
              </span>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState
              image={q ? "search" : "documents"}
              title={q ? "검색 결과가 없습니다" : "아직 문서가 없습니다"}
              description={
                canWrite ? "우측 상단 '업로드'로 서식 파일을 올리거나 '새 문서'를 작성하세요." : "관리자가 서식을 올리면 여기에 표시됩니다."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-dim border-line border-b text-left text-xs">
                    <th className="px-4 py-2 font-medium">이름</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">분류</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">유형</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">크기</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">등록일</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">등록자</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <DocumentRow
                      key={r.id}
                      doc={{
                        id: r.id,
                        title: r.title,
                        kind: r.kind,
                        description: r.description,
                        categoryLabel: CATEGORY_LABEL[r.category],
                        typeLabel: fileTypeLabel(r.kind, r.fileName, r.mimeType, r.formType),
                        sizeLabel: r.kind === "file" ? formatFileSize(r.fileSize) : "—",
                        createdAt: r.createdAt,
                        uploaderName: r.uploaderName,
                        pinned: r.pinned,
                        href:
                          r.kind === "file"
                            ? `/documents/${r.id}/preview`
                            : r.kind === "form"
                              ? formViewHref(r.formType, r.id)
                              : `/documents/${r.id}`,
                      }}
                      canWrite={canWrite}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="lg:pl-[206px]">
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={total} />
      </div>
    </div>
  );
}
