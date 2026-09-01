import { cellDateOf } from "@/features/class-sheets/lib/month";
import {
  MP_COLUMN_LABEL,
  MP_DOW_LABEL_EN,
  mpActiveDates,
  mpCellKey,
  mpCellMapOf,
  mpColumnsForDow,
  mpDayIsOff,
  mpOffOverrideOf,
} from "@/features/class-sheets/lib/month-plan";
import { dowKeyOf, type DowKey } from "@/features/class-sheets/lib/week";
import { monthPlanLines } from "@/features/owner/month-plan-texts";
import type { MonthPlanPrintData } from "@/features/class-sheets/server/month-plan-print";

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 월간 계획서 종이 — **원본 구글 시트와 같은 모양**(머리말 · 교재 약어 범례 · 안내 · 주 블록 · 꼬리말).
 *
 * 🔴 신호(미작성·교재 다름)·작성률·실제 진도는 **한 줄도 싣지 않는다** — 학부모 문서다.
 * 🔴 휴강으로 표시한 날은 **열이 통째로 빠진다**(시트가 9/25 추석을 아예 안 그리는 것과 같다).
 *    그래서 요일마다 "그 요일에 살아 있는 날"을 먼저 세고, 하나도 없으면 그 요일 열 자체를 안 세운다.
 * ⚠️ 머리말·꼬리말 문구는 **학원설정**(`operations.subjects[].monthPlan`)이 단일 소스다 —
 *    빈 항목은 블록째 생략한다(빈 제목만 덩그러니 서지 않게).
 */
export function MonthPlanPaper({ data }: { data: MonthPlanPrintData }) {
  const { month, texts, teacherLabel, periodRange } = data;
  const cells = mpCellMapOf(month.mp.cells);
  const cellList = month.mp.cells;

  const hasClassOn = (date: string) => (month.slotsByDate[date]?.length ?? 0) > 0;
  const isOff = (date: string) => mpDayIsOff(date, month.holidays, mpOffOverrideOf(cells, date));
  const liveOn = (date: string) => hasClassOn(date) && !isOff(date);

  const allDates = month.weeks.flatMap((w) => w.dates);
  // 이 달에 실제로 인쇄될 날 — 배정이 있고 휴강이 아닌 날(판정은 lib/month-plan 한 곳).
  const liveDates = mpActiveDates(allDates, hasClassOn, isOff);
  // 🔴 휴강만 남은 요일은 열을 세우지 않는다 — 시트가 그 열을 통째로 빼는 것과 같은 규칙.
  const dows: DowKey[] = month.dows.filter((dow) => liveDates.some((d) => dowKeyOf(d) === dow));
  const columnsByDow = Object.fromEntries(
    dows.map((dow) => [dow, mpColumnsForDow(dow, allDates, cellList)]),
  ) as Record<DowKey, ReturnType<typeof mpColumnsForDow>>;

  const weeks = month.weeks.filter((w) => w.dates.some(liveOn));
  const notices = monthPlanLines(texts.notices);
  const prepNotes = monthPlanLines(texts.prepNotes);

  if (dows.length === 0 || weeks.length === 0) {
    return (
      <p className="text-[13px] text-black">
        {month.className} · {month.monthLabel} — 인쇄할 수업일이 없습니다.
      </p>
    );
  }

  return (
    <article className="text-black">
      {/* @page 가로 A4 — 요일 3개 × 최대 4열이 세로 폭에 안 들어간다. */}
      <style>{"@page { size: A4 landscape; margin: 12mm; }"}</style>

      <header className="mb-3 flex items-baseline gap-3">
        <h1 className="flex-1 text-center text-[19px] font-extrabold">
          {month.className} ({month.monthLabel})
        </h1>
        {teacherLabel ? <span className="text-[13px] font-bold">{teacherLabel}</span> : null}
      </header>

      {(texts.bookLegend.trim() || notices.length > 0) && (
        <div className="mb-3 flex items-start gap-4">
          <div className="flex-1 space-y-0.5">
            {notices.map((n, i) => (
              <p key={i} className="text-center text-[11.5px]">
                {n}
              </p>
            ))}
          </div>
          {texts.bookLegend.trim() ? (
            <p className="w-[52mm] shrink-0 text-right text-[11px] leading-snug whitespace-pre-line">
              {texts.bookLegend}
            </p>
          ) : null}
        </div>
      )}

      <table className="w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          <col style={{ width: "14mm" }} />
          {dows.flatMap((dow) => columnsByDow[dow].map((c) => <col key={`${dow}:${c}`} />))}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className="border border-black px-1 py-1 text-[11px] font-bold">
              Day
            </th>
            {dows.map((dow) => (
              <th
                key={dow}
                colSpan={columnsByDow[dow].length}
                className="border border-black px-1 py-1 text-[12px] font-extrabold"
              >
                {MP_DOW_LABEL_EN[dow]}
              </th>
            ))}
          </tr>
          <tr>
            {dows.flatMap((dow) =>
              columnsByDow[dow].map((col) => (
                <th key={`${dow}:${col}`} className="border border-black px-1 py-0.5 text-[10.5px] font-bold">
                  {MP_COLUMN_LABEL[col]}
                </th>
              )),
            )}
          </tr>
        </thead>
        {weeks.map((week) => (
          <tbody key={week.monday} className="break-inside-avoid">
            <tr>
              <th className="border border-black px-1 py-0.5 text-[10.5px] font-bold">Date</th>
              {dows.map((dow) => {
                const date = cellDateOf(week, dow, month.month);
                const live = date ? liveOn(date) : false;
                return (
                  <td
                    key={`d:${dow}`}
                    colSpan={columnsByDow[dow].length}
                    className="border border-black px-1 py-0.5 text-center text-[11px] font-bold"
                  >
                    {live && date ? monthDay(date) : ""}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th className="border border-black px-1 py-1 text-[10.5px] font-bold">
                Week <span className="num">{week.index}</span>
              </th>
              {dows.flatMap((dow) => {
                const date = cellDateOf(week, dow, month.month);
                const live = date ? liveOn(date) : false;
                return columnsByDow[dow].map((col) => (
                  <td
                    key={`c:${dow}:${col}`}
                    className="h-[22mm] border border-black px-1 py-1 align-top text-[11px] leading-snug whitespace-pre-line"
                  >
                    {live && date ? (cells[mpCellKey(date, col)] ?? "") : ""}
                  </td>
                ));
              })}
            </tr>
          </tbody>
        ))}
      </table>

      <footer className="mt-3 space-y-1 text-[11.5px]">
        {periodRange ? (
          <p className="text-center font-bold">
            {month.monthLabel} 세션 : {periodRange}
          </p>
        ) : null}
        {texts.prepTitle.trim() ? <p className="text-center font-bold">{texts.prepTitle}</p> : null}
        {prepNotes.map((n, i) => (
          <p key={i} className="text-[11px]">
            {n}
          </p>
        ))}
      </footer>
    </article>
  );
}
