"use client";

import type { StudentProgress } from "../model";
import { CurriculumPosition } from "./curriculum-position";
import { ProgressMapProvider } from "./map-state";
import { PeriodSelector } from "./period-selector";
import { PlanVsActual } from "./plan-vs-actual";
import { ProgressMapPanel } from "./progress-map-panel";
import { StudentHeader } from "./student-header";
import styles from "./progress-map.module.css";
import { CurriculumTimelineCard } from "./timeline/curriculum-timeline-card";

/**
 * 수학 학습 진도맵 — 한 학생의 연간 커리큘럼 위치.
 *
 * 기본 화면은 고정 시계와 세로 커리큘럼을 같은 탐색 위치로 연결한다.
 * 기존 지도 화면도 동일한 학생 데이터와 선택 상태를 공유한다.
 */
export function MathProgressDashboard({ progress }: { progress: StudentProgress }) {
  return (
    <ProgressMapProvider progress={progress}>
      <div className={`${styles.selectionTheme} flex flex-col gap-4`}>
        <StudentHeader />
        <PeriodSelector />
        {/* 폰(<768)은 요약이 먼저, 태블릿(768~1023)은 지도가 먼저 한 열로, 데스크톱은 [지도 | 요약] 두 열(지시 16).
            DOM은 요약(글자)이 먼저다 — 지도 칸이 수백 개라 키보드·스크린리더가 요약에 닿기 전에 칸을 다 지나지 않게(시각 순서만 `order`). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(34rem,1fr)] lg:items-stretch">
          <ProgressMapPanel />
          <CurriculumTimelineCard />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <PlanVsActual />
          <CurriculumPosition />
        </div>
      </div>
    </ProgressMapProvider>
  );
}
