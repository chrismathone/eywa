"use client";

import { Clock, UserCheck, Users, UserX } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
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

/**
 * 상단 스탯 4개 — 출석률·결석·지각은 입력을 즉시 따라간다. '등록 학생'만 서버 값(출결과 무관하게 고정).
 * ⚠️ 기록이 0건이면 "0%"는 **사실이 아니다** — 출석률이 0인 게 아니라 아직 아무도 안 찍은 것이다.
 *    과목을 하드코딩하지 않고 **데이터 유무**로 가른다(데이터가 생기면 저절로 숫자로 돌아온다).
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
    <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      <BigStat
        label="등록 학생"
        value={totalStudents}
        unit="명"
        tone="primary"
        icon={<Users size={16} strokeWidth={1.8} />}
      />
      <BigStat
        label="출석률"
        value={c.recorded > 0 ? rate : "—"}
        unit={c.recorded > 0 ? "%" : undefined}
        tone={c.recorded === 0 ? "neutral" : rate >= 90 ? "primary" : rate >= 80 ? "amber" : "danger"}
        sub={c.recorded > 0 ? undefined : "기록 없음"}
        icon={<UserCheck size={16} strokeWidth={1.8} />}
      />
      <BigStat label="결석" value={c.absent} unit="회" tone="danger" icon={<UserX size={16} strokeWidth={1.8} />} />
      <BigStat label="지각" value={c.late} unit="회" tone="amber" icon={<Clock size={16} strokeWidth={1.8} />} />
    </section>
  );
}
