"use client";

import { HrefSelect } from "@/components/href-select";
import { PeriodNav } from "@/components/period-nav";
import { addDays, formatKoreanDate } from "@/lib/date-kst";
import { SEASON_LABEL, SEASONS, type Season } from "@/features/shuttle/types";

/**
 * 셔틀 면 공용 **시즌 드롭다운** — `시즌: 학기중`(지시서 §10: 상태가 남는 선택은 칩 줄이 아니라 `축: 값` 라벨).
 * 항목은 href(면마다 경로·날짜가 달라 서버/호출부가 만든다) → `HrefSelect`(출석부 '보기'·캘린더 '보기'와 같은 부품).
 * 옛 모양 = `학기중 | 방학중` 알약 칩 둘(SHUTTLE_CHIP, 네 면이 각자 그렸다 — 디자인 v5 17단계 2026-09-04).
 */
export function ShuttleSeasonSelect({ season, hrefFor }: { season: Season; hrefFor: (s: Season) => string }) {
  return (
    <HrefSelect
      axisLabel="시즌"
      ariaLabel="시즌 선택"
      value={season}
      options={SEASONS.map((s) => ({ value: s, label: SEASON_LABEL[s], href: hrefFor(s) }))}
    />
  );
}

/**
 * 셔틀 날짜 면(오늘 등하원·운행 현황·실시간 위치) 공용 **날짜 이동 + 시즌** — 앱 전역 `PeriodNav`(원장 2026-08-31
 * *"웹앱 내 비슷한 곳은 다 이걸로"*; 라벨 클릭 = 오늘, 과거/미래 조회 배지) + 위 시즌 드롭다운.
 * 옛 모양 = `[<] 2026년 9월 4일 (금) [>]` outline 아이콘 버튼 둘 + 시즌 칩 둘 — 세 면이 각자 그렸다.
 * 📱 폰 44px은 `SHUTTLE_TOOLBAR` 래퍼가 변수로 올린다(이 부품은 공용 값만 읽는다).
 */
export function ShuttleDayNav({
  date,
  today,
  season,
  hrefFor,
}: {
  date: string;
  /** 서버(KST)가 내려준 오늘 — 클라 시계로 정하면 자정 부근에 서버·클라가 갈린다. */
  today: string;
  season: Season;
  hrefFor: (date: string, season: Season) => string;
}) {
  return (
    <>
      <PeriodNav
        label={formatKoreanDate(date)}
        prevHref={hrefFor(addDays(date, -1), season)}
        nextHref={hrefFor(addDays(date, 1), season)}
        currentHref={hrefFor(today, season)}
        relation={date === today ? "current" : date < today ? "past" : "future"}
        prevAriaLabel="어제"
        nextAriaLabel="내일"
        currentTitle="눌러서 오늘로"
        // "2026년 12월 31일 (수)"(18px 굵게 실측 182px)가 안 넘치는 고정 폭 — 152 × 1.4 = 213, 내용 폭 195(리뷰 실측: 124는 오늘 날짜부터 넘쳤다).
        labelWidth={152}
      />
      <ShuttleSeasonSelect season={season} hrefFor={(s) => hrefFor(date, s)} />
    </>
  );
}
