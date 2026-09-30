import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SortableThLink } from "@/components/table/sortable-th-link";
import type { SortState } from "@/lib/table/sort";
import {
  categoryPathLabel,
  fileTypeLabel,
  formatFileSize,
  formViewHref,
  type DocumentCategoryOption,
} from "@/features/documents/categories";
import type { DocumentSortKey } from "@/features/documents/document-sort";
import type { LinkedDocRow } from "@/features/documents/linked";
import type { DocumentRow as DocumentRecord } from "@/features/documents/server/queries";
import { DOC_COL } from "./document-columns";
import { DocumentRow } from "./document-row";
import { LinkedDocumentRow } from "./linked-row";

/**
 * 좁은 표에서 덜 중요한 열부터 숨긴다 — 기준은 창(iframe) 폭이 아니라 **이 표가 받은 폭**(@container:
 * 넓은 창에선 폴더 팬을 뺀 자리). 순서 = 등록일(수정일이 최신성을 이미 말한다) → 등록자 → 유형(아이콘 색이 형식을 말한다).
 * 정렬 중인 열은 숨기지 않는다 — 숨기면 무엇으로 줄 섰는지 화면에서 사라진다.
 * ⚠️ Tailwind는 소스에서 클래스를 줍는다 — 문자열을 조립하지 말고 통째로 적을 것.
 */
export const HIDE_WHEN_NARROW = {
  created: "@max-5xl:[&_.doc-col-created]:hidden", // 64rem(1024px) 미만
  uploader: "@max-4xl:[&_.doc-col-uploader]:hidden", // 56rem(896px) 미만
  type: "@max-3xl:[&_.doc-col-type]:hidden", // 48rem(768px) 미만
} as const;

/**
 * 열 너비 — 이름이 남는 폭을 전부 갖고, 나머지는 **값이 한 줄에 들어가는 최소 폭**(원장 2026-09-30 "파일명이 열 너비를
 * 더 차지하게"). Pretendard 16px 실측: 수정일 최장 `2026. 12. 31. 오후 11:59` 174px · 등록일 99px · 유형 최장
 * `구글 슬라이드` 87px · 크기 최장 `1024.0KB` 73px(+ 좌우 여백 24px). 동작 칸은 아이콘 셋(64px).
 * `table-fixed` + colgroup이라 행이 바뀌어도 열이 흔들리지 않는다(#97).
 */
function Columns() {
  return (
    <colgroup>
      <col />
      <col className={`${DOC_COL.type} w-28`} />
      <col className="w-26" />
      <col className="w-52" />
      <col className={`${DOC_COL.created} w-32`} />
      <col className={`${DOC_COL.uploader} w-24`} />
      <col className="w-24" />
    </colgroup>
  );
}

export function DocumentTable({
  linked,
  sort,
  sortHref,
  rows,
  linkedRows,
  categories,
  canWrite,
}: {
  /** 연동 폴더(교재 요청서·수강료 견적서)면 정렬 배선이 없어 정적 머리로 둔다. */
  linked: boolean;
  sort: SortState<DocumentSortKey>;
  sortHref: (next: SortState<DocumentSortKey>) => string;
  rows: DocumentRecord[];
  linkedRows: LinkedDocRow[];
  categories: DocumentCategoryOption[];
  canWrite: boolean;
}) {
  const sortedBy = linked ? null : sort?.key ?? null;
  const hide = [
    HIDE_WHEN_NARROW.type,
    sortedBy === "date" ? "" : HIDE_WHEN_NARROW.created,
    sortedBy === "uploader" ? "" : HIDE_WHEN_NARROW.uploader,
  ].join(" ");
  return (
    <div className={`@container ${hide}`}>
      <DragScrollArea>
        <table className="w-full min-w-[40rem] table-fixed text-sm">
          <Columns />
          <thead>
            {/* 헤더 클릭 정렬 — 서버 정렬(URL `?sort=&dir=`)이라 페이지를 넘겨도 전체 기준으로 줄 선다.
                ⚠️ 연동 폴더(교재 요청서·수강료 견적서)는 원본 테이블을 따로 조회해 정렬 배선이 없다 →
                   누를 수 있게 두면 "눌렀는데 안 바뀐다"가 된다. 그 폴더에선 정적 헤더로 되돌린다.
                ⚠️ '유형'은 의도적으로 정렬 대상이 아니다(사유 = document-sort.ts). */}
            <tr className="text-text-dim border-line border-b text-left text-xs">
              {linked ? (
                <>
                  <th className="px-4 py-2 font-medium">이름</th>
                  <th className={`${DOC_COL.type} px-3 py-2 font-medium whitespace-nowrap`}>유형</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">크기</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">수정일</th>
                  <th className={`${DOC_COL.created} px-3 py-2 font-medium whitespace-nowrap`}>등록일</th>
                  <th className={`${DOC_COL.uploader} px-3 py-2 font-medium whitespace-nowrap`}>등록자</th>
                </>
              ) : (
                <>
                  <SortableThLink sortKey="name" state={sort} hrefFor={sortHref} padClassName="px-4 py-2">
                    이름
                  </SortableThLink>
                  <th className={`${DOC_COL.type} px-3 py-2 font-medium whitespace-nowrap`}>유형</th>
                  <SortableThLink sortKey="size" state={sort} hrefFor={sortHref} align="right" className="whitespace-nowrap">
                    크기
                  </SortableThLink>
                  <SortableThLink sortKey="modified" state={sort} hrefFor={sortHref} className="whitespace-nowrap">
                    수정일
                  </SortableThLink>
                  <SortableThLink sortKey="date" state={sort} hrefFor={sortHref} className={`${DOC_COL.created} whitespace-nowrap`}>
                    등록일
                  </SortableThLink>
                  <SortableThLink sortKey="uploader" state={sort} hrefFor={sortHref} className={`${DOC_COL.uploader} whitespace-nowrap`}>
                    등록자
                  </SortableThLink>
                </>
              )}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {linked
              ? linkedRows.map((r) => <LinkedDocumentRow key={r.id} doc={r} />)
              : rows.map((r) => (
                  <DocumentRow
                    key={r.id}
                    doc={{
                      id: r.id,
                      title: r.title,
                      kind: r.kind,
                      description: r.description,
                      category: r.category,
                      categoryLabel: categoryPathLabel(categories, r.category),
                      typeLabel: fileTypeLabel(r.kind, r.fileName, r.mimeType, r.formType, r.linkUrl),
                      sizeLabel: r.kind === "file" ? formatFileSize(r.fileSize) : "—",
                      createdAt: r.createdAt,
                      updatedAt: r.updatedAt,
                      fileName: r.fileName,
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
    </div>
  );
}
