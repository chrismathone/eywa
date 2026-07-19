import type { ReactNode } from "react";
import { Minus, Square, X } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";

/**
 * BrowserFrame — 제품 화면을 담는 공통 프레임 (히어로·기능 목업 공용).
 * 맥 브라우저 크롬이 아니라 **eywa 플로팅 창 크롬**(실제 제품의 창 시스템)을 재현:
 * 타이틀바(bg-soft) + 창 제목 + Minus/Square/X 컨트롤. "현재 제품 그대로"가 컨셉.
 */
export function BrowserFrame({
  title = "오늘 · 운영실",
  url,
  children,
  className,
}: {
  title?: string;
  /** mono 보조 메타(라우트 경로 등) — 타이틀 옆에 옅게 */
  url?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border-line-strong relative overflow-hidden rounded-[18px] border shadow-[0_1px_2px_rgba(11,16,13,0.05),0_36px_80px_-36px_rgba(11,16,13,0.4)] ${className ?? ""}`}
    >
      <div className="border-line bg-bg-soft flex h-10 items-center gap-2.5 border-b pr-3 pl-3.5">
        <span className="bg-ink flex size-5.5 shrink-0 items-center justify-center rounded-[6px]">
          <EyIcon name="building" size={12} className="text-white" />
        </span>
        <span className="text-foreground truncate text-[12px] font-bold">{title}</span>
        {url ? (
          <span className="text-text-faint hidden truncate font-mono text-[10.5px] sm:inline">{url}</span>
        ) : null}
        <span className="flex-1" />
        <span className="text-text-faint flex shrink-0 items-center gap-2" aria-hidden="true">
          <Minus size={13} />
          <Square size={10} />
          <X size={13} />
        </span>
      </div>
      {children}
    </div>
  );
}
