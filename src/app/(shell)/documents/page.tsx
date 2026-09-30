import { ChevronLeft, ChevronRight, Files, Folder } from "@/components/icons/aywa-icon-compat";
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
import { getDocumentFolderFavorites } from "@/features/documents/server/favorite-queries";
import { categoryPath, categoryTreeCounts } from "@/features/documents/categories";
import { isLinkedSource, LINKED_LABEL, LINKED_SOURCES, type LinkedSourceKey } from "@/features/documents/linked";
import { parseDocumentSort, type DocumentSortKey } from "@/features/documents/document-sort";
import type { SortState } from "@/lib/table/sort";
import { DocumentToolbar } from "./_components/document-toolbar";
import { DocumentTable } from "./_components/document-table";
import { FolderNav, type FolderItem } from "./_components/folder-nav";
import { NewFolderButton } from "./_components/category-manager";
import { FolderBreadcrumbs } from "./_components/folder-breadcrumbs";
import { FolderDropTarget, FolderInteractionProvider, FolderName } from "./_components/folder-interactions";
import { FolderFavoriteToggle } from "./_components/folder-favorite-toggle";
import { FolderListSection, FolderNavigationProvider } from "./_components/folder-navigation";

export const metadata = { title: "데이터베이스 — 에이와" };

const PAGE_SIZE = 20;

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

  // 권한(요청 캐시 — requireAccess가 이미 매트릭스를 읽었다)·분류(테넌트 캐시)는 사실상 왕복이 없어 먼저 받는다 —
  // 폴더 키를 분류 목록으로 검증해야 목록 조회를 시작할 수 있다.
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
  const children = linked ? [] : categories.filter((c) => (c.parentKey ?? null) === cat);
  const path = cat ? categoryPath(categories, cat) : [];

  // 실제 조회는 한 번에(B4) — 예전엔 즐겨찾기가 위 단계에서 왕복 하나를 따로 기다린 뒤에야 목록이 출발했다
  // (폴더를 누를 때마다 직렬 왕복 +1, 2026-09-30 측정).
  const [favoriteKeys, docPage, linkedPage, counts, linkedCounts] = await Promise.all([
    getDocumentFolderFavorites(),
    linked ? null : getDocumentsPage({ category: cat ?? undefined, q, sort }, page, PAGE_SIZE),
    linked ? getLinkedPage(linked, { q }, page, PAGE_SIZE) : null,
    getDocumentCategoryCounts(),
    canBilling ? getLinkedCounts() : null,
  ]);
  const total = linked ? (linkedPage?.total ?? 0) : (docPage?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const treeCounts = counts ? categoryTreeCounts(categories, counts) : null;

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

  // 폴더 팬 맨 위 '전체 문서' — 분류 폴더는 트리가 categories·counts·hrefs로 직접 그린다(클라로 넘기는 양을 줄이려 한 항목만).
  const folders: FolderItem[] = [{ key: null, label: "전체 문서", count: counts?.all ?? null, href: folderHref(null) }];
  const linkedFolders: FolderItem[] = linkedCounts
    ? LINKED_SOURCES.map((s) => ({ key: s.key as string, label: s.label, count: linkedCounts[s.key], href: folderHref(s.key) }))
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
            categories={categories}
            sortParam={sort}
          />
        }
      />

      {/* 탐색기 레이아웃 — 넓은 창: 좌 폴더 팬 + 우 상세 테이블 / 좁은 창: 폴더가 상단 칩으로 접힘.
          폴더 이동은 누르는 즉시 선택 표시 + 목록 흐림(FolderNavigationProvider) — 데이터는 여전히 이 서버 렌더 한 경로. */}
      <FolderInteractionProvider categories={categories} canManage={canWrite}>
      <FolderNavigationProvider activeKey={activeKey} className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start lg:gap-4">
        <FolderNav
          folders={folders}
          linkedFolders={linkedFolders}
          activeKey={activeKey}
          hrefs={Object.fromEntries(categories.map((c) => [c.key, folderHref(c.key)]))}
          categories={categories}
          counts={counts}
          canManage={canWrite}
          favoriteKeys={favoriteKeys}
        />

        <FolderListSection className="bg-card border-line min-w-0 rounded-2xl border">
          {!linked ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <FolderBreadcrumbs rootHref={folderHref(null)} path={path.map((c) => ({ key: c.key, label: c.label, href: folderHref(c.key) }))} />
            <div className="flex items-center gap-2">
              {cat ? <FolderFavoriteToggle folderKey={cat} pathLabel={path.map((part) => part.label).join(" / ")}
                favorite={favoriteKeys.includes(cat)} atLimit={favoriteKeys.length >= 10} /> : null}
              {canWrite ? <NewFolderButton categories={categories} parentKey={cat} /> : null}
            </div>
          </div> : null}
          {children.length ? <div className="border-b border-line p-4">
            <p className="mb-2 text-xs text-text-faint">{cat ? "하위 폴더" : "폴더"} · {children.length}개</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {children.map((c) => <FolderDropTarget key={c.key} folderKey={c.key}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-1 hover:bg-bg-soft">
                <Folder className="size-4 shrink-0 text-amber" />
                <FolderName folder={c} href={folderHref(c.key)} />
                <span className="num shrink-0 text-xs text-text-faint" title="하위 폴더 문서 포함">{treeCounts ? treeCounts[c.key] ?? 0 : "—"}건</span>
                <ChevronRight className="size-3 shrink-0 text-text-faint" />
              </FolderDropTarget>)}
            </div>
          </div> : null}
          <div className="border-line text-text-dim flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Files className="size-3.5" />
              {linked ? LINKED_LABEL[linked] : cat ? "이 폴더의 문서" : "전체 문서"} · {total}건
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

          {docPage?.failed ? (
            // 조회 실패를 '아직 문서가 없습니다'로 보이면 사람이 문서가 사라진 줄 안다(E6) — 사실대로 알린다.
            <p role="alert" className="text-danger px-4 py-8 text-center text-sm">문서 목록을 불러오지 못했습니다 — 잠시 후 새로고침해 주세요.</p>
          ) : total === 0 ? (
            children.length && !q ? <p className="px-4 py-8 text-center text-sm text-text-faint">{cat ? "이 폴더에 직접 저장된 문서가 없습니다. 하위 폴더를 열거나 문서를 추가하세요." : "폴더를 열어 문서를 추가하세요."}</p>
              : <EmptyState image={q ? "search" : "documents"} title={empty.title} description={empty.description} />
          ) : (
            <DocumentTable
              linked={!!linked}
              sort={sort}
              sortHref={sortHref}
              rows={docPage?.rows ?? []}
              linkedRows={linkedPage?.rows ?? []}
              categories={categories}
              canWrite={canWrite}
            />
          )}
        </FolderListSection>
      </FolderNavigationProvider>
      </FolderInteractionProvider>

      <div className="lg:pl-[246px]">
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={total} />
      </div>
    </div>
  );
}
