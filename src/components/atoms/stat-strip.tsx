import type { ReactNode } from "react";
import { BigStatSkeleton } from "./big-stat";
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

/**
 * 요약 띠 스켈레톤 — 실물 `StatStrip` 껍데기에 `BigStatSkeleton`을 끼운다(띠 규칙·폭 기준이 실물과 같다).
 * 🔴 2026-11-05 스켈레톤 2차 검수: 수납·재고·회의록 스켈레톤이 09-11 띠 전환 뒤에도 떨어진 카드 3~5장을 그려 1280px 미만에서 2줄
 *    (실물은 1줄)이었다. 카드 수(`count`)만 실물과 맞추면 된다.
 * - `sub` — 보조 줄. `true`면 모든 칸, **배열이면 칸마다**(실물이 일부 칸에만 보조 줄을 둘 때 — 띠가 폭에 따라 줄을 바꾸면
 *   보조 줄 없는 칸이 혼자 선 줄이 스켈레톤에서만 높아져 도착 때 튀었다, 2026-11-05 리뷰 · 수납).
 */
export function StatStripSkeleton({
  count,
  sub = false,
  className = "",
}: {
  count: number;
  sub?: boolean | readonly boolean[];
  className?: string;
}) {
  return (
    <StatStrip label="현황 요약 불러오는 중" className={className}>
      {Array.from({ length: count }, (_, i) => (
        <BigStatSkeleton key={i} sub={typeof sub === "boolean" ? sub : (sub[i] ?? false)} />
      ))}
    </StatStrip>
  );
}
