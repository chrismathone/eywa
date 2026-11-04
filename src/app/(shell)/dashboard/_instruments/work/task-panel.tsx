"use client";

import { useEffect, useState } from "react";
import { TASK_FILTERS, TASK_FILTER_LABEL, taskKindLabel, type StaffTaskFilter, type StaffTaskItem, type StaffTaskList } from "@/features/staff-tasks/kinds";
import { useBoard } from "../parts";
import { TaskRow } from "./task-row";
import { useWork } from "./work-context";
import { WorkPanel } from "./work-panel";

type Query = { filter: StaffTaskFilter; kind: string | null; assignee: string | null };
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 2.0 할 일 목록 라우트를 그대로 읽는다(종류 · 담당자 · 상태로 거르기 — 새로 판정하지 않는다). */
async function load(q: Query, page: number): Promise<StaffTaskList> {
  const qs = new URLSearchParams({ scope: "all", filter: q.filter, page: String(page) });
  if (q.kind) qs.set("kind", q.kind);
  if (q.assignee) qs.set("assignee", q.assignee);
  const res = await fetch(`/api/staff-tasks?${qs.toString()}`, { cache: "no-store", credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as (StaffTaskList & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "할 일을 불러오지 못했습니다");
  return body;
}

/**
 * 업무 처리 현황 — 대시보드 모양(원장 2026-11-02 *"리스트업도 대시보드 스타일에 맞춰서"* · *"기능성 같은 부분도 최대한 발전"*).
 * 위 = 종류별 · 담당자별 현황표(누르면 아래 목록이 그 값으로) · 아래 = 목록(누르면 그 자리에서 상세) · 고른 할 일을 업무 요청으로 넘긴다.
 * 처리 여부는 원래 기록의 사실로만 정해진다 — 이 창에는 처리 버튼이 없다.
 */
export function TaskPanel({ initial, onClose }: { initial: Partial<Query>; onClose: () => void }) {
  const { extras } = useBoard();
  const work = useWork();
  const board = extras.taskBoard;
  const [q, setQ] = useState<Query>({ filter: initial.filter ?? "late", kind: initial.kind ?? null, assignee: initial.assignee ?? null });
  const [list, setList] = useState<{ items: StaffTaskItem[]; total: number; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, StaffTaskItem>>(new Map());

  useEffect(() => {
    let alive = true;
    load(q, 0).then((r) => { if (alive) { setList({ items: r.items, total: r.total, page: 0 }); setError(null); } }, (e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [q]);
  const more = () => list && load(q, list.page + 1).then((r) => setList({ items: [...list.items, ...r.items], total: r.total, page: list.page + 1 }), (e: Error) => setError(e.message));
  const pick = (item: StaffTaskItem, on: boolean) => setPicked((m) => { const n = new Map(m); if (on) n.set(item.id, item); else n.delete(item.id); return n; });

  const handOff = () => {
    const items = [...picked.values()];
    const kinds = [...new Set(items.map((i) => i.kind))];
    const lines = items.slice(0, 40).map((i) => `- ${i.title}`);
    onClose();
    work.create({
      title: `${kinds.length === 1 ? taskKindLabel(kinds[0]!) : "할 일"} ${items.length}건 처리`, source: "check:tasks", dueOn: shift(work.today, 1),
      body: `${lines.join("\n")}${items.length > 40 ? `\n외 ${items.length - 40}건` : ""}`,
      criteria: "목록의 할 일이 모두 '처리 완료'로 바뀐다(원래 기록으로 자동 확인)",
      assigneeIds: [...new Set(items.flatMap((i) => i.assignees.map((a) => a.id)))], students: [],
    });
  };
  const nameOf = (id: string) => board?.people.find((p) => p.id === id)?.name ?? "담당자";

  return (
    <WorkPanel eyebrow="처리 여부는 원래 기록으로 저절로 확인됩니다" title="업무 처리 현황" onClose={onClose}>
      {board ? (
        <div className="task-overview">
          <section className="drawer-table">
            <h3>종류별 <small>미처리 · 그중 기한 초과</small></h3>
            <table><thead><tr><th scope="col">종류</th><th scope="col" className="is-num">미처리</th><th scope="col" className="is-num">기한 초과</th></tr></thead>
              <tbody>{board.kinds.map((k) => (
                <tr key={k.kind} className={q.kind === k.kind ? "is-focus" : undefined} onClick={() => setQ((x) => ({ ...x, kind: x.kind === k.kind ? null : k.kind, assignee: null }))}>
                  <th scope="row"><button type="button" className="check-open">{taskKindLabel(k.kind)}</button></th><td className="is-num">{k.open}</td><td className={`is-num${k.late ? " is-late" : ""}`}>{k.late}</td>
                </tr>))}</tbody>
            </table>
          </section>
          <section className="drawer-table">
            <h3>담당자별 <small>기한 초과가 많은 순</small></h3>
            <table><thead><tr><th scope="col">담당자</th><th scope="col" className="is-num">미처리</th><th scope="col" className="is-num">기한 초과</th></tr></thead>
              <tbody>{board.people.slice(0, 12).map((p) => (
                <tr key={p.id} className={q.assignee === p.id ? "is-focus" : undefined} onClick={() => setQ((x) => ({ ...x, assignee: x.assignee === p.id ? null : p.id, kind: null }))}>
                  <th scope="row"><button type="button" className="check-open">{p.name}</button></th><td className="is-num">{p.open}</td><td className={`is-num${p.late ? " is-late" : ""}`}>{p.late}</td>
                </tr>))}</tbody>
            </table>
          </section>
        </div>
      ) : null}
      <div className="task-filters">
        <div className="seg-toggle" role="group" aria-label="상태">{TASK_FILTERS.map((f) => <button key={f} type="button" aria-pressed={q.filter === f} onClick={() => setQ((x) => ({ ...x, filter: f }))}>{TASK_FILTER_LABEL[f]}</button>)}</div>
        {q.kind ? <button type="button" className="work-tag is-on" onClick={() => setQ((x) => ({ ...x, kind: null }))}>{taskKindLabel(q.kind)} ×</button> : null}
        {q.assignee ? <button type="button" className="work-tag is-on" onClick={() => setQ((x) => ({ ...x, assignee: null }))}>{nameOf(q.assignee)} ×</button> : null}
        <span className="drawer-note">{list ? `${list.items.length} / ${list.total}건` : "불러오는 중…"}</span>
      </div>
      {picked.size ? (
        <div className="task-picked">
          <b>{picked.size}건 고름</b>
          <button type="button" className="picker-link" onClick={() => setPicked(new Map())}>모두 해제</button>
          {work.board.canCreate ? <button type="button" className="work-new" onClick={handOff}>업무 요청으로 넘기기</button> : null}
        </div>
      ) : null}
      {error ? <p className="work-error" role="alert">{error}</p> : null}
      {list?.items.length ? (
        <section className="drawer-table">
          <div className="table-wrap">
            <table className="task-table">
              <thead><tr><th scope="col" aria-label="고르기" /><th scope="col">상태</th><th scope="col">할 일</th><th scope="col">종류</th><th scope="col">담당</th><th scope="col">생긴 때</th><th scope="col">기한</th></tr></thead>
              <tbody>{list.items.map((item) => <TaskRow key={item.id} item={item} open={openId === item.id} picked={picked.has(item.id)} onToggle={() => setOpenId((id) => (id === item.id ? null : item.id))} onPick={(on) => pick(item, on)} onNavigate={onClose} />)}</tbody>
            </table>
          </div>
          {list.items.length < list.total ? <button type="button" className="task-more" onClick={() => void more()}>더 보기 ({list.total - list.items.length}건 남음)</button> : null}
        </section>
      ) : list ? (
        <p className="drawer-note">
          {TASK_FILTER_LABEL[q.filter]}{q.kind ? ` 중 ${taskKindLabel(q.kind)}` : q.assignee ? ` 중 ${nameOf(q.assignee)} 담당` : ""} 할 일이 없습니다.
          {q.filter !== "all" ? <> <button type="button" className="picker-link" onClick={() => setQ((x) => ({ ...x, filter: "all" }))}>전체에서 보기</button></> : null}
        </p>
      ) : null}
    </WorkPanel>
  );
}
