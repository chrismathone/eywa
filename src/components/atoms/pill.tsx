/**
 * Pill — 시안 사양: mono 11px 700 uppercase, 3px·8px, 999px radius
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
      className={`micro inline-flex items-center justify-center whitespace-nowrap rounded-pill px-2 py-[3px] ${cls} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
