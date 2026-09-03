import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { dotProps } from "@/features/calendar/color";
import { eventDisplayColor, eventTimeLabel, type CalendarEvent } from "@/features/calendar/types";
// 날짜 표기는 분석 화면과 **같은 함수**를 쓴다 — 같은 일정이 화면마다 다른 모양이면 안 된다.
import { shortDate } from "./event-row";

/**
 * 목록(표) 뷰 — 조건(연도·태그)에 맞는 일정을 표로 조사한다(0224a 다중 뷰).
 * 서버 컴포넌트: 데이터·필터는 page가 URL로 확정해 내려준다. 표 규약 = 열 제목 가운데 +
 * 열 구분선 `--line-faint`(doc-list 선례), 가로 넘침은 자체 스크롤(페이지 가로 스크롤 금지).
 */

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
            const dot = dotProps(eventDisplayColor(e));
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
                        className={`size-2 shrink-0 rounded-full ${dot.className}`}
                        style={dot.style}
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
      <p className="text-text-dim border-line border-t px-3 py-2 text-right text-xs">
        총 <span className="num font-semibold">{events.length}</span>건
      </p>
    </DragScrollArea>
  );
}
