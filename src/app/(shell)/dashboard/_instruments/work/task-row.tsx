"use client";

import { Fragment, useEffect, useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { fetchTaskDetail } from "@/features/staff-tasks/fetch";
import { TASK_KINDS, TASK_STATE_LABEL, closeReasonLabel, taskEventLabel, taskKindLabel, taskState, type StaffTaskEvent, type StaffTaskItem, type StaffTaskState } from "@/features/staff-tasks/kinds";
import { hm, stamp } from "./work-panel";

const TONE: Record<StaffTaskState, string> = { open: "is-review", late: "is-late", done: "is-done", cancelled: "is-off", expired: "is-off" };
const HOUR = 3_600_000;

/** 기한까지 남은 · 지난 시간 — 날짜만 적지 않고 얼마나 늦었는지를 바로 읽게. */
export function dueText(item: StaffTaskItem, now = Date.now()): string {
  if (!item.dueAt || item.status !== "open") return item.dueAt ? stamp(item.dueAt) : "—";
  const gap = Date.parse(item.dueAt) - now;
  const h = Math.floor(Math.abs(gap) / HOUR);
  const span = h < 24 ? `${Math.max(1, h)}시간` : `${Math.floor(h / 24)}일`;
  return gap < 0 ? `${span} 지남` : `${span} 남음`;
}

function Inline({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  const [data, setData] = useState<{ item: StaffTaskItem; events: StaffTaskEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchTaskDetail(id).then((d) => alive && setData(d), (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);
  if (error) return <p className="work-error">{error}</p>;
  if (!data) return <p className="drawer-note">불러오는 중…</p>;
  const { item, events } = data;
  const closed = item.closedAt ? `${hm(item.closedAt)}${closeReasonLabel(item.closeReason) ? ` · ${closeReasonLabel(item.closeReason)}` : ""}${item.closedBy ? ` · ${item.closedBy.name}` : ""}` : null;
  return (
    <div className="task-inline">
      {item.detail ? <p className="task-inline-title">{item.detail}</p> : null}
      <p className="drawer-note">처리 기준 — {TASK_KINDS[item.kind]?.doneRule ?? "원래 기록으로 자동 확인됩니다."}</p>
      <dl>
        <div><dt>맡은 사람</dt><dd>{item.assignees.map((a) => a.name).join(" · ") || "—"}</dd></div>
        <div><dt>생긴 때</dt><dd>{hm(item.openedAt)}</dd></div>
        <div><dt>늦음 기준</dt><dd>{item.dueAt ? `${hm(item.dueAt)} 이후` : "—"}</dd></div>
        {closed ? <div><dt>처리</dt><dd>{closed}</dd></div> : null}
      </dl>
      <ol className="work-events">{[...events].reverse().map((e, i) => <li key={`${e.at}-${i}`}><time>{hm(e.at)}</time><b>{e.actor?.name ?? "자동"}</b><span>{taskEventLabel(e.event)}</span></li>)}</ol>
      {item.link && item.status === "open" ? <WindowLink href={item.link} onNavigate={onNavigate} className="task-go">처리하러 가기 ›</WindowLink> : null}
    </div>
  );
}

/** 할 일 한 줄 — 누르면 그 자리에서 처리 기준 · 이력 · 원래 화면 바로가기가 펼쳐진다. 처리 버튼은 없다(원래 기록의 사실로만 닫힌다). */
export function TaskRow({ item, open, picked, onToggle, onPick, onNavigate }: {
  item: StaffTaskItem; open: boolean; picked: boolean; onToggle: () => void; onPick: (on: boolean) => void; onNavigate: () => void;
}) {
  const state = taskState(item.status, item.dueAt);
  return (
    <Fragment>
      <tr className={open ? "is-focus" : undefined} onClick={onToggle}>
        <td className="pick" onClick={(e) => e.stopPropagation()}>{item.status === "open" ? <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} aria-label={`${item.title} 고르기`} /> : null}</td>
        <td><span className={`work-chip ${TONE[state]}`}>{TASK_STATE_LABEL[state]}</span></td>
        <th scope="row"><button type="button" className="check-open" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{item.title}</button></th>
        <td className="area">{taskKindLabel(item.kind)}</td>
        <td>{item.assignees.map((a) => a.name).join(" · ") || "—"}</td>
        <td className="area">{stamp(item.openedAt)}</td>
        <td className={state === "late" ? "is-late" : undefined}>{dueText(item)}</td>
      </tr>
      {open ? <tr className="task-detail-row"><td colSpan={7}><Inline id={item.id} onNavigate={onNavigate} /></td></tr> : null}
    </Fragment>
  );
}
