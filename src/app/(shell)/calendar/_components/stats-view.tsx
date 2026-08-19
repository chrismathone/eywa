import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { weekdayIndexOf } from "@/lib/date-kst";
import { type CalendarEvent, type CalendarTag } from "@/features/calendar/types";
import { DOT_SOLID } from "./list-view";

/**
 * 분석 뷰 — 태그×월 건수 매트릭스 + (태그 필터 시) 그 태그 일정의 전건 날짜 리스트(0224a 다중 뷰).
 * "몇년도 몇월며칠에 다 했는지" 조사용: 연도는 상단 ◀▶로 갈아끼우며 비교한다.
 * ⚠️ 여러 날 일정은 **시작일 기준** 한 번만 센다 · 전년도에 시작해 이어지는 일정은 표에서 제외(각주 명시).
 */

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

const NONE_KEY = "__none__";

export function StatsView({
  year,
  events,
  tags,
  tagFilter,
}: {
  year: number;
  /** 그 해와 겹치는 수기 일정 전건(태그 필터 **미적용** — 매트릭스는 전체가 있어야 비교가 된다). */
  events: CalendarEvent[];
  tags: CalendarTag[];
  /** URL 태그 필터 — 태그 id 또는 "none"(태그 없음). 있으면 아래에 그 태그의 날짜 리스트를 편다. */
  tagFilter?: string;
}) {
  // 시작일이 그 해인 일정만 집계(전년 걸침 제외 — 각주).
  const inYear = events.filter((e) => e.startDate.startsWith(`${year}-`));
  const counts = new Map<string, number[]>();
  for (const e of inYear) {
    const key = e.tag?.id ?? NONE_KEY;
    const arr = counts.get(key) ?? Array.from({ length: 12 }, () => 0);
    arr[Number(e.startDate.slice(5, 7)) - 1] += 1;
    counts.set(key, arr);
  }
  const untagged = counts.get(NONE_KEY);
  const monthTotals = Array.from({ length: 12 }, (_, i) =>
    [...counts.values()].reduce((acc, arr) => acc + arr[i]!, 0),
  );

  // 필터가 걸려 있으면 그 태그 일정 전건(그 해와 겹치는 전부 — 리스트는 걸침도 보인다).
  const picked =
    tagFilter === undefined
      ? null
      : events.filter((e) => (tagFilter === "none" ? !e.tag : e.tag?.id === tagFilter));
  const pickedName =
    tagFilter === "none" ? "태그 없음" : (tags.find((t) => t.id === tagFilter)?.name ?? null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-dim text-[13px]">
        <span className="num text-foreground font-bold">{year}</span>년 일정{" "}
        <span className="num text-foreground font-bold">{inYear.length}</span>건 · 태그{" "}
        <span className="num text-foreground font-bold">{tags.length}</span>종
      </p>

      <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
        <table className="w-full min-w-[720px] text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
          <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-3 py-2 text-center">태그</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className="micro px-1.5 py-2 text-center">
                  {i + 1}월
                </th>
              ))}
              <th className="micro px-2 py-2 text-center">합계</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {tags.map((t) => {
              const arr = counts.get(t.id) ?? Array.from({ length: 12 }, () => 0);
              const total = arr.reduce((a, b) => a + b, 0);
              return (
                <tr key={t.id} className="hover:bg-bg-soft/30">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-2 shrink-0 rounded-full ${DOT_SOLID[t.color]}`} aria-hidden />
                      {t.name}
                    </span>
                  </td>
                  {arr.map((n, i) => (
                    <td key={i} className="num px-1.5 py-2 text-center text-xs">
                      {n > 0 ? n : <span className="text-text-faint">·</span>}
                    </td>
                  ))}
                  <td className="num px-2 py-2 text-center text-xs font-bold">
                    {total > 0 ? total : <span className="text-text-faint font-normal">·</span>}
                  </td>
                </tr>
              );
            })}
            {untagged ? (
              <tr className="hover:bg-bg-soft/30">
                <td className="text-text-dim px-3 py-2 text-xs whitespace-nowrap">태그 없음</td>
                {untagged.map((n, i) => (
                  <td key={i} className="num px-1.5 py-2 text-center text-xs">
                    {n > 0 ? n : <span className="text-text-faint">·</span>}
                  </td>
                ))}
                <td className="num px-2 py-2 text-center text-xs font-bold">
                  {untagged.reduce((a, b) => a + b, 0)}
                </td>
              </tr>
            ) : null}
            <tr className="bg-bg-soft/40">
              <td className="px-3 py-2 text-xs font-bold whitespace-nowrap">전체</td>
              {monthTotals.map((n, i) => (
                <td key={i} className="num px-1.5 py-2 text-center text-xs font-semibold">
                  {n > 0 ? n : <span className="text-text-faint font-normal">·</span>}
                </td>
              ))}
              <td className="num px-2 py-2 text-center text-xs font-bold">{inYear.length}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-text-faint border-line border-t px-3 py-1.5 text-[11px]">
          여러 날 일정은 시작일 기준 1건 · 전년도에 시작해 이어지는 일정은 표에서 제외됩니다
        </p>
      </DragScrollArea>

      {picked && pickedName ? (
        <section className="border-line bg-card shadow-card rounded-2xl border p-4">
          <h3 className="text-foreground mb-2 text-[14px] font-bold">
            &lsquo;{pickedName}&rsquo; 일정 날짜{" "}
            <span className="num text-text-dim text-[12px] font-normal">{picked.length}건</span>
          </h3>
          {picked.length === 0 ? (
            <p className="text-text-faint py-2 text-center text-[12px]">이 태그의 일정이 없습니다</p>
          ) : (
            <ul className="divide-line divide-y">
              {picked.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2.5 py-1.5">
                  <span className="num text-text-dim w-[92px] shrink-0 text-[12px] whitespace-nowrap">
                    {shortDate(e.startDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={e.title}>
                    {e.title}
                  </span>
                  {e.endDate !== e.startDate ? (
                    <span className="num text-text-faint shrink-0 text-[11px]">~{shortDate(e.endDate)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
