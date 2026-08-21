import { weekdayIndexOf } from "@/lib/date-kst";
import { chipProps } from "@/features/calendar/color";
import { eventTimeLabel, type CalendarEvent } from "@/features/calendar/types";

/**
 * 분석 화면의 **일정 한 줄** — 연대기(StatsTimeline)와 숫자 칸 모달(StatsMatrix)이 공유한다.
 * 같은 일정이 두 곳에서 다르게 보이면 "같은 건인지" 되짚게 되므로 한 곳에서만 그린다.
 *
 * ⚠️ 제목은 자르지 않는다(truncate 금지) — 읽으려고 연 목록이라 어절 단위로 접어 전부 보인다.
 * ⚠️ 서버·클라 양쪽에서 import한다 — 이 파일에 server-only·"use client"를 붙이지 말 것([[#61]]·[[#81]]).
 */

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-08-20" → "8/20 (목)" — 연도는 블록 제목·모달 제목이 이미 말한다. */
export function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

/**
 * 이 줄이 실제로 읽는 필드만 — **클라이언트로 내려보낼 최소 집합**이기도 하다.
 * 🔑 `CalendarEvent` 전체를 받으면 memo(최대 2,000자)·작성자·source까지 직렬화돼 3년치에서
 *    페이로드가 수 배로 뛴다(캘린더는 창으로 열리는 화면 — 반응속도가 1순위다).
 *    타입을 좁혀 두면 호출부가 무심코 전건을 넘길 때 컴파일러가 잡아 준다.
 */
export type EventRowData = Pick<
  CalendarEvent,
  "id" | "title" | "startDate" | "endDate" | "startTime" | "endTime" | "tag"
>;

export function EventRow({ event }: { event: EventRowData }) {
  const time = eventTimeLabel(event);
  const chip = event.tag ? chipProps(event.tag.color) : null;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1">
      <span className="num text-text-dim w-[74px] shrink-0 text-[12px] whitespace-nowrap">
        {shortDate(event.startDate)}
      </span>
      <span className="text-foreground min-w-0 flex-1 text-[13px] font-medium break-keep">
        {event.title}
      </span>
      {event.endDate !== event.startDate ? (
        <span className="num text-text-faint shrink-0 text-[11px] whitespace-nowrap">
          ~{shortDate(event.endDate)}
        </span>
      ) : null}
      {time ? (
        <span className="num text-text-faint shrink-0 text-[11px] whitespace-nowrap">{time}</span>
      ) : null}
      {event.tag && chip ? (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}
          style={chip.style}
        >
          {event.tag.name}
        </span>
      ) : null}
    </li>
  );
}
