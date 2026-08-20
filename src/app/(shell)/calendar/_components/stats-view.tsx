import { type CalendarEvent, type CalendarTag } from "@/features/calendar/types";
import type { EventRowData } from "./event-row";
import { StatsMatrix } from "./stats-matrix";
import { StatsTimeline } from "./stats-timeline";

/**
 * 분석 뷰 — **요약표(태그 × 연도 × 월 건수) + 제목 연대기**(0224a 다중 뷰, 2026-08-19 개편).
 *
 * 원장 지시가 이 화면의 형태를 정했다:
 *   ① *"갯수로 나오지말고 각각 그 제목들 쭈루룩 뜨게"* → 건수표는 **요약**으로 물러나고,
 *      본문은 연도→월→제목을 전부 펼치는 [StatsTimeline]이 맡는다(태그 필터 없이도 보인다).
 *   ② *"전년도 후년도까지 한번에"* → 한 해가 아니라 **3개년 창**을 받는다.
 *   ③ *"숫자로 된 거 누르면 모달로 무슨 행사가 몇 건인지"*(2026-08-20) → 요약표는 클릭 가능한
 *      [StatsMatrix](클라이언트)가 맡는다. 건수와 모달 목록이 **한 배열에서 같은 필터**로 나온다.
 *
 * ⚠️ 집계·목록 **둘 다 시작일 기준**이다(규칙이 갈리면 표와 목록의 숫자가 어긋난다).
 *    창 밖에서 시작해 창 안으로 이어지는 일정은 어느 쪽에도 없다 — 표 각주로 명시.
 */

const yearOf = (e: CalendarEvent) => Number(e.startDate.slice(0, 4));

/**
 * 클라이언트(StatsMatrix)로 넘길 최소 필드만 남긴다 — **표·모달이 읽지 않는 것은 안 보낸다.**
 * 🔑 memo는 최대 2,000자다. 3년치 전건을 그대로 직렬화하면 RSC 페이로드가 수 배로 뛰고(실측
 *    225건 기준 56KB → 최대 1.4MB), 캘린더는 창으로 열리는 화면이라 그게 곧 첫 페인트 지연이다.
 */
function toRowData(e: CalendarEvent): EventRowData {
  return {
    id: e.id,
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime,
    endTime: e.endTime,
    tag: e.tag,
  };
}

export function StatsView({
  years,
  events,
  tags,
  tagFilter,
}: {
  /** 분석 창(오름차순) — 보통 [전년, 해당연도, 다음연도]. */
  years: number[];
  /** 창과 겹치는 수기 일정 전건(태그 필터 **미적용** — 요약표는 전체가 있어야 비교가 된다). */
  events: CalendarEvent[];
  tags: CalendarTag[];
  /** URL 태그 필터 — 태그 id 또는 "none"(태그 없음). 걸리면 아래 연대기를 그 태그로 좁힌다. */
  tagFilter?: string;
}) {
  const inWindow = events.filter((e) => years.includes(yearOf(e)));

  // 연대기 — 태그 필터를 여기서만 적용한다(요약표는 전체 유지: 비교의 기준선이 흔들리면 안 된다).
  const listed =
    tagFilter === undefined
      ? inWindow
      : inWindow.filter((e) => (tagFilter === "none" ? !e.tag : e.tag?.id === tagFilter));
  const eventsByYear = new Map<number, CalendarEvent[]>();
  for (const e of listed) {
    eventsByYear.set(yearOf(e), [...(eventsByYear.get(yearOf(e)) ?? []), e]);
  }
  const filterName =
    tagFilter === undefined
      ? null
      : tagFilter === "none"
        ? "태그 없음"
        : (tags.find((t) => t.id === tagFilter)?.name ?? null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-dim text-[13px]">
        <span className="num text-foreground font-bold">
          {years[0]}~{years[years.length - 1]}
        </span>
        년 일정 <span className="num text-foreground font-bold">{inWindow.length}</span>건 · 태그{" "}
        <span className="num text-foreground font-bold">{tags.length}</span>종
        {filterName ? (
          <span className="text-text-faint">
            {" "}
            · 아래 목록은 &lsquo;{filterName}&rsquo;만
          </span>
        ) : null}
      </p>

      <StatsMatrix years={years} events={inWindow.map(toRowData)} tags={tags} />
      <StatsTimeline years={years} eventsByYear={eventsByYear} />
    </div>
  );
}
