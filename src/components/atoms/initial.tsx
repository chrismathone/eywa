/**
 * Initial — 시안 사양: 8px radius 정사각형 + color 10% tint 배경 + 글자
 * 동그란 프로필 사진은 절대 금지. 모든 사람 표시는 이 컴포넌트로.
 */
import type { ReactNode } from "react";

export type InitialColor =
  | "primary"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger"
  | "neutral";

type Props = {
  name?: string | null;
  color?: InitialColor;
  size?: "sm" | "md" | "lg";
  className?: string;
  children?: ReactNode;
};

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
};

const COLOR_CLASS: Record<InitialColor, string> = {
  primary: "bg-primary-soft text-primary",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-bg-soft text-text-dim",
};

function pickInitial(name?: string | null): string {
  if (!name) return "—";
  const trimmed = name.trim();
  if (!trimmed) return "—";
  return trimmed.charAt(0).toUpperCase();
}

export function Initial({
  name,
  color = "primary",
  size = "md",
  className,
  children,
}: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold tracking-tight ${SIZE_CLASS[size]} ${COLOR_CLASS[color]} ${className ?? ""}`}
      aria-label={name ?? undefined}
    >
      {children ?? pickInitial(name)}
    </span>
  );
}
