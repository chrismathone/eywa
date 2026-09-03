"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SEARCH_BOX } from "@/components/toolbar-controls";

/**
 * 면 공용 툴바 — 검색 + (필터 칩) + 우측 동작. 치수는 규약 부품(`@/components/toolbar`)이 정한다.
 * 🔴 `className`으로 높이·라운드를 덮지 않는다(툴바 캐논 가드).
 */
export function ListToolbar({
  query,
  onQueryChange,
  placeholder,
  filters,
  extra,
  actions,
  summary,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  /** 필터 칩 묶음(`<ToolbarSegment>`). */
  filters?: ReactNode;
  /** 묶음 뒤에 홀로 서는 토글 칩(`<ToolbarChip>`) — 예: 폐기 숨김. */
  extra?: ReactNode;
  /** 우측 동작 버튼(`<ToolbarButton>`). */
  actions?: ReactNode;
  /** "N건 표시" 같은 읽기 전용 요약. */
  summary?: ReactNode;
}) {
  return (
    <Toolbar>
      <label className={`${TOOLBAR_SEARCH_BOX} shrink-0`}>
        <EyIcon name="search" size={14} />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="text-foreground placeholder:text-text-faint w-44 min-w-0 h-full bg-transparent leading-normal outline-none"
        />
      </label>
      {filters}
      {extra}
      {summary ? <span className="text-text-faint num shrink-0 text-xs">{summary}</span> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </Toolbar>
  );
}
