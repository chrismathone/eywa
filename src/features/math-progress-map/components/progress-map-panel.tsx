"use client";

import { Legend } from "./legend";
import { ProgressMap } from "./progress-map";
import styles from "./progress-map.module.css";

/** 밝은 배경의 원형 지도. 탐색 상태는 공통 컨텍스트가 유지한다. */
export function ProgressMapPanel() {
  return (
    <div
      className={`${styles.surface} min-w-0`}
      data-map-design="original"
      data-map-background="off"
    >
      <ProgressMap />
      <div className={styles.legend}><Legend /></div>
    </div>
  );
}
