import { Files } from "@/components/icons/eywa-icon-compat";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageStep, Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import {
  getDocumentCategoryCounts,
  getDocumentsPage,
} from "@/features/documents/server/queries";
import { getLinkedCounts, getLinkedPage } from "@/features/documents/server/linked-queries";
import {
  CATEGORY_LABEL,
  DOCUMENT_CATEGORIES,
  fileTypeLabel,
  formatFileSize,
  formViewHref,
  type DocumentCategory,
} from "@/features/documents/categories";
import { isLinkedSource, LINKED_LABEL, LINKED_SOURCES, type LinkedSourceKey } from "@/features/documents/linked";
import { DocumentToolbar } from "./_components/document-toolbar";
import { DocumentRow } from "./_components/document-row";
import { LinkedDocumentRow } from "./_components/linked-row";
import { FolderNav, type FolderItem } from "./_components/folder-nav";

export const metadata = { title: "데이터베이스 — eywa" };

const PAGE_SIZE = 50;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; page?: string }>;
}) {
  const user = await requireAccess("documents");
  const sp = await searchParams;
  const catRaw = sp.cat ?? "";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  // 플로팅 창(iframe, ?embed=1 → proxy가 x-embed 주입) 안이면 폴더·페이저 드릴인에 embed=1을 유지 —
  // 잃으면 창 안에서 풀셸 분기가 서버에서 돌아(크롬은 HideInFrame self-heal) 클릭마다 셸 쿼리 낭비(face-tabs 관례).
  const embed = (await headers()).get("x-embed") === "1";

  // 연동 폴더(교재 요청서·수강료 견적서)는 billing 접근권한이 있어야 노출·조회 —
  // 강사는 담당 학생 스코프 밖 전체 목록을 보면 안 됨(전용 면 /textbook-requests 사용).
  const [canWrite, canBilling] = await Promise.all([
    canWriteTenant(user.systemRole, "documents"),
    canAccessTenant(user.systemRole, "billing"),
  ]);
  const linked: LinkedSourceKey | null = canBilling && isLinkedSource(catRaw) ? catRaw : null;
  const cat =
    !linked && (DOCUMENT_CATEGORIES as readonly string[]).includes(catRaw)
      ? (catRaw as DocumentCategory)
      : null;
  const activeKey = linked ?? cat;

  const [docPage, linkedPage, counts, linkedCounts] = await Promise.all([
    linked ? null : getDocumentsPage({ category: cat ?? undefined, q }, page, PAGE_SIZE),
    linked ? getLinkedPage(linked, { q }, page, PAGE_SIZE) : null,
    getDocumentCategoryCounts(),
    canBilling ? getLinkedCounts() : null,
  ]);
  const total = linked ? (linkedPage?.total ?? 0) : (docPage?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 폴더/페이지 href — 필터 바꾸면 page 리셋(파라미터 미포함), pageHref만 p>1일 때 page 세팅.
  const folderHref = (key: string | null) => {
    const p = new URLSearchParams();
    if (key) p.set("cat", key);
    if (q) p.set("q", q);
    if (embed) p.set("embed", "1");
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (activeKey) params.set("cat", activeKey);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    if (embed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  const folders: FolderItem[] = [
    { key: null, label: "전체 문서", count: counts.all },
    ...DOCUMENT_CATEGORIES.map((c) => ({ key: c as string, label: CATEGORY_LABEL[c], count: counts[c] })),
  ];
  const linkedFolders: FolderItem[] = linkedCounts
    ? LINKED_SOURCES.map((s) => ({ key: s.key as string, label: s.label, count: linkedCounts[s.key] }))
    : [];

  const empty = linked
    ? {
        title: q ? "검색 결과가 없습니다" : linked === "textbooks" ? "아직 교재 요청이 없습니다" : "저장된 견적이 없습니다",
        description:
          linked === "textbooks"
            ? "수납관리 > 교재 면 또는 강사 교재 요청에서 만들어지면 여기에 표시됩니다."
            : "수납관리 > 수강료 계산기에서 '청구서로 저장'하면 여기에 표시됩니다.",
      }
    : {
        title: q ? "검색 결과가 없습니다" : "아직 문서가 없습니다",
        description: canWrite
          ? "우측 상단 '업로드'로 서식 파일을 올리거나 '새 문서'를 작성하세요."
          : "관리자가 서식을 올리면 여기에 표시됩니다.",
      };

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
        <DocumentToolbar canWrite={canWrite} initialQuery={q} category={cat} catParam={activeKey} embed={embed} />
      </header>

      {/* 탐색기 레이아웃 — 넓은 창: 좌 폴더 팬 + 우 상세 테이블 / 좁은 창: 폴더가 상단 칩으로 접힘 */}
      <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-4">
        <FolderNav folders={folders} linkedFolders={linkedFolders} activeKey={activeKey} hrefFor={folderHref} />

        <section className="bg-card border-line rounded-md border">
          <div className="border-line text-text-dim flex items-center justify-between border-b px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Files className="size-3.5" />
              {linked ? LINKED_LABEL[linked] : cat ? CATEGORY_LABEL[cat] : "전체 문서"} · {total}건
            </span>
            {totalPages > 1 ? (
              // 헤더 컴팩트 페이저 — 작은 창에선 50행 아래 하단 표준 페이저가 안 보여(스크롤 필요)
              // 스크롤 없이 바로 넘길 수 있게 표시기를 클릭 가능한 ◀ ▶로 승격(하단 페이저와 병존).
              <span className="inline-flex items-center whitespace-nowrap">
                <PageStep href={pageHref(page - 1)} disabled={page <= 1}>
                  ◀
                </PageStep>
                <span className="num px-0.5">
                  {page}/{totalPages} 페이지
                </span>
                <PageStep href={pageHref(page + 1)} disabled={page >= totalPages}>
                  ▶
                </PageStep>
              </span>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState image={q ? "search" : "documents"} title={empty.title} description={empty.description} />
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
                  {linked
                    ? (linkedPage?.rows ?? []).map((r) => <LinkedDocumentRow key={r.id} doc={r} />)
                    : (docPage?.rows ?? []).map((r) => (
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
