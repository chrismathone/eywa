import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { dotProps } from "@/features/calendar/color";
import { type CalendarColor, type CalendarEvent, type CalendarTag } from "@/features/calendar/types";
import { StatsTimeline } from "./stats-timeline";

/**
 * 분석 뷰 — **요약표(태그 × 연도 × 월 건수) + 제목 연대기**(0224a 다중 뷰, 2026-08-19 개편).
 *
 * 원장 지시 2건이 이 화면의 형태를 정했다:
 *   ① *"갯수로 나오지말고 각각 그 제목들 쭈루룩 뜨게"* → 건수표는 **요약**으로 물러나고,
 *      본문은 연도→월→제목을 전부 펼치는 [StatsTimeline]이 맡는다(태그 필터 없이도 보인다).
 *   ② *"전년도 후년도까지 한번에"* → 한 해가 아니라 **3개년 창**을 받는다. 요약표는 태그마다
 *      연도 소행(小行)을 두어 같은 달을 해마다 위아래로 비교하게 한다.
 *
 * ⚠️ 집계·목록 **둘 다 시작일 기준**이다(규칙이 갈리면 표와 목록의 숫자가 어긋난다).
 *    창 밖에서 시작해 창 안으로 이어지는 일정은 어느 쪽에도 없다 — 각주로 명시.
 */

const NONE_KEY = "__none__";
const ALL_KEY = "__all__";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type Group = { key: string; label: string; color?: CalendarColor; strong?: boolean };

const emptyMonths = () => Array.from({ length: 12 }, () => 0);
const yearOf = (e: CalendarEvent) => Number(e.startDate.slice(0, 4));

/** 열 구분선 — 표 규약(행 구분선보다 한 단계 옅게, `docs/design-conventions.md`). */
const DIVIDER = "border-line-faint border-l";

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

  // 태그키 → 연도 → 월별 건수. 요약표의 모든 칸이 이 한 맵에서 나온다.
  const counts = new Map<string, Map<number, number[]>>();
  for (const e of inWindow) {
    const key = e.tag?.id ?? NONE_KEY;
    const byYear = counts.get(key) ?? new Map<number, number[]>();
    const arr = byYear.get(yearOf(e)) ?? emptyMonths();
    arr[Number(e.startDate.slice(5, 7)) - 1] += 1;
    byYear.set(yearOf(e), arr);
    counts.set(key, byYear);
  }

  function monthsFor(key: string, year: number): number[] {
    if (key !== ALL_KEY) return counts.get(key)?.get(year) ?? emptyMonths();
    const out = emptyMonths();
    for (const byYear of counts.values()) {
      const arr = byYear.get(year);
      if (arr) for (let i = 0; i < 12; i += 1) out[i]! += arr[i]!;
    }
    return out;
  }

  const groups: Group[] = [
    ...tags.map((t) => ({ key: t.id, label: t.name, color: t.color })),
    ...(counts.has(NONE_KEY) ? [{ key: NONE_KEY, label: "태그 없음" }] : []),
    { key: ALL_KEY, label: "전체", strong: true },
  ];

  // 연대기 — 태그 필터를 여기서만 적용한다(요약표는 전체 유지).
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

      <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-3 py-2 text-center">태그</th>
              <th className={`micro px-2 py-2 text-center ${DIVIDER}`}>연도</th>
              {MONTHS.map((m) => (
                <th key={m} className={`micro px-1.5 py-2 text-center ${DIVIDER}`}>
                  {m}월
                </th>
              ))}
              <th className={`micro px-2 py-2 text-center ${DIVIDER}`}>합계</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {groups.map((g) =>
              years.map((y, yi) => {
                const arr = monthsFor(g.key, y);
                const total = arr.reduce((a, b) => a + b, 0);
                const dot = g.color ? dotProps(g.color) : null;
                return (
                  <tr
                    key={`${g.key}-${y}`}
                    className={g.strong ? "bg-bg-soft/40" : "hover:bg-bg-soft/30"}
                  >
                    {yi === 0 ? (
                      <td
                        rowSpan={years.length}
                        className={`px-3 py-2 align-top text-xs whitespace-nowrap ${
                          g.strong ? "font-bold" : ""
                        } ${g.key === NONE_KEY ? "text-text-dim" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {dot ? (
                            <span
                              className={`size-2 shrink-0 rounded-full ${dot.className}`}
                              style={dot.style}
                              aria-hidden
                            />
                          ) : null}
                          {g.label}
                        </span>
                      </td>
                    ) : null}
                    <td className={`num text-text-dim px-2 py-2 text-center text-xs ${DIVIDER}`}>
                      {y}
                    </td>
                    {arr.map((n, i) => (
                      <td key={i} className={`num px-1.5 py-2 text-center text-xs ${DIVIDER}`}>
                        {n > 0 ? n : <span className="text-text-faint">·</span>}
                      </td>
                    ))}
                    <td className={`num px-2 py-2 text-center text-xs font-bold ${DIVIDER}`}>
                      {total > 0 ? total : <span className="text-text-faint font-normal">·</span>}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
        <p className="text-text-faint border-line border-t px-3 py-1.5 text-[11px]">
          여러 날 일정은 시작일 기준 1건 · {years[0]}년 이전에 시작해 이어지는 일정은 집계·목록에
          없습니다
        </p>
      </DragScrollArea>

      <StatsTimeline years={years} eventsByYear={eventsByYear} />
    </div>
  );
}
