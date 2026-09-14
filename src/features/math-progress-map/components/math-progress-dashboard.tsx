"use client";

import type { StudentProgress } from "../model";
import { CurriculumPosition } from "./curriculum-position";
import { ProgressDetailPanel } from "./detail-panel";
import { Legend } from "./legend";
import { ProgressMapProvider } from "./map-state";
import { PeriodSelector } from "./period-selector";
import { PlanVsActual } from "./plan-vs-actual";
import { ProgressMap } from "./progress-map";
import { ProgressSummary } from "./progress-summary";
import { StudentHeader } from "./student-header";

/**
 * 수학 학습 진도맵 — 한 학생의 연간 커리큘럼 위치.
 *
 * 배치(지시 16): 데스크톱 = [학생 줄] / [원형 지도 | 요약·계획 대비·커리큘럼 위치] / [상세]. 태블릿 = 지도 위, 요약 아래.
 * 폰 = 요약 → 지도 → 상세(지도는 360px 아래로 안 줄이고 가로 스크롤).
 */
export function MathProgressDashboard({ progress }: { progress: StudentProgress }) {
  return (
    <ProgressMapProvider progress={progress}>
      <div className="flex flex-col gap-4">
        <StudentHeader />
        <PeriodSelector />
        {/* 폰(<768)은 요약이 먼저, 태블릿(768~1023)은 지도가 먼저 한 열로, 데스크톱은 [지도 | 요약] 두 열(지시 16).
            DOM은 요약(글자)이 먼저다 — 지도 칸이 수백 개라 키보드·스크린리더가 요약에 닿기 전에 칸을 다 지나지 않게(시각 순서만 `order`). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <aside className="order-1 flex min-w-0 flex-col gap-4 md:order-2">
            <ProgressSummary />
            <PlanVsActual />
            <CurriculumPosition />
          </aside>
          <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
            <ProgressMap />
            <Legend />
          </div>
        </div>
        <ProgressDetailPanel />
      </div>
    </ProgressMapProvider>
  );
}
