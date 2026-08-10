"use client";

// 학생 로스터 표 — [이름 | 출결(일 단위 공유) | 학교학년 | 유닛 | 태도 | 특이사항].
// 출결은 (학생,날짜) 하나의 상태를 모든 교시 블록이 미러(하루 1건 — attendance_records).
// 태도·과제는 교시별(class_sheet_student_marks — 키에 slot_start 포함). 아바타 금지(이름 텍스트만).
//
// **2026-08-06 원장 지시 — 수학 수업보고서와 같은 어휘·같은 컨트롤로 통일**:
//  · '출석' 열 → **'출결'** + 체크박스 → **출석/지각/결석 3분화**([AttendancePills] 재사용).
//    🔴 이제 ECS에서 **결석도 찍힌다 = 시수·급여에 닿는다**(그전엔 present만 만들 수 있었다). 서버는
//       원스크린과 **같은 게이트**(`setAttendanceCell` — 권한·담당 반·강사 7일 창)를 그대로 통과한다(#77).
//    ⚠️ 대신 **'출석 취소'는 여기서 사라졌다**(0169a) — pill은 지우지 않는다(활성 재클릭 = no-op). 지우기는
//       출석부에서만: status=null 삭제가 사유 메모·시수까지 함께 지우기 때문(수학 쪽과 동일한 이유).
//  · '상태' 열 → **'태도'** + 자유입력 칩 → **5단 눈금**([ATTITUDE] 재사용, 매우 좋음~매우 안좋음).
//    ⚠️ 옛 값('완' 736·'결석' 49·'지각' 12·'안침' 7 — 출결 대용으로 쓰이던 것)은 **안 지운다**.
//       FieldSelect가 선택지 밖 저장값을 '이전 표기'로 그대로 보여 준다(쓴 게 안 보이면 안 된다).
//  · '개인 진도 · 과제' → **'특이사항'**(라벨만 — 저장 필드는 그대로 `progressNote`).
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
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import type { ClassSheetWeekData } from "../server/queries";
import type { RosterEntry } from "../lib/grid";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import { AttendanceSelect } from "./attendance-select";
import { SessionUnitsField } from "@/features/onescreen/components/attendance-pills";
import { FieldSelect } from "@/features/onescreen/components/field-select";
import { ATTITUDE } from "@/features/onescreen/attitude";
import { SHEET_BOX_READONLY, SHEET_BOX_UNITS, SHEET_INPUT } from "../ui-box";
import type { SheetHandlers } from "./sheet-client";

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
  attendance: Record<string, { status: string; note: string | null; units: number | null }>;
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
          <col style={{ width: 92 }} />
          {/* 출결·태도는 드롭다운 — 태도는 가장 긴 선택지('매우 안좋음')가 잘리지 않는 폭이어야 한다.
              유닛은 숫자 한두 자리라 좁게(수학은 '타임', 영어는 '유닛' — 원장 어휘 그대로). */}
          <col style={{ width: 96 }} />
          {/* ⚠️ 유닛 칸 입력폭은 46px 고정(SessionUnitsField) — 열을 그보다 좁히면 입력칸이 넘쳐
              양옆 드롭다운 위로 **겹쳐 그려진다**(원장 2026-08-06 "너무 겹치네"). 좌우 여백까지 포함해 둘 것. */}
          <col style={{ width: 58 }} />
          <col style={{ width: 100 }} />
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
              title="이 날 수업 유닛 수 — 출결을 처음 찍을 때 그 날 교시 수로 자동 입력되고, 다르면 고칠 수 있습니다. 급여 시수에 반영됩니다."
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
            const mark = marks[`${entry.studentId}|${date}|${slotStart}`] ?? null;
            const att = attendance[`${entry.studentId}|${date}`] ?? null;
            const rowEditable = canEdit && entry.eligible;
            return (
              // ⚠️ 읽기 전용 행을 opacity로 흐리지 않는다 — 흐린 회색은 "가독성이 떨어진다"의 본체였다.
              //    회색조(text-dim)와 은은한 배경으로 구분하고 **글자 대비는 유지**한다.
              <tr key={entry.studentId} className={entry.historical ? "bg-bg-soft/40" : ""}>
                <td className="py-0.5 pr-1">
                  {/* 이름 클릭 = 학생 정보(원장 2026-08-06). WindowLink라 창(embed) 안에서는 그 창에서
                      드릴인하고, 최상위 프레임에서는 새 플로팅 창으로 뜬다([[#86]] — 배경이 창에 가려
                      "아무 일도 안 일어난 것처럼" 보이는 사고를 이 컴포넌트가 이미 막아 준다). */}
                  <WindowLink
                    href={`/students/${entry.studentId}`}
                    title={meta?.name}
                    className={`truncate text-[13px] font-bold underline-offset-2 hover:underline ${
                      entry.historical ? "text-text-dim" : "text-foreground"
                    } ${entry.endedOn ? "line-through" : ""}`}
                    // 학교 열을 뺐으므로 학교·학년은 **이름 툴팁으로 옮긴다** — 열이 사라졌다고 정보까지
                    // 사라지면 "누구인지" 확인할 길이 화면에서 없어진다.
                    ariaLabel={meta ? `${meta.name} 학생 정보` : "학생 정보"}
                  >
                    <span title={meta ? `${meta.name} · ${schoolGradeLabel(meta.school, meta.grade)} — 클릭하면 학생 정보` : undefined}>
                      {meta?.name ?? "?"}
                    </span>
                  </WindowLink>
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
                <td className="py-0.5">
                  {/* 태도와 **같은 컨트롤**(드롭다운, 원장 2026-08-06) — 알약 3개는 한 줄에서 폭을 먹고
                      두 칸이 서로 다른 모양으로 읽혔다. 시수·사유 편집은 출석부·원스크린 쪽에 남는다. */}
                  <AttendanceSelect
                    status={att?.status ?? null}
                    note={att?.note ?? null}
                    studentName={meta?.name ?? ""}
                    canMark={canMarkDate && rowEditable}
                    onSet={(status, n) => handlers.setAttendance(entry.studentId, date, status, n)}
                    onClear={() => handlers.clearAttendance(entry.studentId, date)}
                  />
                </td>
                <td className="px-1 py-0.5 text-center">
                  {/* 유닛 = 수학의 '타임'과 같은 값(session_units). 결석이면 컴포넌트가 '—'로 잠근다
                      (결석은 시수를 안 쓴다). **출결 기록이 없으면 '—'** — 아직 유닛이라는 값 자체가
                      없는 상태라 0이나 1을 보여주면 "이미 잡혀 있다"는 거짓 표시가 된다(원장 "없는 경우 -"). */}
                  {att?.status === "absent" ? (
                    // 결석은 시수를 안 쓴다. size="md"의 SessionUnitsField는 이 경우 **null을 반환**해
                    // 칸이 통째로 비므로(빈 칸 = "입력이 안 되나?") 여기서 직접 '—'를 그린다.
                    <span
                      className="text-text-faint text-[13px] font-semibold"
                      title="결석은 유닛(시수)을 쓰지 않습니다 — 출석·지각으로 바꾸면 입력할 수 있습니다"
                    >
                      —
                    </span>
                  ) : canMarkDate && rowEditable && att ? (
                    <SessionUnitsField
                      units={att.units}
                      status={(att.status as "present" | "late" | "absent" | null) ?? null}
                      pending={false}
                      studentName={meta?.name ?? ""}
                      // 이웃 칸(출결·태도 드롭다운)과 **같은 잉크 테두리·같은 높이**로 — 이 칸만 얇은
                      // 헤어라인이면 한 줄에서 칸 하나가 비어 보인다(원장 2026-08-10 "모든 박스에 테두리").
                      box={SHEET_BOX_UNITS}
                      onSet={(status, extra) =>
                        handlers.setAttendance(entry.studentId, date, status, undefined, extra?.units)
                      }
                    />
                  ) : (
                    <span className="text-text-faint text-[13px] font-semibold">—</span>
                  )}
                </td>
                <td className="py-0.5 pr-1">
                  {rowEditable ? (
                    <FieldSelect
                      options={ATTITUDE}
                      value={mark?.status ?? null}
                      ariaLabel={`${meta?.name ?? ""} 태도`}
                      box={SHEET_INPUT}
                      onSelect={(v) =>
                        handlers.saveMark(entry.studentId, date, slotStart, v, mark?.progressNote ?? null)
                      }
                    />
                  ) : (
                    // 읽기 전용 행도 **값은 보여준다**(옛 '완'·'결석' 같은 이전 표기 포함) — 숨기면 기록이 증발한다.
                    <span className={SHEET_BOX_READONLY}>{mark?.status ?? "—"}</span>
                  )}
                </td>
                <td className="py-0.5">
                  <input
                    className={SHEET_INPUT}
                    defaultValue={mark?.progressNote ?? ""}
                    disabled={!rowEditable}
                    aria-label={`${meta?.name ?? ""} 특이사항`}
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
