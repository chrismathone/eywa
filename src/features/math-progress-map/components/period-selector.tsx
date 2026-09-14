"use client";

import { Toolbar, ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { formatDotDate, formatMdW } from "../calendar";
import { focusOfDate, resolveDay, resolveWeek } from "../focus";
import { VIEW_MODES, VIEW_MODE_LABEL } from "../model";
import { useProgressMap } from "./map-state";

/**
 * 보기 단위 선택 — [일간][주간][월간][분기][연간]. 화면을 바꾸는 게 아니라 **같은 진도를 시간 단위만 바꿔** 본다
 * (지도는 그 링을 켜고, 요약은 그 줄을 켜고, 상세 패널은 그 단위의 목록을 보인다).
 * 옆에 "보는 곳"(초점)과, 초점이 기준일에서 벗어났을 때만 '기준일로' 칩.
 */
export function PeriodSelector() {
  const { mode, setMode, focus, view, progress, resetFocus } = useProgressMap();
  const week = resolveWeek(view, focus);
  const day = resolveDay(view, focus);
  // "기준일에 있는가"는 **풀린 주·날**로 비교한다 — 지도에서 이번 달을 누르면 초점은 `{week:null}`이지만 풀리면 기준일 그대로라
  // '기준일로' 칩이 설 이유가 없다.
  // 기준일 쪽도 **풀어서** 비교한다 — 기준일이 해 밖이면 초점이 `{week:null, day:null}`로 clamp되어 맨 값 비교로는 영영 다르다.
  const home = focusOfDate(progress.asOf, progress.year);
  const homeWeek = resolveWeek(view, home);
  const homeDay = resolveDay(view, home);
  const atHome = focus.month === home.month && week.index === homeWeek.index && day.date === homeDay.date;
  return (
    <Toolbar>
      <ToolbarSegment label="보기" title="같은 진도를 시간 단위만 바꿔 봅니다">
        {VIEW_MODES.map((m) => (
          <ToolbarSegmentItem key={m} active={mode === m} onClick={() => setMode(m)}>
            {VIEW_MODE_LABEL[m]}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
      <span className="text-text-dim text-xs font-medium">
        보는 곳 <span className="text-foreground num font-bold">{focus.month}월 {week.index}주 · {formatMdW(day.date)}</span>
      </span>
      {atHome ? null : (
        <ToolbarChip active={false} onClick={resetFocus} title="초점을 기준일로 되돌립니다">
          기준일로
        </ToolbarChip>
      )}
      <span className="text-text-dim num ml-auto text-xs">{formatDotDate(progress.asOf)} 기준</span>
    </Toolbar>
  );
}
