import type { ReactNode } from "react";
import styles from "./stat-strip.module.css";

/** 업무 목록용 요약. BigStat의 값·단위·상호작용을 그대로 두고 카드 여백만 줄인다. */
export function StatStrip({
  children,
  label = "현황 요약",
  className = "",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <section aria-label={label} className={`${styles.strip} ${className}`}>
      {children}
    </section>
  );
}
