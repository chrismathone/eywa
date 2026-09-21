/**
 * 운영 콕핏 카드 공통 셸 — 제목 + (선택) 카운트 + (선택) 메뉴 링크 헤더 + 본문.
 * 컬럼 안에서 두 장이 쌓일 때 높이를 균등 분배하도록 flex-1. 빈 상태는 DashEmpty.
 */
import { useId, type ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/aywa-icons";

export function DashCard({
  title,
  count,
  href,
  hrefLabel = "전체",
  action,
  children,
}: {
  title: string;
  count?: ReactNode;
  href?: string;
  hrefLabel?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="bg-card border-line shadow-card flex flex-1 flex-col overflow-hidden rounded-2xl border" aria-labelledby={titleId}>
      {/* 믹스 크기(13/11px) 한 줄은 baseline 정렬(작은 글씨 ~1px 뜸 방지) — 복합 action 슬롯만 self-center. */}
      <header className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 id={titleId} className="text-foreground text-sm font-bold">{title}</h3>
          {count != null ? (
            <span className="text-text-dim num text-xs">{count}</span>
          ) : null}
        </div>
        {action ? (
          <div className="self-center">{action}</div>
        ) : href ? (
          <WindowLink
            href={href}
            className="text-text-dim hover:text-foreground focus-visible:ring-primary/35 inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            {hrefLabel}
            <EyIcon name="arrowRight" size={11} />
          </WindowLink>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{children}</div>
    </section>
  );
}

export function DashEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-text-dim flex flex-1 items-center justify-center py-6 text-center text-xs">
      {children}
    </div>
  );
}
