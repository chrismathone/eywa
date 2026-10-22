"use client";

import { useId, useState, type ReactNode } from "react";

/** 통계 목록은 같은 높이를 유지하고, 전체 보기는 그 안에서 스크롤한다. */
export function CompactStatsList({
  children,
  label,
  className = "space-y-2",
  keepLast = false,
  limit = 6,
}: {
  children: ReactNode[];
  label: string;
  className?: string;
  keepLast?: boolean;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const hasMore = children.length > limit;
  const visible = expanded || !hasMore ? children : keepLast
    ? [...children.slice(0, limit - 1), children[children.length - 1]]
    : children.slice(0, limit);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div id={id} className="h-[300px] overflow-y-auto overscroll-contain pr-1" role="region" aria-label={label} tabIndex={0}>
        <ul className={className}>{visible}</ul>
      </div>
      {hasMore ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="text-primary border-line hover:bg-bg-soft mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium"
        >
          {expanded ? "접기" : `전체 ${children.length}개 항목 보기`}
        </button>
      ) : null}
    </div>
  );
}
