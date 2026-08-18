"use client";

/**
 * 오늘 면 **통합 로스터** — 학생 명단은 **한 번만** 그리고, 그 날의 교시들이 열 그룹(출결·유닛·태도·
 * 자유 입력·특이사항 × 교시)으로 옆에 붙는다(원장 2026-08-11 *"목록은 왜 여러 번? 쓸데없이 중복되는
 * 컴포넌트가 다수"* — 교시 카드마다 로스터를 반복하던 것을 접는다). 가로 공간도 이 표가 쓴다
 * (같은 날 지적 *"세로로 놓으면 가로 공간이 너무 의미없지 않아?"*의 처방).
 *
 * 셀 구현은 주간 시트와 **공용**(roster-slot-cells — 출결·태도 체크 순환, 자유 입력 포함) —
 * 저장 경로·게이트·키(`학생|날짜|교시`)가 전부 같다. 섹션(재원/퇴원/기록)·접기·건수 규약도
 * 주간 표(roster-table)와 동일하다.
 *
 * ⚠️ 교시마다 명단 포함 여부가 다를 수 있다(분리등원·기록 보존 행) — 명단은 교시들의 **합집합**이고,
 *    그 교시 칸이 없는 학생은 값 칸 '—' + 잠긴 입력으로 비운다(RosterSlotCells entry=null — 잠긴
 *    입력이어야 Enter/↑↓ 세로 이동이 구멍을 건너뛴다).
 * ⚠️ **교시마다 폼이 다를 수 있다**(JJ 교시는 시험 점수 대신 듣기 레벨·누적 암기 단어수 — 원장
 *    2026-08-13). 그래서 열 폭·머리·칸을 교시별로 뽑는다. 그룹 총폭은 `todaySlotCols`가 항상
 *    교시 폭과 같게 유지하므로 위층 카드 레일과의 줄맞춤은 폼이 섞여도 안 깨진다.
 */
import { Fragment, memo, useMemo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { RosterEntry } from "../lib/grid";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import { attendanceOrMakeup } from "../lib/makeup-roster";
import { GroupToggle, GROUP_HINT } from "./roster-table";
import {
  RosterNameCell,
  RosterSlotCells,
  WithdrawnSummaryRow,
  withdrawnSlotRecord,
} from "./roster-slot-cells";
import type { SheetHandlers } from "./sheet-client";

// 가로 치수는 **위 카드 레일과 공유**한다(today-columns) — 한쪽만 고치면 줄이 조용히 어긋난다.
import { TODAY_NAME_W, todayContentWidth, todaySlotCols } from "../lib/today-columns";
import { rosterFormOf, rosterTextCols, type SheetMark } from "../lib/roster-form";

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
  marks: Record<string, SheetMark>;
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
  // 교시별 폼 — 판정은 슬롯 라벨 하나(rosterFormOf). colgroup·머리·칸이 **같은 값**을 봐야 열이 안 어긋난다.
  const formOf = (slot: (typeof slots)[number]) => rosterFormOf(slot.teacherLabel);

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
      | {
          kind: "row";
          entry: RosterEntry;
          perSlot: Record<string, RosterEntry>;
          navRow: number;
          /** 섹션 — 퇴원 행은 입력칸 대신 한 줄 요약이다(원장 2026-08-18). */
          group: RosterGroupKey;
        }
    )[] = [];
    const sizes = {} as Record<RosterGroupKey, number>;
    let navRow = 0;
    for (const group of groupRosterRows([...base.values()], (id) => data.students[id]?.name ?? "")) {
      sizes[group.key] = group.rows.length;
      const collapsed = collapsedGroups.includes(group.key);
      if (group.label) out.push({ kind: "label", key: group.key, count: group.rows.length });
      if (collapsed) continue; // 접힌 섹션 행은 아예 안 만든다(키보드 이동이 숨은 칸으로 새지 않게)
      for (const entry of group.rows) {
        out.push({
          kind: "row",
          entry,
          perSlot: perSlot.get(entry.studentId) ?? {},
          navRow: navRow++,
          group: group.key,
        });
      }
    }
    return { rows: out, counts: sizes };
  }, [slots, data.students, collapsedGroups]);

  // 이름 열 + 교시마다 (출결·유닛·태도 + 자유 입력 N + 특이사항) — 폼이 섞이면 교시마다 칸 수가 다르다.
  const colSpanAll = 1 + slots.reduce((n, s) => n + 4 + rosterTextCols(formOf(s)).length, 0);

  return (
    // 🔴 카드 껍데기도, 스크롤도 여기 없다 — 위 계획 층과 **한 카드·한 스크롤**을 쓴다
    //    (원장 2026-08-11 *"학생은 붙어있잖아? 이것도 그냥 붙여버려. 마치 엑셀처럼"*). 두 층이 각자
    //    상자를 두르면 사이에 여백과 테두리가 겹쳐 격자가 끊긴다.
    <>
        <table
          className="border-collapse text-[13px]"
          style={{ tableLayout: "fixed", width: todayContentWidth(slots.length) }}
        >
        <colgroup>
          <col style={{ width: TODAY_NAME_W }} />
          {slots.map((slot) => (
            <Fragment key={slot.slotStart}>
              {/* 마지막이 특이사항(잔여)이고 **합은 항상 교시 폭** — 특이사항까지 고정 폭이어야 표가
                  남는 폭을 거기 몰아주지 않는다(그러면 교시 폭이 카드와 달라진다). */}
              {todaySlotCols(formOf(slot)).map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </Fragment>
          ))}
        </colgroup>
        <thead>
          {/* 🔴 **교시 머리 행은 없다.** 바로 위 계획 층이 같은 열에서 이미 "2교시 15:00~15:40 이현이
              본원302"를 말하고 있어, 표가 한 번 더 적으면 같은 사실이 두 줄을 먹는다(원장 2026-08-11
              "여백도 최소화"). 두 층은 한 카드·한 격자라 위층 머리가 곧 이 열의 머리다.
              ⚠️ 계획 층 없이 이 표만 따로 쓸 일이 생기면 교시 머리를 여기 되살릴 것. */}
          <tr className="bg-bg-soft text-foreground text-left text-[11px]">
            <th className="rounded-l-md py-0.5 pl-1 align-bottom font-bold">
              <GroupToggle
                group="active"
                collapsed={collapsedGroups.includes("active")}
                count={counts.active ?? 0}
                onToggle={() => onToggleGroup("active")}
              />
            </th>
            {slots.map((slot) => (
              <Fragment key={slot.slotStart}>
                <th className="border-line-strong border-l py-0.5 text-center font-bold">출결</th>
                <th
                  className="py-0.5 text-center font-bold"
                  title="수업 1회 = 1유닛(기본). 다르면 여기서 고칠 수 있습니다. 급여 시수에 반영됩니다."
                >
                  유닛
                </th>
                <th className="py-0.5 text-center font-bold">태도</th>
                {rosterTextCols(formOf(slot)).map((col) => (
                  <th
                    key={col.field}
                    className="py-0.5 text-center leading-tight font-bold"
                    title={col.title}
                  >
                    {col.label}
                  </th>
                ))}
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
            // 퇴원 섹션 = **한 줄 요약**(주간 시트와 같은 문장 — 두 화면이 갈리지 않게 같은 컴포넌트).
            // 교시가 여럿이라 남은 기록도 교시별로 모아 넘긴다(값이 있는 교시만 문장에 남는다).
            if (row.group === "withdrawn") {
              return (
                <tr key={row.entry.studentId} className="bg-bg-soft/40">
                  <WithdrawnSummaryRow
                    entry={row.entry}
                    meta={meta}
                    colSpan={colSpanAll}
                    records={slots.map((slot) =>
                      withdrawnSlotRecord({
                        slotStart: slot.slotStart,
                        form: formOf(slot),
                        mark: marks[`${row.entry.studentId}|${date}|${slot.slotStart}`] ?? null,
                        att: attendance[`${row.entry.studentId}|${date}|${slot.slotStart}`] ?? null,
                      }),
                    )}
                  />
                </tr>
              );
            }
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
                    att={attendanceOrMakeup(
                      attendance[`${row.entry.studentId}|${date}|${slot.slotStart}`],
                      (row.perSlot[slot.slotStart] ?? row.entry).isMakeup,
                    )}
                    canMarkDate={canMarkDate}
                    canNoteDate={data.canNoteAttendance}
                    canEdit={canEdit}
                    handlers={handlers}
                    navRow={row.navRow}
                    form={formOf(slot)}
                    navColSuffix={`:${slot.slotStart}`}
                    withDivider
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
        </table>
    </>
  );
});
