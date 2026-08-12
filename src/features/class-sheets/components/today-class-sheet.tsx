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
  return (
    // 🔴 **가로 스크롤은 하나**다(원장 2026-08-11 "줄맞춤"). 위 레일과 아래 표가 각자 스크롤을 가지면
    //    옆으로 미는 순간 교시가 서로 다른 위치로 밀려 줄이 어긋난다 — 같은 격자를 쓰는 두 층은 같은
    //    스크롤을 타야 한다. 안쪽은 `w-max`라 내용 폭 그대로 늘어난다(배경이 초기 폭에 멈추지 않게).
    <DragScrollArea barX className="min-w-0">
      <div className="w-max space-y-2">
        {/* 교시 카드(계획) — 가로 레일. 로스터는 아래 통합 표가 맡으므로 hideRoster. 일괄 입력(SlotBulk —
            '기록 없는 N명 출석' 포함)은 카드 머리에 그대로 산다.
            ⚠️ 바깥 상자는 아래 로스터 카드와 **같은 모형**(테두리 1 + 패딩 10)이라야 첫 교시의 시작점이
            맞는다 — 여기만 상자가 없으면 카드가 표보다 11px 왼쪽에서 시작한다(테두리는 투명). */}
        <div className="border border-transparent p-2.5">
          <div className="flex items-start">
            {/* 학생 이름 열 자리 — 아래 표의 첫 열과 같은 폭만큼 비워 교시 열을 맞춘다. */}
            <div aria-hidden className="shrink-0" style={{ width: TODAY_NAME_W }} />
            {day.slots.map((slot) => (
              // 교시 한 칸 = 카드 + 오른쪽 숨. 숨을 `gap`으로 주면 카드 왼쪽 모서리가 표의 열 경계보다
              // 점점 밀려 교시가 늘수록 어긋남이 누적된다(안쪽 패딩이라야 폭이 정확히 교시 폭이다).
              <div
                key={slot.slotStart}
                className="shrink-0"
                style={{ width: TODAY_SLOT_W, paddingRight: TODAY_GUTTER }}
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
                />
              </div>
            ))}
          </div>
        </div>

        {/* 통합 로스터 — 위 레일과 같은 격자(today-columns)라 교시 경계가 위아래로 이어진다. */}
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
    </DragScrollArea>
  );
}
