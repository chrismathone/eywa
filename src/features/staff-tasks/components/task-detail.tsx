"use client";

import { useEffect, useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { kstShortStamp } from "@/lib/date-kst";
import { closeReasonLabel, taskEventLabel, taskKindLabel, taskState, TASK_KINDS, type StaffTaskEvent, type StaffTaskItem } from "../kinds";
import { fetchTaskDetail } from "../fetch";
import { TaskStateChip } from "./task-state-chip";

/**
 * 할 일 하나 — 무엇을 하면 처리되나 · 맡은 사람 · 언제 생겼고 언제까지 · 누가 어떻게 끝냈나 · 변경 이력 · 원래 화면으로 가기.
 * 처리 버튼은 없다(처리는 원래 기록의 사실로만 — 0377a).
 */
export function TaskDetail({ taskId, onBack, onNavigate }: { taskId: string; onBack: () => void; onNavigate: () => void }) {
  const [data, setData] = useState<{ item: StaffTaskItem; events: StaffTaskEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchTaskDetail(taskId).then((d) => alive && setData(d), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [taskId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button type="button" onClick={onBack} className="text-text-dim hover:text-foreground self-start text-sm">‹ 목록으로</button>
      {error ? <p className="text-danger text-sm">{error}</p> : !data ? <p className="text-text-dim text-sm">불러오는 중…</p> : (
        <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <TaskStateChip state={taskState(data.item.status, data.item.dueAt)} />
              <span className="text-text-dim text-sm">{taskKindLabel(data.item.kind)}</span>
            </div>
            <p className="text-base font-bold break-keep">{data.item.kind === "duty_late" ? data.item.title : (data.item.detail ?? data.item.title)}</p>
            {data.item.kind === "duty_late" && data.item.detail ? <p className="text-sm break-keep whitespace-pre-line">{data.item.detail}</p> : null}
            {TASK_KINDS[data.item.kind]?.doneRule ? <p className="text-text-dim text-sm break-keep">{TASK_KINDS[data.item.kind]?.doneRule}</p> : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-text-dim">담당</dt><dd>{data.item.assignees.map((a) => a.name).join(", ") || "—"}</dd>
            <dt className="text-text-dim">발생</dt><dd>{kstShortStamp(data.item.openedAt)?.slice(0, 8) ?? "—"}</dd>
            <dt className="text-text-dim">기한</dt><dd>{data.item.dueAt ? kstShortStamp(data.item.dueAt)?.slice(0, 8) : "—"}</dd>
            {data.item.closedAt ? <>
              <dt className="text-text-dim">처리 시각</dt>
              <dd>{kstShortStamp(data.item.closedAt)}{closeReasonLabel(data.item.closeReason) ? ` · ${closeReasonLabel(data.item.closeReason)}` : ""}{data.item.closedBy ? ` · ${data.item.closedBy.name}` : ""}</dd>
            </> : null}
          </dl>
          <section>
            <h3 className="text-text-dim mb-1 text-sm font-bold">변경 이력</h3>
            <ol className="space-y-1 text-sm">
              {data.events.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-text-dim shrink-0 tabular-nums">{kstShortStamp(e.at)}</span>
                  <span>{taskEventLabel(e.event)}{e.actor ? ` · ${e.actor.name}` : ""}</span>
                </li>
              ))}
            </ol>
          </section>
          {data.item.link && data.item.status === "open" ? (
            <WindowLink href={data.item.link} onNavigate={onNavigate}
              className="bg-primary text-primary-foreground inline-flex h-(--control-h) items-center rounded-lg px-4 text-sm font-bold">
              처리하러 가기
            </WindowLink>
          ) : null}
        </div>
      )}
    </div>
  );
}
