/**
 * 운영 콕핏 카드 공통 셸 — 제목 + (선택) 카운트 + (선택) 메뉴 링크 헤더 + 본문.
 * 컬럼 안에서 두 장이 쌓일 때 높이를 균등 분배하도록 flex-1. 빈 상태는 DashEmpty.
 */
import type { ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";

export function DashCard({
  title,
  count,
  href,
  hrefLabel = "전체 →",
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
  return (
    <section className="bg-card border-line shadow-card flex flex-1 flex-col overflow-hidden rounded-2xl border">
      <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-foreground text-[13px] font-bold">{title}</h2>
          {count != null ? (
            <span className="text-text-faint num font-mono text-[11px]">{count}</span>
          ) : null}
        </div>
        {action ? (
          action
        ) : href ? (
          <WindowLink
            href={href}
            className="text-text-faint hover:text-foreground shrink-0 text-[11px]"
          >
            {hrefLabel}
          </WindowLink>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{children}</div>
    </section>
  );
}

export function DashEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-text-faint flex flex-1 items-center justify-center py-6 text-center text-[12px]">
      {children}
    </div>
  );
}
