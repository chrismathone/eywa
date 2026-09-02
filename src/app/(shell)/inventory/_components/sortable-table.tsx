"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { sortRows, type SortState, type SortValue } from "@/features/inventory/sort";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** 정렬 값. 없으면 `row[key]`. */
  sortValue?: (row: T) => SortValue;
  /** 칸 폭·정렬 등 배치 클래스(본문 td). */
  className?: string;
};

/**
 * 정렬 가능한 데이터 표 — 전 열 정렬(시안 `◆`), 열 제목 가운데·본문 좌측, 열 구분선은 `--line-faint`를
 * 표 한 곳에서(design-conventions "데이터 표"). 좁은 화면(<640px)은 `.stack-table`이 행을 카드로 쌓는다
 * (각 td의 `data-label`이 라벨). 넘치는 폭은 `DragScrollArea`(드래그-팬 기본 인터랙션).
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
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort: SortState;
  onSort: (key: string) => void;
  emptyText: string;
  actions?: (row: T) => ReactNode;
}) {
  const sorted = sortRows(rows, sort, (row, key) => {
    const col = columns.find((c) => c.key === key);
    return col?.sortValue ? col.sortValue(row) : ((row as Record<string, SortValue>)[key] ?? null);
  });

  return (
    <DragScrollArea className="stack-table">
      <table className="w-full border-collapse text-[12.5px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
        <thead>
          <tr className="border-line border-b">
            {columns.map((c) => {
              const on = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className="text-text-dim px-2 py-1.5 text-center text-[11.5px] font-bold whitespace-nowrap"
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={`inline-flex items-center gap-1 rounded-md px-1 hover:bg-bg-soft ${on ? "text-foreground" : ""}`}
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
            sorted.map((row) => (
              <tr key={rowKey(row)} className="border-line-faint hover:bg-bg-soft/60 border-b">
                {columns.map((c) => (
                  <td key={c.key} data-label={c.label} className={`px-2 py-1.5 align-top ${c.className ?? ""}`}>
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
  );
}
