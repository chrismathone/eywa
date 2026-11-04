"use client";

import { useState } from "react";
import { WORK_CATEGORY_LABEL, WORK_TAB_LABEL, dueLabel, filterWork, matchesWork, myTurn, reportedCount, stageOf, statusText, studentCount, urgentFirst, workCounts, type WorkItem, type WorkTab } from "@/features/work-requests/model";
import { GoIcon } from "../parts";
import { useWork } from "./work-context";
import { StagePips } from "./work-panel";

const chipTone = (item: WorkItem, me: string | null) => (myTurn(item, me) ? "is-turn" : item.status === "review" ? "is-review" : item.status === "closed" ? "is-done" : item.status === "cancelled" ? "is-off" : undefined);
const stageText = (item: WorkItem) => (item.status === "working" ? `보고 ${reportedCount(item)}/${item.steps.length}` : item.status === "review" ? `검토 · ${(item.reviewer ?? item.requester)?.name ?? "—"}` : item.status === "closed" ? "마감" : "취소");

/** '업무 흐름' — 요청 → 담당자 보고 → 관리자 검토 → 마감. 보는 사람과 엮인 업무만(현황 권한이 있으면 전부). */
export function WorkSection() {
  const { board, today, open, create } = useWork();
  const tabs: WorkTab[] = ["mine", "requested", ...(board.canMonitor ? (["all"] as const) : []), "past"];
  const mineCount = filterWork(board.items, "mine", board.me).length;
  const [tab, setTab] = useState<WorkTab | null>(null);
  const [query, setQuery] = useState("");
  // 처음엔 내 차례가 있으면 그것부터, 없으면 요청한 업무(빈 표로 시작하지 않게).
  const active: WorkTab = tab ?? (mineCount ? "mine" : "requested");
  if (!board.enabled || (!board.canCreate && !board.items.length)) return null;
  const rows = urgentFirst(filterWork(board.items, active, board.me).filter((i) => matchesWork(i, query)), board.me, today);
  const c = workCounts(board.items, today);
  return (
    <section id="work" className="block dashboard-section">
      <div className="block-title"><h2>업무 흐름</h2><p>요청 → 담당자 보고 → 관리자 검토 → 마감</p></div>
      <article className="card check-card work-card">
        <header className="card-head">
          <div className="seg-toggle" role="group" aria-label="업무 보기">
            {tabs.map((t) => <button key={t} type="button" aria-pressed={active === t} onClick={() => setTab(t)}>{WORK_TAB_LABEL[t]}{t === "mine" ? ` ${mineCount}` : ""}</button>)}
          </div>
          <dl className="work-counts">
            {([["확인 전", c.ready], ["처리 중", c.working], ["보완 중", c.returned], ["검토 대기", c.review], ["기한 지남", c.late], ["7일 마감", c.closedWeek]] as const).map(([k, n]) => <div key={k} className={k === "기한 지남" && n ? "is-alert" : undefined}><dt>{k}</dt><dd>{n}</dd></div>)}
          </dl>
          <input type="search" className="work-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목 · 사람 · 학생" aria-label="업무 찾기" />
          {board.canCreate ? <button type="button" className="work-new" onClick={() => create()}>업무 요청</button> : null}
        </header>
        {rows.length ? (
          <div className="check-wrap">
            <table className="work-table">
              <thead><tr><th scope="col">종류</th><th scope="col">업무</th><th scope="col">담당</th><th scope="col">기한</th><th scope="col">단계</th><th scope="col">상태</th><th scope="col" aria-label="열기" /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} onClick={() => open(i.id)}>
                    <td className="area">{WORK_CATEGORY_LABEL[i.category]}</td>
                    <th scope="row"><button type="button" className="check-open" onClick={(e) => { e.stopPropagation(); open(i.id); }}>{i.title}</button>{i.links.length ? <small> · 학생 {studentCount(i)}</small> : null}</th>
                    <td>{i.steps.map((s) => s.user.name).join(" · ")}</td>
                    {(() => { const due = dueLabel(i, today); return <td className={due.late ? "is-late" : undefined}>{due.text}</td>; })()}
                    <td><StagePips stage={stageOf(i.status)} text={stageText(i)} /></td>
                    <td><span className={`work-chip ${chipTone(i, board.me) ?? ""}`}>{myTurn(i, board.me) === "report" ? "내 보고 차례" : myTurn(i, board.me) === "review" ? "내 검토 차례" : statusText(i)}</span></td>
                    <td className="go-cell"><GoIcon /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="foot">{query ? "찾는 업무가 없습니다." : active === "mine" ? "지금 내 차례인 업무가 없습니다." : "해당하는 업무가 없습니다."}</p>}
      </article>
    </section>
  );
}
