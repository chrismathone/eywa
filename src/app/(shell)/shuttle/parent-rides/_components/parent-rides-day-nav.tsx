"use client";

import { SHUTTLE_PARENT_RIDES_PATH } from "@/features/shuttle/faces";
import type { Season } from "@/features/shuttle/types";
import { ShuttleDayNav } from "../../_components/shuttle-day-nav";

/**
 * 학부모 등하원(관리자 뷰) 날짜 이동 + 시즌 — 다른 셔틀 날짜 면과 같은 공용 부품(ShuttleDayNav).
 * `hrefFor`가 함수라 서버 페이지에서 바로 넘길 수 없어(서버→클라 경계) 이 얇은 감싸개가 만든다.
 * 날짜는 **오늘이면 주소에서 뺀다**(라벨 클릭 = 오늘 규약과 같은 주소).
 */
export function ParentRidesDayNav({ date, today, season }: { date: string; today: string; season: Season }) {
  const href = (d: string, s: Season) => {
    const q = new URLSearchParams();
    if (d !== today) q.set("d", d);
    if (s !== "term") q.set("season", s);
    const qs = q.toString();
    return qs ? `${SHUTTLE_PARENT_RIDES_PATH}?${qs}` : SHUTTLE_PARENT_RIDES_PATH;
  };
  return <ShuttleDayNav date={date} today={today} season={season} hrefFor={href} />;
}
