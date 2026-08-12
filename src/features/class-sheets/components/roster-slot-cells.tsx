"use client";

/**
 * 로스터 **셀 묶음** — 주간 시트(교시별 표, roster-table)와 오늘 면(통합 표, today-roster-table)이
 * **같은 셀 구현**을 쓴다(원장 2026-08-11 "쓸데없이 중복되는 컴포넌트가 다수" — 중복의 처방은 추출).
 *
 *  · `RosterNameCell` — 이름(학생 정보 링크) + 영어이름 + 퇴원일.
 *  · `RosterSlotCells` — 한 교시분 5칸: 출결(체크 순환) · 유닛 · 태도(체크 순환) · 점수 · 특이사항.
 *    entry가 null이면(통합 표에서 그 교시 수강 대상이 아닌 학생) 값 칸 셋은 '—', 입력 칸 둘(점수·
 *    특이사항)은 **잠긴 입력**으로 비운다 — 잠긴 입력이어야 Enter/↑↓ 세로 이동이 이 행을 건너뛴다
 *    (grid-nav는 '없는 입력'을 열의 끝으로 오판한다 — 적대 리뷰 2026-08-11, #103 계열).
 *
 * 🔴 컨트롤·저장 경로는 주간 표의 것을 **한 글자도 바꾸지 않고** 옮겼다: 출결=AttendanceCheck(누를 때마다
 *    출석→결석→지각→선택 안 함, 우클릭=사유 — 원장 2026-08-11 "클릭형으로 변경. 드랍다운 제거"),
 *    태도=AttitudeCheck, 점수(0202a)·특이사항=한 마크 행 공유(saveMark), 유닛=SessionUnitsField.
 */
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { WindowLink } from "@/components/workspace/window-link";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import { SessionUnitsField } from "@/features/onescreen/components/attendance-pills";
import type { RosterEntry } from "../lib/grid";
import { SHEET_BOX_UNITS, SHEET_INPUT } from "../ui-box";
import { AttendanceCheck } from "./attendance-check";
import { AttitudeCheck } from "./attitude-check";
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

/** 한 교시분 5칸(출결·유닛·태도·점수·특이사항). 폭은 표의 colgroup이 정한다(60·46·80·54·잔여). */
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
  navColSuffix = "",
  withDivider = false,
}: {
  /** null = 이 학생이 이 교시 수강 대상이 아님(통합 표) — 5칸 전부 '—'. */
  entry: RosterEntry | null;
  meta: StudentMeta | undefined;
  date: string;
  slotStart: string;
  mark: { status: string | null; progressNote: string | null; score: string | null } | null;
  att: { status: string; note: string | null; units: number | null; slot: string | null } | null;
  canMarkDate: boolean;
  canEdit: boolean;
  handlers: SheetHandlers;
  /** 키보드 세로 이동(Enter/↑↓) 행 번호 — 보이는 행 기준으로 표가 매긴다. */
  navRow: number;
  /** 이동 열 식별자 꼬리 — 통합 표는 교시마다 다른 열이라 `:${slotStart}`를 붙여 세로 이동을 교시 안에 가둔다. */
  navColSuffix?: string;
  /**
   * 교시 그룹 경계선(통합 표) — 첫 칸 왼쪽 세로선.
   * ⚠️ 표 규약의 옅은 열 구분선(`--line-faint`)이 **아니라** 진한 선이다: 여기는 열 하나의 경계가 아니라
   *    **교시(수업)의 경계**이고, 위층 계획 카드와 아래층 명단이 이 선 하나로 이어져 한 격자로 읽혀야
   *    한다(원장 2026-08-11 *"마치 엑셀처럼 … 대신 구분 경계만 명확하게"*).
   */
  withDivider?: boolean;
}) {
  const dividerCls = withDivider ? "border-line-strong border-l" : "";
  if (entry === null) {
    const offTitle = "이 교시 수강 대상이 아닙니다";
    const dash = <span className="text-text-faint text-[13px] font-semibold">—</span>;
    return (
      <>
        <td className={`py-px text-center ${dividerCls}`} title={offTitle}>
          {dash}
        </td>
        <td className="py-px text-center" title={offTitle}>
          {dash}
        </td>
        <td className="py-px text-center" title={offTitle}>
          {dash}
        </td>
        {/* 점수·특이사항은 **잠긴 입력**(값 없음·placeholder —) — 세로 이동(grid-nav)이 이 행을
            '열의 끝'이 아니라 '건너뛸 칸'으로 보게 하는 유일한 방법이다(disabled는 continue, 부재는 종료). */}
        <td className="py-px pr-1" title={offTitle}>
          <input className={`${SHEET_INPUT} text-center`} disabled placeholder="—" aria-label={offTitle} data-nav-col={`ecs-score${navColSuffix}`} data-nav-row={navRow} readOnly value="" />
        </td>
        <td className="py-px" title={offTitle}>
          <input className={SHEET_INPUT} disabled placeholder="—" aria-label={offTitle} data-nav-col={`ecs-note${navColSuffix}`} data-nav-row={navRow} readOnly value="" />
        </td>
      </>
    );
  }
  const rowEditable = canEdit && entry.eligible;
  return (
    <>
      <td className={`py-px ${dividerCls}`}>
        {/* 누를 때마다 출석 → 결석 → 지각 → 선택 안 함(원장 2026-08-11). 사유는 우클릭(순환을 막지 않게). */}
        <AttendanceCheck
          status={att?.status ?? null}
          note={att?.note ?? null}
          studentName={meta?.name ?? ""}
          canMark={canMarkDate && rowEditable}
          onSet={(status, n) => handlers.setAttendance(entry.studentId, date, slotStart, status, n)}
          onClear={() => handlers.clearAttendance(entry.studentId, date, slotStart)}
        />
      </td>
      <td className="px-1 py-px text-center">
        {/* 유닛 = session_units. 결석은 시수를 안 쓰고, 기록이 없으면 값 자체가 없다('—', 원장 "없는 경우 -"). */}
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
        {/* 출결과 같은 체크 순환(원장 2026-08-11 "태도도 마찬가지"). */}
        <AttitudeCheck
          value={mark?.status ?? null}
          studentName={meta?.name ?? ""}
          canEdit={rowEditable}
          onSet={(v) => handlers.saveMark(entry.studentId, date, slotStart, v, mark?.progressNote ?? null)}
        />
      </td>
      <td className="py-px pr-1">
        {/* 점수(0202a) — 태도·특이사항과 **같은 행 하나**를 공유하므로 저장은 같은 액션으로 간다.
            ⚠️ 0202a 미적용이면 서버가 "아직 준비 중"이라 답한다(태도·특이사항 저장은 그대로 산다). */}
        <input
          className={`${SHEET_INPUT} text-center`}
          defaultValue={mark?.score ?? ""}
          disabled={!rowEditable}
          aria-label={`${meta?.name ?? ""} 점수`}
          placeholder="—"
          data-nav-col={`ecs-score${navColSuffix}`}
          data-nav-row={navRow}
          onKeyDown={handleGridNavKey}
          onChange={(e) =>
            handlers.saveMark(
              entry.studentId,
              date,
              slotStart,
              mark?.status ?? null,
              mark?.progressNote ?? null,
              e.target.value,
            )
          }
        />
      </td>
      {/* pr-1 없음 — 주간 표 원본과 동일(옮기며 폭을 바꾸지 않는다). */}
      <td className="py-px">
        <input
          className={SHEET_INPUT}
          defaultValue={mark?.progressNote ?? ""}
          disabled={!rowEditable}
          aria-label={`${meta?.name ?? ""} 특이사항`}
          data-nav-col={`ecs-note${navColSuffix}`}
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
