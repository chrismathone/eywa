"use client";

import { formatSessionUnits } from "@/features/attendance/session-units";
import { rateDecimal, ratePercent, type Counted } from "@/features/attendance/grid/totals";
import { useRowCount, useRowsCount } from "./grid-context";

/**
 * 살아 있는 합계 — 칸을 치는 **그 순간** 시수·출석률·상단 스탯이 따라 움직인다.
 *
 * 🔴 왜 클라에서 세는가: 합계를 서버가 계산하면 저장 → 재조회 → 다시 그리기를 기다려야 해서, 칸은 즉시
 *    바뀌는데 합계만 1초쯤 늦게 따라온다(그 사이 화면은 서로 안 맞는 두 숫자를 동시에 보여준다).
 *    격자 저장소가 이미 모든 칸의 값을 들고 있으므로 **같은 식**(`grid/totals.ts`)으로 여기서 바로 센다.
 * ⚠️ 서버 값은 버리지 않는다 — 첫 렌더(SSR)와 격자가 없는 경우의 폴백이다. 두 경로 모두 같은 함수를 쓰므로
 *    숫자가 갈릴 수 없다.
 */

function rateColorOf(rate: number | null): string {
  if (rate === null) return "text-text-faint";
  return rate >= 90 ? "text-primary" : rate >= 80 ? "text-amber" : "text-danger";
}

/** 학생 행 끝의 고정 두 칸(시수·출석률). `<tr>` 안에 그대로 놓인다. */
export function RowTotalCells({ row, fallback }: { row: string; fallback: Counted }) {
  const live = useRowCount(row);
  const c = live ?? fallback;
  const rate = ratePercent(c);
  return (
    <>
      <td className="border-line text-foreground num sticky right-[64px] z-10 w-[52px] min-w-[52px] border-b border-l bg-card px-2 py-2 text-right text-[12px] whitespace-nowrap">
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

/** 여러 행의 시수 합(반 머리행·총합) — 숫자만 낸다. 라벨("시수")은 부르는 쪽이 붙인다. */
export function LiveUnits({ rows, fallback }: { rows?: string[]; fallback: Counted }) {
  const live = useRowsCount(rows);
  return <>{formatSessionUnits((live ?? fallback).units)}</>;
}

/** 표 전체 기록 수(범례의 "총 N회 기록"). */
export function LiveRecords({ rows, fallback }: { rows?: string[]; fallback: Counted }) {
  const live = useRowsCount(rows);
  return <>{(live ?? fallback).recorded}</>;
}

/** 툴바에 실리는 지표 한 칸 — 라벨 + 숫자 + 단위. */
function CompactMetric({
  label,
  value,
  unit,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string | number;
  unit?: string;
  valueClass?: string;
}) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-text-dim text-[12px] font-medium">{label}</span>
      <span className={`num text-[17px] leading-none font-bold tracking-tight ${valueClass}`}>{value}</span>
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
  const c = useRowsCount() ?? fallback;
  const rate = rateDecimal(c);

  return (
    <div className="flex items-center gap-x-3">
      <CompactMetric label="등록" value={totalStudents} unit="명" />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      {/* ⚠️ 기록 0건에 "0%"를 쓰지 않는다 — 출석률이 0인 게 아니라 아직 아무도 안 찍은 것이다.
          압축 바에서도 "—"만 두면 고장으로 읽히므로 단위 자리에 사유를 적는다. */}
      <CompactMetric
        label="출석률"
        value={c.recorded > 0 ? rate : "—"}
        unit={c.recorded > 0 ? "%" : "기록 없음"}
        valueClass={rateColorOf(c.recorded > 0 ? rate : null)}
      />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      <CompactMetric label="결석" value={c.absent} unit="회" valueClass="text-danger" />
      <span className="bg-line h-4 w-px shrink-0" aria-hidden />
      <CompactMetric label="지각" value={c.late} unit="회" valueClass="text-amber" />
    </div>
  );
}
