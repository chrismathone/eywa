"use client";

/**
 * 305 하루 표 — 시각 하나 × 여러 반 합명단.
 * 칸 구현은 주간 시트와 같다(RosterSlotCells). 이름 옆에만 반 배지를 단다.
 *
 * **열 구분(2026-08-19)**: 표 규약대로 세로선은 표 **한 곳**에서 `border-l-line-faint`로 건다
 * (셀 상수마다 붙이면 행 종류 하나를 빠뜨리는 순간 그 행만 선이 끊긴다 — design-conventions "데이터 표").
 * 첫 칸은 제외(표 바깥 테두리와 이중선), 머리는 가운데·본문 값은 좌측 그대로.
 */
import { useMemo } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { WindowLink } from "@/components/workspace/window-link";
import { SEAT_BADGE_W, seatFixedCols, seatTableMinWidth } from "../lib/seat-day-columns";
import { rosterColSpan, rosterTextCols, type RosterForm, type SheetMark } from "../lib/roster-form";
import { shortClassLabel } from "../lib/seat-day";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import type { RosterEntry } from "../lib/grid";
import { GroupToggle, useGroupHint } from "./roster-table";
import { RosterSlotCells } from "./roster-slot-cells";
import type { SheetHandlers } from "./sheet-client";
import type { SeatDayStudent } from "../server/seat-day-types";

export function SeatDayTable({
  date,
  slotStart,
  form,
  students,
  handlersOf,
  collapsedGroups,
  onToggleGroup,
}: {
  date: string;
  slotStart: string;
  form: RosterForm;
  students: SeatDayStudent[];
  handlersOf: (classId: string) => Pick<SheetHandlers, "setAttendance" | "clearAttendance" | "saveMark">;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const textCols = rosterTextCols(form);
  const groupHint = useGroupHint();
  const { rows, counts } = useMemo(() => {
    const asRoster: (RosterEntry & { row: SeatDayStudent })[] = students.map((s) => ({
      studentId: s.studentId,
      eligible: s.eligible,
      historical: s.historical,
      endedOn: s.endedOn,
      row: s,
    }));
    const out: (
      | { kind: "label"; key: RosterGroupKey; count: number }
      | { kind: "row"; entry: (typeof asRoster)[number]; navRow: number }
    )[] = [];
    const sizes = {} as Record<RosterGroupKey, number>;
    let navRow = 0;
    for (const group of groupRosterRows(asRoster, (id) => students.find((s) => s.studentId === id)?.name ?? "")) {
      sizes[group.key] = group.rows.length;
      if (group.label) out.push({ kind: "label", key: group.key, count: group.rows.length });
      if (collapsedGroups.includes(group.key)) continue;
      for (const entry of group.rows) out.push({ kind: "row", entry, navRow: navRow++ });
    }
    return { rows: out, counts: sizes };
  }, [students, collapsedGroups]);

  return (
    // 폭은 seat-day-columns 단일 소스. `min-width`는 좁은 창에서 특이사항이 0으로 짜부라지지 않게 하는
    // 바닥이고, 넘치는 만큼은 바깥 DragScrollArea(overflow-x:auto)가 받는다(페이지 body가 아니다).
    <table
      className="w-full border-collapse text-[13px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint"
      style={{ tableLayout: "fixed", minWidth: seatTableMinWidth(form) }}
    >
      <colgroup>
        {seatFixedCols(form).map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
        {/* 특이사항 = 잔여(width 없는 마지막 col이 남는 폭을 받는다). */}
        <col />
      </colgroup>
      <thead>
        <tr className="bg-bg-soft text-foreground text-left text-[11px]">
          {/* 첫 칸만 좌측 — 열 제목이 아니라 **접기 버튼**이다(가운데로 밀면 셰브런이 이름 위에서 떠 보인다). */}
          <th className="rounded-l-md py-0.5 pl-1 font-bold">
            <GroupToggle
              group="active"
              collapsed={collapsedGroups.includes("active")}
              count={counts.active ?? 0}
              onToggle={() => onToggleGroup("active")}
            />
          </th>
          <th className="py-0.5 text-center font-bold">출결</th>
          <th className="py-0.5 text-center font-bold" title="수업 1회 = 1유닛(기본). 급여 시수에 반영됩니다.">
            유닛
          </th>
          <th className="py-0.5 text-center font-bold">태도</th>
          {textCols.map((col) => (
            <th key={col.field} className="py-0.5 text-center leading-tight font-bold" title={col.title}>
              {col.label}
            </th>
          ))}
          {/* 가운데 정렬이라 pr-1은 뺐다 — 있으면 라벨이 열 중심에서 2px 왼쪽으로 밀린다. */}
          <th className="rounded-r-md py-0.5 text-center font-bold">특이사항</th>
        </tr>
      </thead>
      <tbody className="divide-line divide-y">
        {rows.map((row) => {
          if (row.kind === "label") {
            return (
              <tr key={`label:${row.key}`} className="bg-bg-soft">
                <td colSpan={rosterColSpan(form)} className="text-foreground px-1 py-0.5 text-[11px] font-bold" title={groupHint(row.key)}>
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
          const s = row.entry.row;
          const mark: SheetMark | null = s.mark;
          return (
            <tr key={`${s.classId}:${s.studentId}`}>
              <td className="py-px pr-1">
                <SeatNameCell student={s} historical={row.entry.historical} />
              </td>
              <RosterSlotCells
                entry={row.entry}
                meta={{ name: s.name, school: s.school, grade: s.grade, englishName: s.englishName }}
                date={date}
                slotStart={slotStart}
                mark={mark}
                att={s.attendance}
                canMarkDate={s.canMarkAttendance}
                canEdit={s.canEditMark}
                handlers={handlersOf(s.classId) as SheetHandlers}
                navRow={row.navRow}
                form={form}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * 이름 칸 — [이름][반 배지]를 **항상 한 줄**로.
 *
 * 🔴 **무엇이 열을 흐트러뜨렸나(2026-08-19, 헤드리스 크롬 실측)**: 그전엔 블록 `<div>` 안에 **인라인**
 *    `<a class="truncate">` + inline-block 배지였다. `truncate`의 `overflow:hidden`은 **비치환 인라인
 *    요소엔 적용되지 않아**(CSS 2.1 — overflow는 블록 컨테이너 대상) 이름은 잘리지도 줄지도 않았고,
 *    이름+배지가 칸(112px)을 넘는 순간 **배지가 둘째 줄로 꺾여** 그 행만 22px → 37px로 부풀었다.
 *    동명이인 접미사 한 글자(≈9px)가 정확히 그 경계를 넘긴다 — `이서온A`(48)+`중1 정규 A`(62)=114 → 꺾임,
 *    `김현준B`(47)+`중2 심화`(51)=102 → 한 줄. 그래서 **어떤 행은 두 줄, 어떤 행은 한 줄**이 되고
 *    옆 열의 입력 상자들이 행마다 위아래로 밀려 "열이 흐트러진" 것처럼 보였다(원장 제보 그대로).
 * 🔑 고침 = **flex 한 줄**: 이름은 `shrink-0`(안 줄고 안 꺾임) · 배지는 `min-w-0 truncate`(먼저 줄고
 *    전문은 툴팁) · 컨테이너는 `overflow-hidden`(비정상적으로 긴 이름의 최종 클램프 — 옆 열 침범 금지).
 *    열 폭은 [seat-day-columns](../lib/seat-day-columns.ts)가 이름 몫+배지 몫을 더해 정한다.
 * ⚠️ 여기서 `flex-wrap`으로 접지 말 것 — 접히는 순간 그 행만 두 줄이 되어 같은 증상이 돌아온다
 *    (고정 폭 칸을 `flex-wrap`으로 접는 규약은 행 높이가 자유로운 표의 이야기다).
 * ⚠️ 아바타/이니셜 배지 금지(결정 로그) — 여기 배지는 사람이 아니라 **반 이름**이다.
 */
function SeatNameCell({ student: s, historical }: { student: SeatDayStudent; historical: boolean }) {
  const badge = shortClassLabel(s.className);
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      <WindowLink
        href={`/students/${s.studentId}`}
        title={s.name}
        className={`shrink-0 text-[13px] font-bold whitespace-nowrap underline-offset-2 hover:underline ${
          historical ? "text-text-dim" : "text-foreground"
        } ${s.endedOn ? "line-through" : ""}`}
        ariaLabel={`${s.name} 학생 정보`}
      >
        <span title={`${s.name} · ${schoolGradeLabel(s.school, s.grade)} · ${s.className}`}>
          {s.name}
        </span>
      </WindowLink>
      <span
        className="bg-bg-soft text-text-dim min-w-0 truncate rounded-full px-1.5 py-px text-[10px] font-bold"
        style={{ maxWidth: SEAT_BADGE_W }}
        title={s.className}
      >
        {badge}
      </span>
    </div>
  );
}
