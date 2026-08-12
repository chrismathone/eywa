"use client";

/**
 * 오늘 면의 **반 1개 시트** — 위에는 그 날 교시 카드(머리+수업계획+일괄 입력)를 **가로로**, 아래에는
 * 학생 명단을 **한 번만** 담은 통합 로스터(교시 = 열 그룹). 원장 2026-08-11 두 지적의 조립이다:
 * *"세로로 놓으면 가로 공간이 너무 의미없지 않아?"* + *"목록은 왜 여러 번?"*.
 *
 * 새 기계가 아니다 — 교시 카드는 주간 시트의 PeriodBlock(hideRoster), 로스터는 공용 셀
 * (roster-slot-cells)이라 저장 경로(CAS·setAttendanceCell·마크 LWW)와 게이트가 주간 시트와 한 벌이다.
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

/** 계획 카드 폭 — 주간 시트 열 폭(sheet-grid COL_W)과 같은 540px(계획 표 colgroup이 이 폭 기준). */
const PLAN_W = 540;

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
  return (
    <div className="space-y-2">
      {/* 교시 카드(계획) — 가로 레일. 로스터는 아래 통합 표가 맡으므로 hideRoster. 일괄 입력(SlotBulk —
          '기록 없는 N명 출석' 포함)은 카드 머리에 그대로 산다.
          ⚠️ 카드 폭은 540 고정(주간 시트 열과 동일 — PlanTable 고정열이 이 폭 기준이라 줄이면 진도·과제
          칸이 슬리버로 무너진다). 좁은 화면은 접는 대신 가로 드래그 스크롤이 받는다(시트와 같은 어포던스). */}
      <DragScrollArea barX className="min-w-0">
        <div className="flex w-max items-start gap-3">
          {day.slots.map((slot) => (
            <div key={slot.slotStart} className="shrink-0" style={{ width: PLAN_W }}>
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
              />
            </div>
          ))}
        </div>
      </DragScrollArea>

      {/* 통합 로스터 — 가로 스크롤은 표 컴포넌트가 카드 **안**에서 처리한다(카드 밖 스크롤 금지). */}
      {day.slots.some((s) => s.roster.length > 0) ? (
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
      ) : null}
    </div>
  );
}
