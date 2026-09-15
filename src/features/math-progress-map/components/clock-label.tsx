import type { ReactNode } from "react";
import styles from "./continuous-dial.module.css";

/** 시계가 회전해도 글자는 항상 똑바로 읽힌다. 일반 지도에서는 회전값이 0이다. */
export function ClockLabel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <g transform={`translate(${x} ${y})`}><g className={styles.counterRotation}>{children}</g></g>;
}
