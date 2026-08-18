"use client";

/**
 * 로스터 **셀 묶음** — 주간 시트(교시별 표, roster-table)와 오늘 면(통합 표, today-roster-table)이
 * **같은 셀 구현**을 쓴다(원장 2026-08-11 "쓸데없이 중복되는 컴포넌트가 다수" — 중복의 처방은 추출).
 *
 *  · `RosterNameCell` — 이름(학생 정보 링크) + 퇴원일, 영어이름은 **둘째 줄**(2026-08-17).
 *  · `RosterSlotCells` — 한 교시분: 출결(체크 순환) · 유닛 · 태도(체크 순환) · **폼별 자유 입력** · 특이사항.
 *    자유 입력 칸은 교시마다 다르다 — 기본은 '시험 점수' 하나, **JJ 교시는 '듣기 레벨'+'누적 암기 단어수'**
 *    (원장 2026-08-13). 구성은 [roster-form](../lib/roster-form.ts) 단일 소스.
 *    entry가 null이면(통합 표에서 그 교시 수강 대상이 아닌 학생) 값 칸 셋은 '—', 입력 칸들(자유 입력·
 *    특이사항)은 **잠긴 입력**으로 비운다 — 잠긴 입력이어야 Enter/↑↓ 세로 이동이 이 행을 건너뛴다
 *    (grid-nav는 '없는 입력'을 열의 끝으로 오판한다 — 적대 리뷰 2026-08-11, #103 계열).
 *
 * 🔴 컨트롤·저장 경로는 주간 표의 것을 **한 글자도 바꾸지 않고** 옮겼다: 출결=AttendanceCheck(누를 때마다
 *    출석→결석→지각→선택 안 함, 우클릭=사유 — 원장 2026-08-11 "클릭형으로 변경. 드랍다운 제거"),
 *    태도=AttitudeCheck, 자유 입력·특이사항=한 마크 행 공유(saveMark), 유닛=SessionUnitsField.
 * ⚠️ 화면에 없는 칸(예: JJ 교시의 시험 점수)은 **서버로 안 보낸다** = 지금 값 유지. 폼이 바뀌었다고
 *    저장된 값을 지우지 않는다(roster-form.ts 규약).
 */
import { schoolGradeLabel } from "@/lib/format/school-grade";
// 사유는 표준 코드(other·schedule…)일 수 있다 — 한글화를 거치지 않으면 raw enum이 화면에 샌다(반복 지적).
import { reasonDisplay } from "@/features/withdrawals/types";
import { WindowLink } from "@/components/workspace/window-link";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import { SessionUnitsField } from "@/features/onescreen/components/attendance-pills";
import type { RosterEntry } from "../lib/grid";
import { rosterTextCols, type RosterForm, type SheetMark } from "../lib/roster-form";
import { attendanceLabelOf } from "../lib/attendance-label";
import {
  withdrawnRecordText,
  withdrawnSummaryText,
  type WithdrawnSlotRecord,
} from "../lib/withdrawn-row";
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

/**
 * 이름 칸 — 클릭=학생 정보(WindowLink, #86). 한글 이름 13px 굵게(원장 2026-08-10 "크기 통일").
 *
 * 영어이름은 **아래 줄 작은 회색 한 줄**이다(원장 2026-08-17 "학생들 영어이름 어떻게 하면 깔끔하게
 * 보이게 할 수 있을려나"). 그전의 괄호 병기("김나윤A (Chloe)")는 좁은 칸에서 "김나윤A (" 다음 줄
 * "Chloe)"로 꺾여 지저분했다 — 이제 truncate(nowrap)라 꺾이지 않고, 잘리면 title 툴팁이 전체를 보인다.
 * ⚠️ 아바타/이니셜 배지 금지(결정 로그) — 이름은 텍스트만.
 */
export function RosterNameCell({ entry, meta }: { entry: RosterEntry; meta: StudentMeta | undefined }) {
  return (
    <td className="py-px pr-1">
      {/* 첫 줄: 한글 이름(+퇴원일). flex+min-w-0라 긴 이름이 truncate로 잘리고 날짜는 안 밀린다. */}
      <div className="flex min-w-0 items-center gap-1">
        <WindowLink
          href={`/students/${entry.studentId}`}
          title={meta?.name}
          className={`min-w-0 truncate text-[13px] font-bold underline-offset-2 hover:underline ${
            entry.historical ? "text-text-dim" : "text-foreground"
          } ${entry.endedOn ? "line-through" : ""}`}
          ariaLabel={meta ? `${meta.name} 학생 정보` : "학생 정보"}
        >
          {/* 학교·학년은 이름 툴팁(학교 열은 2026-08-06에 뺐다 — 정보는 남긴다). */}
          <span title={meta ? `${meta.name} · ${schoolGradeLabel(meta.school, meta.grade)} — 클릭하면 학생 정보` : undefined}>
            {meta?.name ?? "?"}
          </span>
        </WindowLink>
        {entry.isMakeup ? (
          <span
            className="bg-purple/15 text-purple shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            title="이 반 수강생은 아니지만 그날 보강으로 온 학생"
          >
            보강
          </span>
        ) : null}
        {entry.endedOn ? (
          <span className="text-text-dim num shrink-0 text-[13px]" title={`${entry.endedOn} 수강 종료`}>
            {entry.endedOn.slice(5)}
          </span>
        ) : null}
      </div>
      {/* 둘째 줄: 영어이름 — 행 글자 13px 통일 규약의 유일한 예외(보조 표기라 11px dim, ui-box.ts 각주). */}
      {meta?.englishName ? (
        <div className="text-text-dim truncate text-[11px] leading-tight font-semibold" title={meta.englishName}>
          {meta.englishName}
        </div>
      ) : null}
    </td>
  );
}

/**
 * 한 교시분 칸들(출결·유닛·태도·자유 입력 N·특이사항). 폭은 표의 colgroup이 정한다
 * (60·46·80·[폼별]·잔여) — 여기서 폭을 정하지 않는다.
 */
export function RosterSlotCells({
  entry,
  meta,
  date,
  slotStart,
  mark,
  att,
  canMarkDate,
  canNoteDate,
  canEdit,
  handlers,
  navRow,
  form,
  navColSuffix = "",
  withDivider = false,
}: {
  /** null = 이 학생이 이 교시 수강 대상이 아님(통합 표) — 값 칸은 '—', 입력 칸은 잠긴 입력. */
  entry: RosterEntry | null;
  meta: StudentMeta | undefined;
  date: string;
  slotStart: string;
  mark: SheetMark | null;
  att: { status: string; note: string | null; units: number | null; slot: string | null } | null;
  canMarkDate: boolean;
  /**
   * 사유(메모)만 고칠 수 있는가 — 7일 창을 안 보는 값(`canNoteAttendance`). 안 넘기면 `canMarkDate`를
   * 따른다(면제를 배선하지 않은 화면 = 자리 출석부는 종전 동작 그대로).
   */
  canNoteDate?: boolean;
  canEdit: boolean;
  handlers: SheetHandlers;
  /** 키보드 세로 이동(Enter/↑↓) 행 번호 — 보이는 행 기준으로 표가 매긴다. */
  navRow: number;
  /**
   * 이 교시의 입력 폼 — 표(colgroup·머리)와 **같은 값**을 써야 열과 칸이 맞는다.
   * 판정은 `rosterFormOf(slot.teacherLabel)` 한 곳에서(소비처가 각자 추측하지 않는다).
   */
  form: RosterForm;
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
  const textCols = rosterTextCols(form);
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
        {/* 자유 입력·특이사항은 **잠긴 입력**(값 없음·placeholder —) — 세로 이동(grid-nav)이 이 행을
            '열의 끝'이 아니라 '건너뛸 칸'으로 보게 하는 유일한 방법이다(disabled는 continue, 부재는 종료). */}
        {textCols.map((col) => (
          <td key={col.field} className="py-px pr-1" title={offTitle}>
            <input
              className={`${SHEET_INPUT} text-center`}
              disabled
              placeholder="—"
              aria-label={offTitle}
              data-nav-col={`${col.nav}${navColSuffix}`}
              data-nav-row={navRow}
              readOnly
              value=""
            />
          </td>
        ))}
        <td className="py-px" title={offTitle}>
          <input className={SHEET_INPUT} disabled placeholder="—" aria-label={offTitle} data-nav-col={`ecs-note${navColSuffix}`} data-nav-row={navRow} readOnly value="" />
        </td>
      </>
    );
  }
  const rowEditable = canEdit && (entry.eligible || !!entry.isMakeup);
  return (
    <>
      <td className={`py-px ${dividerCls}`}>
        {/* 누를 때마다 출석 → 결석 → 지각 → 선택 안 함(원장 2026-08-11). 사유는 우클릭(순환을 막지 않게). */}
        <AttendanceCheck
          status={att?.status ?? null}
          note={att?.note ?? null}
          studentName={meta?.name ?? ""}
          canMark={canMarkDate && rowEditable}
          canNote={(canNoteDate ?? canMarkDate) && rowEditable}
          onSet={(status, n) => handlers.setAttendance(entry.studentId, date, slotStart, status, n)}
          onClear={() => handlers.clearAttendance(entry.studentId, date, slotStart)}
          onNote={(n) => handlers.setAttendanceNote(entry.studentId, date, slotStart, n)}
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
      {/* 자유 입력 칸(폼별) — 기본은 시험 점수(0202a), JJ는 듣기 레벨·누적 암기 단어수(0206a).
          태도·특이사항과 **같은 마크 행 하나**를 공유하므로 저장은 같은 액션으로 간다.
          ⚠️ 마이그레이션 미적용이면 서버가 "아직 준비 중"이라 답한다(태도·특이사항 저장은 그대로 산다, #95).
          ⚠️ `key`에 폼이 섞이지 않게 field를 쓴다 — 같은 자리에 다른 칸이 오면 React가 defaultValue를
             재사용해 옛 값이 남는다. */}
      {textCols.map((col) => (
        <td key={col.field} className="py-px pr-1">
          <input
            className={`${SHEET_INPUT} text-center`}
            defaultValue={mark?.[col.field] ?? ""}
            disabled={!rowEditable}
            aria-label={`${meta?.name ?? ""} ${col.label}`}
            title={col.title}
            // placeholder 없음 — 텍스트 입력은 **그냥 비워 둔다**(원장 2026-08-13). 빈 상자 자체가
            // "여기 적어라"이고, `—`를 넣으면 값이 적힌 것처럼 보인다([click-hint.ts](../click-hint.ts)).
            data-nav-col={`${col.nav}${navColSuffix}`}
            data-nav-row={navRow}
            onKeyDown={handleGridNavKey}
            onChange={(e) =>
              handlers.saveMark(
                entry.studentId,
                date,
                slotStart,
                mark?.status ?? null,
                mark?.progressNote ?? null,
                // 이 칸 **하나만** 실어 보낸다 — 안 보낸 칸은 서버가 지금 값 그대로 둔다.
                { [col.field]: e.target.value },
              )
            }
          />
        </td>
      ))}
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

/**
 * 퇴원 행 한 칸 분의 **남은 기록**을 요약 문장 재료로 — 화면에서 입력칸을 걷어내도 값은 안 사라지게.
 * (`WithdrawnSummaryRow`가 교시마다 이걸 만들어 [withdrawn-row](../lib/withdrawn-row.ts)에 넘긴다.)
 */
export function withdrawnSlotRecord({
  slotStart,
  form,
  mark,
  att,
}: {
  slotStart: string;
  form: RosterForm;
  mark: SheetMark | null;
  att: { status: string; note: string | null } | null;
}): WithdrawnSlotRecord {
  return {
    slotStart,
    attendance: attendanceLabelOf(att?.status ?? null),
    attendanceNote: att?.note ?? null,
    attitude: mark?.status ?? null,
    progressNote: mark?.progressNote ?? null,
    extras: rosterTextCols(form).map((c) => ({ label: c.label, value: mark?.[c.field] ?? null })),
  };
}

/**
 * **퇴원 섹션의 한 줄** — `이름 · 학교학년 · (퇴원일, 퇴원사유)` (원장 2026-08-18:
 * *"퇴원생은 이름 학교학년만 표시, 뒤에는 필요 없음"* → *"날짜도 있어야겠네"*).
 *
 * 그전엔 이 행에도 출결·유닛·태도·시험 점수·특이사항 칸이 **그려지기만 하고 전부 잠겨** 있었다
 * (`주. 08-18 — — —`). 퇴원 행은 원래 읽기 전용이고 일괄 대상도 아니라(bulk.ts `editableRows`)
 * 그 칸들은 처음부터 **쓸 수 없는 자리**였다 — 그래서 `colSpan`으로 접는다(빈 칸도 남기지 않는다).
 *
 * 🔴 **접는 건 빈 칸이지 기록이 아니다**: 그만두기 직전 주에 찍힌 출결·태도가 남아 있으면 요약 뒤에
 *    읽기 전용 텍스트로 이어 붙인다(값이 화면에서 증발하지 않게 — grid.ts `hiddenSpecial`과 같은 원칙).
 * ⚠️ 여기엔 입력이 하나도 없다 → 세로 이동(grid-nav)이 이 행에서 멈춘다. 퇴원·기록 섹션은 **항상 재원
 *    아래**이고 그 아래 행은 전부 잠긴 칸이라 잃는 이동이 없다(순서는 roster-order.ts가 보장).
 * ⚠️ '기록' 섹션(마크·출석만 남은 행)은 **이 규칙 대상이 아니다** — 거기엔 퇴원일이 없어 요약할 문장이
 *    없고, 원장 지시도 '퇴원'에 대한 것이었다.
 */
export function WithdrawnSummaryRow({
  entry,
  meta,
  colSpan,
  records,
}: {
  entry: RosterEntry;
  meta: StudentMeta | undefined;
  /** 표 한 행의 칸 수 — 주간 표는 `rosterColSpan(form)`, 오늘 통합 표는 교시 합계. */
  colSpan: number;
  /** 이 학생에게 남아 있는 교시별 기록(빈 것은 문장에서 알아서 빠진다). */
  records: readonly WithdrawnSlotRecord[];
}) {
  const summary = withdrawnSummaryText({
    // 압축 표기 "침산중2" — 공백 join 금지(전역 규칙).
    schoolGrade: schoolGradeLabel(meta?.school, meta?.grade),
    endedOn: entry.endedOn,
    reason: reasonDisplay(entry.endedReason),
  });
  const kept = withdrawnRecordText(records);
  const fullReason = reasonDisplay(entry.endedReason);
  return (
    <td colSpan={colSpan} className="py-px pr-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <WindowLink
          href={`/students/${entry.studentId}`}
          title={meta?.name}
          className="text-text-dim shrink-0 text-[13px] font-bold line-through underline-offset-2 hover:underline"
          ariaLabel={meta ? `${meta.name} 학생 정보` : "학생 정보"}
        >
          <span
            title={`${meta?.name ?? ""} · ${entry.endedOn ?? ""} 수강 종료${
              fullReason ? ` · ${fullReason}` : ""
            } — 클릭하면 학생 정보`}
          >
            {meta?.name ?? "?"}
          </span>
        </WindowLink>
        {summary ? <span className="text-text-dim shrink-0 text-[13px]">{summary}</span> : null}
        {/* 남은 기록 — 길면 잘리고 전체는 툴팁에(한 줄 요약이 두 줄로 부풀지 않게). */}
        {kept ? (
          <span className="text-text-dim min-w-0 truncate text-[13px]" title={kept}>
            · {kept}
          </span>
        ) : null}
      </div>
    </td>
  );
}
