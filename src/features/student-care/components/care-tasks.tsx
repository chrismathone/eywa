"use client";
import { useEffect, useState } from "react";
import { kstShortStamp } from "@/lib/date-kst";
import { TaskDetail } from "@/features/staff-tasks/components/task-detail";
import { TaskStateChip } from "@/features/staff-tasks/components/task-state-chip";
import { taskKindLabel, taskState, closeReasonLabel } from "@/features/staff-tasks/kinds";
import type { CareTaskFilter, CareTasks } from "../tasks";

/** Existing task workflow, opened on demand so student detail doesn't wait on another set of reads. */
export function CareTaskPanel({ studentId }: { studentId: string }) {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState<CareTaskFilter>("open");
  const [refresh, setRefresh] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [data, setData] = useState<CareTasks | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    fetch(`/api/students/${encodeURIComponent(studentId)}/care-tasks?filter=${filter}`, {
      signal: controller.signal, credentials: "same-origin", cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error("관련 업무를 불러오지 못했습니다. 다시 확인해 주세요.");
      return await res.json() as CareTasks;
    }).then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [studentId, opened, filter, refresh]);
  const reload = (next = filter) => { setData(null); setError(null); setTaskId(null); setFilter(next); setRefresh((n) => n + 1); };
  return <section aria-label="관련 업무 처리 현황" className="border-line bg-card rounded-xl border p-4">
    <h3 className="text-foreground text-sm font-bold">담당자 조치와 처리 확인</h3>
    <p className="text-text-dim mt-1 text-xs">기존 상담 후속조치·결석 확인·진도 이상 업무를 함께 봅니다. 숙제 수행률 하락은 상담에서 원인과 다음 확인일을 기록해 주세요.</p>
    {!opened ? <button type="button" onClick={() => setOpened(true)} className="text-primary mt-3 text-sm font-semibold">관련 업무 확인</button> : <>
      <div className="my-3 flex flex-wrap gap-3 text-sm">
        {(["open", "closed"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => reload(value)} className={filter === value ? "text-primary font-bold" : "text-text-dim"}>
          {value === "open" ? "진행 중" : "종료 이력"}
        </button>)}
        <button type="button" onClick={() => reload()} className="text-text-dim ml-auto">새로 확인</button>
      </div>
      {taskId ? <TaskDetail key={taskId} taskId={taskId} onBack={() => reload()} onNavigate={() => reload()} /> :
        error ? <p role="alert" className="text-danger text-sm">{error}</p> :
        !data ? <p role="status" className="text-text-dim text-sm">관련 업무 확인 중…</p> : <>
          <p className="text-text-dim text-xs">{data.canMonitor ? "열람 가능한 학생 기록에 연결된 업무" : "내가 담당하고 열람할 수 있는 학생 업무"} · {data.items.length}/{data.total}건
            {data.total > data.items.length ? " · 진행 중은 기한 순, 종료 이력은 최근 30건을 표시합니다." : ""}</p>
          {!data.items.length ? <p className="text-text-dim mt-3 text-sm">이 범위에서 확인된 업무가 없습니다. 학생의 문제가 해결됐다는 뜻은 아닙니다.</p> :
            <ul className="divide-line mt-2 divide-y">{data.items.map((task) => <li key={task.id}>
              <button type="button" onClick={() => setTaskId(task.id)} className="hover:bg-bg-soft flex w-full items-start gap-3 py-3 text-left">
                <TaskStateChip state={taskState(task.status, task.dueAt)} />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">{taskKindLabel(task.kind)}</span>
                  <span className="text-text-dim block text-xs">담당: {task.assignees.map((u) => u.name).join(", ") || "확인 필요"} · 기한: {kstShortStamp(task.dueAt) ?? "미설정"}</span>
                  {task.closedAt ? <span className="text-text-dim block text-xs">{kstShortStamp(task.closedAt)} · {closeReasonLabel(task.closeReason) ?? "종료"}{task.closedBy ? ` · ${task.closedBy.name}` : ""}</span> : null}
                </span>
              </button>
            </li>)}</ul>}
        </>}
    </>}
    <p className="text-text-dim mt-3 text-xs">처리 완료는 연락·기록 확인의 완료입니다. 실제 개선 여부는 위의 숙제·출결 기록과 다음 상담에서 따로 확인합니다.</p>
  </section>;
}
