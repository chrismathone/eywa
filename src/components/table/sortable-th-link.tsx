/**
 * 정렬 가능한 표 헤더 — **서버 컴포넌트/서버 페이지네이션용** 링크 판. 판정은 [`@/lib/table/sort`](순수)
 * 단일 소스를 그대로 쓰고(오름 → 내림 → 해제 3단 순환), 상태만 React state가 아니라 **URL**에 둔다.
 *
 * 언제 어느 쪽?
 *   · 목록이 한 번에 다 오는 화면 = [`SortableTh`](./sortable-th.tsx) (클라 state + `sortRows`)
 *   · 목록이 **페이지로 끊겨 오는 화면** = 이 파일. 정렬을 화면에서 하면 "보고 있는 한 페이지 안에서만"
 *     정렬돼 사용자는 전체가 정렬된 줄 안다 → 정렬 키를 URL에 싣고 **서버가 정렬**해야 한다.
 *
 * 쓰는 법(서버 페이지):
 *   <SortableThLink sortKey="name" state={sort} hrefFor={sortHref}>이름</SortableThLink>
 *   // hrefFor: (next: SortState) => string — 기존 필터(cat·q)를 유지한 채 sort/dir만 갈아끼우고 page는 리셋.
 *
 * ⚠️ 수제 `<th>` + 자체 정렬 상태를 새로 만들지 말 것 — 규약이 갈라지면 같은 목록이 화면마다 다르게 줄 선다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ariaSort, sortIndicator, toggleSort, type SortState } from "@/lib/table/sort";

export function SortableThLink<K extends string>({
  sortKey,
  state,
  hrefFor,
  align = "left",
  /** 셀 여백 — 본문 셀과 좌우 정렬을 맞춰야 하므로 첫 열처럼 여백이 다른 자리는 여기서 맞춘다. */
  padClassName = "px-3 py-2",
  className = "",
  children,
}: {
  sortKey: K;
  state: SortState<K>;
  hrefFor: (next: SortState<K>) => string;
  align?: "left" | "right" | "center";
  padClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const active = state?.key === sortKey;
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const next = toggleSort(state, sortKey);
  return (
    <th className={`${padClassName} font-medium ${alignCls} ${className}`} aria-sort={ariaSort(state, sortKey)}>
      <Link
        href={hrefFor(next)}
        scroll={false}
        // 정렬 중인 열만 진하게 — 어느 기준으로 보고 있는지 한눈에.
        className={`group hover:text-foreground inline-flex items-center gap-1 ${active ? "text-foreground font-bold" : ""}`}
        title={
          active
            ? next
              ? "다시 누르면 내림차순"
              : "다시 누르면 정렬 해제(기본 순서)"
            : "눌러서 이 열로 정렬"
        }
      >
        {children}
        {/* 방향 표시는 EyIcon(아이콘 자리에 ▲▼ 텍스트 글리프 금지 — `aywa-icon-mapping` 테스트가 잡는다).
            비활성 열은 hover에서만 흐리게 = 어느 열이 정렬 가능한지 알리되 평소엔 조용하게. */}
        <span aria-hidden className={active ? "" : "opacity-0 transition-opacity group-hover:opacity-40"}>
          <EyIcon name={sortIndicator(state, sortKey) === "desc" ? "chevronDown" : "chevronUp"} size={11} />
        </span>
      </Link>
    </th>
  );
}
