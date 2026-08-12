"use client";

/**
 * 오늘 면 **통합 로스터** — 학생 명단은 **한 번만** 그리고, 그 날의 교시들이 열 그룹(출결·유닛·태도·
 * 점수·특이사항 × 교시)으로 옆에 붙는다(원장 2026-08-11 *"목록은 왜 여러 번? 쓸데없이 중복되는
 * 컴포넌트가 다수"* — 교시 카드마다 로스터를 반복하던 것을 접는다). 가로 공간도 이 표가 쓴다
 * (같은 날 지적 *"세로로 놓으면 가로 공간이 너무 의미없지 않아?"*의 처방).
 *
 * 셀 구현은 주간 시트와 **공용**(roster-slot-cells — 출결·태도 체크 순환, 점수 0202a 포함) —
 * 저장 경로·게이트·키(`학생|날짜|교시`)가 전부 같다. 섹션(재원/퇴원/기록)·접기·건수 규약도
 * 주간 표(roster-table)와 동일하다.
 *
 * ⚠️ 교시마다 명단 포함 여부가 다를 수 있다(분리등원·기록 보존 행) — 명단은 교시들의 **합집합**이고,
 *    그 교시 칸이 없는 학생은 값 칸 '—' + 잠긴 입력으로 비운다(RosterSlotCells entry=null — 잠긴
 *    입력이어야 Enter/↑↓ 세로 이동이 구멍을 건너뛴다).
 */
import { Fragment, memo, useMemo } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay, GridSlot } from "../lib/grid";
import type { RosterEntry } from "../lib/grid";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import { GroupToggle, GROUP_HINT } from "./roster-table";
import { RosterNameCell, RosterSlotCells } from "./roster-slot-cells";
import type { SheetHandlers } from "./sheet-client";

/** 교시 그룹 안 열 폭 — 주간 표(roster-table colgroup)와 같은 수치(출결 60·유닛 46·태도 80·점수 54). */
const SLOT_COLS = [60, 46, 80, 54] as const;
/** 특이사항 최소폭 — 표 전체 minWidth 계산용(이보다 좁아지면 가로 드래그 스크롤이 받는다). */
const NOTE_MIN = 120;
const NAME_W = 64;

export const TodayRosterTable = memo(function TodayRosterTable({
  day,
  data,
  marks,
  attendance,
  handlers,
  canEdit,
  collapsedGroups,
  onToggleGroup,
}: {
  day: GridDay;
  data: ClassSheetWeekData;
  marks: Record<string, { status: string | null; progressNote: string | null; score: string | null }>;
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  handlers: SheetHandlers;
  canEdit: boolean;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const date = day.date;
  const slots = day.slots;
  const canMarkDate = data.canMarkAttendanceByDate[date] ?? false;

  // 명단 = 교시 로스터의 합집합(학생당 1행). 교시마다 다른 것은 **명단 포함 여부**뿐이다(markOwners가
  // (날짜,교시) 단위) — entry의 값(eligible·historical·endedOn)은 rosterStateOn이 **날짜 단위**로 찍어
  // 같은 날 교시 간 항상 동일하다(grid.ts). 그래서 대표는 처음 만난 entry면 충분하고, perSlot은
  // "이 교시에 이 학생 칸이 있나"(구멍이면 잠긴 '—' 칸)를 판정하는 데만 쓴다.
  const { rows, counts } = useMemo(() => {
    const perSlot = new Map<string, Record<string, RosterEntry>>();
    const base = new Map<string, RosterEntry>();
    for (const slot of slots) {
      for (const e of slot.roster) {
        if (!base.has(e.studentId)) base.set(e.studentId, e);
        const cur = perSlot.get(e.studentId) ?? {};
        cur[slot.slotStart] = e;
        perSlot.set(e.studentId, cur);
      }
    }
    const out: (
      | { kind: "label"; key: RosterGroupKey; count: number }
      | { kind: "row"; entry: RosterEntry; perSlot: Record<string, RosterEntry>; navRow: number }
    )[] = [];
    const sizes = {} as Record<RosterGroupKey, number>;
    let navRow = 0;
    for (const group of groupRosterRows([...base.values()], (id) => data.students[id]?.name ?? "")) {
      sizes[group.key] = group.rows.length;
      const collapsed = collapsedGroups.includes(group.key);
      if (group.label) out.push({ kind: "label", key: group.key, count: group.rows.length });
      if (collapsed) continue; // 접힌 섹션 행은 아예 안 만든다(키보드 이동이 숨은 칸으로 새지 않게)
      for (const entry of group.rows) {
        out.push({ kind: "row", entry, perSlot: perSlot.get(entry.studentId) ?? {}, navRow: navRow++ });
      }
    }
    return { rows: out, counts: sizes };
  }, [slots, data.students, collapsedGroups]);

  const colSpanAll = 1 + slots.length * 5;
  const slotLabel = (slot: GridSlot) => data.periodLabelBySlot[`${date}|${slot.slotStart}`] ?? null;
  const slotColsW = SLOT_COLS.reduce((a, b) => a + b, 0) + NOTE_MIN;

  return (
    // 🔴 스크롤은 **카드 안**에서 — 카드 밖에서 스크롤하면 표가 카드 폭(뷰포트)을 넘는 순간 배경·테두리가
    //    초기 폭에 멈춰 셀이 맨바탕 위에 그려진다(sheet-grid의 w-max 교훈과 같은 계열, 적대 리뷰 2026-08-11).
    <div className="bg-card border-foreground shadow-card cursor-default rounded-2xl border p-2.5">
      <DragScrollArea barX className="min-w-0">
        <table
          className="w-full border-collapse text-[13px]"
          style={{ tableLayout: "fixed", minWidth: NAME_W + slots.length * slotColsW }}
        >
        <colgroup>
          <col style={{ width: NAME_W }} />
          {slots.map((slot) => (
            <Fragment key={slot.slotStart}>
              {SLOT_COLS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
              <col />
            </Fragment>
          ))}
        </colgroup>
        <thead>
          {/* 1행 = 교시 머리(교시·시각·강의실), 2행 = 칸 라벨. 교시 경계는 옅은 세로선(표 규약). */}
          <tr className="bg-bg-soft text-foreground text-left text-[11px]">
            <th rowSpan={2} className="rounded-l-md py-0.5 pl-1 align-bottom font-bold">
              <GroupToggle
                group="active"
                collapsed={collapsedGroups.includes("active")}
                count={counts.active ?? 0}
                onToggle={() => onToggleGroup("active")}
              />
            </th>
            {slots.map((slot) => (
              <th key={slot.slotStart} colSpan={5} className="border-l-line-faint border-l py-0.5 text-center font-bold">
                {slotLabel(slot) ? `${slotLabel(slot)} · ` : ""}
                <span className="num">
                  {slot.slotStart}
                  {slot.slotEnd ? `~${slot.slotEnd}` : ""}
                </span>
                {slot.roomLabel ? ` · ${slot.roomLabel}` : ""}
              </th>
            ))}
          </tr>
          <tr className="bg-bg-soft text-foreground text-[11px]">
            {slots.map((slot) => (
              <Fragment key={slot.slotStart}>
                <th className="border-l-line-faint border-l py-0.5 text-center font-bold">출결</th>
                <th
                  className="py-0.5 text-center font-bold"
                  title="수업 1회 = 1유닛(기본). 다르면 여기서 고칠 수 있습니다. 급여 시수에 반영됩니다."
                >
                  유닛
                </th>
                <th className="py-0.5 text-center font-bold">태도</th>
                <th className="py-0.5 text-center font-bold" title="이 교시의 점수 — 자유 입력(18/20 · 95 · A 등)">
                  점수
                </th>
                <th className="py-0.5 pr-1 text-left font-bold">특이사항</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((row) => {
            if (row.kind === "label") {
              return (
                <tr key={`label:${row.key}`} className="bg-bg-soft">
                  <td colSpan={colSpanAll} className="text-foreground px-1 py-0.5 text-[11px] font-bold" title={GROUP_HINT[row.key]}>
                    <GroupToggle
                      group={row.key}
                      collapsed={collapsedGroups.includes(row.key)}
                      count={row.count}
                      onToggle={() => onToggleGroup(row.key)}
                    />
                  </td>
                </tr>
              );
            }
            const meta = data.students[row.entry.studentId];
            return (
              <tr key={row.entry.studentId} className={row.entry.historical ? "bg-bg-soft/40" : ""}>
                <RosterNameCell entry={row.entry} meta={meta} />
                {slots.map((slot) => (
                  <RosterSlotCells
                    key={slot.slotStart}
                    entry={row.perSlot[slot.slotStart] ?? null}
                    meta={meta}
                    date={date}
                    slotStart={slot.slotStart}
                    mark={marks[`${row.entry.studentId}|${date}|${slot.slotStart}`] ?? null}
                    att={attendance[`${row.entry.studentId}|${date}|${slot.slotStart}`] ?? null}
                    canMarkDate={canMarkDate}
                    canEdit={canEdit}
                    handlers={handlers}
                    navRow={row.navRow}
                    navColSuffix={`:${slot.slotStart}`}
                    withDivider
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
        </table>
      </DragScrollArea>
    </div>
  );
});
