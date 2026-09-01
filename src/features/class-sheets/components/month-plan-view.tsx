"use client";

import { useMemo } from "react";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { cellDateOf } from "../lib/month";
import {
  MP_COLUMN_HINT,
  MP_COLUMN_LABEL,
  MP_DOW_LABEL_EN,
  mpCellKey,
  mpColumnsForDow,
  mpDayIsOff,
  mpOffOverrideOf,
  type MpCell,
  type MpColumnKind,
} from "../lib/month-plan";
import {
  MP_STATUS_HINT,
  MP_STATUS_LABEL,
  MP_STATUS_TONE,
  mpActualSummary,
  mpCompareDay,
  mpLinesOfDate,
} from "../lib/month-plan-compare";
import { dowKeyOf, type DowKey } from "../lib/week";
import { SHEET_TEXTAREA } from "../ui-box";
import type { ClassSheetMonthData } from "../server/month-queries";

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * ECS **계획(MP)** 보기 — 미리 쓰는 월간 계획서와 실제 진도의 대조 화면.
 *
 * 원장 2026-09-01: *"미리 입력하는 월간 뷰와, 실제로 수업진행하면서 입력하는 주간뷰를 비교할 수 있게
 * 하려고 함. 그래서 과연 진도가 제대로 나가고 있는지도 점검하기 위해서임."*
 *
 * 표의 골격은 **원본 구글 시트 그대로**다 — 열은 그 반이 실제로 도는 요일뿐이고, 요일마다 열 구성이
 * 다르며(화요일만 e-book), 행은 주 단위다. 그 규칙은 전부 [`lib/month-plan`](../lib/month-plan.ts)에
 * 있고 여기는 그리기만 한다.
 *
 * 🔴 **대조·경고는 이 화면에만 있다** — 인쇄물은 학부모 문서라 신호를 싣지 않는다.
 * 🔴 **판정은 [`mpCompareDay`](../lib/month-plan-compare.ts) 한 곳**이다(칸 테두리·배지·툴바 숫자가
 *    같은 답을 내야 한다 — 달력의 `goal-match`가 같은 이유로 단일 소스다).
 */
export function MonthPlanView({
  data,
  cells,
  showActual,
  canEdit,
  onCell,
  onEbookColumn,
  onDayOff,
}: {
  data: ClassSheetMonthData;
  /** `YYYY-MM-DD|col_kind` → 내용(빈 문자열 가능 — 그 칸이 섰다는 뜻). */
  cells: Record<string, string>;
  showActual: boolean;
  canEdit: boolean;
  onCell: (date: string, colKind: MpColumnKind, body: string) => void;
  onEbookColumn: (dates: string[], show: boolean) => void;
  onDayOff: (date: string, off: boolean) => void;
}) {
  const cellList: MpCell[] = useMemo(
    () =>
      Object.entries(cells).map(([key, body]) => {
        const [planDate, colKind] = key.split("|");
        return {
          planDate: planDate!,
          colKind: colKind as MpCell["colKind"],
          body,
        };
      }),
    [cells],
  );

  const monthDates = useMemo(() => data.weeks.flatMap((w) => w.dates), [data.weeks]);
  const isOff = (date: string) => mpDayIsOff(date, data.holidays, mpOffOverrideOf(cells, date));
  const hasClassOn = (date: string) => (data.slotsByDate[date]?.length ?? 0) > 0;

  /** 요일별 열 구성 — 그 요일에 ebook 칸이 하나라도 있으면 4열(저장하지 않고 파생). */
  const columnsByDow = useMemo(() => {
    const out = {} as Record<DowKey, MpColumnKind[]>;
    for (const dow of data.dows) out[dow] = mpColumnsForDow(dow, monthDates, cellList);
    return out;
  }, [data.dows, monthDates, cellList]);

  /** 그 요일의 **수업일 전부**(열 추가/숨기기가 한 요일을 통째로 다룬다). */
  const classDatesOfDow = (dow: DowKey) => monthDates.filter((d) => dowKeyOf(d) === dow && hasClassOn(d));

  /**
   * e-book 열 세우기/내리기.
   * 🔴 **내릴 땐 적어 둔 내용이 함께 사라진다** — 되돌릴 수 없으므로 내용이 있으면 먼저 묻는다
   *    (칸을 비우는 것과 열을 내리는 것은 다른 결심이다).
   */
  const toggleEbook = (dow: DowKey, hasEbook: boolean) => {
    const dates = classDatesOfDow(dow);
    if (hasEbook) {
      const written = dates.filter((d) => (cells[mpCellKey(d, "ebook")] ?? "").trim() !== "").length;
      if (
        written > 0 &&
        !window.confirm(
          `${MP_DOW_LABEL_EN[dow]}의 e-book 열을 내리면 적어 둔 ${written}칸이 함께 지워집니다. 계속할까요?`,
        )
      ) {
        return;
      }
    }
    onEbookColumn(dates, !hasEbook);
  };

  const linesOfDate = (date: string) => mpLinesOfDate(data, date);

  const verdictOf = (date: string) =>
    mpCompareDay({ date, cells, lines: linesOfDate(date), isOff: isOff(date) });

  if (data.dows.length === 0) {
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        이 달에는 이 반의 배정된 수업이 없습니다 — 계획을 적을 날짜가 없습니다.
      </p>
    );
  }

  // 수업이 하루도 없는 주는 행을 만들지 않는다(달력 보기와 같은 규칙 — 빈 띠가 서지 않게).
  const weeks = data.weeks.filter((w) => w.dates.some(hasClassOn));

  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="border-line-faint bg-bg-soft sticky left-0 z-[4] w-[52px] min-w-[52px] border-r border-b px-2 py-1.5 text-[11.5px] font-bold shadow-[1px_0_0_var(--line)]"
            >
              주
            </th>
            {data.dows.map((dow) => {
              const cols = columnsByDow[dow];
              const hasEbook = cols.includes("ebook");
              return (
                <th
                  key={dow}
                  colSpan={cols.length}
                  className="border-line-faint border-r border-b px-2 py-1.5 text-[12px] font-extrabold"
                >
                  <span className="inline-flex items-center gap-2">
                    {/* 요일 표기는 원본 시트 그대로 영문 — 학부모 인쇄물과 화면이 같은 글자를 쓴다. */}
                    <span>{MP_DOW_LABEL_EN[dow]}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-pressed={hasEbook}
                        onClick={() => toggleEbook(dow, hasEbook)}
                        title={
                          hasEbook
                            ? "이 요일의 e-book 열을 내립니다(적어 둔 내용도 함께 지워집니다)"
                            : "이 요일에 e-book 열을 세웁니다"
                        }
                        className="border-line-strong text-text-dim hover:bg-bg-soft cursor-pointer rounded-full border px-1.5 py-px text-[10.5px] font-bold"
                      >
                        {hasEbook ? "e-book 열 내리기" : "+ e-book 열"}
                      </button>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
          <tr>
            {data.dows.flatMap((dow) =>
              columnsByDow[dow].map((col, i) => (
                <th
                  key={`${dow}:${col}`}
                  title={MP_COLUMN_HINT[col]}
                  className={`bg-bg-soft border-line-faint min-w-[124px] border-b px-2 py-1 text-[11px] font-bold ${
                    i === columnsByDow[dow].length - 1 ? "border-r" : ""
                  }`}
                >
                  {MP_COLUMN_LABEL[col]}
                </th>
              )),
            )}
          </tr>
        </thead>
        {/* ⚠️ 주마다 `<tbody>` 하나 — 한 주가 2~3행이라 `<tbody>`를 겹치면 안 되고(중첩은 무효 HTML),
            여러 개를 나란히 두는 것은 표준이다. 주 라벨의 rowSpan이 그 안에서만 걸린다. */}
        {weeks.map((week) => {
          const rows = showActual ? 3 : 2;
          return (
            <tbody key={week.monday}>
              <tr>
                <td
                  rowSpan={rows}
                  className="border-line-faint bg-bg-soft sticky left-0 z-[3] border-r border-b px-2 py-1 text-center text-[11.5px] font-bold shadow-[1px_0_0_var(--line)]"
                >
                  <span className="num">{week.index}</span>주
                </td>
                {data.dows.map((dow) => {
                  const cols = columnsByDow[dow];
                  const date = cellDateOf(week, dow, data.month);
                  const teaches = date ? hasClassOn(date) : false;
                  const off = date ? isOff(date) : false;
                  const holidayName = date ? data.holidays[date] : undefined;
                  const v = date && teaches ? verdictOf(date) : null;
                  const tone = v ? MP_STATUS_TONE[v.status] : null;
                  return (
                    <td
                      key={dow}
                      colSpan={cols.length}
                      className={`border-line-faint border-r border-b px-2 py-1 ${off ? "bg-bg-soft" : ""}`}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={`num text-[12px] font-bold ${teaches ? "" : "text-text-faint"}`}>
                          {date ? monthDay(date) : "—"}
                        </span>
                        {date && !teaches ? (
                          <span className="text-text-faint text-[10.5px]">수업 없음</span>
                        ) : null}
                        {holidayName ? (
                          <span
                            className={`rounded-pill px-1.5 py-px text-[10px] font-bold ${TONE_SOFT.inert}`}
                          >
                            {holidayName}
                          </span>
                        ) : null}
                        {v && tone && v.status !== "ok" && v.status !== "empty" ? (
                          <span
                            title={MP_STATUS_HINT[v.status]}
                            className={`rounded-pill px-1.5 py-px text-[10px] font-bold ${TONE_SOFT[tone]}`}
                          >
                            {MP_STATUS_LABEL[v.status]}
                          </span>
                        ) : null}
                        {date && teaches && canEdit ? (
                          <button
                            type="button"
                            aria-pressed={off}
                            onClick={() => onDayOff(date, !off)}
                            title={
                              off
                                ? "이 날 수업을 되살립니다(인쇄에도 다시 나옵니다)"
                                : "이 날을 휴강으로 표시합니다(인쇄에서 빠집니다)"
                            }
                            className="border-line-strong text-text-dim hover:bg-bg-soft ml-auto cursor-pointer rounded-full border px-1.5 py-px text-[10px] font-bold"
                          >
                            {off ? "수업함으로" : "휴강"}
                          </button>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
              <tr>
                {data.dows.flatMap((dow) => {
                  const date = cellDateOf(week, dow, data.month);
                  const teaches = date ? hasClassOn(date) : false;
                  const off = date ? isOff(date) : false;
                  const cols = columnsByDow[dow];
                  const v = date && teaches && !off ? verdictOf(date) : null;
                  // 🔴 칸에 테두리를 주는 신호는 **'교재 다름' 하나뿐**이다. '미작성'은 이 칸이 아니라
                  //    주간 시트를 고쳐야 하는 일이라, 계획 칸을 칠하면 엉뚱한 곳을 가리킨다
                  //    (그 사실은 날짜 줄 배지가 이미 말한다).
                  const warnBook = v?.status === "off-book";
                  return cols.map((col, i) => (
                    <td
                      key={`${dow}:${col}:${week.monday}`}
                      className={`border-line-faint border-b p-1 align-top ${
                        i === cols.length - 1 ? "border-r" : ""
                      } ${off || !teaches ? "bg-bg-soft" : ""} ${
                        // 테두리는 **In-class 칸에만** — 대조의 근거가 그 칸이라, 네 칸을 다 칠하면
                        // 어디를 고쳐야 하는지가 사라진다.
                        warnBook && col === "in_class" ? "shadow-[inset_0_0_0_1px_var(--amber)]" : ""
                      }`}
                    >
                      {date && teaches ? (
                        <textarea
                          className={`${SHEET_TEXTAREA} min-h-[52px]`}
                          rows={3}
                          spellCheck={false}
                          disabled={!canEdit || off}
                          value={cells[mpCellKey(date, col)] ?? ""}
                          onChange={(e) => onCell(date, col, e.target.value)}
                          aria-label={`${monthDay(date)} ${MP_COLUMN_LABEL[col]}`}
                          title={MP_COLUMN_HINT[col]}
                        />
                      ) : null}
                    </td>
                  ));
                })}
              </tr>
              {showActual ? (
                <tr>
                  {data.dows.map((dow) => {
                    const cols = columnsByDow[dow];
                    const date = cellDateOf(week, dow, data.month);
                    const teaches = date ? hasClassOn(date) : false;
                    const summary = date && teaches ? mpActualSummary(linesOfDate(date)) : [];
                    return (
                      <td
                        key={`actual:${dow}:${week.monday}`}
                        colSpan={cols.length}
                        className="border-line-faint bg-bg-soft/60 border-r border-b px-2 py-1 align-top"
                      >
                        <span className="text-text-faint mr-1.5 text-[10px] font-bold">실제</span>
                        {summary.length === 0 ? (
                          <span className="text-text-faint text-[11px]">
                            {date && teaches ? "기록 없음" : ""}
                          </span>
                        ) : (
                          <span className="text-text-dim text-[11px]">{summary.join(" / ")}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
