"use client";

// 학생 로스터 표 — [이름 | 출결(일 단위 공유) | 학교학년 | 유닛 | 태도 | 특이사항].
// 출결은 **교시별**(0196a, 원장 2026-08-10) — 같은 날 4교시·6교시가 서로 다른 기록이다.
//   ⚠️ 그전엔 (학생,날짜) 하루 1건이라 모든 교시 카드가 같은 행을 비췄고, 한 칸을 고치면 다른 칸도
//      함께 바뀌었다. 옛 기록(slot_start null)은 서버가 그 날 **첫 교시 칸에만** 붙여 준다.
// 태도·과제는 교시별(class_sheet_student_marks — 키에 slot_start 포함). 아바타 금지(이름 텍스트만).
//
// **컨트롤 이력**: 2026-08-06 "수학 보고서와 같은 어휘·컨트롤"(출결 3분화·태도 5단·특이사항) →
// 출결 컨트롤은 2026-08-11 원장 *"클릭형으로 변경. 드랍다운 제거"*로 **클릭 알약**(roster-slot-cells.tsx,
// 압축 라벨 출/지/결)이 됐다. 셀 구현은 오늘 면 통합 표(today-roster-table)와 **공용**이다(중복 금지).
//
// 명단은 시간표 셀처럼 **섹션으로 나뉜다**: 재원(기본) → 퇴원(유예 30일) → 기록(그 외 보존 행).
// 퇴원·기록 섹션은 전부 읽기 전용이고 일괄 입력 대상도 아니다(bulk.ts editableRows).
//
// 섹션 머리는 **접기/펼치기 버튼**이다(원장 2026-08-06 "학생 목록 / 퇴원생 목록 접기/펼치기").
// ⚠️ 접힘은 **시트 전체 공유 상태**(계정 저장)라 이 컴포넌트가 들고 있지 않다 — 카드마다 따로 접히면
//    같은 일을 교시 수만큼 반복해야 하고, 나란한 카드의 로스터 높이가 어긋나 subgrid 줄맞춤이 깨진다.
// ⚠️ 접어도 **건수는 머리에 남긴다** — 숨기면서 숫자까지 지우면 "몇 명인지 모를 뿐 아니라 있는지도 모름"이 된다.
import { memo, useMemo } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { ClassSheetWeekData } from "../server/queries";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import type { RosterEntry } from "../lib/grid";
import { RosterNameCell, RosterSlotCells } from "./roster-slot-cells";
import type { SheetHandlers } from "./sheet-client";

/** 섹션 라벨 행의 설명(툴팁) — 왜 이 학생이 아직 보이는지 화면이 스스로 답한다. 통합 표와 공용. */
export const GROUP_HINT: Record<RosterGroupKey, string> = {
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

/** 섹션 접기/펼치기 셰브런 — 표 머리(active)와 라벨 행(withdrawn·record)이 같은 어포던스. 통합 표와 공용. */
export function GroupToggle({
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
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  handlers: SheetHandlers;
  canEdit: boolean;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const canMarkDate = data.canMarkAttendanceByDate[date] ?? false;
  // 섹션(재원/퇴원/기록)으로 나눠 이름·종료일 순으로 정렬한 뒤 라벨 행과 함께 한 줄로 편다.
  // 표를 나누지 않고 한 <table> 안에서 라벨 행으로 가르는 이유: 열 폭(이름/출결/학교/태도/과제)이
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
    <div className="border-line-strong mt-1.5 border-t pt-1">
      <table className="w-full border-collapse text-[13px]" style={{ tableLayout: "fixed" }}>
        {/* ⚠️ 학교 열은 뺐다(원장 2026-08-06) — 남은 폭은 전부 '특이사항'이 가져간다.
            학교·학년은 학생 이름 툴팁과 학생목록에 있고, 교시 카드에서 매일 보는 값이 아니다. */}
        {/* 폭은 **꼭 필요한 만큼만** 고정하고 남는 건 전부 '특이사항'이 가져간다(원장 2026-08-06
            "특이사항 열너비를 남은 열너비로"). `table-fixed`라 width 없는 마지막 <col>이 잔여를 받는다. */}
        <colgroup>
          <col style={{ width: 84 }} />
          {/* 출결 = 클릭 알약 3개(출/지/결, 2026-08-11 "드랍다운 제거") — 압축 라벨이라 88px에 앉는다.
              태도는 드롭다운 유지 — 가장 긴 선택지('매우 안좋음' ≈ 91px)가 잘리지 않는 폭.
              유닛은 숫자 한두 자리라 좁게(수학은 '타임', 영어는 '유닛' — 원장 어휘 그대로). */}
          <col style={{ width: 88 }} />
          {/* ⚠️ 유닛 칸은 이제 열 폭을 그대로 채운다(w-full) — 예전 46px 고정 입력이 열보다 넓어
              양옆 칸 위로 겹쳐 그려지던 문제(원장 2026-08-06 "너무 겹치네")가 구조적으로 사라졌다. */}
          <col style={{ width: 46 }} />
          <col style={{ width: 96 }} />
          <col />
        </colgroup>
        <thead>
          {/* 헤더 밴드 — 원본 시트의 노란 머리글 줄이 하던 일(본문과 확실히 구분). 회색 밴드 + dim 굵은 글씨. */}
          {/* 머리글도 **굵게 + foreground**(원장 2026-08-06 "전체 텍스트를 굵게할것") — dim 보통굵기는
              한 발짝만 떨어져도 안 읽혔다. */}
          <tr className="bg-bg-soft text-foreground text-left text-[11px]">
            {/* '학생' 머리가 곧 재원 섹션의 접기 버튼(이 섹션엔 라벨 행이 없다). */}
            <th className="rounded-l-md py-0.5 pl-1 font-bold">
              <GroupToggle
                group="active"
                collapsed={collapsedGroups.includes("active")}
                count={counts.active ?? 0}
                onToggle={() => onToggleGroup("active")}
              />
            </th>
            {/* 가운데 세 열은 라벨을 **칸 가운데**로(원장 2026-08-06 "라벨 중앙정렬") — 값(드롭다운·숫자)이
                칸을 꽉 채우거나 가운데 있어서 라벨만 왼쪽에 붙으면 열이 어긋나 보인다. */}
            <th className="py-0.5 text-center font-bold">출결</th>
            <th
              className="py-0.5 text-center font-bold"
              title="수업 1회 = 1유닛(기본). 시간·교시 길이와 상관없이 1이고, 다르면 여기서 고칠 수 있습니다. 급여 시수에 반영됩니다."
            >
              유닛
            </th>
            <th className="py-0.5 text-center font-bold">태도</th>
            <th className="rounded-r-md py-0.5 pr-1 font-bold">특이사항</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((row) => {
            if (row.kind === "label") {
              return (
                <tr key={`label:${row.key}`} className="bg-bg-soft">
                  <td
                    colSpan={5}
                    className="text-foreground px-1 py-0.5 text-[11px] font-bold"
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
            // 출결은 **교시별**(0196a) — 같은 날 4교시·6교시가 서로 다른 칸이다.
            // (옛 "그날 전체" 기록은 서버가 그 날 첫 교시 칸에만 붙여 준다.)
            return (
              // ⚠️ 읽기 전용 행을 opacity로 흐리지 않는다 — 흐린 회색은 "가독성이 떨어진다"의 본체였다.
              //    회색조(text-dim)와 은은한 배경으로 구분하고 **글자 대비는 유지**한다.
              <tr key={entry.studentId} className={entry.historical ? "bg-bg-soft/40" : ""}>
                <RosterNameCell entry={entry} meta={meta} />
                <RosterSlotCells
                  entry={entry}
                  meta={meta}
                  date={date}
                  slotStart={slotStart}
                  mark={marks[`${entry.studentId}|${date}|${slotStart}`] ?? null}
                  att={attendance[`${entry.studentId}|${date}|${slotStart}`] ?? null}
                  canMarkDate={canMarkDate}
                  canEdit={canEdit}
                  handlers={handlers}
                  navRow={navRow}
                  navCol="ecs-note"
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
