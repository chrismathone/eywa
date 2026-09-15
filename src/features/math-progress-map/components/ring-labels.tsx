"use client";

import { memo, useState, type CSSProperties } from "react";
import { RINGS, VIEWBOX } from "../geometry";
import { ringLabelAngle } from "../ring-label-position";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import styles from "./ring-labels.module.css";

const mid = (b: readonly [number, number]) => (b[0] + b[1]) / 2;

const LABELS = [
  { mode: "year", label: "연간", radius: mid(RINGS.year) },
  { mode: "month", label: "월간", radius: mid(RINGS.month) },
  { mode: "week", label: "주간", radius: mid(RINGS.week) },
  { mode: "day", label: "일간", radius: mid(RINGS.day) },
] as const;

/** 월에 따라 위·아래로 옮기는 공통 이름표. HTML 궤도와 역회전을 함께 움직여 글자는 수평을 유지한다. */
export const RingLabels = memo(function RingLabels() {
  const { mode, focus, display, currentProgressPosition } = useProgressMap();
  const [motion, setMotion] = useState(() => ({ angle: ringLabelAngle(0, focus.month), position: currentProgressPosition }));
  if (motion.position !== currentProgressPosition) {
    const direction = display === "continuous" && currentProgressPosition < motion.position ? "counterclockwise" : "clockwise";
    setMotion({ angle: ringLabelAngle(motion.angle, focus.month, direction), position: currentProgressPosition });
  }
  const { angle } = motion;
  return (
    <div className={styles.labels} data-dial-layer="labels" data-label-angle={angle} style={{ "--label-angle": `${angle}deg` } as CSSProperties} aria-hidden>
      {LABELS.map((item) => <div key={item.mode} className={styles.orbit}>
        <div className={styles.anchor} style={{ top: `${50 - item.radius / VIEWBOX * 100}%` }}>
          <div className={styles.upright}><span className={styles.pill} data-active={ringActive(item.mode, mode) ? "true" : undefined}>{item.label}</span></div>
        </div>
      </div>)}
    </div>
  );
});
