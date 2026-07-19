/**
 * Pill — 소프트 프로덕트 톤: Pretendard 11px 600, 999px radius (2026-07-19 de-mono)
 * soft 버전은 color soft 배경 + 같은 색 텍스트.
 */
import type { ReactNode } from "react";

export type PillColor =
  | "primary"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger"
  | "neutral";

type Props = {
  color?: PillColor;
  soft?: boolean;
  children: ReactNode;
  className?: string;
};

const SOFT_CLASS: Record<PillColor, string> = {
  primary: "bg-primary-soft text-primary",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-bg-soft text-text-dim",
};

const SOLID_CLASS: Record<PillColor, string> = {
  primary: "bg-primary text-primary-foreground",
  gold: "bg-gold text-white",
  blue: "bg-blue text-white",
  purple: "bg-purple text-white",
  rose: "bg-rose text-white",
  amber: "bg-amber text-white",
  danger: "bg-danger text-white",
  neutral: "bg-ink text-background",
};

export function Pill({ color = "neutral", soft = true, children, className }: Props) {
  const cls = soft ? SOFT_CLASS[color] : SOLID_CLASS[color];
  return (
    <span
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-pill px-2.5 py-[3px] text-[11px] font-bold ${cls} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
