"use client";

// 교시 블록 카드 — 헤더(교시·시각·강사·강의실) + 수업계획 표 + 학생 로스터.
// 고아 슬롯(시간표 변경으로 스케줄에 없는 시각)은 데이터 보존을 위해 흐린 경고와 함께 표시(소실 금지).
import { memo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridSlot } from "../lib/grid";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PlanTable } from "./plan-table";
import { RosterTable } from "./roster-table";
import { SlotBulk } from "./slot-bulk";
import type { RosterGroupKey } from "../lib/roster-order";

export const PeriodBlock = memo(function PeriodBlock({
  date,
  slot,
  data,
  lines,
  marks,
  attendance,
  store,
  handlers,
  canEdit,
  collapsedGroups,
  onToggleGroup,
}: {
  date: string;
  slot: GridSlot;
  data: ClassSheetWeekData;
  lines: PlanLineDTO[];
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
  /** 접어 둔 로스터 섹션 — **시트 전체 공유**(카드마다 따로면 나란한 카드의 줄맞춤이 어긋난다). */
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  // 키에 날짜 포함 — 같은 시각이라도 평일/주말 교시 번호가 다르다(주말은 별도 교시표).
  const periodLabel = data.periodLabelBySlot[`${date}|${slot.slotStart}`] ?? null;
  // teacherLabel은 로더에서 이미 해석된 표시명(시간표와 동일 문자열). 라벨 우선은 **시간표 3뷰와 같은
  // 순서**라 두 화면이 같은 이름을 보여준다 — 뒤집지 말 것(실측: 라벨과 FK가 서로 다른 사람을 가리키는
  // 슬롯이 존재해, FK 우선으로 바꾸면 시간표와 어긋난 이름이 ECS에만 뜬다. 상세는 changelog 2026-07-29).
  const teacher =
    slot.teacherLabel ??
    (slot.teacherId ? (data.teacherNames[slot.teacherId] ?? null) : null) ??
    data.classTeacherName;
  return (
    // ⚠️ cursor-default 필수 — 바깥 DragScrollArea가 컨테이너에 cursor-grab(펼친 손)을 깔아서,
    // 안 덮으면 카드를 **끌어서 옮길 수 있는 것처럼** 보인다(teacher-grid 선례·원장 지적 2026-07-29).
    //
    // ⚠️ `cursor-auto`로 바꾸지 말 것(검토 후 기각): auto는 텍스트 위에서 I빔이 되는데, 이 컨테이너는
    // 5px 넘게 끌면 팬으로 전환하며 `userSelect:none`을 걸어(drag-scroll-area.tsx:128) **드래그 선택이
    // 아예 불가능**하다 — I빔은 못 하는 일을 약속하는 거짓 어포던스가 된다. 중립적인 화살표가 정직하다.
    // 선택이 실제로 되는 곳(input·textarea)은 skip() 대상이라 UA I빔을 그대로 유지한다(실측 확인).
    // `grid-rows-subgrid` + `row-span-3` — 부모(sheet-grid)가 교시 행마다 깔아 둔 세 트랙
    // (머리 / 계획 / 로스터)에 이 카드의 세 구획을 그대로 올린다. 그래야 계획 줄 수가 달라도
    // **같은 행의 모든 카드에서 학생 표가 같은 높이에서 시작**한다(원장 2026-08-04).
    // ⚠️ 자식이 정확히 이 셋이어야 한다 — 여기에 형제 요소를 더하면 넷째가 다음 교시 행 트랙으로
    //    흘러 카드가 겹친다. 새 구획이 필요하면 세 구획 **안에** 넣거나 부모 트랙 수를 함께 늘릴 것.
    // ⚠️ `h-full`은 쓰지 않는다(부모가 span으로 높이를 정한다).
    <article className="bg-card shadow-card row-span-3 grid cursor-default grid-rows-subgrid rounded-2xl p-3">
      {/* 카드 머리 — 원본 시트의 회색 교시 칸(1교시 / 03:00~03:40)과 같은 위계. 교시=칩, 시각=옆 숫자.
          ⚠️ 글자는 **전부 굵게 + foreground**(원장 2026-08-06 "전체 텍스트를 굵게할것 (잘보이게)").
             시각·강의실이 dim 보통굵기라 한 발짝만 떨어져도 안 읽혔다 — 여기서 위계를 다시 낮추지 말 것. */}
      <header className="border-line-strong flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2">
        {periodLabel ? (
          <span className="bg-bg-soft text-foreground rounded-md px-1.5 py-0.5 text-[13px] font-bold">
            {periodLabel}
          </span>
        ) : null}
        <span className="text-foreground num text-[13px] font-bold whitespace-nowrap">
          {slot.slotStart}
          {slot.slotEnd ? ` ~ ${slot.slotEnd}` : ""}
        </span>
        {teacher ? (
          <span className="border-line-strong text-foreground rounded-full border px-2 py-0.5 text-[12px] font-bold whitespace-nowrap">
            {teacher}
          </span>
        ) : null}
        {slot.roomLabel ? (
          <span className="text-foreground text-[12px] font-bold whitespace-nowrap">{slot.roomLabel}</span>
        ) : null}
        {!slot.scheduled ? (
          <span
            className="border-amber/50 bg-amber-soft text-amber rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
            title="시간표가 바뀌어 현재 스케줄에 없는 시각입니다 — 기록 보존을 위해 표시"
          >
            시간 변경됨
          </span>
        ) : null}
        {/* 일괄 입력 = 카드 머리 오른쪽 끝(원장 2026-08-06). 계획·로스터 **둘 다**의 일괄이라 두 표보다
            위에 있어야 순서가 맞는다. 권한 없으면 컴포넌트가 스스로 아무것도 안 그린다. */}
        <span className="ml-auto">
          <SlotBulk
            date={date}
            slotStart={slot.slotStart}
            roster={slot.roster}
            lines={lines}
            marks={marks}
            attendance={attendance}
            canEdit={canEdit && slot.scheduled}
            canMarkDate={data.canMarkAttendanceByDate[date] ?? false}
            showExamTerm={!data.isEie}
            onBulkAttendance={(ids) => ids.forEach((id) => handlers.markPresent(id, date))}
            onBulkStatus={(ids, status) =>
              ids.forEach((id) =>
                handlers.saveMark(
                  id,
                  date,
                  slot.slotStart,
                  status,
                  marks[`${id}|${date}|${slot.slotStart}`]?.progressNote ?? null,
                ),
              )
            }
            onBulkPlanCells={(lineIds, field, value) =>
              lineIds.forEach((id) => handlers.editCell(id, field, value))
            }
          />
        </span>
      </header>

      <PlanTable
        date={date}
        slotStart={slot.slotStart}
        lines={lines}
        skillAreas={data.skillAreas}
        store={store}
        handlers={handlers}
        canEdit={canEdit && slot.scheduled}
        showExamTerm={!data.isEie}
      />

      {slot.roster.length > 0 ? (
        <RosterTable
          date={date}
          slotStart={slot.slotStart}
          roster={slot.roster}
          data={data}
          marks={marks}
          attendance={attendance}
          handlers={handlers}
          canEdit={canEdit}
          collapsedGroups={collapsedGroups}
          onToggleGroup={onToggleGroup}
        />
      ) : null}
    </article>
  );
});
