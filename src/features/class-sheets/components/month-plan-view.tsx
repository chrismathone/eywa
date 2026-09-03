"use client";

import { useMemo, useState } from "react";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import {
  defaultMonthPlanFooter,
  monthPlanLines,
  type MonthPlanTexts,
} from "@/features/owner/month-plan-texts";
import { cellDateOf } from "../lib/month";
// 🔴 화면 크롬만 언어를 따른다 — 서식 본문(머리말·Prep·하단 문구)은 학원설정이 단일 소스이고
//    인쇄물은 아예 다른 컴포넌트(month-plan-paper)라 학부모에게는 한국어 그대로 나간다.
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import {
  MP_COLUMN_HINT,
  MP_COLUMN_LABEL,
  MP_DOW_LABEL_EN,
  MP_LOGO_SRC,
  mpCellKey,
  mpColumnsForDow,
  mpDayIsOff,
  mpDayKindOf,
  mpDocTitle,
  mpFooterDate,
  mpOffLabel,
  mpOffOverrideOf,
  mpResolveFooter,
  mpSessionLine,
  mpTitleLines,
  type MpCell,
  type MpColKind,
  type MpColumnKind,
} from "../lib/month-plan";
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
  mpValueInputStyle,
} from "../lib/month-plan-sheet-style";
import { mpFitTitle, mpTitleBoxPx } from "../lib/month-plan-title-fit";
import {
  MP_STATUS_HINT,
  MP_STATUS_LABEL,
  MP_STATUS_TONE,
  mpActualSummary,
  mpCompareDay,
  mpLinesOfDate,
} from "../lib/month-plan-compare";
import { dowKeyOf, type DowKey } from "../lib/week";
import type { ClassSheetMonthData } from "../server/month-queries";

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 문서 껍데기(머리말·안내·범례·꼬리말) — 인쇄물과 **같은 값**이 서버에서 내려온다. */
export type MonthPlanChromeProps = {
  texts: MonthPlanTexts;
  teacherLabel: string | null;
  periodRange: string;
};

/** 왼쪽 고정 열(시트의 A열) — sticky만 여기서, 색·글꼴은 시트 스타일이 준다. */
const STICKY_LEFT = "sticky left-0 z-[3]";
/** 라벨 열(A)·데이터 열 — 시트는 A~K가 **전부 81px**이다. */
const SHEET_COL = { width: MP_SHEET_PX.col, minWidth: MP_SHEET_PX.col } as const;

/**
 * 계획 칸 하나 — **평소엔 시트처럼 위아래 가운데**, 쓸 때만 위에서부터 적힌다
 * (원장 2026-09-02 *"작성시에는 중간 정렬 하지말고, 작성 완료되면 중간정렬"*).
 *
 * 🔑 `textarea`는 글이 늘 위에서 시작해 시트의 세로 가운데 모양이 안 난다. 그래서 **볼 때는 div**,
 *    **누르면 textarea**로 바꾼다 — 커서가 가운데에서 튀지 않고, 다 쓰고 나면 시트와 같은 모양이 된다.
 * ⚠️ 저장은 손대지 않는다(`onChange`가 그대로 디바운스 저장을 탄다). 포커스를 잃으면 보기로 돌아간다.
 * ⚠️ 빈 칸도 눌러서 쓸 수 있어야 하므로 보기 상태의 div가 칸을 꽉 채운다(`h-full`).
 */
function PlanCell({
  value,
  col,
  disabled,
  muted,
  label,
  hint,
  onChange,
}: {
  value: string;
  col: MpColumnKind;
  disabled: boolean;
  /**
   * 휴강 칸 — 글자도 회색으로 죽인다.
   * ⚠️ 안 죽이면 회색 바탕 위에 Homework의 굵은 빨강이 그대로 떠서, 같은 칸이 인쇄물(회색 글자)과
   *    다른 모양이 된다.
   */
  muted?: boolean;
  label: string;
  hint: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = muted
    ? { ...mpValueInputStyle(col), color: MP_SHEET_COLOR.offFg }
    : mpValueInputStyle(col);

  if (editing && !disabled) {
    return (
      <textarea
        autoFocus
        className="h-full w-full resize-none overflow-auto border-0 bg-white/70 p-0.5 outline-none"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        aria-label={label}
        title={hint}
        style={text}
      />
    );
  }
  return (
    <div
      role={disabled ? undefined : "textbox"}
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-readonly={disabled || undefined}
      title={hint}
      onClick={() => !disabled && setEditing(true)}
      onFocus={() => !disabled && setEditing(true)}
      className={`flex h-full w-full items-center justify-center overflow-hidden px-0.5 whitespace-pre-line ${
        disabled ? "" : "cursor-text"
      }`}
      style={text}
    >
      {value}
    </div>
  );
}

/**
 * 문서 아래 문구 — **반마다 고쳐 쓴다**(원장 2026-09-02 *"하단은 수정가능하게. 고정 멘트 아님.
 * LE1 멘트는 이것이 맞음."*). 안 고친 반은 학원설정 기본값이 그대로 나온다.
 *
 * 🔑 값 칸과 **같은 모양**이다 — 볼 때는 글자, 누르면 입력칸(`PlanCell` 규약). 저장도 같은 길
 *    (`col_kind='footer'`, 0240a)이라 새 경로가 없다.
 * ⚠️ 0240a 미적용이면 저장이 거절되고 한글 사유가 뜬다(읽기는 그대로 기본값).
 */
function FooterBlock({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const t = useSheetT();
  const [editing, setEditing] = useState(false);
  /**
   * 🔴 보기(div)와 입력(textarea)이 **같은 상자**여야 한다 — 글꼴·크기·굵기·줄간격·정렬·패딩까지.
   *    `textarea`의 기본 `line-height`는 `normal`이라, 이걸 안 맞추면 누르는 순간 줄간격이 미세하게
   *    달라져 글이 흔들린다(원장 제보 2026-09-02).
   */
  const box = "w-full whitespace-pre-line px-1 py-0.5 text-center";
  const text: React.CSSProperties = {
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: MP_SHEET_LEADING.footer,
  };
  const lines = Math.max(4, value.split("\n").length);

  if (editing && !disabled) {
    return (
      <textarea
        autoFocus
        className={`${box} resize-y border-0 bg-white/70 outline-none`}
        rows={lines}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        aria-label={t("mp.footerAria")}
        style={text}
      />
    );
  }
  return (
    <div
      role={disabled ? undefined : "textbox"}
      tabIndex={disabled ? -1 : 0}
      aria-label={t("mp.footerAria")}
      aria-readonly={disabled || undefined}
      title={disabled ? undefined : t("mp.footerTitle")}
      onClick={() => !disabled && setEditing(true)}
      onFocus={() => !disabled && setEditing(true)}
      className={`${box} ${disabled ? "" : "cursor-text"}`}
      style={text}
    >
      {value || (disabled ? "" : t("mp.footerEmpty"))}
    </div>
  );
}

/** 그 요일에 **수업이 아예 없을 때**(달 밖·배정 밖) 한 칸으로 자리만 지킨다. ⚠️ 휴강은 회색이라 여기가 아니다. */
const BLANK = { backgroundColor: MP_SHEET_COLOR.paper } as const;

/**
 * ECS **계획(MP)** 보기 — 미리 쓰는 월간 계획서와 실제 진도의 대조 화면.
 *
 * 원장 2026-09-01: *"미리 입력하는 월간 뷰와, 실제로 수업진행하면서 입력하는 주간뷰를 비교할 수 있게
 * 하려고 함."* → *"최대한 시트 디자인을 그대로 MP 월별 세팅에서 볼 수 있게"* → *"글씨체부터 하나하나
 * 그대로 카피해올것"*.
 *
 * 그래서 이 화면은 **원본 구글 시트를 그대로 복제한 문서**다 — 로고 · 파란 제목 띠(두 줄) ·
 * 안내 4줄(마지막 줄만 빨강) · 범례 · `Day / Date / Week N` 골격 · 열마다 다른 바탕색 · 검정 격자 ·
 * 꼬리말까지 인쇄물과 같다. 다른 점은 **칸이 입력칸이고 대조 신호가 얹힌다**는 것뿐이다.
 *
 * 🔴 색·글꼴·pt는 [`month-plan-sheet-style`](../lib/month-plan-sheet-style.ts) 단일 소스다 —
 *    여기에 hex나 pt를 다시 적지 말 것(적는 순간 화면과 인쇄가 갈린다).
 * 🔴 **열 라벨은 주 블록마다 다시 그린다**(시트 그대로) — 그 주에 이 반 수업이 **아예 없는** 요일은
 *    그 주에서만 라벨이 사라진다(배정이 달 중간에 시작·종료한 요일). ⚠️ 휴강은 사라지는 게 아니라
 *    회색으로 남는다(아래 항목).
 * 🔴 **대조·경고는 이 화면에만 있다** — 인쇄물은 학부모 문서라 신호를 싣지 않는다.
 * 🔴 **판정은 [`mpCompareDay`](../lib/month-plan-compare.ts) 한 곳**이다.
 * 🔴 **휴강은 회색 + 빗금**이고 라벨 자리에 `휴강 · 추석`이 적힌다(원장 2026-09-02) — 판정은
 *    `mpDayIsOff` → `mpDayKindOf`를 타고, 인쇄물이 **같은 함수·같은 스타일**을 쓴다.
 * ⚠️ 문구는 **학원설정**이 단일 소스다(`getMonthPlanChrome`) — 여기 하드코딩하지 말 것.
 */
export function MonthPlanView({
  data,
  chrome,
  cells,
  showActual,
  canEdit,
  onCell,
  onEbookColumn,
  onDayOff,
}: {
  data: ClassSheetMonthData;
  /** 없으면(조회 실패 등) 문서 껍데기 없이 표만 그린다 — 표가 사라지는 것보다 낫다. */
  chrome: MonthPlanChromeProps | null;
  /** `YYYY-MM-DD|col_kind` → 내용(빈 문자열 가능 — 그 칸이 섰다는 뜻). */
  cells: Record<string, string>;
  showActual: boolean;
  canEdit: boolean;
  /** ⚠️ `footer`도 같은 길로 저장한다(0240a) — 저장 경로를 새로 만들지 않는다. */
  onCell: (date: string, colKind: Exclude<MpColKind, "off">, body: string) => void;
  onEbookColumn: (dates: string[], show: boolean) => void;
  onDayOff: (date: string, off: boolean) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const cellList: MpCell[] = useMemo(
    () =>
      Object.entries(cells).map(([key, body]) => {
        const [planDate, colKind] = key.split("|");
        return { planDate: planDate!, colKind: colKind as MpCell["colKind"], body };
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
   * 🔴 **내릴 땐 적어 둔 내용이 함께 사라진다** — 되돌릴 수 없으므로 내용이 있으면 먼저 묻는다.
   */
  const toggleEbook = (dow: DowKey, hasEbook: boolean) => {
    const dates = classDatesOfDow(dow);
    if (hasEbook) {
      const written = dates.filter((d) => (cells[mpCellKey(d, "ebook")] ?? "").trim() !== "").length;
      if (
        written > 0 &&
        !window.confirm(
          tf("mp.ebook.dropConfirm", { dow: MP_DOW_LABEL_EN[dow], n: written }),
        )
      ) {
        return;
      }
    }
    onEbookColumn(dates, !hasEbook);
  };

  const linesOfDate = (date: string) => mpLinesOfDate(data, date);
  const verdictOf = (date: string) =>
    mpCompareDay({ date, cells, lines: linesOfDate(date), isOff: isOff(date), today: data.today });

  if (data.dows.length === 0) {
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        {t("mp.noSchedule")}
      </p>
    );
  }

  // 수업이 하루도 없는 주는 행을 만들지 않는다(달력 보기와 같은 규칙 — 빈 띠가 서지 않게).
  const weeks = data.weeks.filter((w) => w.dates.some(hasClassOn));
  const notices = chrome ? monthPlanLines(chrome.texts.notices) : [];
  const legend = chrome ? monthPlanLines(chrome.texts.bookLegend) : [];
  const sessionLine = chrome ? mpSessionLine(data.month, chrome.periodRange) : "";
  // 꼬리말은 **반이 적은 것이 이긴다**(0240a) — 안 적었으면 학원설정 기본값.
  const footerText = chrome
    ? mpResolveFooter(cells, data.month, defaultMonthPlanFooter(chrome.texts))
    : "";
  // 머리말·꼬리말과 표의 오른쪽 끝을 맞춘다(머리말은 flex라 안 박으면 창 폭을 다 먹는다).
  const dataColumnCount = data.dows.reduce((n, dow) => n + columnsByDow[dow].length, 0);
  const docWidth = mpDocWidth(dataColumnCount);
  // 제목은 두 줄(반 이름 / 월)이고 반 이름은 폭에 맞춰 줄어든다 — 인쇄물과 **같은 함수**를 쓴다.
  const title = mpTitleLines(data.className, data.month);
  const titleFit = mpFitTitle(title.name, title.period, mpTitleBoxPx(dataColumnCount));

  return (
    <div className="overflow-x-auto p-3">
      {/* 🔴 문서 **바깥 테두리만 굵다**(시트 3px) — 안쪽 격자는 전부 1px이다. */}
      <div className="w-fit" style={{ background: MP_SHEET_COLOR.paper, border: MP_SHEET_OUTER }}>
      {chrome ? (
        /* 시트 1~7행 — 로고(A·B) · 제목+안내(C~J) · 강사+범례(K).
           🔴 **세 칸을 나란히** 둔다. 제목 줄과 강사 줄을 한 행으로 묶으면 강사 칸(2행)이 제목
           높이(3행)에 끌려가 그 아래에 빈틈이 생긴다(원장 제보 2026-09-02). */
        <div className="flex items-stretch" style={{ width: docWidth, height: MP_SHEET_PX.head }}>
          <div
            className="flex shrink-0 items-center justify-center p-1"
            style={{ ...mpGridBorder(), width: MP_SHEET_PX.logo }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 인쇄물과 같은 정적 자산이라 최적화 파이프라인을 태우지 않는다(두 문서가 같은 그림이어야 한다) */}
            <img src={MP_LOGO_SRC} alt="EiE" className="max-h-full object-contain" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* 🔴 두 줄(반 이름 / 월) — 인쇄물과 같은 규칙이다(한 줄이면 띠 밖으로 깨져 나간다). */}
            <h2
              className="flex flex-col items-center justify-center px-2 text-center"
              style={{ ...mpGridBorder(), ...mpTitleStyle() }}
              title={mpDocTitle(data.className, data.month)}
            >
              <span style={mpTitleNameStyle(titleFit.nameSize)}>{title.name}</span>
              {title.period ? (
                <span style={mpTitlePeriodStyle(titleFit.periodSize)}>{title.period}</span>
              ) : null}
            </h2>
            <div className="flex flex-1 flex-col justify-center px-2 py-1" style={mpGridBorder()}>
              {notices.map((n, i) => (
                <p
                  key={i}
                  className="text-center"
                  style={{
                    fontFamily: MP_SHEET_FONT.body,
                    fontSize: MP_SHEET_SIZE.body,
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
              {chrome.teacherLabel ?? ""}
            </div>
            {/* 범례 — 남은 높이를 똑같이 나눠 갖는다(20px로 못박으면 두 줄짜리가 잘린다). */}
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
        </div>
      ) : null}

      <table
        className="border-separate border-spacing-0"
        style={{ width: docWidth }}
      >
        <thead>
          <tr>
            <th
              scope="col"
              className={`${STICKY_LEFT} z-[4] px-1 py-1`}
              style={{
                ...mpBandCellStyle("day"),
                backgroundColor: MP_SHEET_COLOR.paper,
                ...SHEET_COL,
              }}
            >
              Day
            </th>
            {data.dows.map((dow) => {
              const cols = columnsByDow[dow];
              const hasEbook = cols.includes("ebook");
              return (
                <th
                  key={dow}
                  colSpan={cols.length}
                  className="px-2 py-1"
                  style={mpBandCellStyle("day")}
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
                            ? t("mp.ebook.drop.title")
                            : t("mp.ebook.add.title")
                        }
                        className="text-text-dim hover:bg-bg-soft cursor-pointer rounded-full border border-black/40 bg-white/70 px-1.5 py-px text-[10px] font-bold"
                      >
                        {t(hasEbook ? "mp.ebook.drop" : "mp.ebook.add")}
                      </button>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        {/* ⚠️ 주마다 `<tbody>` 하나 — 한 주가 3~4행이라 겹칠 수 없고, 나란히 두는 것은 표준이다. */}
        {weeks.map((week) => (
          <tbody key={week.monday}>
            {/* ① Date 행 — 날짜 · 휴일 이름 · 대조 배지 · 휴강 토글 */}
            <tr>
              <th
                scope="row"
                className={`${STICKY_LEFT} px-1 py-1`}
                style={{
                  ...mpBandCellStyle("date"),
                  backgroundColor: MP_SHEET_COLOR.paper,
                  ...SHEET_COL,
                }}
              >
                Date
              </th>
              {data.dows.map((dow) => {
                const cols = columnsByDow[dow];
                const date = cellDateOf(week, dow, data.month);
                const teaches = date ? hasClassOn(date) : false;
                const off = date ? isOff(date) : false;
                const kind = mpDayKindOf(date, teaches, off);
                const holidayName = date ? data.holidays[date] : undefined;
                const v = date && teaches ? verdictOf(date) : null;
                const tone = v ? MP_STATUS_TONE[v.status] : null;
                return (
                  <td
                    key={dow}
                    colSpan={cols.length}
                    className="relative px-2 py-1"
                    style={kind === "off" ? mpOffBandCellStyle() : mpBandCellStyle("date")}
                  >
                    {/* 날짜는 **가운데**(시트 그대로). 휴강 버튼만 오른쪽에 띄워서 날짜를 밀지 않게 한다. */}
                    <span className="flex flex-wrap items-center justify-center gap-1.5 pr-10">
                      <span className="num">{date ? monthDay(date) : "—"}</span>
                      {date && !teaches ? (
                        <span className="text-[10px]">{t("mp.noClassDay")}</span>
                      ) : null}
                      {/* ⚠️ 휴강 날은 아래 라벨 줄이 이미 `휴강 · 추석`을 적는다 — 여기 또 붙이면 같은
                          말이 두 번이다. 휴일인데 **수업하는 날**(반별 예외 `open`)에는 이 알약이
                          유일한 표시라 그때는 남긴다. */}
                      {holidayName && kind !== "off" ? (
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
                              ? t("mp.off.undo.title")
                              : t("mp.off.title")
                          }
                          className="absolute top-1/2 right-1 -translate-y-1/2 cursor-pointer rounded-full border border-black/40 bg-white/70 px-1.5 py-px text-[10px] font-bold hover:bg-white"
                        >
                          {t(off ? "mp.off.undo" : "mp.off")}
                        </button>
                      ) : null}
                    </span>
                  </td>
                );
              })}
            </tr>

            {/* ② Week N 행 = 열 라벨(시트 그대로 주마다 반복). 그 주에 수업이 없는 요일은 라벨 없음. */}
            <tr>
              <th
                scope="row"
                rowSpan={showActual ? 3 : 2}
                className={`${STICKY_LEFT} px-1`}
                style={{ ...mpBandCellStyle("week"), ...SHEET_COL }}
              >
                Week <span className="num">{week.index}</span>
              </th>
              {data.dows.flatMap((dow) => {
                const cols = columnsByDow[dow];
                const date = cellDateOf(week, dow, data.month);
                const kind = mpDayKindOf(
                  date,
                  date ? hasClassOn(date) : false,
                  date ? isOff(date) : false,
                );
                // 🔴 휴강 날은 라벨 자리에 **`휴강 · 추석`**을 적는다(인쇄물과 같은 모양).
                if (kind === "off") {
                  return [
                    <td
                      key={`h:${dow}:${week.monday}`}
                      colSpan={cols.length}
                      className="px-1"
                      style={mpOffBandCellStyle()}
                    >
                      {mpOffLabel(date ? data.holidays[date] : null)}
                    </td>,
                  ];
                }
                if (kind === "none") {
                  return [
                    <td
                      key={`h:${dow}:${week.monday}`}
                      colSpan={cols.length}
                      style={{ ...mpBandCellStyle("week"), ...BLANK }}
                    />,
                  ];
                }
                return cols.map((col) => (
                  <th
                    key={`h:${dow}:${col}:${week.monday}`}
                    scope="col"
                    title={MP_COLUMN_HINT[col]}
                    className="px-1 py-1"
                    style={{ ...mpHeadCellStyle(col), ...SHEET_COL }}
                  >
                    {MP_COLUMN_LABEL[col]}
                  </th>
                ));
              })}
            </tr>

            {/* ③ 값 행 — 시트에서도 이 행의 A열은 비어 있다. */}
            <tr>
              {data.dows.flatMap((dow) => {
                const date = cellDateOf(week, dow, data.month);
                const teaches = date ? hasClassOn(date) : false;
                const off = date ? isOff(date) : false;
                const kind = mpDayKindOf(date, teaches, off);
                const cols = columnsByDow[dow];
                const v = date && teaches && !off ? verdictOf(date) : null;
                // 🔴 칸에 테두리를 주는 신호는 **'교재 다름' 하나뿐**이다. '미작성'은 이 칸이 아니라
                //    주간 시트를 고쳐야 하는 일이라, 계획 칸을 칠하면 엉뚱한 곳을 가리킨다.
                const warnBook = v?.status === "off-book";
                return cols.map((col) => (
                  <td
                    key={`${dow}:${col}:${week.monday}`}
                    className="p-0 align-top"
                    style={{
                      // 🔴 휴강은 **회색 + 빗금**(인쇄물과 같은 함수) — 그전엔 평일과 똑같은 흰 칸이라
                      //    "아직 안 적음"과 구분되지 않았다(원장 2026-09-02).
                      ...(kind === "off" ? mpOffValueCellStyle() : mpValueCellStyle(col)),
                      ...SHEET_COL,
                      height: MP_SHEET_PX.value,
                      ...(kind === "none" ? BLANK : null),
                      ...(warnBook && col === "in_class"
                        ? { boxShadow: "inset 0 0 0 2px var(--amber)" }
                        : null),
                    }}
                  >
                    {date && teaches ? (
                      <PlanCell
                        col={col}
                        disabled={!canEdit || off}
                        muted={kind === "off"}
                        value={cells[mpCellKey(date, col)] ?? ""}
                        onChange={(next) => onCell(date, col, next)}
                        label={`${monthDay(date)} ${MP_COLUMN_LABEL[col]}`}
                        hint={MP_COLUMN_HINT[col]}
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
                      className="px-2 py-1 text-left align-top"
                      style={{
                        ...mpBandCellStyle("week"),
                        backgroundColor: "#f3f3f3",
                        fontWeight: 400,
                        textAlign: "left",
                      }}
                    >
                      {summary.length === 0 ? (
                        <span className="text-black/40">{date && teaches ? t("mp.noRecord") : ""}</span>
                      ) : (
                        <span className="text-black/70">{summary.join(" / ")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        ))}
      </table>

      {chrome ? (
        <div
          className="px-3 py-2 text-center"
          style={{
            width: docWidth,
            fontFamily: MP_SHEET_FONT.body,
            fontSize: MP_SHEET_SIZE.footer,
            fontWeight: 700,
            lineHeight: MP_SHEET_LEADING.footer,
          }}
        >
          {/* 🔴 세션 줄만 자동(날짜)이고, 그 아래는 **반마다 고쳐 쓴다**. */}
          {sessionLine ? <p>{sessionLine}</p> : null}
          <FooterBlock
            value={footerText}
            disabled={!canEdit}
            onChange={(next) => onCell(mpFooterDate(data.month), "footer", next)}
          />
        </div>
      ) : null}
    </div>
    </div>
  );
}
