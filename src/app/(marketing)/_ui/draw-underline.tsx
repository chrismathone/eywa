/**
 * DrawUnderline — 강조 단어에 좌→우로 그어지는 primary/gold/mint 언더라인.
 * 부모 Reveal이 data-in이 되면 그어진다. 전 페이지에서 5~6회만(남용 금지).
 * 기본은 primary(브랜드 그린), mint는 다크 파인 서피스 전용.
 */
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  tone?: "primary" | "gold" | "mint";
  className?: string;
};

export function DrawUnderline({ children, tone = "primary", className }: Props) {
  return (
    <span className={`ey-uline ${className ?? ""}`} data-tone={tone === "primary" ? undefined : tone}>
      {children}
    </span>
  );
}
