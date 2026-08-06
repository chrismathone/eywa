"use client";

// 주간 그리드 — 요일을 독립 스택이 아니라 **하나의 CSS grid**로 배치해, 같은 행의 카드가 같은 높이로
// 놓인다("카드 크기 맞춤"). 행 배치 전략(시각 정렬 vs 서수 배치)은 순수 함수 buildGridRows가 정한다
// — 평일+주말이 섞이면 시각 정렬이 거대한 공백을 만들어서다(grid-rows.ts 주석 참조).
//
// 헤더는 **본문 그리드와 분리된 sticky 밴드**다. 헤더 카드 자체를 sticky로 두면 카드가 둥글고 열 사이에
// 간격이 있어 **스크롤되는 본문이 모서리·틈으로 비쳐** 겹쳐 보인다(원장 제보 2026-07-29). 불투명 배경
// 밴드가 전 폭을 덮으면 본문은 그 뒤로 완전히 숨는다(gotcha #74 "불투명 base + 밴드 레이어"와 같은 처방).
import { memo, useMemo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { RosterGroupKey } from "../lib/roster-order";
import { buildGridRows } from "../lib/grid-rows";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const COL_W = 540;
const GAP_X = 12; // gap-x-3 — 밴드가 열 사이 틈까지 덮어야 본문이 안 비친다
// 교시 행 사이 간격(옛 gap-y-2). row-gap이 아니라 **행마다 붙는 전용 트랙**이다 — 아래 주석 참조.
const GAP_Y = 8;

export const SheetGrid = memo(function SheetGrid({
  days,
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
  days: GridDay[];
  data: ClassSheetWeekData;
  linesBySlot: Record<string, PlanLineDTO[]>;
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, { status: string; note: string | null; units: number | null }>;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
  /** 로스터 섹션 접힘 — 카드가 아니라 시트가 소유한다(나란한 카드의 줄맞춤 유지). */
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const rows = useMemo(() => buildGridRows(days), [days]);
  const columns = `repeat(${days.length}, ${COL_W}px)`;

  if (days.length === 0) {
    // 랜딩 빈 상태와 동일 스타일(부모가 flex가 아니라 self-center는 무효 — 카드형으로 통일)
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        이 주에는 수업이 없습니다.
      </p>
    );
  }

  return (
    // w-max — 밴드가 열 전체 폭(가로 스크롤 폭)을 덮게. 부모 폭에 맞추면 스크롤 시 오른쪽이 샌다.
    <div className="w-max pb-2">
      {/* sticky 밴드 — 불투명 배경 + 아래 여백 포함. z-10: 본문 위, StatusCell 팝오버(포털 z-50) 아래. */}
      <div
        className="bg-background sticky top-0 z-10 grid pb-2"
        style={{ gridTemplateColumns: columns, columnGap: GAP_X }}
      >
        {days.map((day) => {
          const isToday = day.date === data.today;
          return (
            <header
              key={day.date}
              // cursor-default — DragScrollArea의 cursor-grab이 헤더까지 덮지 않게(period-block과 동일)
              className="bg-card shadow-card flex cursor-default items-center gap-2 rounded-2xl px-3 py-2"
            >
              {/* 요일 = 원본 시트의 검정 반전 머리글(월/화/수). 오늘은 브랜드 네이비로 대체. */}
              <span
                className={`inline-flex size-7 items-center justify-center rounded-lg text-[15px] font-bold text-white ${
                  isToday ? "bg-primary" : "bg-foreground"
                }`}
              >
                {DOW_KO[day.dow]}
              </span>
              <span className="text-foreground num text-[13px] font-semibold">
                {day.date.slice(5).replace("-", "/")}
              </span>
              {isToday ? (
                <span className="border-primary text-primary rounded-full border px-1.5 py-0.5 text-[11px] font-bold">
                  오늘
                </span>
              ) : null}
            </header>
          );
        })}
      </div>

      {/* 같은 행 카드의 **속살까지** 줄을 맞춘다(원장 2026-08-04: "상단의 평시/내신 없더라도 좌우 동일하게
          학생 행 위치 맞출 것"). 카드 높이만 같으면(h-full) 계획 줄 수가 다른 순간 학생 표가 좌우로 어긋난다.
          → 한 교시 행에 **트랙 4개**(머리 / 계획 / 로스터 / 간격)를 깔고 카드가 앞 3개에 subgrid로 올라탄다.
          트랙 높이는 그 행에서 가장 큰 카드가 정하므로, 계획이 없는 카드는 계획 트랙이 빈 채로 늘어나
          **로스터 시작선이 같아진다**(실측: 어긋남 42px → 0).
          ⚠️ 간격을 `gap-y`로 주지 말 것 — row-gap은 **모든** 트랙 사이에 끼어 카드 **안쪽**(머리↔계획↔로스터)
             까지 벌어진다. 그래서 행마다 4번째 트랙을 간격으로 두고 rowGap은 0이다.
          ⚠️ subgrid 미지원 브라우저에선 선언이 무시돼 예전처럼 **각자 쌓인다**(정렬만 없어지고 안 깨진다). */}
      <div
        className="grid content-start"
        style={{
          gridTemplateColumns: columns,
          columnGap: GAP_X,
          gridTemplateRows: `repeat(${rows.length}, auto auto auto ${GAP_Y}px)`,
          rowGap: 0,
        }}
      >
        {rows.map((row, ri) =>
          row.map((slot, ci) =>
            slot ? (
              <div
                key={`${days[ci]!.date}|${slot.slotStart}`}
                className="grid min-w-0 grid-rows-subgrid"
                style={{ gridColumn: ci + 1, gridRow: `${ri * 4 + 1} / span 3` }}
              >
                <PeriodBlock
                  date={days[ci]!.date}
                  slot={slot}
                  data={data}
                  lines={linesBySlot[`${days[ci]!.date}|${slot.slotStart}`] ?? []}
                  marks={marks}
                  attendance={attendance}
                  store={store}
                  handlers={handlers}
                  canEdit={canEdit}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={onToggleGroup}
                />
              </div>
            ) : null,
          ),
        )}
      </div>
    </div>
  );
});
