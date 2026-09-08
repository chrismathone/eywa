/**
 * Pill — 소프트 프로덕트 톤: Pretendard 11px 600, 999px radius (2026-07-19 de-mono)
 * soft 버전은 color soft 배경 + 같은 색 텍스트.
 */
import type { ReactNode } from "react";

export type PillColor =
  | "primary"
  | "green"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger"
  | "neutral";

/**
 * 크기 — 기본 `sm`(11px, 앱 전역 알약). `md`는 **글씨를 키운 화면**(등록상담 칸반 카드)에서 배지만
 * 작게 남아 균형이 깨지는 걸 막는다. 🔴 className으로 `text-*`를 덮지 말 것 — 여긴 twMerge를 안 타서
 * 충돌 유틸의 승자가 문자열 순서가 아니라 **생성된 CSS 순서**로 정해진다([[#116]]).
 */
type PillSize = "sm" | "md";

type Props = {
  color?: PillColor;
  soft?: boolean;
  size?: PillSize;
  children: ReactNode;
  className?: string;
};

const SIZE_CLASS: Record<PillSize, string> = {
  sm: "px-2.5 py-[3px] text-xs",
  md: "px-3 py-[5px] text-sm",
};

const SOFT_CLASS: Record<PillColor, string> = {
  primary: "bg-primary-soft text-primary",
  green: "bg-green-soft text-green",
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
  green: "bg-green text-white",
  gold: "bg-gold text-white",
  blue: "bg-blue text-white",
  purple: "bg-purple text-white",
  rose: "bg-rose text-white",
  amber: "bg-amber text-white",
  danger: "bg-danger text-white",
  neutral: "bg-ink text-background",
};

export function Pill({ color = "neutral", soft = true, size = "sm", children, className }: Props) {
  const cls = soft ? SOFT_CLASS[color] : SOLID_CLASS[color];
  return (
    <span
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-pill font-bold ${SIZE_CLASS[size]} ${cls} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
