import { EventRow } from "./event-row";
import { type CalendarEvent } from "@/features/calendar/types";

/**
 * 분석 뷰의 **일정 제목 연대기** — 원장 2026-08-19: *"갯수로 나오지말고 각각 그 제목들 쭈루룩 뜨게."*
 * 연도 → 월 → `날짜 · 제목 · 태그` 줄. 위 요약표가 "몇 건"이라면 여기가 "무엇을 언제"다.
 *
 * 🔑 **일정이 없는 달도 한 줄로 남긴다** — 블록을 통째로 빼면 "그 달엔 없었다"와 "안 봤다"가
 *    구분되지 않는다(조사 도구라 이 차이가 결론을 바꾼다).
 * 줄 렌더는 [event-row.tsx](./event-row.tsx) 공용 — 숫자 칸 모달과 같은 모양이어야 한다.
 */

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 한 해 블록 — 월별로 나눠 그린다. 빈 달은 "없음" 한 줄. */
function YearBlock({ year, events }: { year: number; events: CalendarEvent[] }) {
  const byMonth = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const m = Number(e.startDate.slice(5, 7));
    byMonth.set(m, [...(byMonth.get(m) ?? []), e]);
  }

  return (
    <section className="bg-card shadow-card rounded-2xl">
      <header className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-foreground text-base font-bold">
          <span className="num">{year}</span>년
        </h3>
        <span className="text-text-dim text-sm">
          일정 <span className="num text-foreground font-semibold">{events.length}</span>건
        </span>
      </header>
      {events.length === 0 ? (
        // ⚠️ "등록된 일정이 없다"고 쓰지 않는다 — 태그 필터가 걸린 목록이면 사실이 아니다.
        <p className="text-text-faint px-4 py-3 text-sm">표시할 일정이 없습니다</p>
      ) : (
        <div className="divide-line divide-y">
          {MONTHS.map((m) => {
            const list = (byMonth.get(m) ?? []).slice().sort((a, b) =>
              a.startDate.localeCompare(b.startDate),
            );
            return (
              <div key={m} className="flex gap-3 px-4 py-2">
                <span
                  className={`num w-12 shrink-0 pt-0.5 text-sm font-semibold ${
                    list.length > 0 ? "text-foreground" : "text-text-faint"
                  }`}
                >
                  {m}월
                </span>
                <div className="min-w-0 flex-1">
                  {list.length === 0 ? (
                    <span className="text-text-faint text-sm">없음</span>
                  ) : (
                    <ul className="divide-line/60 divide-y">
                      {list.map((e) => (
                        <EventRow key={e.id} event={e} />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function StatsTimeline({
  years,
  eventsByYear,
}: {
  /** 표시할 연도(오름차순) — 창 밖 연도는 호출부가 이미 걸렀다. */
  years: number[];
  /** 연도별 일정(시작일 기준). 태그 필터가 걸렸으면 호출부에서 이미 좁혀 넘긴다. */
  eventsByYear: Map<number, CalendarEvent[]>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {years.map((y) => (
        <YearBlock key={y} year={y} events={eventsByYear.get(y) ?? []} />
      ))}
    </div>
  );
}
