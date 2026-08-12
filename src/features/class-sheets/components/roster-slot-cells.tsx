"use client";

/**
 * 로스터 **셀 묶음** — 주간 시트(교시별 표, roster-table)와 오늘 면(통합 표, today-roster-table)이
 * **같은 셀 구현**을 쓴다(원장 2026-08-11 "쓸데없이 중복되는 컴포넌트가 다수" — 중복의 처방은 추출).
 *
 *  · `RosterNameCell` — 이름(학생 정보 링크) + 영어이름 + 퇴원일.
 *  · `RosterSlotCells` — 한 교시분 4칸: 출결(클릭 알약) · 유닛 · 태도 · 특이사항.
 *    entry가 null이면(통합 표에서 그 교시 수강 대상이 아닌 학생) 4칸 전부 '—'로 조용히 비운다.
 *
 * 🔴 출결은 **클릭 알약**(원장 2026-08-11 "출결도 클릭형으로 변경. 드랍다운 제거") — 옛 드롭다운
 *    (attendance-select)은 삭제됐다. 저장 경로는 불변: handlers.setAttendance/clearAttendance
 *    (= setAttendanceCell·0169a — 권한·담당 반·7일 창 게이트 공용, #77).
 */
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { WindowLink } from "@/components/workspace/window-link";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import { SessionUnitsField } from "@/features/onescreen/components/attendance-pills";
import { FieldSelect } from "@/features/onescreen/components/field-select";
import { ATTITUDE } from "@/features/onescreen/attitude";
import type { RosterEntry } from "../lib/grid";
import { SHEET_BOX_READONLY, SHEET_BOX_UNITS, SHEET_INPUT } from "../ui-box";
import { TodayAttendancePills } from "./today-attendance-pills";
import type { SheetHandlers } from "./sheet-client";

export type StudentMeta = {
  name: string;
  school: string | null;
  grade: string | null;
  englishName: string | null;
};

/** 이름 칸 — 클릭=학생 정보(WindowLink, #86). 행 안 글자는 전부 13px(원장 2026-08-10 "크기 통일"). */
export function RosterNameCell({ entry, meta }: { entry: RosterEntry; meta: StudentMeta | undefined }) {
  return (
    <td className="py-px pr-1">
      <WindowLink
        href={`/students/${entry.studentId}`}
        title={meta?.name}
        className={`truncate text-[13px] font-bold underline-offset-2 hover:underline ${
          entry.historical ? "text-text-dim" : "text-foreground"
        } ${entry.endedOn ? "line-through" : ""}`}
        ariaLabel={meta ? `${meta.name} 학생 정보` : "학생 정보"}
      >
        {/* 학교·학년은 이름 툴팁(학교 열은 2026-08-06에 뺐다 — 정보는 남긴다). */}
        <span title={meta ? `${meta.name} · ${schoolGradeLabel(meta.school, meta.grade)} — 클릭하면 학생 정보` : undefined}>
          {meta?.name ?? "?"}
        </span>
      </WindowLink>
      {meta?.englishName ? <span className="text-text-dim ml-1 text-[13px]">({meta.englishName})</span> : null}
      {entry.endedOn ? (
        <span className="text-text-dim num ml-1 text-[13px]" title={`${entry.endedOn} 수강 종료`}>
          {entry.endedOn.slice(5)}
        </span>
      ) : null}
    </td>
  );
}

/** 한 교시분 4칸(출결·유닛·태도·특이사항). 폭은 표의 colgroup이 정한다(88·46·96·잔여). */
export function RosterSlotCells({
  entry,
  meta,
  date,
  slotStart,
  mark,
  att,
  canMarkDate,
  canEdit,
  handlers,
  navRow,
  navCol,
  withDivider = false,
}: {
  /** null = 이 학생이 이 교시 수강 대상이 아님(통합 표) — 4칸 전부 '—'. */
  entry: RosterEntry | null;
  meta: StudentMeta | undefined;
  date: string;
  slotStart: string;
  mark: { status: string | null; progressNote: string | null } | null;
  att: { status: string; note: string | null; units: number | null; slot: string | null } | null;
  canMarkDate: boolean;
  canEdit: boolean;
  handlers: SheetHandlers;
  /** 키보드 세로 이동(Enter/↑↓) 행 번호 — 보이는 행 기준으로 표가 매긴다. */
  navRow: number;
  /** 특이사항 칸의 이동 열 식별자 — 통합 표는 교시마다 다른 열이라 slotStart를 섞어 넘긴다. */
  navCol: string;
  /** 교시 그룹 경계선(통합 표) — 첫 칸 왼쪽에 옅은 세로선(표 규약: 세로선은 가로선보다 한 단계 옅게). */
  withDivider?: boolean;
}) {
  const dividerCls = withDivider ? "border-line border-l" : "";
  if (entry === null) {
    return (
      <>
        <td className={`py-px text-center ${dividerCls}`} title="이 교시 수강 대상이 아닙니다">
          <span className="text-text-faint text-[13px] font-semibold">—</span>
        </td>
        <td className="py-px text-center">
          <span className="text-text-faint text-[13px] font-semibold">—</span>
        </td>
        <td className="py-px text-center">
          <span className="text-text-faint text-[13px] font-semibold">—</span>
        </td>
        <td className="py-px pr-1" />
      </>
    );
  }
  const rowEditable = canEdit && entry.eligible;
  return (
    <>
      <td className={`py-px ${dividerCls}`}>
        {/* 클릭 알약(압축 라벨 출/지/결 — 88px 열) — 활성 '출석' 재클릭=0169a 취소, 지각·결석=사유 창. */}
        <TodayAttendancePills
          status={att?.status ?? null}
          note={att?.note ?? null}
          studentName={meta?.name ?? ""}
          canMark={canMarkDate && rowEditable}
          compact
          onSet={(status, n) => handlers.setAttendance(entry.studentId, date, slotStart, status, n)}
          onClear={() => handlers.clearAttendance(entry.studentId, date, slotStart)}
        />
      </td>
      <td className="px-1 py-px text-center">
        {/* 유닛 = session_units. 결석은 시수를 안 쓰고, 기록이 없으면 값 자체가 없다('—', 원장 지시). */}
        {att?.status === "absent" ? (
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
            box={SHEET_BOX_UNITS}
            onSet={(status, extra) =>
              handlers.setAttendance(entry.studentId, date, slotStart, status, undefined, extra?.units)
            }
          />
        ) : (
          <span className="text-text-faint text-[13px] font-semibold">—</span>
        )}
      </td>
      <td className="py-px pr-1">
        {rowEditable ? (
          <FieldSelect
            options={ATTITUDE}
            value={mark?.status ?? null}
            ariaLabel={`${meta?.name ?? ""} 태도`}
            box={SHEET_INPUT}
            onSelect={(v) => handlers.saveMark(entry.studentId, date, slotStart, v, mark?.progressNote ?? null)}
          />
        ) : (
          // 읽기 전용 행도 **값은 보여준다**(옛 '완'·'결석' 같은 이전 표기 포함) — 숨기면 기록이 증발한다.
          <span className={SHEET_BOX_READONLY}>{mark?.status ?? "—"}</span>
        )}
      </td>
      <td className="py-px pr-1">
        <input
          className={SHEET_INPUT}
          defaultValue={mark?.progressNote ?? ""}
          disabled={!rowEditable}
          aria-label={`${meta?.name ?? ""} 특이사항`}
          data-nav-col={navCol}
          data-nav-row={navRow}
          onKeyDown={handleGridNavKey}
          onChange={(e) =>
            handlers.saveMark(entry.studentId, date, slotStart, mark?.status ?? null, e.target.value)
          }
        />
      </td>
    </>
  );
}
