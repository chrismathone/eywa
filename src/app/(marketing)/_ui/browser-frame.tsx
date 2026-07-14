import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";

/**
 * BrowserFrame — 제품 화면을 담는 공통 브라우저 크롬 프레임 (히어로·기능 목업 공용).
 * 깊이 있는 그림자로 "떠 있는 제품 화면" 느낌.
 */
export function BrowserFrame({
  url = "eywa.app · 인재원수학",
  children,
  className,
}: {
  url?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border-line relative overflow-hidden rounded-2xl border shadow-[0_40px_90px_-30px_rgba(13,17,16,0.32)] ${className ?? ""}`}
    >
      <div className="border-line bg-bg-soft flex items-center gap-2 border-b px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#e0726b]" />
          <span className="size-2.5 rounded-full bg-[#e2b04a]" />
          <span className="size-2.5 rounded-full bg-[#5bb873]" />
        </span>
        <span className="bg-card border-line text-text-faint ml-3 flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1 font-mono text-[11px]">
          <EyIcon name="building" size={11} className="text-primary" />
          {url}
        </span>
      </div>
      {children}
    </div>
  );
}
