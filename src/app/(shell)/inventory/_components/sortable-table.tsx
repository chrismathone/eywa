"use client";

import { useRef, useState, type ReactNode } from "react";
import { isDirectEditClick } from "@/lib/direct-edit";
import { useIsMobile } from "@/hooks/use-mobile";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { sortRows, type SortState, type SortValue } from "@/features/inventory/sort";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** 정렬 값. 없으면 `row[key]`. */
  sortValue?: (row: T) => SortValue;
  /** 칸 배치 클래스(본문 td). */
  className?: string;
  /** 고정 폭(px). 없으면 남는 폭을 나눠 갖는 가변 칸(`minWidth`가 하한). */
  width?: number;
  minWidth?: number;
  /** 이 칸만의 더블클릭(예: 상태 칸 → 상태 변경). 행 더블클릭보다 우선한다(전파를 끊는다). */
  onDoubleClick?: (row: T) => void;
};

const DEFAULT_MIN = 120;

/**
 * 정렬 가능한 데이터 표 — 전 열 정렬(시안 `◆`), 열 제목 가운데·본문 좌측, 열 구분선은 `--line-faint`를
 * 표 한 곳에서(design-conventions "데이터 표"). 좁은 화면(<640px)은 `.stack-table`이 행을 카드로 쌓는다
 * (각 td의 `data-label`이 라벨).
 *
 * 🔴 **열 폭은 내용이 아니라 `colgroup`이 정한다**(`table-fixed`) — 원장 2026-09-02 *"탭을 눌러도 열너비
 *    변경안되게"*. 자동 폭은 그 열의 최장 내용에서 폭을 뽑아 필터로 행이 바뀔 때마다 표가 밀린다([[#97]]).
 *    고정 칸은 `width`, 가변 칸(모델명·비고)은 남는 폭을 나눠 갖되 `minWidth` 아래로는 안 줄고 가로 스크롤이 된다.
 * 🔴 **드래그 스크롤 + 더블클릭을 함께 쓴다** — 원장 2026-09-02 *"창이 작아져도 열 크기는 적당선에서 고정시키고, 드래그로
 *    스크롤 이동 가능하게"*(같은 날 *"행 더블클릭 = 수정"*과 함께). DragScrollArea는 5px 넘게 끌어야 팬이 되고 그 전엔
 *    클릭으로 두므로 **제자리 더블클릭은 산다**; 두 클릭 사이에 5px 넘게 움직이면 팬으로 잡혀 새어나간다([[#97]]).
 * ⚠️ 동작 칸(`actions`)엔 `data-label`을 안 붙인다 — 카드에서 라벨 없이 버튼만 서게.
 */
export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  emptyText,
  actions,
  onRowDoubleClick,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort: SortState;
  onSort: (key: string) => void;
  emptyText: string;
  actions?: (row: T) => ReactNode;
  /** 행 더블클릭(예: 수정 창). 칸에 자기 더블클릭이 있으면 그쪽이 이긴다. */
  onRowDoubleClick?: (row: T) => void;
  /** 행 배경 등 행 단위 클래스(예: 조치필요 자산 = 붉은 틴트). 판정은 호출부의 단일 소스 함수가 한다. */
  rowClassName?: (row: T) => string;
}) {
  const mobile = useIsMobile();
  const [page, setPage] = useState(1);
  const pageAnchor = useRef<HTMLDivElement>(null);
  const movePage = (next: number) => {
    setPage(next);
    pageAnchor.current?.scrollIntoView?.({ block: "start" });
  };
  const sorted = sortRows(rows, sort, (row, key) => {
    const col = columns.find((c) => c.key === key);
    return col?.sortValue ? col.sortValue(row) : ((row as Record<string, SortValue>)[key] ?? null);
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visible = mobile ? sorted.slice((currentPage - 1) * 10, currentPage * 10) : sorted;
  // 표의 하한 폭 = 고정 칸 합 + 가변 칸 하한 합 (+ 동작 칸). 컨테이너가 이보다 좁으면 가로 스크롤.
  const minTableWidth = columns.reduce((sum, c) => sum + (c.width ?? c.minWidth ?? DEFAULT_MIN), 0) + (actions ? 96 : 0);

  return (
    <div ref={pageAnchor} className="min-w-0 scroll-mt-3">
    <DragScrollArea className="stack-table">
      <table
        style={{ minWidth: minTableWidth }}
        className="w-full table-fixed border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint"
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
          {actions ? <col style={{ width: 96 }} /> : null}
        </colgroup>
        <thead>
          <tr className="border-line border-b">
            {columns.map((c) => {
              const on = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className="text-text-dim overflow-hidden px-2 py-1.5 text-center text-xs font-bold whitespace-nowrap"
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={`inline-flex max-w-full items-center gap-1 rounded-md px-1 hover:bg-bg-soft ${on ? "text-foreground" : ""}`}
                    title="정렬"
                  >
                    {c.label}
                    {/* 정렬 표식은 글리프가 아니라 아이콘(글리프 가드). 안 켜진 열은 옅은 아래 화살로 "누를 수 있다"만. */}
                    <EyIcon
                      name={on && sort.dir === "asc" ? "chevronUp" : "chevronDown"}
                      size={11}
                      className={on ? "text-primary" : "text-text-faint opacity-60"}
                    />
                  </button>
                </th>
              );
            })}
            {actions ? <th scope="col" className="px-2 py-1.5" /> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className="text-text-faint px-2 py-8 text-center">
                {emptyText}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr
                key={rowKey(row)}
                onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                onClick={onRowDoubleClick ? (event) => {
                  if (event.target instanceof Element && !event.target.closest("button,a,input,select,textarea") && isDirectEditClick(event)) onRowDoubleClick(row);
                } : undefined}
                className={`border-line-faint border-b ${rowClassName?.(row) || "hover:bg-bg-soft/60"}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    data-label={c.label}
                    onClick={c.onDoubleClick ? (event) => {
                      if (event.target instanceof Element && !event.target.closest("button,a,input,select,textarea") && isDirectEditClick(event)) {
                        event.stopPropagation();
                        c.onDoubleClick?.(row);
                      }
                    } : undefined}
                    onDoubleClick={
                      c.onDoubleClick
                        ? (e) => {
                            e.stopPropagation();
                            c.onDoubleClick?.(row);
                          }
                        : undefined
                    }
                    // 고정 폭이라 넘치는 글자는 칸 안에서 잘린다(전문은 마우스 오버 title — render 쪽 몫).
                    // 🔴 본문도 **가운데 정렬**(원장 2026-09-02 *"내용들 전부 가운데 센터 정렬"* — 데이터 표 규약의 "본문 좌측"을
                    //    이 화면에서 명시로 뒤집은 것). 다른 표에 이 값을 가져가지 말 것.
                    className={`overflow-hidden px-2 py-1.5 text-center align-top text-ellipsis ${c.className ?? ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
                {actions ? <td className="px-2 py-1 text-right whitespace-nowrap">{actions(row)}</td> : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </DragScrollArea>
    {mobile && pageCount > 1 ? (
      <nav aria-label="재고 목록 페이지" className="flex items-center justify-between gap-3 px-2 py-3 text-sm">
        <button type="button" className="min-h-11 rounded-md border px-3 disabled:opacity-40" disabled={currentPage === 1} onClick={() => movePage(currentPage - 1)}>이전</button>
        <span aria-live="polite">{currentPage} / {pageCount} · 전체 {sorted.length}건</span>
        <button type="button" className="min-h-11 rounded-md border px-3 disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => movePage(currentPage + 1)}>다음</button>
      </nav>
    ) : null}
    </div>
  );
}
