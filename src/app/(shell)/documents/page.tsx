import { ChevronLeft, ChevronRight, Files } from "@/components/icons/eywa-icon-compat";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageStep, Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  getDocumentCategoryCounts,
  getDocumentsPage,
} from "@/features/documents/server/queries";
import { getLinkedCounts, getLinkedPage } from "@/features/documents/server/linked-queries";
import { getDocumentCategories } from "@/features/documents/server/category-queries";
import {
  categoryLabelOf,
  fileTypeLabel,
  formatFileSize,
  formViewHref,
} from "@/features/documents/categories";
import { isLinkedSource, LINKED_LABEL, LINKED_SOURCES, type LinkedSourceKey } from "@/features/documents/linked";
import { parseDocumentSort, type DocumentSortKey } from "@/features/documents/document-sort";
import { SortableThLink } from "@/components/table/sortable-th-link";
import type { SortState } from "@/lib/table/sort";
import { DocumentToolbar } from "./_components/document-toolbar";
import { DocumentRow } from "./_components/document-row";
import { LinkedDocumentRow } from "./_components/linked-row";
import { FolderNav, type FolderItem } from "./_components/folder-nav";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

export const metadata = { title: "데이터베이스 — eywa" };

const PAGE_SIZE = 50;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireAccess("documents");
  const sp = await searchParams;
  const catRaw = sp.cat ?? "";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  // 정렬 상태는 URL에 둔다 — 목록이 서버 페이지네이션이라 정렬도 서버가 해야 하고(50건 안에서만 정렬되는
  // 거짓말 방지), 덤으로 정렬된 화면을 그대로 링크로 공유·새로고침할 수 있다.
  const sort = parseDocumentSort(sp.sort, sp.dir);
  // 플로팅 창(iframe, ?embed=1 → proxy가 x-embed 주입) 안이면 폴더·페이저 드릴인에 embed=1을 유지 —
  // 잃으면 창 안에서 풀셸 분기가 서버에서 돌아(크롬은 HideInFrame self-heal) 클릭마다 셸 쿼리 낭비(face-tabs 관례).
  const embed = (await headers()).get("x-embed") === "1";

  // 연동 폴더(교재 요청서·수강료 견적서)는 billing 접근권한이 있어야 노출·조회 —
  // 강사는 담당 학생 스코프 밖 전체 목록을 보면 안 됨(전용 면 /textbook-requests 사용).
  const [canWrite, canBilling, categories] = await Promise.all([
    canWriteTenant(user.systemRole, "documents"),
    canAccessTenant(user.systemRole, "billing"),
    // 분류는 학원장이 관리하는 테넌트 데이터(0161a) — 코드 상수가 아니라 DB가 단일 소스.
    getDocumentCategories(),
  ]);
  const linked: LinkedSourceKey | null = canBilling && isLinkedSource(catRaw) ? catRaw : null;
  const cat = !linked && categories.some((c) => c.key === catRaw) ? catRaw : null;
  const activeKey = linked ?? cat;

  const [docPage, linkedPage, counts, linkedCounts] = await Promise.all([
    linked ? null : getDocumentsPage({ category: cat ?? undefined, q, sort }, page, PAGE_SIZE),
    linked ? getLinkedPage(linked, { q }, page, PAGE_SIZE) : null,
    getDocumentCategoryCounts(),
    canBilling ? getLinkedCounts() : null,
  ]);
  const total = linked ? (linkedPage?.total ?? 0) : (docPage?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 폴더/페이지/정렬 href — 필터·정렬을 바꾸면 page 리셋(파라미터 미포함), pageHref만 p>1일 때 page 세팅.
  // ⚠️ 세 링크가 서로의 파라미터를 **보존**해야 한다 — 하나라도 흘리면 폴더를 옮길 때 정렬이 조용히 풀리거나
  //    2페이지에서 정렬을 누르면 1페이지 기준으로 되돌아간 것처럼 보인다.
  const buildHref = (o: { cat?: string | null; page?: number; sort?: SortState<DocumentSortKey> }) => {
    const p = new URLSearchParams();
    const c = o.cat !== undefined ? o.cat : activeKey;
    if (c) p.set("cat", c);
    if (q) p.set("q", q);
    const s = o.sort !== undefined ? o.sort : sort;
    if (s) {
      p.set("sort", s.key);
      p.set("dir", s.dir);
    }
    if (o.page && o.page > 1) p.set("page", String(o.page));
    if (embed) p.set("embed", "1");
    const qs = p.toString();
    return qs ? `/documents?${qs}` : "/documents";
  };
  const folderHref = (key: string | null) => buildHref({ cat: key });
  const pageHref = (p: number) => buildHref({ page: p });
  const sortHref = (next: SortState<DocumentSortKey>) => buildHref({ sort: next });

  const folders: FolderItem[] = [
    { key: null, label: "전체 문서", count: counts?.all ?? null },
    // 문서가 0건인 분류는 RPC가 행을 안 주므로 0으로 채운다(폴더 자체는 항상 보인다).
    ...categories.map((c) => ({ key: c.key, label: c.label, count: counts ? counts[c.key] ?? 0 : null })),
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
          ? "우측 상단에서 서식 파일을 '업로드'하거나, '새 문서'를 작성하거나, 구글 드라이브 등에 있는 자료를 '링크 추가'로 등록하세요."
          : "관리자가 서식을 올리면 여기에 표시됩니다.",
      };

  return (
    <div className="space-y-4 p-6">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행(설명+툴바)으로 접힌다. */}
      <PageHeader
        eyebrow="운영 · 서식 저장소"
        title="데이터베이스"
        description="학원 각종 서식을 보관합니다 — 빈 양식을 내려받아 작성하거나, 앱에서 문서를 작성해 두세요."
        actions={
          <DocumentToolbar
            canWrite={canWrite}
            initialQuery={q}
            category={cat}
            catParam={activeKey}
            embed={embed}
            categories={categories}
            sortParam={sort}
          />
        }
      />

      {/* 탐색기 레이아웃 — 넓은 창: 좌 폴더 팬 + 우 상세 테이블 / 좁은 창: 폴더가 상단 칩으로 접힘 */}
      <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-4">
        <FolderNav
          folders={folders}
          linkedFolders={linkedFolders}
          activeKey={activeKey}
          hrefFor={folderHref}
          categories={categories}
          counts={counts}
          canManage={canWrite}
        />

        <section className="bg-card border-line rounded-2xl border">
          <div className="border-line text-text-dim flex items-center justify-between border-b px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Files className="size-3.5" />
              {linked ? LINKED_LABEL[linked] : cat ? categoryLabelOf(categories, cat) : "전체 문서"} · {total}건
            </span>
            {totalPages > 1 ? (
              // 헤더 컴팩트 페이저 — 작은 창에선 50행 아래 하단 표준 페이저가 안 보여(스크롤 필요)
              // 스크롤 없이 바로 넘길 수 있게 표시기를 클릭 가능한 ◀ ▶로 승격(하단 페이저와 병존).
              <span className="inline-flex items-center whitespace-nowrap">
                <PageStep href={pageHref(page - 1)} disabled={page <= 1}>
                  <ChevronLeft className="size-3" />
                </PageStep>
                <span className="num px-0.5">
                  {page}/{totalPages} 페이지
                </span>
                <PageStep href={pageHref(page + 1)} disabled={page >= totalPages}>
                  <ChevronRight className="size-3" />
                </PageStep>
              </span>
            ) : null}
          </div>

          {total === 0 ? (
            <EmptyState image={q ? "search" : "documents"} title={empty.title} description={empty.description} />
          ) : (
            <DragScrollArea>
              <table className="w-full text-sm">
                <thead>
                  {/* 헤더 클릭 정렬 — 서버 정렬(URL `?sort=&dir=`)이라 페이지를 넘겨도 전체 기준으로 줄 선다.
                      ⚠️ 연동 폴더(교재 요청서·수강료 견적서)는 원본 테이블을 따로 조회해 정렬 배선이 없다 →
                         누를 수 있게 두면 "눌렀는데 안 바뀐다"가 된다. 그 폴더에선 정적 헤더로 되돌린다.
                      ⚠️ '분류'·'유형'은 의도적으로 정렬 대상이 아니다(사유 = document-sort.ts). */}
                  <tr className="text-text-dim border-line border-b text-left text-xs">
                    {linked ? (
                      <>
                        <th className="px-4 py-2 font-medium">이름</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">분류</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">유형</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">크기</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">등록일</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">등록자</th>
                      </>
                    ) : (
                      <>
                        <SortableThLink sortKey="name" state={sort} hrefFor={sortHref} padClassName="px-4 py-2">
                          이름
                        </SortableThLink>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">분류</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">유형</th>
                        <SortableThLink
                          sortKey="size"
                          state={sort}
                          hrefFor={sortHref}
                          align="right"
                          className="whitespace-nowrap"
                        >
                          크기
                        </SortableThLink>
                        <SortableThLink sortKey="date" state={sort} hrefFor={sortHref} className="whitespace-nowrap">
                          등록일
                        </SortableThLink>
                        <SortableThLink sortKey="uploader" state={sort} hrefFor={sortHref} className="whitespace-nowrap">
                          등록자
                        </SortableThLink>
                      </>
                    )}
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
                            categoryLabel: categoryLabelOf(categories, r.category),
                            typeLabel: fileTypeLabel(r.kind, r.fileName, r.mimeType, r.formType, r.linkUrl),
                            sizeLabel: r.kind === "file" ? formatFileSize(r.fileSize) : "—",
                            createdAt: r.createdAt,
                            uploaderName: r.uploaderName,
                            pinned: r.pinned,
                            // 링크 문서는 외부 주소로 직행(새 탭) — 값이 비면 상세로 폴백해 죽은 링크를 안 만든다.
                            href:
                              r.kind === "link"
                                ? (r.linkUrl ?? `/documents/${r.id}`)
                                : r.kind === "file"
                                  ? `/documents/${r.id}/preview`
                                  : r.kind === "form"
                                    ? formViewHref(r.formType, r.id)
                                    : `/documents/${r.id}`,
                            external: r.kind === "link" && !!r.linkUrl,
                          }}
                          canWrite={canWrite}
                        />
                      ))}
                </tbody>
              </table>
            </DragScrollArea>
          )}
        </section>
      </div>

      <div className="lg:pl-[206px]">
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={total} />
      </div>
    </div>
  );
}
