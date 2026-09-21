"use client";

import { formatSessionUnits } from "@/features/attendance/session-units";
import {
  attendanceUnitsDiff,
  formatUnitsWithSuffix,
  type AttendanceUnitSuffix,
} from "@/features/attendance/unit-suffix";
import type { AttendanceInvoiceGap, AttendanceTermSessions } from "@/features/attendance/class-billing";
import { tipProps } from "@/components/hover-tip/tip";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { EMPTY_COUNT, rateDecimal, ratePercent, sumCounts, type Counted } from "@/features/attendance/grid/totals";
import { useColumnTotals, useRowCount, useRowsCount } from "./grid-context";
import type { ColumnTotals } from "@/features/attendance/grid/column-totals";
import { formatMoney } from "@/features/attendance/money-format";
import { useAttendanceSearch } from "./search-context";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 살아 있는 합계 — 칸을 치는 **그 순간** 시수·출석률·상단 스탯이 따라 움직인다.
 *
 * 🔴 왜 클라에서 세는가: 합계를 서버가 계산하면 저장 → 재조회 → 다시 그리기를 기다려야 해서, 칸은 즉시
 *    바뀌는데 합계만 1초쯤 늦게 따라온다(그 사이 화면은 서로 안 맞는 두 숫자를 동시에 보여준다).
 *    격자 저장소가 이미 모든 칸의 값을 들고 있으므로 **같은 식**(`grid/totals.ts`)으로 여기서 바로 센다.
 * ⚠️ 서버 값은 버리지 않는다 — 첫 렌더(SSR)와 격자가 없는 경우의 폴백이다. 두 경로 모두 같은 함수를 쓰므로
 *    숫자가 갈릴 수 없다.
 */

/** 출석률 신호등 — 의미색 캐논(좋음=positive · 주의=caution · 위험=critical). 구 primary(네이비)는
 *  브랜드 자리라 "좋다"는 뜻으로 안 쓴다. 자리 월간 출석부(monthly-row.tsx)와 **같은 문턱·같은 색**. */
function rateColorOf(rate: number | null): string {
  if (rate === null) return "text-text-faint";
  return rate >= 90 ? "text-green" : rate >= 80 ? "text-amber" : "text-danger";
}

/**
 * '수업 차수' 칸 — 출석부에서 센 시수(소비 상태 칸의 배수 합).
 * 🔴 오른쪽 sticky가 아니라 **청구액 옆**이다(원장 2026-09-17 *"우측 시수를 청구액 우측으로 이동. 수업 차수로 이름 변경"*).
 */
export function RowLessonCountCell({
  row,
  fallback,
  suffix = null,
  zeroAsNumber = false,
}: {
  row: string;
  fallback: Counted;
  /** 단위 한 글자(영어 `U` · 수학 `T`, 원장 2026-09-18). */
  suffix?: AttendanceUnitSuffix;
  /**
   * 0을 `—`가 아니라 **숫자로** 적는다 — 그 달 수업날이 하나도 없는 줄(`hasNoLessonDays`, 원장 2026-09-18
   * *"수업차수도 0 으로"*). 수업날이 있는 줄의 0은 "아직 안 찍었다"라 종전대로 `—`다.
   */
  zeroAsNumber?: boolean;
}) {
  const c = useRowCount(row) ?? fallback;
  // 여백은 이웃(청구액·등록 차수)과 같은 `px-1 py-1` — 옛 오른쪽 sticky 자리의 `py-2`가 따라왔던 것이다.
  // 배경(연파랑)은 등록 차수 칸과 같은 토큰 — 두 칸이 한 짝이라는 걸 색이 말한다(원장 2026-09-18).
  return (
    <td className="border-line text-foreground num bg-att-col-sessions border-b border-r px-1 py-1 text-right text-xs font-bold whitespace-nowrap">
      {c.units > 0 || zeroAsNumber ? formatUnitsWithSuffix(c.units, suffix) : "—"}
    </td>
  );
}

/**
 * '차이확인' 칸 = **수업 차수 − 등록 차수**(원장 2026-09-18) — 양수 파랑 · 음수 빨강 솔리드 + 흰 굵은 글씨.
 *
 * 🔴 수업 차수는 **칸을 치면 즉시** 바뀌므로(클라 집계) 차이도 같은 값을 보고 다시 센다 —
 *    서버 값만 보면 방금 친 칸이 반영 안 된 차이가 남아 "수업 차수는 바뀌었는데 차이는 그대로"가 된다.
 * 🔴 **뺄 수 없으면 `—`**: 미확정(`null`)이거나 옛 '일수 기준' 확정(단위가 시수가 아니라 출석 일수)이면
 *    빼는 순간 단위가 다른 두 수의 차가 나온다. 0으로 치면 "전부 초과"라는 거짓 신호가 열 전체에 깔린다.
 */
export function RowSessionDiffCell({
  row,
  fallback,
  term: termIn,
  suffix = null,
  lang = "ko",
  termSynthetic = false,
  noInvoice = null,
}: {
  row: string;
  fallback: Counted;
  term: AttendanceTermSessions | null;
  suffix?: AttendanceUnitSuffix;
  lang?: SheetLang;
  /**
   * 등록 차수가 확정값이 아니라 수업날 없는 줄에 **지어 넣은 0**이다(`noLessonZeroView`). 그 줄에 값을 치면(보강 등) 더는 수업날
   * 없는 줄이 아니므로, 그 0에서 뺀 `+1.0` 같은 신호를 내지 않고 미확정(`—`)으로 돌아간다(새로고침 뒤 서버 값과 같은 모양).
   */
  termSynthetic?: boolean;
  /**
   * 그 달 청구서가 없거나(`none`) 취소된(`void`) 학생의 줄(2026-09-18) — 등록 차수가 `—`인 이유가 '아직 확정 전'이 아니라
   * '확정할 곳이 없다'라, `—`의 툴팁을 그 문구로 바꾼다. 청구서가 있으면 null(종전 문구).
   */
  noInvoice?: AttendanceInvoiceGap | null;
}) {
  const c = useRowCount(row) ?? fallback;
  const term = termSynthetic && c.units > 0 ? null : termIn;
  const diff = attendanceUnitsDiff(c.units, term);
  if (diff === null) {
    // 옛 일수 기준 확정이면 회차 행이 있다(= 청구서가 있다) — 그 문구가 먼저. 청구서 없음은 회차 행이 없는 줄에만 선다.
    const why = term?.daysBasis
      ? "att.row.diffDaysBasis"
      : noInvoice === "void"
        ? "att.row.invoiceVoidTip"
        : noInvoice === "none"
          ? "att.row.noInvoiceTip"
          : "att.row.diffUnconfirmed";
    return (
      <td
        className="border-line text-text-dim num border-b border-r px-1 py-1 text-center text-xs font-bold whitespace-nowrap"
        title={sheetT(lang, why)}
      >
        —
      </td>
    );
  }
  // 0 = 계획대로 — 색을 칠하지 않는다(전부 칠하면 색이 신호이길 그만둔다).
  const fill =
    diff > 0
      ? "bg-att-diff-plus text-white"
      : diff < 0
        ? "bg-att-diff-minus text-white"
        : "text-foreground";
  return (
    <td className={`border-line num border-b border-r px-1 py-1 text-center text-xs font-bold whitespace-nowrap ${fill}`}>
      <span
        {...tipProps({
          title: sheetT(lang, "att.row.diffTip"),
          lines: [
            `${sheetT(lang, "att.col.lessonCount")} ${formatUnitsWithSuffix(c.units, suffix)}`,
            `${sheetT(lang, "att.col.termSessions")} ${formatUnitsWithSuffix(term!.units, suffix)}`,
          ],
        })}
      >
        {diff > 0 ? "+" : ""}
        {formatUnitsWithSuffix(diff, suffix)}
      </span>
    </td>
  );
}

/** 맨 오른쪽 출석률 칸(가로 고정). 시수는 위 `RowLessonCountCell`로 옮겼다. */
export function RowTotalCells({ row, fallback }: { row: string; fallback: Counted }) {
  const live = useRowCount(row);
  const c = live ?? fallback;
  const rate = ratePercent(c);
  return (
    <td
      className={`border-line num sm:sticky sm:right-0 z-10 w-[64px] min-w-[64px] border-b border-l bg-card px-2 py-2 text-right text-xs font-bold whitespace-nowrap ${rateColorOf(rate)}`}
    >
      {rate === null ? "—" : `${rate}%`}
    </td>
  );
}

/**
 * "행 0개" — `undefined`(=표 전체)와 **뜻이 다르다**. 검색이 없을 때 두 번째 구독을 헛돌리지 않으려고 쓴다.
 * ⚠️ 모듈 상수여야 한다(매 렌더 새 배열이면 아낀 만큼을 할당으로 도로 쓴다).
 */
const NO_ROWS: readonly string[] = [];

/** 서버 값으로 세는 폴백 — 격자가 없는 화면(테스트·SSR 첫 렌더)에서만 탄다. */
function serverCount(
  rows: readonly string[] | undefined,
  countByRow: Record<string, Counted> | undefined,
  fallback: Counted,
): Counted {
  // ⚠️ `countByRow`가 없으면 **좁히지 않은 값**으로 떨어진다 — 0을 지어내면 "시수 0 / 279.5"가 뜬다.
  //    검색이 걸릴 수 있는 호출부(matrix-table)는 항상 넘긴다.
  if (!rows || !countByRow) return fallback;
  return sumCounts(rows.map((r) => countByRow[r] ?? EMPTY_COUNT));
}

/**
 * 지금 화면이 세야 하는 집계 — **검색 모수(scoped)와 전체(all)를 함께** 낸다(2026-08-20).
 *
 * 🔴 검색 중이면 숫자도 검색을 따라간다(원장 제보 *"학생 검색시 하단 숫자는 안바뀌네"*). 다만 좁힌 값만
 *    두면 그건 "좁혀 놓고 전체인 척하는 숫자"라 더 나쁘다([[#89]]) — 그래서 전체를 **같이** 돌려주고,
 *    화면이 `검색분 / 전체`로 나란히 세운다.
 * ⚠️ `useRowsCount`는 두 번 부른다(모수별 하나씩) — 훅 개수는 렌더마다 고정이라 조건 분기가 아니다.
 */
function useScopedCounts(
  rows: readonly string[] | undefined,
  countByRow: Record<string, Counted> | undefined,
  fallback: Counted,
): { scoped: Counted; all: Counted; searching: boolean } {
  const search = useAttendanceSearch();
  const searching = search?.active ?? false;
  // 검색 중이면 이 범위(rows) 안에서 걸린 행만. rows 생략 = 표 전체라 걸린 행 전부가 모수다.
  const matchedRows = search?.active
    ? rows
      ? rows.filter((r) => search.matched.has(r))
      : [...search.matched]
    : undefined;
  const liveAll = useRowsCount(rows);
  // ⚠️ 검색이 없으면 **빈 목록**으로 부른다 — 훅은 조건 없이 불러야 하지만(개수 고정), 같은 집계를 두 번
  //    세게 두면 칸을 칠 때마다 표 전체를 한 벌 더 훑는다(합계·반 머리행 전부).
  const liveScoped = useRowsCount(searching ? (matchedRows ?? NO_ROWS) : NO_ROWS);
  const all = liveAll ?? serverCount(rows, countByRow, fallback);
  const scoped = searching ? (liveScoped ?? serverCount(matchedRows, countByRow, fallback)) : all;
  return { scoped, all, searching };
}

/**
 * `검색분 / 전체` 중 **뒤쪽(전체)** — 검색 중에만 붙고, 지우면 흔적 없이 사라진다.
 * 🔑 표기를 한 곳에 둔다 — 자리마다 손으로 `/`를 적으면 어떤 숫자는 병기고 어떤 숫자는 아닌 화면이 된다.
 */
export function OfTotal({ children }: { children: React.ReactNode }) {
  return <span className="text-text-faint font-normal">{" / "}{children}</span>;
}

/**
 * 여러 행의 시수 합(반 머리행·총합) — 숫자만 낸다. 라벨("시수")은 부르는 쪽이 붙인다.
 * 검색 중이면 `12 / 53`(검색분 / 전체)로 늘어난다.
 */
export function LiveUnits({
  rows,
  countByRow,
  fallback,
}: {
  rows?: readonly string[];
  /** 행 키 → 서버 집계. 격자가 없을 때 **검색 모수로도** 셀 수 있게 하는 폴백 재료. */
  countByRow?: Record<string, Counted>;
  fallback: Counted;
}) {
  const { scoped, all, searching } = useScopedCounts(rows, countByRow, fallback);
  return (
    <>
      {formatSessionUnits(scoped.units)}
      {searching ? <OfTotal>{formatSessionUnits(all.units)}</OfTotal> : null}
    </>
  );
}

/** 표 전체 기록 수(범례의 "총 N회 기록"). 검색 중이면 같은 규약으로 `검색분 / 전체`. */
export function LiveRecords({
  rows,
  countByRow,
  fallback,
}: {
  rows?: readonly string[];
  countByRow?: Record<string, Counted>;
  fallback: Counted;
}) {
  const { scoped, all, searching } = useScopedCounts(rows, countByRow, fallback);
  return (
    <>
      {scoped.recorded}
      {searching ? <OfTotal>{all.recorded}</OfTotal> : null}
    </>
  );
}

/** 툴바에 실리는 지표 한 칸 — 라벨 + 숫자 + 단위. */
function CompactMetric({
  label,
  value,
  unit,
  ofTotal,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** 검색 중일 때 나란히 서는 전체 값(`검색분 / 전체`). 없으면 종전과 똑같이 숫자 하나만. */
  ofTotal?: string | number | null;
  valueClass?: string;
}) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-text-dim text-xs font-medium">{label}</span>
      <span className={`num text-lg leading-none font-bold tracking-tight ${valueClass}`}>{value}</span>
      {ofTotal !== null && ofTotal !== undefined ? (
        <span className="text-text-faint num text-xs font-medium">{`/ ${ofTotal}`}</span>
      ) : null}
      {unit ? <span className="text-text-faint text-xs font-medium">{unit}</span> : null}
    </span>
  );
}

/**
 * 상단 스탯 4개 — 출석률·결석·지각은 입력을 즉시 따라간다. '등록 학생'만 서버 값(출결과 무관하게 고정).
 * ⚠️ 기록이 0건이면 "0%"는 **사실이 아니다** — 출석률이 0인 게 아니라 아직 아무도 안 찍은 것이다.
 *    과목을 하드코딩하지 않고 **데이터 유무**로 가른다(데이터가 생기면 저절로 숫자로 돌아온다).
 *
 * 🔴 **BigStat 카드 4장에서 툴바 한 줄로 강등**(원장 지시 2026-08-06 "상단 공간낭비 심한 것부터"):
 * 출석부는 화면 높이가 고정이라 위에서 먹는 1px이 그대로 학생 행 1px이다. 카드는 세로 110px을 쓰는데
 * 여기서 필요한 건 숫자 4개뿐이라, 툴바 오른쪽에 실어 **세로 0px**로 만들었다.
 * ⚠️ 이 화면에서 BigStat 카드로 되돌리지 말 것 — Editorial 빅 스탯은 대시보드용이고, 여기선 행이 곧 정보다.
 */
export function LiveStats({
  totalStudents,
  fallback,
}: {
  totalStudents: number;
  fallback: Counted;
}) {
  const t = useSheetT();
  const search = useAttendanceSearch();
  // 🔴 검색 중이면 이 숫자들도 검색을 따라간다(2026-08-20) — 목록만 좁고 숫자는 전체이면, 바로 옆
  //    검색 칩이 "1/38명 표시"라고 말하는 그 화면에서 출석률·결석이 다른 38명 얘기를 하게 된다.
  //    전체 값은 `검색분 / 전체`로 함께 세워 사라지지 않는다.
  const { scoped, all, searching } = useScopedCounts(undefined, undefined, fallback);
  const c = scoped;
  const rate = rateDecimal(c);
  const allRate = rateDecimal(all);

  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1" data-help="att-totals">
      <CompactMetric
        label={t("att.stat.enrolled")}
        value={searching ? (search?.matchedStudents ?? 0) : totalStudents}
        ofTotal={searching ? totalStudents : null}
        unit={t("att.stat.people")}
      />
      <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />
      {/* ⚠️ 기록 0건에 "0%"를 쓰지 않는다 — 출석률이 0인 게 아니라 아직 아무도 안 찍은 것이다.
          압축 바에서도 "—"만 두면 고장으로 읽히므로 단위 자리에 사유를 적는다. */}
      {/* ⚠️ 단위(%)는 **한 번만** 붙는다 — 병기 값에도 %를 달면 "91.2 / 88% %"가 된다.
          검색분에 기록이 없어도 전체에 있으면 단위는 %다(그 자리가 "기록 없음"이면 옆 숫자가 미아가 된다). */}
      <CompactMetric
        label={t("att.stat.rate")}
        value={c.recorded > 0 ? rate : "—"}
        ofTotal={searching ? (all.recorded > 0 ? allRate : "—") : null}
        unit={c.recorded > 0 || (searching && all.recorded > 0) ? "%" : t("att.stat.noRecord")}
        valueClass={rateColorOf(c.recorded > 0 ? rate : null)}
      />
      <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />
      <CompactMetric
        label={t("att.stat.absent")}
        value={c.absent}
        ofTotal={searching ? all.absent : null}
        unit={t("att.stat.times")}
        valueClass="text-danger"
      />
      <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />
      <CompactMetric
        label={t("att.stat.late")}
        value={c.late}
        ofTotal={searching ? all.late : null}
        unit={t("att.stat.times")}
        valueClass="text-amber"
      />
    </div>
  );
}

/**
 * **합계 행**(원장 2026-09-18) — 열 아래에 맞춘 한 줄: `합계`(이름·학교학년 병합) · 청구액 합 · 수업 차수 합 · 등록 차수 합 ·
 * 날짜별 시수 합 · 출석률 평균. *"'이름'과 '학교학년' 행을 병합해서 '합계'라고 셀 안에 적으면"*.
 *
 * 🔴 **검색을 따른다** — 아래 요약 줄과 같은 규약(좁혀 놓고 전체인 척하지 않는다, [[#89]]): 검색 중이면 라벨이
 *    `검색 합계`가 되고 숫자는 걸린 행만 센다.
 * 🔴 시수·출석률은 **입력을 즉시 따라간다**(격자 `useColumnTotals` → `countCells`). 격자가 없으면 서버가 같은 함수로
 *    만든 `fallback`을 쓴다.
 * 🔴 등록 차수 합에서 옛 **일수 기준** 확정은 뺀다 — 시수가 아니라 출석 일수라 더하면 단위가 다른 수의 합이 된다.
 * ⚠️ 차이확인 열은 비운다(원장이 합계를 요청한 열은 청구액·수업 차수·등록 차수다).
 */
export function MatrixColumnTotalsRow({
  rows,
  days,
  showClassBilled,
  showPrice = false,
  billedColumnWidth = 76,
  showTermSessions,
  billedByRow,
  termByRow,
  suffix = null,
  fallback,
  lang = "ko",
}: {
  /** 표의 모든 행 키(검색 전). */
  rows: readonly string[];
  days: readonly { date: string; placeholder?: boolean }[];
  showClassBilled: boolean;
  showPrice?: boolean;
  /** 학생 행의 청구액 폭. 합계가 길면 왼쪽 라벨 공간에서 필요한 만큼만 더 쓴다. */
  billedColumnWidth?: number;
  showTermSessions: boolean;
  billedByRow?: Record<string, number | null>;
  termByRow?: Record<string, AttendanceTermSessions | null>;
  /** 표의 반들이 **한 단위**일 때만(영어만 U · 수학만 T). 섞이면 null — 한 글자로 묶으면 거짓이다. */
  suffix?: AttendanceUnitSuffix;
  fallback: ColumnTotals;
  lang?: SheetLang;
}) {
  const search = useAttendanceSearch();
  const searching = search?.active ?? false;
  const scope = searching ? rows.filter((r) => search!.matched.has(r)) : rows;
  const live = useColumnTotals(scope);
  // 검색 중인데 격자가 없으면(테스트·첫 렌더) 서버 값은 **전체**라 쓸 수 없다 — 비워 둔다.
  const totals = live ?? (searching ? null : fallback);

  let billed = 0;
  let billedAny = false;
  let term = 0;
  let termAny = false;
  let daysBasisSkipped = 0;
  for (const r of scope) {
    const b = billedByRow?.[r];
    if (typeof b === "number") {
      billed += b;
      billedAny = true;
    }
    const t = termByRow?.[r];
    if (t) {
      if (t.daysBasis) daysBasisSkipped++;
      else {
        term += t.units;
        termAny = true;
      }
    }
  }
  const cell = "border-line border-t-2 border-r px-1 py-1.5 text-xs font-bold whitespace-nowrap num";
  return (
    <tr className="bg-bg-soft">
      <td
        colSpan={2 + (showPrice ? 1 : 0) + (showClassBilled ? 1 : 0)}
        className="border-line bg-bg-soft z-10 border-t-2 border-r p-0 text-xs font-bold whitespace-nowrap sm:sticky sm:left-0"
      >
        {/* 합계 행 안에서만 경계를 옮긴다. colgroup을 바꾸면 위 학생들의 학교 열까지 줄어든다. */}
        <div className="flex items-stretch">
          <span className="min-w-0 flex-1 px-2 py-1.5 text-center">
            {sheetT(lang, searching ? "att.totals.search" : "att.totals.all")}
          </span>
          {showClassBilled ? (
            <span
              className="border-line bg-att-col-billed shrink-0 border-l px-1 py-1.5 text-right num"
              style={{ minWidth: billedColumnWidth }}
            >
              {billedAny ? formatMoney(billed) : "—"}
            </span>
          ) : null}
        </div>
      </td>
      <td className={`${cell} bg-att-col-sessions text-right`}>
        {totals ? formatUnitsWithSuffix(totals.units, suffix) : "—"}
      </td>
      {showTermSessions ? (
        <>
          <td
            className={`${cell} bg-att-col-sessions text-right`}
            title={daysBasisSkipped > 0 ? sheetTf(lang, "att.totals.daysBasisSkipped", { n: daysBasisSkipped }) : undefined}
          >
            {termAny ? formatUnitsWithSuffix(term, suffix) : "—"}
          </td>
          <td className={cell} />
        </>
      ) : null}
      {days.map((d) => {
        const u = d.placeholder ? undefined : totals?.dayUnits[d.date];
        return (
          <td key={d.date} className={`${cell} px-0 text-center`}>
            {u ? formatUnitsWithSuffix(u, null) : ""}
          </td>
        );
      })}
      <td
        className={`border-line bg-bg-soft sticky right-0 z-10 border-t-2 border-l px-2 py-1.5 text-right text-xs font-bold whitespace-nowrap num ${rateColorOf(totals?.rateAvg ?? null)}`}
        title={sheetT(lang, "att.totals.rateAvgTitle")}
      >
        {totals?.rateAvg == null ? "—" : `${totals.rateAvg}%`}
      </td>
    </tr>
  );
}
