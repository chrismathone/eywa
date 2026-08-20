"use client";

import { formatSessionUnits } from "@/features/attendance/session-units";
import { EMPTY_COUNT, rateDecimal, ratePercent, sumCounts, type Counted } from "@/features/attendance/grid/totals";
import { useRowCount, useRowsCount } from "./grid-context";
import { useAttendanceSearch } from "./search-context";

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

/** 학생 행 끝의 고정 두 칸(시수·출석률). `<tr>` 안에 그대로 놓인다. */
export function RowTotalCells({ row, fallback }: { row: string; fallback: Counted }) {
  const live = useRowCount(row);
  const c = live ?? fallback;
  const rate = ratePercent(c);
  return (
    <>
      <td className="border-line text-foreground num sticky right-[64px] z-10 w-[40px] min-w-[40px] border-b border-l bg-card px-1.5 py-2 text-right text-[12px] whitespace-nowrap">
        {c.units > 0 ? formatSessionUnits(c.units) : "—"}
      </td>
      <td
        className={`border-line num sticky right-0 z-10 w-[64px] min-w-[64px] border-b bg-card px-2 py-2 text-right text-[12px] font-bold whitespace-nowrap ${rateColorOf(rate)}`}
      >
        {rate === null ? "—" : `${rate}%`}
      </td>
    </>
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
      <span className="text-text-dim text-[12px] font-medium">{label}</span>
      <span className={`num text-[17px] leading-none font-bold tracking-tight ${valueClass}`}>{value}</span>
      {ofTotal !== null && ofTotal !== undefined ? (
        <span className="text-text-faint num text-[12px] font-medium">{`/ ${ofTotal}`}</span>
      ) : null}
      {unit ? <span className="text-text-faint text-[11px] font-medium">{unit}</span> : null}
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
  const search = useAttendanceSearch();
  // 🔴 검색 중이면 이 숫자들도 검색을 따라간다(2026-08-20) — 목록만 좁고 숫자는 전체이면, 바로 옆
  //    검색 칩이 "1/38명 표시"라고 말하는 그 화면에서 출석률·결석이 다른 38명 얘기를 하게 된다.
  //    전체 값은 `검색분 / 전체`로 함께 세워 사라지지 않는다.
  const { scoped, all, searching } = useScopedCounts(undefined, undefined, fallback);
  const c = scoped;
  const rate = rateDecimal(c);
  const allRate = rateDecimal(all);

  return (
    <div className="flex items-center gap-x-3">
      <CompactMetric
        label="등록"
        value={searching ? (search?.matchedStudents ?? 0) : totalStudents}
        ofTotal={searching ? totalStudents : null}
        unit="명"
      />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      {/* ⚠️ 기록 0건에 "0%"를 쓰지 않는다 — 출석률이 0인 게 아니라 아직 아무도 안 찍은 것이다.
          압축 바에서도 "—"만 두면 고장으로 읽히므로 단위 자리에 사유를 적는다. */}
      {/* ⚠️ 단위(%)는 **한 번만** 붙는다 — 병기 값에도 %를 달면 "91.2 / 88% %"가 된다.
          검색분에 기록이 없어도 전체에 있으면 단위는 %다(그 자리가 "기록 없음"이면 옆 숫자가 미아가 된다). */}
      <CompactMetric
        label="출석률"
        value={c.recorded > 0 ? rate : "—"}
        ofTotal={searching ? (all.recorded > 0 ? allRate : "—") : null}
        unit={c.recorded > 0 || (searching && all.recorded > 0) ? "%" : "기록 없음"}
        valueClass={rateColorOf(c.recorded > 0 ? rate : null)}
      />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      <CompactMetric
        label="결석"
        value={c.absent}
        ofTotal={searching ? all.absent : null}
        unit="회"
        valueClass="text-danger"
      />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      <CompactMetric
        label="지각"
        value={c.late}
        ofTotal={searching ? all.late : null}
        unit="회"
        valueClass="text-amber"
      />
    </div>
  );
}
