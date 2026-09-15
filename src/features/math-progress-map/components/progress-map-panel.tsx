"use client";

import { useState } from "react";
import { ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { Legend } from "./legend";
import { ProgressMap } from "./progress-map";
import styles from "./progress-map.module.css";

/** 표시 설정만 바꾼다. 지도는 다시 마운트하지 않아 연도·선택·확대 단계를 유지한다. */
export function ProgressMapPanel() {
  const [navy, setNavy] = useState(true);
  const [backgroundOn, setBackgroundOn] = useState(true);
  const dark = navy && backgroundOn;

  return (
    <div
      className={`${styles.surface} ${dark ? `${styles.dialTheme} ${styles.backgroundOn}` : ""} order-2 min-w-0 md:order-1`}
      data-map-design={navy ? "navy" : "original"}
      data-map-background={dark ? "on" : "off"}
    >
      <ProgressMap navy={navy} controls={
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2" role="group" aria-label="지도 디자인 설정">
          <ToolbarSegment title="지도 디자인">
            <ToolbarSegmentItem active={!navy} onClick={() => setNavy(false)}>기존</ToolbarSegmentItem>
            <ToolbarSegmentItem active={navy} onClick={() => setNavy(true)}>남색</ToolbarSegmentItem>
          </ToolbarSegment>
          <ToolbarChip
            active={dark}
            disabled={!navy}
            onClick={() => setBackgroundOn((value) => !value)}
            aria-label="남색 배경"
            title={navy ? "남색 배경을 켜거나 끕니다" : "남색 디자인에서 배경을 켜거나 끌 수 있습니다"}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            배경 {dark ? "켜짐" : "꺼짐"}
          </ToolbarChip>
        </div>
      } />
      <div className={styles.legend}><Legend navy={navy} /></div>
    </div>
  );
}
