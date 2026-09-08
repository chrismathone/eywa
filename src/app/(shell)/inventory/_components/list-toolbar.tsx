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
  /** 필터 드롭다운(`필터: 값` — 지시서 §10, 칩 묶음이 아니다). */
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
          // 안 글자는 16px(sm 라벨) — 자리표시자 "자산ID, 모델명, 위치, 사용자 검색"이 18px에선 잘렸다(원장 2026-09-04
          // *"내부 텍스트는 폰트 작게 해서 필요한 내용이 더 보이면"*). 앱의 검색 입력이 전부 같은 값(SearchForm·StudentSearchBox).
          className="text-foreground placeholder:text-text-faint h-full w-60 min-w-0 bg-transparent text-(length:--control-label-sm) leading-normal outline-none"
        />
      </label>
      {filters}
      {extra}
      {summary ? <span className="text-text-faint num shrink-0 text-xs">{summary}</span> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </Toolbar>
  );
}
