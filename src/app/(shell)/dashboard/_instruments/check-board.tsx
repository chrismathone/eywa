"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WindowLink } from "@/components/workspace/window-link";
import { checkRows } from "@/features/dashboard/instruments/check-board";
import type { Candidate } from "@/features/dashboard/instruments/secretary-plan";
import { secretaryBrief } from "@/features/dashboard/instruments/secretary-plan";
import { requestFor } from "@/features/dashboard/instruments/secretary-requests";
import { BRIEF_EXTRAS } from "@/features/dashboard/instruments/extras-types";
import { saveDashboardCheckView } from "@/features/dashboard/overview/chart-prefs-actions";
import type { CheckView } from "@/features/dashboard/overview/chart-prefs";
import { myTurn } from "@/features/work-requests/model";
import { GoIcon, useBoard } from "./parts";
import { PeopleBoard } from "./people-board";
import { SecretaryPanel, type Numbers } from "./secretary-panel";
import { TaskPanel } from "./work/task-panel";
import { useWork } from "./work/work-context";

/**
 * 숫자에서 바로 처리로 — 줄을 누르면 그 카드의 상세가 열리고, '요청'을 누르면 근거 학생·담당자가 채워진 업무 요청이 열린다.
 * 내 차례인 업무 요청(보고 · 검토)이 맨 위에 선다. 강사 범위·과목 관리자 화면엔 학원 줄이 없다.
 * 위의 업무 비서가 같은 값에서 오늘 먼저 할 일을 고르고, '사람별'은 같은 값을 사람마다 묶는다(원장 2026-11-02 *"스마트하게"*).
 */
export function CheckBoard({ initialView = "rows", part = "all" }: {
  initialView?: CheckView;
  /** 시안: 새 대시보드 모양 — 'secretary' = 업무 비서만(한눈에 보기 머리 칸) · 'table' = 확인할 일 표만(오늘 운영). */
  part?: "all" | "secretary" | "table";
}) {
  const { snapshot, extras, extrasFailed, amounts, subjects, eieOn, clock } = useBoard();
  const work = useWork();
  const [tasks, setTasks] = useState<{ assignee: string | null } | null>(null);
  const [view, setView] = useState<CheckView>(initialView);
  const [open, setOpen] = useState(false);
  const academy = !snapshot.teacherView && !snapshot.view?.subjectScoped;
  const canRequest = work.board.enabled && work.board.canCreate;
  const rows = useMemo(
    () => (academy ? checkRows({ snapshot, extras, amounts, subjects, eieOn, can: (menu) => snapshot.allowed.includes(menu) }) : []),
    [academy, snapshot, extras, amounts, subjects, eieOn],
  );
  const brief = useMemo(() => secretaryBrief({ snapshot, extras }, rows, work.board.enabled ? work.board : null, canRequest), [snapshot, extras, rows, work.board, canRequest]);
  // 줄의 '요청'도 비서와 같은 초안 — 내용을 담당자별로 정리한다(`requestFor`).
  const prefills = useMemo(
    () => new Map(canRequest ? rows.map((r) => [r.key, requestFor(r.key, { snapshot, extras }, brief.signals, brief.people)] as const) : []),
    [canRequest, rows, snapshot, extras, brief],
  );
  // 비서 후보에 드는 숫자 — 업무 흐름 · 추가 값을 다 받았나 · 후보에 드는 칸을 못 받았나(못 받았으면 후보를 남기지 않는다).
  const numbers: Numbers = extrasFailed === null || !work.board.enabled ? "wait"
    : extrasFailed.some((k) => k === "*" || (BRIEF_EXTRAS as readonly string[]).includes(k)) ? "retry" : "ok";
  const turns = (["report", "review"] as const).map((kind) => ({ kind, items: work.board.items.filter((i) => myTurn(i, work.board.me) === kind) })).filter((t) => t.items.length);
  if (!academy && !turns.length) return null;
  const openTurn = (ids: string[]) => (ids.length === 1 ? work.open(ids[0]!) : document.getElementById("work")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const pick = (next: CheckView) => { setView(next); void saveDashboardCheckView(next).catch(() => undefined); };
  const request = (ref: string) => { const prefill = requestFor(ref, { snapshot, extras }, brief.signals, brief.people); if (prefill) work.create(prefill); };
  const act = (c: Candidate) => {
    if (c.action.kind === "request") request(c.ref);
    else if (c.action.kind === "tasks") setTasks({ assignee: c.action.assignee });
    else if (c.action.kind === "work") openTurn(c.action.id ? [c.action.id] : []);
  };
  if (part === "secretary") {
    return academy ? (
      <>
        <SecretaryPanel brief={brief} today={snapshot.today} clock={clock} numbers={numbers} canAsk={canRequest} onAct={act} variant="compact" onOpen={() => setOpen(true)} />
        {open ? <SecretaryOverlay onClose={() => setOpen(false)}>
          <SecretaryPanel brief={brief} today={snapshot.today} clock={clock} numbers={numbers} canAsk={canRequest} onAct={(c) => { setOpen(false); act(c); }} />
        </SecretaryOverlay> : null}
        {tasks ? <TaskPanel initial={{ filter: "late", assignee: tasks.assignee }} onClose={() => setTasks(null)} /> : null}
      </>
    ) : null;
  }
  return (
    <section id="checks" className="block dashboard-section">
      <div className="block-title">
        <h2>확인할 일</h2>
        <div className="check-title-tools">
          <p>줄을 누르면 근거와 대상이 열립니다{canRequest ? " · '요청'은 담당자에게 업무로 넘깁니다" : ""}</p>
          {academy ? (
            <div className="check-views" role="group" aria-label="확인할 일 보기" data-noopen>
              <button type="button" aria-pressed={view === "rows"} onClick={() => pick("rows")}>항목별</button>
              <button type="button" aria-pressed={view === "people"} onClick={() => pick("people")}>사람별</button>
            </div>
          ) : null}
        </div>
      </div>
      {academy && part === "all" ? <SecretaryPanel brief={brief} today={snapshot.today} clock={clock} numbers={numbers} canAsk={canRequest} onAct={act} /> : null}
      <article className="card check-card">
        {academy && view === "people" ? (
          <div className="check-wrap">
            <PeopleBoard people={brief.people} canRequest={canRequest} onRequest={(p) => request(`person:${p.id}`)} onTasks={(id) => setTasks({ assignee: id })} />
          </div>
        ) : rows.length || turns.length ? (
          <div className="check-wrap">
            <table>
              <thead><tr><th scope="col">영역</th><th scope="col">확인할 일</th><th scope="col" className="is-num">대상</th><th scope="col">근거</th><th scope="col">담당</th><th scope="col" aria-label="처리" /></tr></thead>
              <tbody>
                {turns.map(({ kind, items }) => (
                  <tr key={`work-${kind}`} className="is-turn" data-noopen>
                    <td className="area">업무</td>
                    <th scope="row"><button type="button" className="check-open" onClick={() => openTurn(items.map((i) => i.id))}>{kind === "report" ? "내가 보고할 업무 요청" : "내가 검토할 업무 요청"}</button></th>
                    <td className="is-num strong">{items.length}건</td>
                    <td className="basis">{items.slice(0, 2).map((i) => i.title).join(" · ")}{items.length > 2 ? ` 외 ${items.length - 2}` : ""}</td>
                    <td>나</td>
                    <td className="go-cell"><GoIcon /></td>
                  </tr>
                ))}
                {rows.map((r) => {
                  const prefill = prefills.get(r.key) ?? null;
                  return (
                    <tr key={r.key} data-detail={r.detail} data-noopen={r.detail ? undefined : true}>
                      <td className="area">{r.area}</td>
                      <th scope="row">
                        {r.href ? <WindowLink href={r.href}>{r.title}</WindowLink>
                          : r.tasks ? <button type="button" className="check-open" onClick={() => setTasks({ assignee: null })}>{r.title}</button>
                          : <button type="button" className="card-open">{r.title}</button>}
                      </th>
                      <td className="is-num strong">{r.target}</td>
                      <td className="basis">{r.basis}</td>
                      <td>{r.owner}</td>
                      <td className="go-cell">{prefill ? <button type="button" className="check-request" data-noopen onClick={() => work.create(prefill)}>요청</button> : <GoIcon />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="foot">지금 확인할 일이 없습니다.</p>}
      </article>
      {tasks ? <TaskPanel initial={{ filter: "late", assignee: tasks.assignee }} onClose={() => setTasks(null)} /> : null}
    </section>
  );
}

/**
 * 시안: 업무 비서 크게 보기 — 화면 위 오버레이. body로 꺼내 그리므로(카드 격자 · 변형된 조상 밖) 계기판 스타일 범위(.aywa-instruments)를 다시 씌운다.
 * React 이벤트는 포털을 지나 보드로 올라가므로, 단계의 '상세' 단추는 그대로 상세 창을 연다(상세 창이 이 위에 뜬다).
 */
function SecretaryOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="aywa-instruments sec-overlay" role="dialog" aria-modal="true" aria-label="오늘의 브리핑">
      <div className="sec-overlay-scrim" onClick={onClose} />
      <div className="sec-overlay-panel">
        <button type="button" className="sec-overlay-close" data-noopen onClick={onClose} aria-label="닫기">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
