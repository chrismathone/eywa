"use client";

/**
 * 오늘 면의 **반 1개 시트** — 한 장의 격자다. 위층은 그 날 교시의 수업계획, 아래층은 학생 명단이고,
 * **교시 = 세로 줄** 하나로 두 층이 이어진다. 원장 2026-08-11 지적들의 조립:
 * *"세로로 놓으면 가로 공간이 너무 의미없지 않아?"* → 교시를 가로로 / *"목록은 왜 여러 번?"* → 명단 1회 /
 * *"카드 크기도 같으면 좋겠고 여백도 최소화하고 줄로 교시 구분"* + *"학생은 붙어있잖아? 이것도 그냥
 * 붙여버려. 마치 엑셀처럼 … 대신 구분 경계만 명확하게"* → **상자 하나, 여백 대신 선**.
 *
 * 🔴 그래서 이 파일이 상자·스크롤·격자를 **혼자** 소유한다. 교시 카드(PeriodBlock)는 `flat`으로 껍데기를
 *    벗고, 로스터 표도 껍데기가 없다 — 층마다 상자를 두르면 사이에 여백과 테두리가 겹쳐 격자가 끊긴다.
 * 🔴 두 층의 가로 치수는 [today-columns](../lib/today-columns.ts) **한 곳**에서 나온다(교시 폭 = 카드 폭).
 * 새 기계가 아니다 — 계획은 주간 시트의 PeriodBlock, 로스터는 공용 셀(roster-slot-cells)이라 저장
 * 경로(CAS·setAttendanceCell·마크 LWW)와 게이트가 주간 시트와 한 벌이다.
 */
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { RosterGroupKey } from "../lib/roster-order";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";
import { TodayRosterTable } from "./today-roster-table";
// 가로 치수는 아래 통합 로스터와 **공유**한다 — 한쪽만 고치면 줄이 조용히 어긋난다(today-columns).
import { TODAY_GUTTER, TODAY_NAME_W, TODAY_SLOT_W } from "../lib/today-columns";

export function TodayClassSheet({
  day,
  data,
  linesBySlot,
  marks,
  attendance,
  store,
  handlers,
  canEdit,
  collapsedGroups,
  onToggleGroup,
}: {
  day: GridDay;
  data: ClassSheetWeekData;
  linesBySlot: Record<string, PlanLineDTO[]>;
  marks: Record<string, { status: string | null; progressNote: string | null; score: string | null }>;
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const hasRoster = day.slots.some((s) => s.roster.length > 0);
  return (
    // 🔴 **가로 스크롤은 하나**다(원장 2026-08-11 "줄맞춤"). 두 층이 각자 스크롤을 가지면 옆으로 미는
    //    순간 교시가 서로 다른 위치로 밀려 줄이 어긋난다. 안쪽은 `w-max`라 내용 폭 그대로 늘어난다
    //    (배경·테두리가 초기 폭에 멈춰 셀이 맨바탕 위에 그려지던 문제, 적대 리뷰 2026-08-11).
    <DragScrollArea barX className="min-w-0">
      <div className="bg-card border-foreground shadow-card w-max cursor-default rounded-2xl border p-2">
        {/* 계획 층 — 교시가 가로로. 명단은 아래 층이 맡으므로 hideRoster, 껍데기는 이 상자가 있으니 flat.
            일괄 입력(SlotBulk — '기록 없는 N명 출석' 포함)은 교시 머리에 그대로 산다. */}
        <div className="flex items-start">
          {/* 학생 이름 열 자리 — 아래 표의 첫 열과 같은 폭만큼 비워 교시 줄을 맞춘다. */}
          <div aria-hidden className="shrink-0" style={{ width: TODAY_NAME_W }} />
          {day.slots.map((slot) => (
            // 교시 한 칸 = 열 폭 그대로(숨 0). 경계는 여백이 아니라 **세로선**이 긋고, 그 선이 아래층
            // 표의 교시 경계선과 같은 x에 서서 두 층이 한 격자로 읽힌다.
            <div
              key={slot.slotStart}
              className="border-line-strong shrink-0 border-l px-1.5"
              style={{ width: TODAY_SLOT_W, paddingRight: TODAY_GUTTER || undefined }}
            >
              <PeriodBlock
                date={day.date}
                slot={slot}
                data={data}
                lines={linesBySlot[`${day.date}|${slot.slotStart}`] ?? []}
                marks={marks}
                attendance={attendance}
                store={store}
                handlers={handlers}
                canEdit={canEdit}
                collapsedGroups={collapsedGroups}
                onToggleGroup={onToggleGroup}
                hideRoster
                flat
              />
            </div>
          ))}
        </div>

        {/* 두 층의 경계 — 세로선들과 만나 격자가 된다(여백으로 띄우지 않는다). */}
        {hasRoster ? (
          <>
            <div className="border-line-strong -mx-2 my-1.5 border-t" />
            <TodayRosterTable
              day={day}
              data={data}
              marks={marks}
              attendance={attendance}
              handlers={handlers}
              canEdit={canEdit}
              collapsedGroups={collapsedGroups}
              onToggleGroup={onToggleGroup}
            />
          </>
        ) : null}
      </div>
    </DragScrollArea>
  );
}
