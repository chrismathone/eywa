"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { kstShortStamp } from "@/lib/date-kst";
import { TASK_FILTERS, TASK_FILTER_LABEL, closeReasonLabel, taskKindLabel, taskState, type StaffTaskFilter, type StaffTaskItem } from "../kinds";
import { fetchTaskList, type TaskScope } from "../fetch";
import { TaskDetail } from "./task-detail";
import { TaskStateChip } from "./task-state-chip";

export type StaffTaskDialogTarget = TaskScope & { filter?: StaffTaskFilter; personName?: string; taskId?: string };

/**
 * 공통 할 일 창(목록 → 상세 · 0377a) — 벨의 '내 할 일' · 강사 홈 줄 · 운영실 '강사별 업무 현황'이 이 창 하나를 연다.
 * 독립 화면(주소)이 없다(원장 2026-10-19 회의: 따로 탭을 두지 않고 기존 화면에 녹인다). 폰에선 화면 높이 거의 전부.
 * `scope: "all"`은 업무 처리 현황 권한이 있을 때만 부른다(라우트가 다시 막는다).
 */
export function StaffTaskDialog({ target, onClose }: { target: StaffTaskDialogTarget; onClose: () => void }) {
  const [filter, setFilter] = useState<StaffTaskFilter>(target.filter ?? "open");
  const [taskId, setTaskId] = useState<string | null>(target.taskId ?? null);
  const all = target.scope === "all";
  // 원장 2026-11-10: '내 할 일' → '내 업무' · 제목 1.5배 · 설명 줄 없음.
  const title = all ? (target.personName ? `${target.personName} 선생님의 업무` : "업무 처리 현황") : "내 업무";
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex h-[min(640px,88dvh)] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{title}</DialogTitle>
        </DialogHeader>
        {taskId ? <TaskDetail taskId={taskId} onBack={() => setTaskId(null)} onNavigate={onClose} /> : <>
          <ToolbarSegment>
            {TASK_FILTERS.map((f) => <ToolbarSegmentItem key={f} active={f === filter} onClick={() => setFilter(f)}>{TASK_FILTER_LABEL[f]}</ToolbarSegmentItem>)}
          </ToolbarSegment>
          <TaskList key={filter} scope={target} filter={filter} showPeople={all && !target.personName} onPick={setTaskId} />
        </>}
      </DialogContent>
    </Dialog>
  );
}

function TaskList({ scope, filter, showPeople, onPick }: { scope: TaskScope; filter: StaffTaskFilter; showPeople: boolean; onPick: (id: string) => void }) {
  const [items, setItems] = useState<StaffTaskItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const assigneeId = scope.scope === "all" ? scope.assigneeId ?? null : null;
  useEffect(() => {
    let alive = true;
    const query: TaskScope = scope.scope === "all" ? { scope: "all", assigneeId } : { scope: "mine" };
    fetchTaskList(query, filter, page).then((list) => {
      if (!alive) return;
      setItems((prev) => (page === 0 ? list.items : [...(prev ?? []), ...list.items]));
      setTotal(list.total);
    }, (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [scope.scope, assigneeId, filter, page]);

  if (error) return <p className="text-danger text-sm">{error}</p>;
  if (!items) return <p className="text-text-dim text-sm">불러오는 중…</p>;
  if (!items.length) return <p className="text-text-dim py-8 text-center text-sm">{filter === "late" ? "기한 초과 업무가 없습니다" : filter === "open" ? "미처리 업무가 없습니다" : "업무가 없습니다"}</p>;
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
      <ul className="divide-line divide-y">
        {items.map((t) => {
          const state = taskState(t.status, t.dueAt);
          const closed = t.closedAt ? `${kstShortStamp(t.closedAt)} ${closeReasonLabel(t.closeReason) ?? ""}${t.closedBy ? ` · ${t.closedBy.name}` : ""}` : null;
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onPick(t.id)} className="hover:bg-bg-soft flex w-full items-start gap-3 px-1 py-2.5 text-left">
                <TaskStateChip state={state} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold break-keep">{t.detail ?? t.title}</span>
                  <span className="text-text-dim block text-xs break-keep">
                    {taskKindLabel(t.kind)} · {kstShortStamp(t.openedAt)}
                    {showPeople && t.assignees.length ? ` · ${t.assignees.map((a) => a.name).join(", ")}` : ""}
                    {closed ? ` · ${closed}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length < total ? (
        <button type="button" onClick={() => setPage((p) => p + 1)} className="text-text-dim hover:text-foreground w-full py-2 text-center text-sm">
          더 보기 · {total - items.length}건 더
        </button>
      ) : null}
    </div>
  );
}
