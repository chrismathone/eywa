"use client";

import { WORK_CATEGORY_LABEL, dueLabel, isOpen, myTurn, statusText, type WorkItem } from "@/features/work-requests/model";
import { WorkPanel } from "./work-panel";

/** 강사 홈 '받은 업무 요청' 목록 창 — 진행 중 / 지난 요청(최근 60일). 줄을 누르면 상세(`WorkDrawer`)로. 운영실 '업무 흐름' 표와 같은 모양. */
export function ReceivedList({ items, me, today, onClose, onOpen }: { items: WorkItem[]; me: string | null; today: string; onClose: () => void; onOpen: (id: string) => void }) {
  const live = items.filter(isOpen);
  const past = items.filter((i) => !isOpen(i));
  const table = (rows: WorkItem[]) => <table className="work-table">
    <thead><tr><th scope="col">종류</th><th scope="col">업무</th><th scope="col">요청</th><th scope="col">기한</th><th scope="col">상태</th></tr></thead>
    <tbody>{rows.map((i) => {
      const due = dueLabel(i, today);
      const turn = myTurn(i, me) === "report";
      return <tr key={i.id} onClick={() => onOpen(i.id)}>
        <td className="area">{WORK_CATEGORY_LABEL[i.category]}</td>
        <th scope="row"><button type="button" className="check-open" onClick={(e) => { e.stopPropagation(); onOpen(i.id); }}>{i.title}</button></th>
        <td>{i.requester?.name ?? "—"}</td>
        <td className={due.late ? "is-late" : undefined}>{due.text}</td>
        <td><span className={`work-chip ${turn ? "is-turn" : i.status === "closed" ? "is-done" : i.status === "cancelled" ? "is-off" : ""}`}>{turn ? "내 보고 차례" : statusText(i)}</span></td>
      </tr>;
    })}</tbody>
  </table>;
  return <WorkPanel eyebrow="업무 요청" title="받은 업무 요청" onClose={onClose}>
    <section className="drawer-table">
      <h3>진행 중 <small>{live.length}</small></h3>
      {live.length ? table(live) : <p className="drawer-note">진행 중인 요청이 없습니다.</p>}
    </section>
    {past.length ? <section className="drawer-table"><h3>지난 요청 <small>최근 60일</small></h3>{table(past)}</section> : null}
  </WorkPanel>;
}
