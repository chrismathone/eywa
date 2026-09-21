import { cellDateOf } from "@/features/class-sheets/lib/month";
import {
  MP_COLUMN_LABEL,
  MP_DOW_LABEL_EN,
  MP_LOGO_SRC,
  mpActiveDates,
  mpCellKey,
  mpCellMapOf,
  mpColumnsForDow,
  mpDayIsOff,
  mpDayKindOf,
  mpDocTitle,
  mpOffLabel,
  mpOffOverrideOf,
  mpResolveFooter,
  mpSessionLine,
  mpTitleLines,
} from "@/features/class-sheets/lib/month-plan";
import {
  MP_SHEET_COLOR,
  MP_SHEET_FONT,
  MP_SHEET_LEADING,
  MP_SHEET_OUTER,
  MP_SHEET_PX,
  MP_SHEET_SIZE,
  mpDocWidth,
  mpBandCellStyle,
  mpGridBorder,
  mpHeadCellStyle,
  mpOffBandCellStyle,
  mpOffValueCellStyle,
  mpTitleNameStyle,
  mpTitlePeriodStyle,
  mpTitleStyle,
  mpValueCellStyle,
} from "@/features/class-sheets/lib/month-plan-sheet-style";
import { mpFitTitle, mpTitleBoxPx } from "@/features/class-sheets/lib/month-plan-title-fit";
import type { DowKey } from "@/features/class-sheets/lib/week";
import { defaultMonthPlanFooter, monthPlanLines } from "@/features/owner/month-plan-texts";
import type { MonthPlanPrintData } from "@/features/class-sheets/server/month-plan-print";

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 월간 계획서 종이 — **원본 구글 시트를 그대로 복제한 문서**.
 *
 * 원장 2026-09-01: *"글씨체부터 하나하나 그대로 카피해올것"* — 색·글꼴·글자 크기·테두리 두께는
 * [`month-plan-sheet-style`](@/features/class-sheets/lib/month-plan-sheet-style.ts) 단일 소스이고,
 * 그 값은 시트가 내려주는 CSS에서 뽑았다. **여기에 색·pt를 다시 적지 말 것.**
 *
 * 🔴 신호(미작성·교재 다름)·작성률·실제 진도는 **한 줄도 싣지 않는다** — 학부모 문서다.
 * 🔴 **열 라벨은 주 블록마다 다시 그린다**(시트 그대로). 그래서 그 주에 이 반 수업이 없는 요일은
 *    **그 주에서만** 라벨이 사라진다(배정이 달 중간에 시작·종료한 요일).
 * 🔴 **휴강은 감추지 않고 회색으로 표시한다**(원장 2026-09-02 — 그전엔 그 날이 통째로 빈 칸이라
 *    "아직 안 적은 평일"과 구분되지 않았다). 격자·열 수·저장 경로는 평일과 같다.
 * 🔴 격자 범위(요일·주)를 계획(MP) 화면과 **같은 규칙**으로 잡는다 — 화면은 배정만 보고, 인쇄는
 *    휴강까지 빼고 있었다. 그래서 화면엔 있는 주가 인쇄에선 통째로 사라졌다.
 * ⚠️ 머리말·꼬리말 문구는 **학원설정**이 단일 소스이고, 계획(MP) 화면이 같은 값을 읽는다
 *    (`getMonthPlanChrome`) — 두 문서가 갈리지 않는다.
 */
export function MonthPlanPaper({ data }: { data: MonthPlanPrintData }) {
  const { month, texts, teacherLabel, periodRange } = data;
  const cells = mpCellMapOf(month.mp.cells);
  const cellList = month.mp.cells;

  const hasClassOn = (date: string) => (month.slotsByDate[date]?.length ?? 0) > 0;
  const isOff = (date: string) => mpDayIsOff(date, month.holidays, mpOffOverrideOf(cells, date));
  const kindOf = (date: string | null) =>
    mpDayKindOf(date, date ? hasClassOn(date) : false, date ? isOff(date) : false);

  const allDates = month.weeks.flatMap((w) => w.dates);
  // 🔴 격자 범위는 **배정만** 본다(휴강은 빼지 않는다) — 계획(MP) 화면과 **글자 그대로 같은 두 줄**이라야
  //    같은 달이 두 문서에서 같은 모양으로 선다. 그전엔 인쇄만 휴강을 빼서, 화면엔 있는 주·요일이
  //    인쇄물에선 통째로 사라졌다(원장 2026-09-02).
  const dows: DowKey[] = month.dows;
  const columnsByDow = Object.fromEntries(
    dows.map((dow) => [dow, mpColumnsForDow(dow, allDates, cellList)]),
  ) as Record<DowKey, ReturnType<typeof mpColumnsForDow>>;

  const weeks = month.weeks.filter((w) => w.dates.some(hasClassOn));
  // 실제로 수업하는 날이 하나도 없으면(전부 휴강) 표를 그리는 대신 그 사실을 적는다.
  const liveDates = mpActiveDates(allDates, hasClassOn, isOff);
  const notices = monthPlanLines(texts.notices);
  const legend = monthPlanLines(texts.bookLegend);
  // 꼬리말은 **반이 적은 것이 이긴다**(0240a) — 안 적었으면 학원설정 기본값.
  const footerText = mpResolveFooter(cells, month.month, defaultMonthPlanFooter(texts));
  const sessionLine = mpSessionLine(month.month, periodRange);

  if (dows.length === 0 || weeks.length === 0) {
    return (
      <p className="text-[13px] text-black">
        {month.className} · {month.monthLabel} — 인쇄할 수업일이 없습니다.
      </p>
    );
  }
  if (liveDates.length === 0) {
    return (
      <p className="text-[13px] text-black">
        {month.className} · {month.monthLabel} — 이 달은 수업일이 전부 휴강입니다.
      </p>
    );
  }

  const bodyFont = { fontFamily: MP_SHEET_FONT.body, fontSize: MP_SHEET_SIZE.body } as const;
  // 머리말과 표의 오른쪽 끝을 맞춘다 — 머리말은 flex라 안 박으면 종이 폭을 다 먹는다.
  const dataColumnCount = Object.values(columnsByDow).reduce((n, c) => n + c.length, 0);
  const docWidth = mpDocWidth(dataColumnCount);
  // 제목은 두 줄(반 이름 / 월)이고, 반 이름은 제목 칸 폭에 맞춰 단계적으로 줄어든다.
  const title = mpTitleLines(month.className, month.month);
  const titleFit = mpFitTitle(title.name, title.period, mpTitleBoxPx(dataColumnCount));

  return (
    <article style={{ color: "#000", background: MP_SHEET_COLOR.paper }}>
      {/* ⚠️ `@page`(방향·여백)는 여기 없다 — 문서마다 방향이 달라 한 장에 맞추는 껍데기(`MpFitToPage`)가 정한다. */}
      {/* 🔴 문서 **바깥 테두리만 굵다**(시트 3px) — 안쪽 격자는 전부 1px이다. */}
      <div className="w-fit" style={{ border: MP_SHEET_OUTER }}>

      {/* 시트 1~7행 — 로고(A·B) · 제목+안내(C~J) · 강사+범례(K). 세 칸을 나란히 둬야
          강사 칸(2행)이 제목 높이(3행)에 끌려가 빈틈이 생기지 않는다. */}
      <header className="flex items-stretch" style={{ width: docWidth, height: MP_SHEET_PX.head }}>
        <div
          className="flex shrink-0 items-center justify-center p-1"
          style={{ ...mpGridBorder(), width: MP_SHEET_PX.logo }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 인쇄 라우트: next/image의 지연 로드가 인쇄 시점을 놓친다 */}
          <img src={MP_LOGO_SRC} alt="EiE" className="max-h-full object-contain" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 🔴 두 줄(반 이름 / 월) — 한 줄이면 반 이름이 짧아도 칸을 넘어 띠 밖으로 깨져 나간다. */}
          <h1
            className="flex flex-col items-center justify-center px-2 text-center"
            style={{ ...mpGridBorder(), ...mpTitleStyle() }}
            title={mpDocTitle(month.className, month.month)}
          >
            <span style={mpTitleNameStyle(titleFit.nameSize)}>{title.name}</span>
            {title.period ? (
              <span style={mpTitlePeriodStyle(titleFit.periodSize)}>{title.period}</span>
            ) : null}
          </h1>
          <div className="flex flex-1 flex-col justify-center px-2 py-1" style={mpGridBorder()}>
            {notices.map((n, i) => (
              <p
                key={i}
                className="text-center"
                style={{
                  ...bodyFont,
                  lineHeight: MP_SHEET_LEADING.cell,
                  // 🔴 **마지막 한 줄만** 굵은 빨강 — 시트가 "본 일정은 학사일정에 따라…"만 그렇게 칠했다.
                  color: i === notices.length - 1 ? MP_SHEET_COLOR.alertFg : "#000000",
                  fontWeight: i === notices.length - 1 ? 700 : 400,
                }}
              >
                {n}
              </p>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col" style={{ width: MP_SHEET_PX.side }}>
          <div
            className="flex items-center justify-center"
            style={{
              ...mpGridBorder(),
              height: MP_SHEET_PX.teacher,
              color: MP_SHEET_COLOR.teacherFg,
              fontFamily: MP_SHEET_FONT.teacher,
              fontSize: MP_SHEET_SIZE.teacher,
              fontWeight: 700,
            }}
          >
            {teacherLabel ?? ""}
          </div>
          {legend.map((l, i) => (
            <p
              key={i}
              className="flex items-center justify-center px-0.5 text-center"
              style={{
                ...mpGridBorder(),
                backgroundColor: MP_SHEET_COLOR.legendBg,
                fontFamily: MP_SHEET_FONT.body,
                fontSize: MP_SHEET_SIZE.legend,
                fontWeight: 700,
                lineHeight: 1.15,
                flex: "1 1 0",
                minHeight: MP_SHEET_PX.band,
              }}
            >
              {l}
            </p>
          ))}
        </div>
      </header>

      <table
        className="table-fixed"
        style={{ width: docWidth, borderCollapse: "collapse" }}
      >
        <colgroup>
          {/* 시트는 라벨 열(A)까지 전부 81px다. */}
          <col style={{ width: MP_SHEET_PX.col }} />
          {dows.flatMap((dow) =>
            columnsByDow[dow].map((c) => <col key={`${dow}:${c}`} style={{ width: MP_SHEET_PX.col }} />),
          )}
        </colgroup>
        <thead>
          <tr style={{ height: MP_SHEET_PX.band }}>
            <th style={{ ...mpBandCellStyle("day"), backgroundColor: MP_SHEET_COLOR.paper }}>
              Day
            </th>
            {dows.map((dow) => (
              <th
                key={dow}
                colSpan={columnsByDow[dow].length}
                style={mpBandCellStyle("day")}
              >
                {MP_DOW_LABEL_EN[dow]}
              </th>
            ))}
          </tr>
        </thead>
        {weeks.map((week) => (
          <tbody key={week.monday} className="break-inside-avoid">
            <tr style={{ height: MP_SHEET_PX.band }}>
              <th style={{ ...mpBandCellStyle("date"), backgroundColor: MP_SHEET_COLOR.paper }}>
                Date
              </th>
              {dows.map((dow) => {
                const date = cellDateOf(week, dow);
                const kind = kindOf(date);
                return (
                  <td
                    key={`d:${dow}`}
                    colSpan={columnsByDow[dow].length}
                    style={kind === "off" ? mpOffBandCellStyle() : mpBandCellStyle("date")}
                  >
                    {/* 🔴 휴강 날도 **날짜는 적는다** — 며칠이 쉬는 날인지가 이 표기의 목적이다. */}
                    {kind !== "none" && date ? monthDay(date) : ""}
                  </td>
                );
              })}
            </tr>
            <tr style={{ height: MP_SHEET_PX.band }}>
              <th style={mpBandCellStyle("week")}>Week {week.index}</th>
              {dows.flatMap((dow) => {
                const cols = columnsByDow[dow];
                const date = cellDateOf(week, dow);
                const kind = kindOf(date);
                // 🔴 휴강 날은 라벨 대신 **`휴강 · 추석`**을 한 칸으로 적는다 — In-class/Homework 라벨이
                //    회색 빈 칸 위에 서 있으면 "안 적은 평일"로 읽힌다.
                if (kind === "off") {
                  return [
                    <td key={`h:${dow}`} colSpan={cols.length} style={mpOffBandCellStyle()}>
                      {mpOffLabel(date ? month.holidays[date] : null)}
                    </td>,
                  ];
                }
                // 🔴 그 주에 이 요일 **수업이 아예 없으면**(배정 밖·달 밖) 라벨을 그리지 않는다 —
                //    열 자체는 colSpan 한 칸으로 자리만 지킨다. ⚠️ 휴강은 여기가 아니라 위 갈래다.
                if (kind === "none") {
                  return [
                    <td key={`h:${dow}`} colSpan={cols.length} style={mpBandCellStyle("week")} />,
                  ];
                }
                return cols.map((col) => (
                  <th key={`h:${dow}:${col}`} style={mpHeadCellStyle(col)}>
                    {MP_COLUMN_LABEL[col]}
                  </th>
                ));
              })}
            </tr>
            <tr style={{ height: MP_SHEET_PX.value }}>
              <th style={mpBandCellStyle("week")} />
              {/* ⚠️ 값 줄은 **언제나 열마다 한 칸**이다 — 계획(MP) 화면이 그렇고, 합치면 격자선이
                  사라져 같은 달이 두 문서에서 다른 모양이 된다. */}
              {dows.flatMap((dow) => {
                const cols = columnsByDow[dow];
                const date = cellDateOf(week, dow);
                const kind = kindOf(date);
                return cols.map((col) => (
                  <td
                    key={`c:${dow}:${col}`}
                    className="align-middle whitespace-pre-line"
                    style={{
                      ...(kind === "off" ? mpOffValueCellStyle() : mpValueCellStyle(col)),
                      ...(kind === "none" ? { backgroundColor: MP_SHEET_COLOR.paper } : null),
                      height: MP_SHEET_PX.value,
                      padding: "2px 3px",
                    }}
                  >
                    {/* 🔴 휴강이어도 적어 둔 계획은 **그대로 보인다**(회색 위) — 감추면 화면엔 있는
                        글이 인쇄물에서만 사라진다. */}
                    {date && kind !== "none" ? (cells[mpCellKey(date, col)] ?? "") : ""}
                  </td>
                ));
              })}
            </tr>
          </tbody>
        ))}
      </table>

      <footer
        className="text-center whitespace-pre-line"
        style={{
          width: docWidth,
          fontFamily: MP_SHEET_FONT.body,
          fontSize: MP_SHEET_SIZE.footer,
          fontWeight: 700,
          lineHeight: MP_SHEET_LEADING.footer,
          padding: "6px 8px",
        }}
      >
        {/* 🔴 세션 줄만 자동(날짜)이고, 그 아래는 반이 고친 문구가 그대로 나간다. */}
        {sessionLine ? <p>{sessionLine}</p> : null}
        {footerText ? <p>{footerText}</p> : null}
      </footer>
    </div>
    </article>
  );
}
