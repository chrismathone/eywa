import Link from "next/link";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";

/** 교시 칩 한 줄에 필요한 최소한 — 자리 화면 두 곳(교시 하나 / '전체')이 같은 줄을 쓴다. */
export type SeatPeriodChip = { start: string; classIds: string[] };

/** '전체' 보기를 가리키는 `?start=` 값 — 링크·판정이 한 낱말을 공유한다(문자열을 두 곳에 적지 않게). */
export const SEAT_ALL_PERIODS = "all";

/**
 * 교시 칩 줄 — `전체`(있을 때만) + 교시들.
 *
 * 🔴 **한 벌이다** — 교시 하나 보기는 `SeatBoard` 안에서, '전체' 보기는 페이지가 위에 한 번만 그린다.
 *    두 줄을 따로 만들면 칩 모양·순서가 갈린다.
 * ⚠️ '전체'는 **랩실에서만** 선다(원장 2026-09-10 ⑨) — JJ실은 교시마다 진도(수업계획) 블록이 붙어서
 *    하루치를 한 화면에 펼치면 그 블록이 교시 수만큼 쌓이고 조회도 그만큼 늘어난다(B6).
 */
export function SeatPeriodChips({
  periods,
  activeStart,
  hrefFor,
  showAll,
}: {
  periods: readonly SeatPeriodChip[];
  /** 지금 보고 있는 교시 시작시각, 또는 `SEAT_ALL_PERIODS`. */
  activeStart: string;
  /** `?start=` 앞까지의 주소(뒤에 값이 그대로 붙는다). */
  hrefFor: string;
  showAll: boolean;
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
        <Link
          key={p.start}
          href={`${hrefFor}${p.start}`}
          className={`${TOOLBAR_CHIP} tabular-nums ${p.start === activeStart ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
        >
          {p.start}
          <span className="ml-1.5 text-xs font-medium opacity-80">{p.classIds.length}개 반</span>
        </Link>
      ))}
    </div>
  );
}
