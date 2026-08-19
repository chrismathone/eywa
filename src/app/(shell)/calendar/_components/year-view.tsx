import { chipProps } from "@/features/calendar/color";
import { eventDisplayColor, type CalendarEvent } from "@/features/calendar/types";

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
          <section key={m} className="border-line bg-card shadow-card rounded-2xl border p-3">
            <h3 className="text-foreground mb-2 flex items-baseline justify-between text-[14px] font-bold">
              {m}월
              {list.length > 0 ? (
                <span className="num text-text-faint text-[11px] font-normal">{list.length}건</span>
              ) : null}
            </h3>
            {list.length === 0 ? (
              <p className="text-text-faint py-2 text-center text-[12px]">일정 없음</p>
            ) : (
              <ul className="space-y-1">
                {list.map((e) => {
                  const chip = chipProps(eventDisplayColor(e));
                  return (
                    <li key={e.id} className="flex items-start gap-1.5">
                      <span className="num text-text-dim w-[56px] shrink-0 pt-0.5 text-right text-[11px] whitespace-nowrap">
                        {dayLabel(e, monthKey)}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-[12px] leading-tight font-medium ${chip.className}`}
                        style={chip.style}
                        title={e.title}
                      >
                        {e.title}
                      </span>
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
