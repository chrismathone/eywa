import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";

/** 교시 칩 한 줄에 필요한 최소한 — 자리 화면 두 곳(교시 하나 / '전체')이 같은 줄을 쓴다. */
export type SeatPeriodChip = { start: string; classIds: string[] };

/** '전체' 보기를 가리키는 `?start=` 값 — 링크·판정이 한 낱말을 공유한다(문자열을 두 곳에 적지 않게). */
export const SEAT_ALL_PERIODS = "all";

/** 교시 칩 하나를 그리는 조각의 입력 — 기본 조각은 그냥 링크다. */
export type SeatPeriodChipProps = { start: string; href: string; className: string; children: ReactNode };

function LinkChip({ href, className, children }: SeatPeriodChipProps) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * 교시 칩 줄 — `전체`(있을 때만) + 교시들.
 *
 * 🔴 **한 벌이다** — 교시 하나 보기(JJ실·공개 PIN)는 `SeatBoard` 안에서, 랩실 로그인 화면은 `SeatAllDay`가 그린다.
 *    두 줄을 따로 만들면 칩 모양·순서가 갈린다.
 * 🔑 **드래그의 놓을 곳**(원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임"*) — 랩실 로그인
 *    화면은 교시 칩을 놓을 곳으로 만든 조각(`SeatDropChip`)을 `Chip`으로 넘긴다(칩에 놓으면 그 교시로). 이 파일은
 *    서버 페이지도 import하므로 dnd-kit을 여기서 부르지 않는다 — 받아 끼울 뿐이다.
 * ⚠️ '전체'는 로그인 화면의 **랩실·JJ실 둘 다** 선다(랩실 2026-09-10 ⑨ · JJ실 2026-09-18 *"펼치기"*). JJ실은 교시마다
 *    진도(수업계획) 블록이 붙어서 '전체'에선 계획을 교시마다 **접은 채** 시작한다(`SeatJjAllDay`). 공개 PIN 화면은
 *    랩실에서만 선다(그 문이 따로 정한다).
 */
export function SeatPeriodChips({
  periods,
  activeStart,
  hrefFor,
  showAll,
  Chip = LinkChip,
}: {
  periods: readonly SeatPeriodChip[];
  /** 지금 보고 있는 교시 시작시각, 또는 `SEAT_ALL_PERIODS`. */
  activeStart: string;
  /** `?start=` 앞까지의 주소(뒤에 값이 그대로 붙는다). */
  hrefFor: string;
  showAll: boolean;
  /** 교시 칩 하나를 그리는 조각 — 드래그를 받는 화면만 넘긴다. '전체' 칩은 언제나 링크다(교시가 아니다). */
  Chip?: ComponentType<SeatPeriodChipProps>;
}) {
  return (
    <div className="toolbar-rail flex shrink-0 items-center gap-1.5 overflow-x-auto">
      {showAll ? (
        <Link
          href={`${hrefFor}${SEAT_ALL_PERIODS}`}
          title="오늘 이 자리의 모든 교시를 위에서 아래로 한 번에 봅니다"
          className={`${TOOLBAR_CHIP} ${
            activeStart === SEAT_ALL_PERIODS ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF
          }`}
        >
          전체
          <span className="ml-1.5 text-xs font-medium opacity-80">{periods.length}교시</span>
        </Link>
      ) : null}
      {periods.map((p) => (
        <Chip
          key={p.start}
          start={p.start}
          href={`${hrefFor}${p.start}`}
          className={`${TOOLBAR_CHIP} tabular-nums ${p.start === activeStart ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
        >
          {p.start}
          <span className="ml-1.5 text-xs font-medium opacity-80">{p.classIds.length}개 반</span>
        </Chip>
      ))}
    </div>
  );
}
