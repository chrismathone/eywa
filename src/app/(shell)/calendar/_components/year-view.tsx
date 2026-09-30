import { chipProps } from "@/features/calendar/color";
import { eventDisplayColor, type CalendarEvent } from "@/features/calendar/types";
import { EventOpenButton } from "./event-open";
import { cancelledSuffix, cancelledTitleClass, countEvents } from "@/features/calendar/cancelled";

/**
 * 연간 뷰 — 12개월 카드 격자(0224a 다중 뷰). "행사 태그 연간보기": 태그 필터는 page가 URL로
 * 확정해 걸러 내려주므로 여기는 그리기만 한다. 색은 표시색 단일 규칙(eventDisplayColor) 경유.
 */

/** 카드 안 날짜 라벨 — "20일" / "20~28일"(같은 달) / "20일~"(다음 달로 걸침) / "~5일"(전달에서 이어짐). */
function dayLabel(e: CalendarEvent, month: string): string {
  const sameStart = e.startDate.slice(0, 7) === month;
  const sameEnd = e.endDate.slice(0, 7) === month;
  const sd = Number(e.startDate.slice(8, 10));
  const ed = Number(e.endDate.slice(8, 10));
  if (e.startDate === e.endDate) return `${sd}일`;
  if (sameStart && sameEnd) return `${sd}~${ed}일`;
  if (sameStart) return `${sd}일~`;
  return sameEnd ? `~${ed}일` : "계속";
}

export function YearView({ year, events }: { year: number; events: CalendarEvent[] }) {
  // 시작 월 기준으로 묶는다 — 전년도에 시작해 이어지는 일정은 1월 카드에(잃지 않고 보인다).
  const byMonth = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const m = e.startDate.startsWith(`${year}-`) ? Number(e.startDate.slice(5, 7)) : 1;
    byMonth.set(m, [...(byMonth.get(m) ?? []), e]);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const list = byMonth.get(m) ?? [];
        const monthKey = `${year}-${String(m).padStart(2, "0")}`;
        return (
          <section key={m} className="bg-card shadow-card rounded-2xl p-3">
            <h3 className="text-foreground mb-2 flex items-baseline justify-between text-base font-bold">
              {m}월
              {list.length > 0 ? (
                <span className="num text-text-faint text-xs font-normal">
                  {countEvents(list).active}건{cancelledSuffix(countEvents(list).cancelled)}
                </span>
              ) : null}
            </h3>
            {list.length === 0 ? (
              <p className="text-text-faint py-2 text-center text-sm">일정 없음</p>
            ) : (
              <ul className="space-y-1">
                {list.map((e) => {
                  const chip = chipProps(eventDisplayColor(e));
                  return (
                    <li key={e.id} className="flex items-start gap-1.5">
                      <span className="num text-text-dim w-18 shrink-0 pt-0.5 text-right text-sm whitespace-nowrap">
                        {dayLabel(e, monthKey)}
                      </span>
                      {/* 누르면 월 보기와 같은 일정 창(N9). 칩 색은 버튼 안 span이 든다(버튼에 인라인 style을 넘기지 않게). */}
                      <EventOpenButton id={e.id} className="min-w-0 flex-1">
                      <span
                        className={`block truncate rounded px-1.5 py-0.5 text-sm leading-tight font-medium ${chip.className}`}
                        style={chip.style}
                        // 태그 이름은 툴팁에 — 옛 태그 칩 줄이 색의 범례였는데 드롭다운엔 색이 없어, 연간 카드에선 이 툴팁이
                        // 유일하게 "이 색이 무슨 태그인지"를 말한다(월 그리드와 같은 `[태그] 제목` 규약, 적대 리뷰 2026-09-04).
                        title={e.tag ? `[${e.tag.name}] ${e.title}` : e.title}
                      >
                        <span className={cancelledTitleClass(e.title)}>{e.title}</span>
                      </span>
                      </EventOpenButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
