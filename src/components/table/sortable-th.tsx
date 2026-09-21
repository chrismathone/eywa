"use client";

/**
 * 정렬 가능한 표 헤더 — 눌러서 오름 → 내림 → 해제. 판정·비교는 전부 `@/lib/table/sort`(순수) 단일 소스.
 *
 * 쓰는 법:
 *   const [sort, setSort] = useState<SortState<Key>>(null);
 *   <SortableTh sortKey="name" state={sort} onSort={setSort}>학생 · 반</SortableTh>
 *   const view = sortRows(rows, sort, valueOf);
 *
 * ⚠️ 새 목록 표를 만들면 헤더는 이걸 쓴다(수제 `<th>` + 자체 정렬 상태 신설 금지) — 정렬 규약이 갈라지면
 * 같은 이름 목록이 화면마다 다른 순서로 나온다.
 */
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ariaSort, sortIndicator, toggleSort, type SortState } from "@/lib/table/sort";

export function SortableTh<K extends string>({
  sortKey,
  state,
  onSort,
  align = "left",
  className = "",
  children,
}: {
  sortKey: K;
  state: SortState<K>;
  onSort: (next: SortState<K>) => void;
  align?: "left" | "right" | "center";
  className?: string;
  children: ReactNode;
}) {
  const active = state?.key === sortKey;
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th className={`px-3 py-2 font-bold ${alignCls} ${className}`} aria-sort={ariaSort(state, sortKey)}>
      <button
        type="button"
        onClick={() => onSort(toggleSort(state, sortKey))}
        // 정렬 중인 열만 진하게 — 어느 기준으로 보고 있는지 한눈에.
        className={`hover:text-foreground inline-flex items-center gap-1 font-bold ${
          active ? "text-foreground" : ""
        }`}
        title={active ? "다시 누르면 방향 전환 · 한 번 더 누르면 정렬 해제" : "눌러서 이 열로 정렬"}
      >
        {children}
        {/* 방향 표시는 EyIcon(텍스트 화살표 글리프 금지 규칙). 비활성 열은 hover에서만 흐리게 — 어느 열이
            정렬 가능한지 알리되 평소엔 조용하도록. */}
        <span aria-hidden className={active ? "" : "opacity-0 group-hover:opacity-40"}>
          <EyIcon name={sortIndicator(state, sortKey) === "desc" ? "chevronDown" : "chevronUp"} size={11} />
        </span>
      </button>
    </th>
  );
}
