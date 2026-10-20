"use client";

// 그날 전체 업무 목록 — 그리드 셀/"+N건 더" 클릭 시. 항목 클릭 → 업무 상세(부모가 처리).
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tasksOnDate, type NotionTask } from "@/features/staff/notion/notion-tasks";

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function DayTasksDialog({
  date,
  tasks,
  onPick,
  onClose,
}: {
  date: string;
  tasks: NotionTask[];
  onPick: (t: NotionTask) => void;
  onClose: () => void;
}) {
  const items = tasksOnDate(tasks, date);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{dateLabel(date)} · 업무 {items.length}건</DialogTitle>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-text-faint py-4 text-center text-xs">이 날짜에 업무가 없습니다.</p>
        ) : (
          <div className="border-line divide-line max-h-[55vh] divide-y overflow-y-auto rounded-md border">
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t)}
                className="hover:bg-bg-soft flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
              >
                <span className={t.done ? "text-text-faint line-through" : "text-foreground"}>{t.title}</span>
                {t.dept ? <span className="text-text-faint">· {t.dept}</span> : null}
                {t.start && t.due && t.start !== t.due ? (
                  <span className="text-text-faint num ml-auto text-xs">
                    {t.start.slice(5)}~{t.due.slice(5)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
