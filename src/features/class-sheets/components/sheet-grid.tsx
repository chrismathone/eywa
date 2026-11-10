"use client";

// 주간 그리드 — 요일을 독립 스택이 아니라 **하나의 CSS grid**로 배치해, 같은 행의 카드가 같은 높이로
// 놓인다("카드 크기 맞춤"). 행 배치는 순수 함수 buildGridRows의 **서수 배치**(각 요일 N번째 수업이 N행,
// 카드가 위로 붙어 공백 없음) — 시각 정렬은 요일 간 시각이 갈라지는 반에서 거대한 공백을 만들어 폐기했다
// (grid-rows.ts 주석 참조: 2026-07-29 주말 혼합 → 2026-08-17 평일끼리도).
//
// 헤더는 **본문 그리드와 분리된 sticky 밴드**다. 헤더 카드 자체를 sticky로 두면 카드가 둥글고 열 사이에
// 간격이 있어 **스크롤되는 본문이 모서리·틈으로 비쳐** 겹쳐 보인다(원장 제보 2026-07-29). 불투명 배경
// 밴드가 전 폭을 덮으면 본문은 그 뒤로 완전히 숨는다(gotcha #74 "불투명 base + 밴드 레이어"와 같은 처방).
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import { memo, useMemo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { RosterGroupKey } from "../lib/roster-order";
import type { SheetMark } from "../lib/roster-form";
import { buildGridRows } from "../lib/grid-rows";
import { SHEET_DAY_MAX_W, sheetPlanWidth } from "../lib/today-columns";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";
import { DayBulk } from "./day-bulk";

// 요일 열의 **최소** 폭 = 오늘 면 교시 카드 폭과 같은 상수(today-columns 단일 소스) — 따로 적으면 두 화면이 갈린다.
// 🔴 2026-09-10부터 **최소**다(그전엔 고정). 원장 *"우측 공간 많으니까 적절히 열너비 조정"* — 요일이
//    두셋뿐인 반(실측 43반 중 2일 10 · 3일 30)은 창 오른쪽이 통째로 비어 있었는데, 정작 카드 안에서는
//    특이사항이 잔여 폭을 못 받아 좁았다. 이제 남는 폭을 요일들이 고르게 나눠 갖는다.
// ⚠️ **최소값은 그대로 둔다** — 2026-08-17의 "3열이 한 페이지에"(3×420+24 = 1284 ≤ 가용 1330)가 이 값에
//    걸려 있다. 넓히는 쪽으로만 움직이므로 그 결정은 어떤 폭에서도 깨지지 않는다.

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
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const rows = useMemo(() => buildGridRows(days), [days]);
  // 🔴 `minmax(0, 1fr)` — **0**이 최소인 이유: `1fr`(=`minmax(auto, 1fr)`)로 두면 카드 안 내용의
  //    min-content가 트랙을 밀어 올려 폭이 내용 따라 들쭉날쭉해진다. 실제 최소는 아래 `minWidth`가
  //    바깥에서 잡는다(계산이 한 곳에 모여 있어야 밴드와 본문이 같은 격자를 쓴다).
  const columns = `repeat(${days.length}, minmax(0, 1fr))`;
  const gaps = Math.max(0, days.length - 1) * GAP_X;
  // 최소 = 종전 고정 폭 그대로(3열 한 페이지 유지) · 최대 = 요일이 한둘뿐인 반이 화면을 통째로
  // 차지하지 않게(카드 한 장이 두 장 몫을 넘지 않는다).
  const minWidth = days.length * sheetPlanWidth(lang) + gaps;
  const maxWidth = days.length * SHEET_DAY_MAX_W + gaps;

  if (days.length === 0) {
    // 랜딩 빈 상태와 동일 스타일(부모가 flex가 아니라 self-center는 무효 — 카드형으로 통일)
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        이 주에는 수업이 없습니다.
      </p>
    );
  }

  return (
    // 폭은 `100%`이되 **최소는 종전 고정 폭**(min-width) — 좁으면 넘쳐 스크롤되고(밴드가 그 폭을 그대로
    // 덮으므로 스크롤해도 오른쪽이 새지 않는다), 넓으면 남는 폭을 요일들이 나눠 갖는다.
    // ⚠️ `w-max`(=max-content)로 되돌리지 말 것 — max-content는 `1fr`을 내용 폭으로 접어서 아무리 넓은
    //    창에서도 카드가 안 늘어난다(그러면 이 변경이 통째로 무효다).
    <div className="w-full pb-2" style={{ minWidth, maxWidth }}>
      {/* sticky 밴드 — 불투명 배경 + 아래 여백 포함. z-10: 본문 위, StatusCell 팝오버(포털 z-50) 아래. */}
      <div
        className="bg-bg-canvas sticky top-0 z-10 grid pb-2"
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
                className={`inline-flex size-7 items-center justify-center rounded-lg text-base font-bold text-white ${
                  isToday ? "bg-primary" : "bg-foreground"
                }`}
              >
                {sheetDowLabel(day.dow, lang)}
              </span>
              {/* 휴일 날짜·공휴일명 = 출석부 휴일 잉크(`text-att-holiday-ink`) — 공용 `text-danger`는 휴일 회색
                  (`--att-weekend`) 위에서 대비 3.75로 WCAG 4.5를 깼다(2026-09-14). */}
              <span className={`num text-sm font-semibold ${holiday ? "text-att-holiday-ink" : "text-foreground"}`}>
                {day.date.slice(5).replace("-", "/")}
              </span>
              {isToday ? (
                <span className="border-primary text-primary rounded-full border px-1.5 py-0.5 text-xs font-bold">
                  {t("toolbar.today")}
                </span>
              ) : null}
              {/* 공휴일명 — 이름이 곧 설명이라 본문에 적는다(툴팁은 모바일에서 없는 것과 같다).
                  ⚠️ 폭이 모자라면 이름만 줄인다(`min-w-0`) — 뒤의 일괄 버튼이 밀리면 그 날 입력이 막힌다. */}
              {holiday ? (
                <span
                  className="text-att-holiday-ink min-w-0 shrink truncate text-xs font-bold"
                  title={tf("plan.holidayHint", { holiday })}
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
