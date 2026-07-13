"use client";

// 월간 달력 그리드(프레젠테이션) — 순수 계산은 month-grid.ts, 데이터는 상위(월간뷰)에서 주입.
// 라이브러리 0(CSS grid). 넘치면 드래그-스크롤. 업무 클릭 시 Notion 페이지 새 탭 열람.
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { weekdayHeaders, type MonthCell } from "@/lib/month-grid";
import { groupTasksByDate, type NotionTask } from "@/features/staff/notion-tasks";

const MAX_PER_CELL = 4;

function TaskChip({ task }: { task: NotionTask }) {
  const body = (
    <>
      <span className={task.done ? "text-text-faint line-through" : "text-foreground"}>
        {task.title}
      </span>
      {task.dept ? <span className="text-text-faint ml-1">· {task.dept}</span> : null}
    </>
  );
  const cls =
    "block w-full truncate rounded-sm px-1 py-0.5 text-left text-[11px] " +
    (task.done ? "bg-bg-soft" : "bg-primary/10 hover:bg-primary/15");
  return task.url ? (
    <a href={task.url} target="_blank" rel="noopener noreferrer" className={cls} title={task.title}>
      {body}
    </a>
  ) : (
    <span className={cls} title={task.title}>
      {body}
    </span>
  );
}

export function MonthGridView({
  weeks,
  tasks,
  today,
}: {
  weeks: MonthCell[][];
  tasks: NotionTask[];
  today: string;
}) {
  const byDate = groupTasksByDate(tasks);
  const heads = weekdayHeaders(0);

  return (
    <DragScrollArea className="border-line bg-card rounded-md border">
      <div className="min-w-[640px]">
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
        {/* 주 */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((cell) => {
              const dayTasks = byDate[cell.date] ?? [];
              const isToday = cell.date === today;
              return (
                <div
                  key={cell.date}
                  className={`border-line min-h-[92px] border-r border-b p-1 last:border-r-0 ${
                    cell.inMonth ? "" : "bg-bg-soft/40"
                  }`}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular ${
                        isToday
                          ? "bg-primary text-primary-foreground font-bold"
                          : cell.inMonth
                            ? "text-text-dim"
                            : "text-text-faint"
                      }`}
                    >
                      {cell.day}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, MAX_PER_CELL).map((t) => (
                      <TaskChip key={t.id} task={t} />
                    ))}
                    {dayTasks.length > MAX_PER_CELL ? (
                      <span className="text-text-faint px-1 text-[10px]">
                        +{dayTasks.length - MAX_PER_CELL}건 더
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </DragScrollArea>
  );
}
