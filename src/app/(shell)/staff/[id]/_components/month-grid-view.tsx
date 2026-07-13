"use client";

// 월간 달력 그리드(프레젠테이션) — 순수 계산은 month-grid.ts. 기간(시작일~마감일) 업무는 노션처럼 가로 막대로
// 표시(주 경계에서 잘림/이어짐 표시). 막대 클릭=업무 상세, 빈 칸/"+N건 더" 클릭=그날 전체 목록.
// canEdit면 막대를 다른 날짜로 드래그 이동(HTML5 DnD) → onMove(부모가 확인 후 Notion 반영).
// 라이브러리 0: 막대는 퍼센트 기반 absolute(7열). 넘치면 드래그-스크롤.
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import {
  weekdayHeaders,
  buildWeekBars,
  countSpansPerDay,
  type MonthCell,
} from "@/lib/month-grid";
import { taskSpans, type NotionTask } from "@/features/staff/notion-tasks";

const MAX_LANES = 4; // 셀에 보일 최대 막대 줄 수 — 초과분은 "+N건 더"
const NUM_ROW = 22; // 날짜 숫자 줄 높이(px)
const LANE_H = 20; // 막대 한 줄 높이(px)

export function MonthGridView({
  weeks,
  tasks,
  today,
  onOpen,
  onOpenDay,
  canEdit = false,
  onMove,
}: {
  weeks: MonthCell[][];
  tasks: NotionTask[];
  today: string;
  onOpen: (t: NotionTask) => void;
  onOpenDay: (date: string) => void;
  canEdit?: boolean;
  onMove?: (task: NotionTask, newDue: string) => void;
}) {
  const heads = weekdayHeaders(0);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const spans = taskSpans(tasks);

  // ⚠️ 드래그 중 setState(하이라이트) 금지 — 리렌더가 끌던 막대 요소를 다시 그려 브라우저가 드래그를
  // 취소한다(드롭 원상복구·no-drop 커서). 드롭 허용은 onDragOver의 preventDefault로만.
  // ⚠️ 막대가 셀을 덮으므로 드롭존은 **주 행 전체**로 두고, 놓은 날짜는 커서 X위치로 계산(막대 위에 놓아도 동작).
  const allowDrop = (e: React.DragEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleWeekDrop = (weekDates: string[]) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!canEdit || !onMove) return;
    const id = e.dataTransfer.getData("text/plain");
    const t = byId.get(id);
    if (!t) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.min(6, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
    const date = weekDates[col];
    if (date && t.due !== date) onMove(t, date); // 같은 날 드롭은 무시
  };

  return (
    <DragScrollArea className="border-line bg-card rounded-md border">
      <div className="min-w-[680px]">
        {/* 요일 헤더 */}
        <div className="border-line grid grid-cols-7 border-b">
          {heads.map((h, i) => (
            <div
              key={h}
              className={`px-2 py-1.5 text-center text-[11px] font-semibold ${
                i === 0 ? "text-danger" : i === 6 ? "text-primary" : "text-text-faint"
              }`}
            >
              {h}
            </div>
          ))}
        </div>

        {/* 주별 — 배경 셀(그리드) + 막대(퍼센트 absolute) */}
        {weeks.map((week, wi) => {
          const weekDates = week.map((c) => c.date);
          const { bars } = buildWeekBars(weekDates, spans);
          const shown = bars.filter((b) => b.lane < MAX_LANES);
          const perDay = countSpansPerDay(weekDates, spans);
          // 각 날짜에서 보인 막대 수(그날 열을 덮는 shown 막대) → +N 계산
          const shownPerDay: Record<string, number> = {};
          for (let ci = 0; ci < 7; ci++) {
            const col = ci + 1;
            shownPerDay[weekDates[ci]!] = shown.filter(
              (b) => b.colStart <= col && col < b.colStart + b.colSpan,
            ).length;
          }
          const lanesShown = Math.min(Math.max(...bars.map((b) => b.lane + 1), 0), MAX_LANES);
          const hasOverflow = weekDates.some((d) => (perDay[d] ?? 0) > (shownPerDay[d] ?? 0));
          const weekH = NUM_ROW + Math.max(lanesShown, 0) * LANE_H + (hasOverflow ? 18 : 6);

          return (
            <div
              key={wi}
              className="border-line relative border-b last:border-b-0"
              style={{ minHeight: Math.max(weekH, 84) }}
              onDragOver={canEdit ? allowDrop : undefined}
              onDrop={canEdit ? handleWeekDrop(weekDates) : undefined}
            >
              {/* 배경 셀 */}
              <div className="grid h-full grid-cols-7">
                {week.map((cell) => {
                  const isToday = cell.date === today;
                  const overflow = (perDay[cell.date] ?? 0) - (shownPerDay[cell.date] ?? 0);
                  return (
                    <button
                      type="button"
                      key={cell.date}
                      onClick={() => onOpenDay(cell.date)}
                      className={`border-line hover:bg-bg-soft/60 relative border-r text-left transition last:border-r-0 ${
                        cell.inMonth ? "" : "bg-bg-soft/40"
                      }`}
                    >
                      <span
                        className={`absolute top-1 right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular ${
                          isToday
                            ? "bg-primary text-primary-foreground font-bold"
                            : cell.inMonth
                              ? "text-text-dim"
                              : "text-text-faint"
                        }`}
                      >
                        {cell.day}
                      </span>
                      {overflow > 0 ? (
                        <span className="text-text-faint absolute bottom-0.5 left-1 text-[10px]">
                          +{overflow}건 더
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* 막대 오버레이 */}
              <div className="pointer-events-none absolute inset-0">
                {shown.map((bar) => {
                  const t = byId.get(bar.id);
                  if (!t) return null;
                  const left = ((bar.colStart - 1) / 7) * 100;
                  const width = (bar.colSpan / 7) * 100;
                  const rounded = `${bar.continuesLeft ? "rounded-l-none" : ""} ${bar.continuesRight ? "rounded-r-none" : ""}`;
                  return (
                    <button
                      type="button"
                      key={bar.id}
                      title={canEdit ? `${t.title} — 드래그해 날짜 이동` : t.title}
                      onClick={() => onOpen(t)}
                      draggable={canEdit}
                      onPointerDown={canEdit ? (e) => e.stopPropagation() : undefined} // 드래그-팬 가로채기 방지
                      onDragStart={canEdit ? (e) => e.dataTransfer.setData("text/plain", bar.id) : undefined}
                      style={{
                        left: `calc(${left}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        top: NUM_ROW + bar.lane * LANE_H,
                        height: LANE_H - 3,
                      }}
                      className={`pointer-events-auto absolute truncate rounded-sm px-1 text-left text-[11px] leading-[17px] ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${rounded} ${
                        t.done
                          ? "bg-bg-soft text-text-faint line-through hover:bg-bg-soft/70"
                          : "bg-primary/15 text-foreground hover:bg-primary/25"
                      }`}
                    >
                      {bar.continuesLeft ? "◂ " : ""}
                      {t.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </DragScrollArea>
  );
}
