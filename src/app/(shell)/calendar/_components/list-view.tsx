import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { weekdayIndexOf } from "@/lib/date-kst";
import {
  eventDisplayColor,
  eventTimeLabel,
  type CalendarEvent,
  type EventColor,
} from "@/features/calendar/types";

/**
 * 목록(표) 뷰 — 조건(연도·태그)에 맞는 일정을 표로 조사한다(0224a 다중 뷰).
 * 서버 컴포넌트: 데이터·필터는 page가 URL로 확정해 내려준다. 표 규약 = 열 제목 가운데 +
 * 열 구분선 `--line-faint`(doc-list 선례), 가로 넘침은 자체 스크롤(페이지 가로 스크롤 금지).
 */

/** 태그 색 점 — 정적 Record(Tailwind 동적 조립 금지). 분석 뷰·페이지 태그 칩이 공유한다. */
export const DOT_SOLID: Record<EventColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  green: "bg-green",
  amber: "bg-amber",
  purple: "bg-purple",
  rose: "bg-rose",
  neutral: "bg-text-faint",
};

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-08-20" → "8/20 (목)" — 연도는 상단 컨트롤이 이미 말하고 있어 반복하지 않는다. */
function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

function spanDays(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function ListView({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
        조건에 맞는 일정이 없습니다
      </div>
    );
  }

  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
      <table className="w-full min-w-[760px] text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
        <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-3 py-2 text-center">날짜</th>
            <th className="micro px-3 py-2 text-center">시간</th>
            <th className="micro px-3 py-2 text-center">일수</th>
            <th className="micro px-3 py-2 text-center">태그</th>
            <th className="micro px-3 py-2 text-center">제목</th>
            <th className="micro px-3 py-2 text-center">작성</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {events.map((e) => {
            const days = spanDays(e.startDate, e.endDate);
            const time = eventTimeLabel(e);
            return (
              <tr key={e.id} className="hover:bg-bg-soft/30">
                <td className="num px-3 py-2 text-xs whitespace-nowrap">
                  {shortDate(e.startDate)}
                  {e.endDate !== e.startDate ? (
                    <span className="text-text-dim"> ~ {shortDate(e.endDate)}</span>
                  ) : null}
                </td>
                <td className="num text-text-dim px-3 py-2 text-xs whitespace-nowrap">
                  {time ?? <span className="text-text-faint">종일</span>}
                </td>
                <td className="num text-text-dim px-3 py-2 text-center text-xs whitespace-nowrap">
                  {days}일
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {e.tag ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`size-2 shrink-0 rounded-full ${DOT_SOLID[eventDisplayColor(e)]}`}
                        aria-hidden
                      />
                      {e.tag.name}
                    </span>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-medium break-keep">{e.title}</td>
                <td className="text-text-dim px-3 py-2 text-xs whitespace-nowrap">
                  {e.createdByName ?? <span className="text-text-faint">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-text-dim border-line border-t px-3 py-2 text-right text-[12px]">
        총 <span className="num font-semibold">{events.length}</span>건
      </p>
    </DragScrollArea>
  );
}
