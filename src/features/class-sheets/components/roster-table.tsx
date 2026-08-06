"use client";

// 학생 로스터 표 — [이름 | 출석(일 단위 공유) | 학교학년 | 상태 | 개인 진도/과제].
// 출석 체크는 (학생,날짜) 하나의 상태를 모든 교시 블록이 미러(하루 1건 — attendance_records).
// 상태·개인진도는 교시별(class_sheet_student_marks — 키에 slot_start 포함). 아바타 금지(이름 텍스트만).
//
// 명단은 시간표 셀처럼 **섹션으로 나뉜다**: 재원(기본) → 퇴원(유예 30일) → 기록(그 외 보존 행).
// 퇴원·기록 섹션은 전부 읽기 전용이고 일괄 입력 대상도 아니다(bulk.ts editableRows).
//
// 섹션 머리는 **접기/펼치기 버튼**이다(원장 2026-08-06 "학생 목록 / 퇴원생 목록 접기/펼치기").
// ⚠️ 접힘은 **시트 전체 공유 상태**(계정 저장)라 이 컴포넌트가 들고 있지 않다 — 카드마다 따로 접히면
//    같은 일을 교시 수만큼 반복해야 하고, 나란한 카드의 로스터 높이가 어긋나 subgrid 줄맞춤이 깨진다.
// ⚠️ 접어도 **건수는 머리에 남긴다** — 숨기면서 숫자까지 지우면 "몇 명인지 모를 뿐 아니라 있는지도 모름"이 된다.
import { memo, useMemo } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { EyIcon } from "@/components/icons/eywa-icons";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import type { ClassSheetWeekData } from "../server/queries";
import type { RosterEntry } from "../lib/grid";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import type { SheetHandlers } from "./sheet-client";
import { AttendanceCheck, StatusCell } from "./status-cell";

// 입력칸 테두리는 헤어라인(--line 9%)이 아니라 line-strong(18%) — 9%는 흰 카드 위에서 "칸이 있는지"가
// 안 보여 표 전체가 흐릿하게 읽혔다(원장 지적 2026-07-31). 글자도 12→13px.
const noteCls =
  "border-line-strong text-foreground w-full rounded-lg border bg-transparent px-1.5 py-1 text-[13px] outline-none focus:border-primary disabled:opacity-60";

/** 섹션 라벨 행의 설명(툴팁) — 왜 이 학생이 아직 보이는지 화면이 스스로 답한다. */
const GROUP_HINT: Record<RosterGroupKey, string> = {
  active: "",
  withdrawn: "수강이 끝난 학생 — 종료일부터 한 달간 표시되고 그 뒤 주부터는 명단에서 빠집니다(읽기 전용)",
  record: "현재 수강 대상이 아니지만 이 교시에 기록이 있어 표시(읽기 전용)",
};

/** 접기 버튼의 접근성 이름 — `active`는 라벨 행이 없어 표 머리('학생')가 그 자리다. */
const GROUP_TOGGLE_LABEL: Record<RosterGroupKey, string> = {
  active: "학생 목록",
  withdrawn: "퇴원생 목록",
  record: "기록 목록",
};

/** 섹션 접기/펼치기 셰브런 — 표 머리(active)와 라벨 행(withdrawn·record)이 같은 어포던스를 쓴다. */
function GroupToggle({
  group,
  collapsed,
  count,
  onToggle,
}: {
  group: RosterGroupKey;
  collapsed: boolean;
  count: number;
  onToggle: () => void;
}) {
  const name = GROUP_TOGGLE_LABEL[group];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${name} ${collapsed ? "펼치기" : "접기"}`}
      title={`${name} ${collapsed ? "펼치기" : "접기"}`}
      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1"
    >
      <EyIcon
        name="chevronRight"
        size={10}
        className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
      />
      <span>{group === "active" ? "학생" : GROUP_LABEL_OF[group]}</span>
      {/* 접었든 폈든 건수는 남긴다 — 접힌 섹션이 "없는 섹션"으로 보이면 안 된다. */}
      <span className="num opacity-70">{count}</span>
    </button>
  );
}

const GROUP_LABEL_OF: Record<RosterGroupKey, string> = {
  active: "학생",
  withdrawn: "퇴원",
  record: "기록",
};

export const RosterTable = memo(function RosterTable({
  date,
  slotStart,
  roster,
  data,
  marks,
  attendance,
  handlers,
  canEdit,
  collapsedGroups,
  onToggleGroup,
}: {
  date: string;
  slotStart: string;
  roster: RosterEntry[];
  data: ClassSheetWeekData;
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  handlers: SheetHandlers;
  canEdit: boolean;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const canMarkDate = data.canMarkAttendanceByDate[date] ?? false;
  // 섹션(재원/퇴원/기록)으로 나눠 이름·종료일 순으로 정렬한 뒤 라벨 행과 함께 한 줄로 편다.
  // 표를 나누지 않고 한 <table> 안에서 라벨 행으로 가르는 이유: 열 폭(이름/출석/학교/상태/진도)이
  // 섹션마다 어긋나면 같은 명단으로 안 읽힌다. 키보드 이동(data-nav-row)은 렌더 순서로 다시 매긴다.
  //
  // ⚠️ 접힌 섹션의 행은 **아예 안 만든다**(CSS로 감추지 않는다) — 감추기만 하면 접은 채로 Tab·↑↓이
  //    안 보이는 입력칸으로 들어간다. navRow도 보이는 행만으로 다시 매겨 이동이 건너뛰지 않는다.
  const { rows, counts } = useMemo(() => {
    const out: (
      | { kind: "label"; key: RosterGroupKey; count: number }
      | { kind: "row"; entry: RosterEntry; navRow: number }
    )[] = [];
    const sizes = {} as Record<RosterGroupKey, number>;
    let navRow = 0;
    for (const group of groupRosterRows(roster, (id) => data.students[id]?.name ?? "")) {
      sizes[group.key] = group.rows.length;
      const collapsed = collapsedGroups.includes(group.key);
      if (group.label) out.push({ kind: "label", key: group.key, count: group.rows.length });
      if (collapsed) continue;
      for (const entry of group.rows) out.push({ kind: "row", entry, navRow: navRow++ });
    }
    return { rows: out, counts: sizes };
  }, [roster, data.students, collapsedGroups]);
  return (
    <div className="border-line mt-2 border-t pt-1.5">
      <table className="w-full border-collapse text-[13px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 100 }} />
          <col style={{ width: 46 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 68 }} />
          <col />
        </colgroup>
        <thead>
          {/* 헤더 밴드 — 원본 시트의 노란 머리글 줄이 하던 일(본문과 확실히 구분). 회색 밴드 + dim 굵은 글씨. */}
          <tr className="bg-bg-soft text-text-dim text-left text-[11px]">
            {/* '학생' 머리가 곧 재원 섹션의 접기 버튼(이 섹션엔 라벨 행이 없다). */}
            <th className="rounded-l-md py-1 pl-1 font-semibold">
              <GroupToggle
                group="active"
                collapsed={collapsedGroups.includes("active")}
                count={counts.active ?? 0}
                onToggle={() => onToggleGroup("active")}
              />
            </th>
            <th className="py-1 font-semibold">출석</th>
            <th className="py-1 font-semibold">학교</th>
            <th className="py-1 font-semibold">상태</th>
            <th className="rounded-r-md py-1 pr-1 font-semibold">개인 진도 · 과제</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((row) => {
            if (row.kind === "label") {
              return (
                <tr key={`label:${row.key}`} className="bg-bg-soft">
                  <td
                    colSpan={5}
                    className="text-text-dim px-1 py-1 text-[11px] font-semibold"
                    title={GROUP_HINT[row.key]}
                  >
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
            const { entry, navRow } = row;
            const meta = data.students[entry.studentId];
            const mark = marks[`${entry.studentId}|${date}|${slotStart}`] ?? null;
            const attStatus = attendance[`${entry.studentId}|${date}`] ?? null;
            const rowEditable = canEdit && entry.eligible;
            return (
              // ⚠️ 읽기 전용 행을 opacity로 흐리지 않는다 — 흐린 회색은 "가독성이 떨어진다"의 본체였다.
              //    회색조(text-dim)와 은은한 배경으로 구분하고 **글자 대비는 유지**한다.
              <tr key={entry.studentId} className={entry.historical ? "bg-bg-soft/40" : ""}>
                <td className="py-1 pr-1">
                  <span
                    className={`truncate text-[13px] font-semibold ${
                      entry.historical ? "text-text-dim" : "text-foreground"
                    } ${entry.endedOn ? "line-through" : ""}`}
                    title={meta?.name}
                  >
                    {meta?.name ?? "?"}
                  </span>
                  {meta?.englishName ? (
                    <span className="text-text-dim ml-1 text-[11px]">({meta.englishName})</span>
                  ) : null}
                  {/* 퇴원일 — 섹션 라벨이 '퇴원'이라 날짜만(월-일). 전체 날짜는 툴팁. */}
                  {entry.endedOn ? (
                    <span className="text-text-dim num ml-1 text-[11px]" title={`${entry.endedOn} 수강 종료`}>
                      {entry.endedOn.slice(5)}
                    </span>
                  ) : null}
                </td>
                <td className="py-1 pr-1">
                  <AttendanceCheck
                    status={attStatus}
                    canMark={canMarkDate && rowEditable}
                    onMark={() => handlers.markPresent(entry.studentId, date)}
                    onClear={() => handlers.clearAttendance(entry.studentId, date)}
                  />
                </td>
                <td className="text-text-dim truncate py-1 pr-1 text-[12px]">
                  {meta ? schoolGradeLabel(meta.school, meta.grade) : ""}
                </td>
                <td className="py-1 pr-1">
                  <StatusCell
                    value={mark?.status ?? null}
                    canEdit={rowEditable}
                    onChange={(status) =>
                      handlers.saveMark(entry.studentId, date, slotStart, status, mark?.progressNote ?? null)
                    }
                  />
                </td>
                <td className="py-1">
                  <input
                    className={noteCls}
                    defaultValue={mark?.progressNote ?? ""}
                    disabled={!rowEditable}
                    aria-label={`${meta?.name ?? ""} 개인 진도·과제`}
                    data-nav-col="ecs-note"
                    data-nav-row={navRow}
                    onKeyDown={handleGridNavKey}
                    onChange={(e) =>
                      handlers.saveMark(
                        entry.studentId,
                        date,
                        slotStart,
                        mark?.status ?? null,
                        e.target.value,
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
