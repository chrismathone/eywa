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
}) {
  // 키에 날짜 포함 — 같은 시각이라도 평일/주말 교시 번호가 다르다(주말은 별도 교시표).
  const periodLabel = data.periodLabelBySlot[`${date}|${slot.slotStart}`] ?? null;
  // teacherLabel은 로더에서 이미 해석된 표시명(시간표와 동일 문자열). 라벨 우선은 **시간표 3뷰와 같은
  // 순서**라 두 화면이 같은 이름을 보여준다 — 뒤집지 말 것(실측: 라벨과 FK가 서로 다른 사람을 가리키는
  // 슬롯이 존재해, FK 우선으로 바꾸면 시간표와 어긋난 이름이 ECS에만 뜬다. 상세는 changelog 2026-07-29).
  // 자리(LAB·JJ)는 사람이 아니다 — 강사 칩 자리에 이름처럼 넣지 않는다(원장 2026-07-31 "랩실이므로").
  // 이 카드는 기록(계획·마크·메모)이 있을 때만 남는다(빈 자리 교시는 grid가 아예 안 그린다).
  const teacher = slot.specialRoom
    ? null
    : (slot.teacherLabel ??
      (slot.teacherId ? (data.teacherNames[slot.teacherId] ?? null) : null) ??
      data.classTeacherName);
  return (
    // ⚠️ cursor-default 필수 — 바깥 DragScrollArea가 컨테이너에 cursor-grab(펼친 손)을 깔아서,
    // 안 덮으면 카드를 **끌어서 옮길 수 있는 것처럼** 보인다(teacher-grid 선례·원장 지적 2026-07-29).
    //
    // ⚠️ `cursor-auto`로 바꾸지 말 것(검토 후 기각): auto는 텍스트 위에서 I빔이 되는데, 이 컨테이너는
    // 5px 넘게 끌면 팬으로 전환하며 `userSelect:none`을 걸어(drag-scroll-area.tsx:128) **드래그 선택이
    // 아예 불가능**하다 — I빔은 못 하는 일을 약속하는 거짓 어포던스가 된다. 중립적인 화살표가 정직하다.
    // 선택이 실제로 되는 곳(input·textarea)은 skip() 대상이라 UA I빔을 그대로 유지한다(실측 확인).
    <article className="bg-card shadow-card cursor-default rounded-2xl p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-2">
        {periodLabel ? <span className="text-foreground text-[13px] font-bold">{periodLabel}</span> : null}
        <span className="text-text-dim num text-[12px] whitespace-nowrap">
          {slot.slotStart}
          {slot.slotEnd ? ` ~ ${slot.slotEnd}` : ""}
        </span>
        {teacher ? (
          <span className="bg-bg-soft text-foreground rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap">
            {teacher}
          </span>
        ) : null}
        {slot.specialRoom ? (
          <span
            className="border-line text-text-dim rounded-full border border-dashed px-2 py-0.5 text-[11px] whitespace-nowrap"
            title={`강사 수업이 아니라 자리(${slot.specialRoom})입니다 — 기록이 있어 표시합니다`}
          >
            {slot.specialRoom} 자리
          </span>
        ) : null}
        {slot.roomLabel ? (
          <span className="text-text-faint text-[11px] whitespace-nowrap">{slot.roomLabel}</span>
        ) : null}
        {!slot.scheduled ? (
          <span
            className="border-line text-text-dim ml-auto rounded-full border border-dashed px-2 py-0.5 text-[10px] whitespace-nowrap"
            title="시간표가 바뀌어 현재 스케줄에 없는 시각입니다 — 기록 보존을 위해 표시"
          >
            시간 변경됨
          </span>
        ) : null}
      </header>

      <PlanTable
        date={date}
        slotStart={slot.slotStart}
        lines={lines}
        skillAreas={data.skillAreas}
        store={store}
        handlers={handlers}
        canEdit={canEdit && slot.scheduled}
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
        />
      ) : null}
    </article>
  );
});
