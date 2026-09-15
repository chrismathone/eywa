"use client";

import type { CSSProperties } from "react";
import { Toolbar, ToolbarChip, ToolbarRow, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { formatDotDate } from "../calendar";
import { focusOfDate, resolveDay, resolveWeek } from "../focus";
import { VIEW_MODES, VIEW_MODE_LABEL } from "../model";
import { useProgressMap } from "./map-state";
import styles from "./year-transition.module.css";
import mapStyles from "./progress-map.module.css";
import { MapPeriodPicker } from "./map-period-picker";

/**
 * 보기 단위 선택 — [일간][주간][월간][분기][연간]. 화면을 바꾸는 게 아니라 **같은 진도를 시간 단위만 바꿔** 본다
 * (지도는 그 링을 켜고, 요약은 그 줄을 켜고, 상세 패널은 그 단위의 목록을 보인다).
 * 주차·날짜 선택과 오늘·종강 날짜로 이동하는 버튼을 함께 둔다.
 */
export function PeriodSelector() {
  const { mode, setMode, focus, view, currentView, progress, sourceProgress, years, selectYear, selectPeriod, resetFocus } = useProgressMap();
  const week = resolveWeek(view, focus);
  const day = resolveDay(view, focus);
  // "기준일에 있는가"는 **풀린 주·날**로 비교한다. 월 선택은 1주차에서 시작하므로,
  // 이번 달이어도 기준일의 주·날과 다르면 '기준일로' 칩이 보여야 한다.
  // 기준일 쪽도 **풀어서** 비교한다 — 기준일이 해 밖이면 초점이 `{week:null, day:null}`로 clamp되어 맨 값 비교로는 영영 다르다.
  const home = focusOfDate(sourceProgress.asOf, sourceProgress.year);
  const homeWeek = resolveWeek(currentView, home);
  const homeDay = resolveDay(currentView, home);
  const atHome = view.year === sourceProgress.year && focus.month === home.month && week.index === homeWeek.index && day.date === homeDay.date;
  const finalStep = progress.roadmap?.steps.at(-1);
  return (
    <Toolbar rail={false}>
      {years.length > 1 ? (
        <ToolbarRow>
        <ToolbarSegment label="연도" title="입학부터 종강 예정 연도까지 이동합니다">
          <div className={styles.yearOptions} style={{ "--year-count": years.length, "--year-index": years.indexOf(view.year) } as CSSProperties}>
          {years.map((year) => (
            <ToolbarSegmentItem key={year} className={styles.yearOption} active={view.year === year} onClick={() => selectYear(year)}>
              {year}년
            </ToolbarSegmentItem>
          ))}
          </div>
        </ToolbarSegment>
        </ToolbarRow>
      ) : null}
      <ToolbarRow>
      <ToolbarSegment label="보기" title="같은 진도를 시간 단위만 바꿔 봅니다">
        {VIEW_MODES.map((m) => (
          <ToolbarSegmentItem key={m} className={mapStyles.selectionItem} active={mode === m} onClick={() => setMode(m)}>
            {VIEW_MODE_LABEL[m]}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
      </ToolbarRow>
      <ToolbarRow>
      <MapPeriodPicker />
      {finalStep ? (
        <ToolbarChip active={false} onClick={() => selectPeriod(Number(finalStep.endMonth.slice(0, 4)), Number(finalStep.endMonth.slice(5, 7)))} title={`${finalStep.endMonth} ${finalStep.label} 종강 예정`}>종강 날짜로</ToolbarChip>
      ) : null}
      {atHome ? null : (
        <ToolbarChip active={false} onClick={resetFocus} title={`${formatDotDate(sourceProgress.asOf)} 진도로 돌아갑니다`}>
          오늘 날짜로
        </ToolbarChip>
      )}
      <span className="ml-auto inline-flex items-center gap-2 whitespace-nowrap text-xs">
        <span className="text-text-dim num">{formatDotDate(progress.asOf)} 기준</span>
        {progress.estimated ? <span className="text-amber font-bold">예상 진도</span> : null}
      </span>
      </ToolbarRow>
    </Toolbar>
  );
}
