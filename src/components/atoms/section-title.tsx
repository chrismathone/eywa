/**
 * SectionTitle — 시안 사양: 14px 700 + 우측 action slot
 * 카드 헤더 / 섹션 헤더에 일관되게 사용.
 */
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  action?: ReactNode;
  helper?: ReactNode;
  className?: string;
};

export function SectionTitle({ children, action, helper, className }: Props) {
  return (
    <header className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <div className="min-w-0">
        <h3 className="text-foreground text-sm font-bold tracking-tight">{children}</h3>
        {helper ? <p className="caption mt-0.5">{helper}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
