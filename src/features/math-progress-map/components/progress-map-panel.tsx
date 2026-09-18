"use client";

import { Legend } from "./legend";
import { ProgressMap } from "./progress-map";
import styles from "./progress-map.module.css";
import { useProgressMap } from "./map-state";

/** 밝은 배경의 원형 지도. 탐색 상태는 공통 컨텍스트가 유지한다. */
export function ProgressMapPanel() {
  const { progress } = useProgressMap();
  return (
    <div
      className={`${styles.surface} min-w-0`}
      data-map-design="original"
      data-map-background="off"
      data-learning={progress.learningMap ? "true" : undefined}
    >
      <ProgressMap controls={<Legend compact />} />
    </div>
  );
}
