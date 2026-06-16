/**
 * DrawUnderline — 강조 단어에 좌→우로 그어지는 gold/primary 언더라인.
 * 부모 Reveal이 data-in이 되면 그어진다. 전 페이지에서 5~6회만(남용 금지).
 */
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  tone?: "gold" | "primary";
  className?: string;
};

export function DrawUnderline({ children, tone = "gold", className }: Props) {
  return (
    <span
      className={`ey-uline ${className ?? ""}`}
      data-tone={tone === "primary" ? "primary" : undefined}
    >
      {children}
    </span>
  );
}
