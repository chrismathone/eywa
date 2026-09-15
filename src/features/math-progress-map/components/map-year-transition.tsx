"use client";

import { useState, type ReactNode } from "react";
import { ProgressMapSnapshot, useProgressMap, type ProgressMapState } from "./map-state";
import styles from "./year-transition.module.css";

type Scene = {
  current: ProgressMapState;
  outgoing: ProgressMapState | null;
  direction: "forward" | "backward";
  revision: number;
  key: string;
  level: number;
  content: ReactNode;
  outgoingContent: ReactNode;
  motion: "year" | "zoom";
};

/** 연도가 바뀌면 시계의 링을 다시 정렬한다. 이전 장면은 한 장만 보관해 연속 클릭을 쌓아 두지 않는다. */
export function MapYearTransition({ children, sceneKey = "full", level = 0 }: { children: ReactNode; sceneKey?: string; level?: number }) {
  const current = useProgressMap();
  const [scene, setScene] = useState<Scene>(() => ({ current, outgoing: null, direction: "forward", revision: 0,
    key: sceneKey, level, content: children, outgoingContent: null, motion: "year" }));

  // 같은 해의 월·주 선택도 기억해야 퇴장 장면에 마지막으로 보던 초점이 남는다.
  if (scene.current !== current || scene.key !== sceneKey) {
    const yearChanged = scene.current.view.year !== current.view.year;
    setScene(!yearChanged && scene.key === sceneKey ? { ...scene, current, content: children, level } : {
      current,
      outgoing: scene.current,
      direction: (yearChanged ? current.view.year > scene.current.view.year : level >= scene.level) ? "forward" : "backward",
      revision: scene.revision + 1,
      key: sceneKey, level, content: children, outgoingContent: scene.content,
      motion: yearChanged ? "year" : "zoom",
    });
  }

  return (
    <div className={styles.stage} data-year-transition data-direction={scene.direction} data-motion={scene.motion}>
      {scene.outgoing ? (
        <div key={`out-${scene.revision}`} className={styles.departure} aria-hidden inert>
          <ProgressMapSnapshot value={scene.outgoing}>{scene.outgoingContent}</ProgressMapSnapshot>
        </div>
      ) : null}
      <div
        key={scene.revision}
        className={scene.outgoing ? styles.arrival : undefined}
        data-year-scene={current.view.year}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          setScene((latest) => latest.revision === scene.revision && latest.outgoing
            ? { ...latest, outgoing: null, outgoingContent: null } : latest);
        }}
      >
        {children}
      </div>
    </div>
  );
}
