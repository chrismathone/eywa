/**
 * DrawUnderline — 강조 단어에 좌→우로 그어지는 primary/gold/azure 언더라인.
 * 부모 Reveal이 data-in이 되면 그어진다. 전 페이지에서 5~6회만(남용 금지).
 * 기본은 primary(브랜드 네이비), azure는 다크 네이비 서피스 전용.
 */
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  tone?: "primary" | "gold" | "azure";
  className?: string;
};

export function DrawUnderline({ children, tone = "primary", className }: Props) {
  return (
    <span className={`ey-uline ${className ?? ""}`} data-tone={tone === "primary" ? undefined : tone}>
      {children}
    </span>
  );
}
