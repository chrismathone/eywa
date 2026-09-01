"use client";

// 주간 그리드 — 요일을 독립 스택이 아니라 **하나의 CSS grid**로 배치해, 같은 행의 카드가 같은 높이로
// 놓인다("카드 크기 맞춤"). 행 배치는 순수 함수 buildGridRows의 **서수 배치**(각 요일 N번째 수업이 N행,
// 카드가 위로 붙어 공백 없음) — 시각 정렬은 요일 간 시각이 갈라지는 반에서 거대한 공백을 만들어 폐기했다
// (grid-rows.ts 주석 참조: 2026-07-29 주말 혼합 → 2026-08-17 평일끼리도).
//
// 헤더는 **본문 그리드와 분리된 sticky 밴드**다. 헤더 카드 자체를 sticky로 두면 카드가 둥글고 열 사이에
// 간격이 있어 **스크롤되는 본문이 모서리·틈으로 비쳐** 겹쳐 보인다(원장 제보 2026-07-29). 불투명 배경
// 밴드가 전 폭을 덮으면 본문은 그 뒤로 완전히 숨는다(gotcha #74 "불투명 base + 밴드 레이어"와 같은 처방).
import { memo, useMemo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { RosterGroupKey } from "../lib/roster-order";
import type { SheetMark } from "../lib/roster-form";
import { buildGridRows } from "../lib/grid-rows";
import { TODAY_PLAN_W } from "../lib/today-columns";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";
import { DayBulk } from "./day-bulk";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
// 요일 열 폭 = 오늘 면 교시 카드 폭과 **같은 상수**(today-columns 단일 소스) — 따로 적으면 두 화면이 갈린다.
const COL_W = TODAY_PLAN_W;
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
  shouting,
}: {
  days: GridDay[];
  data: ClassSheetWeekData;
  linesBySlot: Record<string, PlanLineDTO[]>;
  marks: Record<string, SheetMark>;
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
  /** 로스터 섹션 접힘 — 카드가 아니라 시트가 소유한다(나란한 카드의 줄맞춤 유지). */
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
  /** `${date}|${HH:MM}` → Shouting 체크(EiE 전용). 저장 반영이 즉시 보이도록 시트가 들고 있는 live 맵. */
  shouting: Record<string, boolean>;
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
          // 🔴 휴일은 **알아보게만** 한다 — 카드·교시·로스터·입력은 평일과 글자 그대로 같다(원장
          //    2026-09-01 *"입력은 가능하도록 해줘 출석부처럼"*). 톤도 월별 출석부와 같은 회색
          //    (`--att-weekend`)·같은 빨간 날짜라 두 화면이 같은 날을 같은 모양으로 말한다.
          const holiday = day.holiday;
          return (
            <header
              key={day.date}
              // cursor-default — DragScrollArea의 cursor-grab이 헤더까지 덮지 않게(period-block과 동일)
              className={`shadow-card flex cursor-default items-center gap-2 rounded-2xl px-3 py-2 ${
                holiday ? "bg-att-weekend" : "bg-card"
              }`}
            >
              {/* 요일 = 원본 시트의 검정 반전 머리글(월/화/수). 오늘은 브랜드 네이비로 대체. */}
              <span
                className={`inline-flex size-7 items-center justify-center rounded-lg text-[15px] font-bold text-white ${
                  isToday ? "bg-primary" : "bg-foreground"
                }`}
              >
                {DOW_KO[day.dow]}
              </span>
              <span className={`num text-[13px] font-semibold ${holiday ? "text-danger" : "text-foreground"}`}>
                {day.date.slice(5).replace("-", "/")}
              </span>
              {isToday ? (
                <span className="border-primary text-primary rounded-full border px-1.5 py-0.5 text-[11px] font-bold">
                  오늘
                </span>
              ) : null}
              {/* 공휴일명 — 이름이 곧 설명이라 본문에 적는다(툴팁은 모바일에서 없는 것과 같다).
                  ⚠️ 폭이 모자라면 이름만 줄인다(`min-w-0`) — 뒤의 일괄 버튼이 밀리면 그 날 입력이 막힌다. */}
              {holiday ? (
                <span
                  className="text-danger min-w-0 shrink truncate text-[11px] font-bold"
                  title={`${holiday} — 휴일이지만 수업했다면 그대로 쓰실 수 있습니다`}
                >
                  {holiday}
                </span>
              ) : null}
              {/* 일괄 = **요일 머리**(원장 2026-08-14 "요일 옆에 넣어도 될듯. 어차피 일괄이니까").
                  교시 카드마다 반복하던 것을 하루 하나로 — 범위가 곧 그 날 전부라 "나머지 교시도"를
                  따로 물을 필요가 없다. 권한 없으면 컴포넌트가 스스로 아무것도 안 그린다. */}
              <span className="ml-auto">
                <DayBulk
                  date={day.date}
                  slots={day.slots.map((s) => ({
                    slotStart: s.slotStart,
                    roster: s.roster,
                    lines: linesBySlot[`${day.date}|${s.slotStart}`] ?? [],
                    scheduled: s.scheduled,
                  }))}
                  marks={marks}
                  attendance={attendance}
                  canEdit={canEdit}
                  canMarkDate={data.canMarkAttendanceByDate[day.date] ?? false}
                  showExamTerm={!data.isEie}
                  // 저장은 **교시별로** 나눠 보낸다(0196a) — 뭉치면 다른 교시 기록을 덮는다.
                  onBulkAttendance={(targets, status) =>
                    targets.forEach((t) =>
                      t.studentIds.forEach((id) =>
                        handlers.setAttendance(id, day.date, t.slotStart, status),
                      ),
                    )
                  }
                  onBulkStatus={(targets, status) =>
                    targets.forEach((t) =>
                      t.studentIds.forEach((id) =>
                        handlers.saveMark(
                          id,
                          day.date,
                          t.slotStart,
                          status,
                          marks[`${id}|${day.date}|${t.slotStart}`]?.progressNote ?? null,
                        ),
                      ),
                    )
                  }
                  onBulkPlanCells={(lineIds, field, value) =>
                    lineIds.forEach((id) => handlers.editCell(id, field, value))
                  }
                />
              </span>
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
                  shouting={!!shouting[`${days[ci]!.date}|${slot.slotStart}`]}
                  {...(data.isEie ? { onShouting: handlers.toggleShouting } : {})}
                />
              </div>
            ) : null,
          ),
        )}
      </div>
    </div>
  );
});
