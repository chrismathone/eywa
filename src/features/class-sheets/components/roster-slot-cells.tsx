"use client";

/**
 * 로스터 **셀 묶음** — 주간 시트(교시별 표, roster-table)와 오늘 면(통합 표, today-roster-table)이
 * **같은 셀 구현**을 쓴다(원장 2026-08-11 "쓸데없이 중복되는 컴포넌트가 다수" — 중복의 처방은 추출).
 *
 *  · `RosterNameCell` — 학생 정보 링크·영문 이름 편집. 영어 화면은 이름 / 학교학년의 두 줄.
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
import { SplitBadge } from "./split-badge";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
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
import { NoteCell } from "./note-cell";
// 강사뷰 화면 언어(2026-09-03) — 영어 모드에서 학생 영어 이름이 주 이름이 된다(표시 전용).
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { studentNameParts } from "@/features/teacher-view/student-name";
import { EnglishNameEditor } from "./english-name-editor";
import { useStudentEnglishName } from "./english-name-context";
import type { SheetHandlers } from "./sheet-client";

export type StudentMeta = {
  name: string;
  school: string | null;
  grade: string | null;
  englishName: string | null;
};

/**
 * 이름 칸 — 클릭=학생 정보(WindowLink, #86). 이름 13px 굵게(원장 2026-08-10 "크기 통일").
 *
 * 영어 화면: 영문 이름(없으면 한글 이름) / 영문 학교·학년의 두 줄(2026-10-07).
 * 한국어 화면: 이름/학교학년 + 보조 영문 이름의 기존 표기 유지.
 * 영문 이름은 전용 권한이 있으면 더블클릭 또는 F2로 수정한다.
 */
export function RosterNameCell({ entry, meta }: { entry: RosterEntry; meta: StudentMeta | undefined }) {
  // 🔴 주/보조 이름 판정은 [`studentNameParts`](@/features/teacher-view/student-name) **한 곳**이다 —
  //    화면마다 `lang === "en" ? …`를 적으면 한쪽만 고쳐진다. 여기선 그 결과를 그리기만 한다.
  const lang = useSheetLang();
  const t = useSheetT();
  const english = useStudentEnglishName(entry.studentId, meta?.englishName ?? null);
  const names = studentNameParts(meta?.name, english.value, lang);
  // 없으면 빈 문자열 — 아래에서 슬래시째 안 그린다.
  const schoolGrade = sheetSchoolGrade(meta?.school, meta?.grade, lang);
  const schoolParts = /^(.*?)( (?:Girls’ )?(?:ES|MS|HS)\d*)$/.exec(schoolGrade);
  const editPrimary = lang === "en" || !english.value?.trim();
  const nameLink = (
    <WindowLink href={`/students/${entry.studentId}`} title={meta?.name}
      className={`max-w-full shrink-0 truncate text-sm font-bold underline-offset-2 hover:underline ${
        entry.historical ? "text-text-dim" : "text-foreground"
      } ${entry.endedOn ? "line-through" : ""}`}
      ariaLabel={sheetTf(lang, "studentEnglishName.detailsAria", { name: names.primary })}>
      <span title={meta ? `${names.primary || meta.name}${schoolGrade ? ` · ${schoolGrade}` : ""} — ${
        english.enabled && editPrimary ? t("studentEnglishName.editHint") : t("studentEnglishName.detailsHint")
      }` : undefined}>{names.primary || "?"}</span>
    </WindowLink>
  );
  return (
    <td className="py-px pr-1">
      {/* 첫 줄: 이름 + /학교학년 (+퇴원일). flex+min-w-0라 학교학년이 truncate로 잘리고 날짜는 안 밀린다. */}
      <div className="flex min-w-0 items-center gap-1">
        {/* 이름과 학교학년은 **한 덩어리**(사이 간격 0) — `김원중/경명여중3`이 한 낱말로 읽혀야 한다. */}
        <span className="flex min-w-0 items-center">
          {editPrimary && meta ? (
            <EnglishNameEditor studentId={entry.studentId} studentName={meta.name} englishName={meta.englishName}>
              {nameLink}
            </EnglishNameEditor>
          ) : nameLink}
          {/* 보조 표기라 한 단계 작게(둘째 줄 영어이름과 같은 위계). ⚠️ `text-text-dim`은 지금
              `--foreground`와 **같은 색**이다(2026-09-08 글자색 통일) — 색으로 위계를 만들지 못하니
              크기·굵기가 그 일을 한다. 토큰을 `text-text-faint` 등으로 바꿔도 결과는 같다. */}
          {lang !== "en" && schoolGrade ? (
            <span
              className="text-text-dim min-w-0 truncate text-xs font-semibold"
              title={`${names.primary}/${schoolGrade}`}
            >
              /{schoolGrade}
            </span>
          ) : null}
        </span>
        <SplitBadge split={entry.split} />
        {entry.endedOn ? (
          <span className="text-text-dim num shrink-0 text-sm" title={sheetTf(lang, "roster.endedTitle", { date: entry.endedOn })}>
            {entry.endedOn.slice(5)}
          </span>
        ) : null}
      </div>
      {/* 영어 화면은 이름 한 개 + 학교·학년의 두 줄(2026-10-07). */}
      {lang === "en" && schoolGrade ? (
        <div className="text-text-dim flex min-w-0 gap-1 text-xs leading-tight font-semibold" title={schoolGrade}>
          {schoolParts ? <><span className="min-w-0 truncate">{schoolParts[1]}</span>{" "}<span className="shrink-0">{schoolParts[2].trim()}</span></> : <span className="truncate">{schoolGrade}</span>}
        </div>
      ) : lang !== "en" && names.secondary && meta ? (
        <EnglishNameEditor studentId={entry.studentId} studentName={meta.name} englishName={meta.englishName}>
          <span tabIndex={english.enabled ? 0 : undefined} className="text-text-dim block truncate text-xs leading-tight font-semibold" title={english.enabled ? t("studentEnglishName.editHint") : names.secondary}>
            {names.secondary}
          </span>
        </EnglishNameEditor>
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
  // 화면 언어 — 이 칸들의 툴팁·접근성 이름도 사전을 거친다(하드코딩된 한국어를 남기지 않는다).
  const lang = useSheetLang();
  // 🔑 `ecs-slot-edge`는 **스타일이 없는 표식 클래스**다 — 통합 표(today-roster-table)가 표 한 곳에서 거는
  //    옅은 열 구분선(`border-l-line-faint`)을 이 칸에서만 빼내려고 쓴다. 안 빼면 side 유틸이 이겨서
  //    (design-conventions "데이터 표": 셀이 전면 색을 가져도 `border-l-*`가 이긴다) **교시 경계의 진한
  //    선이 옅은 선으로 덮인다** — 위층 계획 카드와 아래층 명단을 잇는 그 선이 이 표의 뼈대다.
  const dividerCls = withDivider ? "ecs-slot-edge border-line-strong border-l" : "";
  const textCols = rosterTextCols(form);
  if (entry === null) {
    const offTitle = sheetT(lang, "roster.notEnrolled");
    const dash = <span className="text-text-faint text-sm font-semibold">—</span>;
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
          onRemoveMakeup={
            entry.isMakeup ? () => handlers.removeMakeup(entry.studentId, date) : undefined
          }
        />
      </td>
      <td className="px-1 py-px text-center">
        {/* 유닛 = session_units. 결석은 시수를 안 쓰고, 기록이 없으면 값 자체가 없다('—', 원장 "없는 경우 -"). */}
        {att?.status === "absent" ? (
          <span
            className="text-text-faint text-sm font-semibold"
            title={sheetT(lang, "roster.unitsOnAbsent")}
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
          <span className="text-text-faint text-sm font-semibold">—</span>
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
            aria-label={sheetTf(lang, "roster.cellAria", {
              name: meta?.name ?? "",
              field: sheetT(lang, col.labelKey),
            })}
            title={sheetT(lang, col.titleKey)}
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
      {/* 특이사항 — 열은 좁고(80%, 원장 2026-08-28) 적을 때만 스티커 메모처럼 펼쳐진다.
          ⚠️ 여기서 다시 맨 `<input>`으로 되돌리지 말 것: 좁힌 열 폭의 보상이 그 펼침이다. */}
      <NoteCell
        defaultValue={mark?.progressNote ?? ""}
        disabled={!rowEditable}
        label={`${meta?.name ?? ""} 특이사항`}
        navCol={`ecs-note${navColSuffix}`}
        navRow={navRow}
        onChange={(next) =>
          handlers.saveMark(entry.studentId, date, slotStart, mark?.status ?? null, next)
        }
      />
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
  lang,
}: {
  slotStart: string;
  form: RosterForm;
  mark: SheetMark | null;
  att: { status: string; note: string | null } | null;
  /** 화면 언어 — 출결 라벨·자유 입력 칸 이름이 표 머리와 **같은 낱말**이어야 한다. */
  lang: SheetLang;
}): WithdrawnSlotRecord {
  return {
    slotStart,
    attendance: attendanceLabelOf(att?.status ?? null, lang),
    attendanceNote: att?.note ?? null,
    attitude: mark?.status ?? null,
    progressNote: mark?.progressNote ?? null,
    extras: rosterTextCols(form).map((c) => ({
      label: sheetT(lang, c.labelKey),
      value: mark?.[c.field] ?? null,
    })),
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
  const lang = useSheetLang();
  const summary = withdrawnSummaryText({
    // 압축 표기 "침산중2" — 공백 join 금지(전역 규칙).
    schoolGrade: sheetSchoolGrade(meta?.school, meta?.grade, lang),
    endedOn: entry.endedOn,
    reason: reasonDisplay(entry.endedReason, lang),
  });
  const kept = withdrawnRecordText(records, {
    reason: sheetT(lang, "withdrawn.reason"),
    attitude: sheetT(lang, "withdrawn.attitude"),
  });
  const fullReason = reasonDisplay(entry.endedReason, lang);
  return (
    <td colSpan={colSpan} className="py-px pr-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <WindowLink
          href={`/students/${entry.studentId}`}
          title={meta?.name}
          className="text-text-dim shrink-0 text-sm font-bold line-through underline-offset-2 hover:underline"
          ariaLabel={sheetTf(lang, "studentEnglishName.detailsAria", { name: meta?.name ?? "" })}
        >
          <span
            title={`${meta?.name ?? ""} · ${sheetTf(lang, "roster.endedTitle", { date: entry.endedOn ?? "" })}${
              fullReason ? ` · ${fullReason}` : ""
            } — ${sheetT(lang, "studentEnglishName.detailsHint")}`}
          >
            {meta?.name ?? "?"}
          </span>
        </WindowLink>
        {summary ? <span className="text-text-dim shrink-0 text-sm">{summary}</span> : null}
        {/* 남은 기록 — 길면 잘리고 전체는 툴팁에(한 줄 요약이 두 줄로 부풀지 않게). */}
        {kept ? (
          <span className="text-text-dim min-w-0 truncate text-sm" title={kept}>
            · {kept}
          </span>
        ) : null}
      </div>
    </td>
  );
}
