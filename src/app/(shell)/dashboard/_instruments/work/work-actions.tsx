"use client";

import { useState, type ReactNode } from "react";
import { actOnWorkRequest } from "@/features/work-requests/server/actions";
import { OUTCOME_LABEL, WORK_OUTCOMES, reviewerOf, type WorkAction, type WorkItem, type WorkLink, type WorkOutcome } from "@/features/work-requests/model";
import { useWork } from "./work-context";

/** 내 차례의 처리 — 담당자는 확인·보고, 검토자는 승인·보완 요청, 요청자는 취소. 판정은 서버 함수가 다시 한다. */
/** 보고 칸 첫 글 — 맡은 학생마다 한 줄(학생마다 무엇을 했는지 적게). 이 글 그대로는 보고할 수 없다. */
const templateOf = (links: readonly WorkLink[]) => links.map((l) => `- ${l.label}: `).join("\n");

export function WorkActions({ item, me, links }: { item: WorkItem; me: string | null; links: readonly WorkLink[] }) {
  const { board, refresh } = useWork();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WorkOutcome>("done");
  const template = templateOf(links);
  const [note, setNote] = useState(template);
  const [review, setReview] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const mine = item.steps.find((s) => s.user.id === me);
  const reviewer = me !== null && (reviewerOf(item)?.id === me || item.requester?.id === me);
  const requester = me !== null && item.requester?.id === me;
  const open = item.status === "working" || item.status === "review";
  const reported = item.steps.filter((s) => s.state === "reported");

  const run = async (action: WorkAction, extra: { outcome?: WorkOutcome; note?: string; targets?: string[] } = {}) => {
    setBusy(true); setError(null);
    const res = await actOnWorkRequest({ id: item.id, action, outcome: extra.outcome ?? null, note: extra.note ?? null, targets: extra.targets ?? null }).catch(() => ({ ok: false as const, error: "연결이 끊겼습니다. 다시 해 주세요." }));
    setBusy(false);
    // 실패해도 다시 읽는다 — 다른 사람이 먼저 승인 · 취소했으면 낡은 화면을 지금 상태로(처리 칸이 남으면 쓰던 글은 그대로 · 칸이 없어져도 까닭은 보인다).
    if (!res.ok) { setError(res.error); await refresh(); return; }
    setNote(""); setReview(""); setTargets([]);
    setDone({ ack: "확인했습니다.", report: "보고했습니다.", approve: "승인해 마감했습니다.", return: "보완을 요청했습니다.", cancel: "요청을 취소했습니다." }[action]);
    await refresh();
  };

  // 강사뷰('다른 강사 뷰') — 처리 칸 대신 한 줄(서버도 막는다 · 막힐 단추를 내밀지 않는다 · 그 강사 대신 보고하지 않는다).
  if (board.readonly) return open ? <p className="drawer-note">강사뷰에서는 보기만 합니다 — 확인 · 보고는 이 선생님 계정에서 합니다.</p> : null;
  const parts: ReactNode[] = [];
  if (item.status === "working" && mine && mine.state !== "reported") {
    parts.push(
      <div key="report" className="work-act">
        <h4>{mine.state === "ready" ? "내 차례 — 확인하고 처리를 보고해 주세요" : "내 차례 — 처리 보고"}</h4>
        {mine.returnedNote ? <p className="work-returned">보완 요청: {mine.returnedNote}</p> : null}
        <div className="seg-toggle" role="group" aria-label="처리 결과">{WORK_OUTCOMES.map((o) => <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>{OUTCOME_LABEL[o]}</button>)}</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={Math.min(10, Math.max(3, links.length + 1))} maxLength={2000} placeholder="무엇을 했는지 · 근거(어느 기록에서 확인했는지)" />
        {links.length ? <p className="drawer-note">맡은 학생 {links.length}명 — 학생마다 한 줄씩 적어 주세요.</p> : null}
        <div className="work-buttons">
          {mine.state === "ready" ? <button type="button" disabled={busy} onClick={() => void run("ack")}>확인만</button> : null}
          <button type="button" className="is-primary" disabled={busy || note.trim().length < 2 || note.trim() === template.trim()} onClick={() => void run("report", { outcome, note })}>보고</button>
        </div>
      </div>,
    );
  }
  if (open && reviewer && reported.length) {
    parts.push(
      <div key="review" className="work-act">
        <h4>{item.status === "review" ? "검토 — 승인하거나 보완을 요청해 주세요" : `받은 보고 ${reported.length}건 — 먼저 보완을 요청할 수 있습니다`}</h4>
        <div className="work-targets">{reported.map((s) => <label key={s.user.id}><input type="checkbox" checked={targets.includes(s.user.id)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, s.user.id] : t.filter((x) => x !== s.user.id)))} />{s.user.name}</label>)}<small>고르지 않으면 보고한 사람 전부</small></div>
        <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} maxLength={1000} placeholder={item.status === "review" ? "승인 메모(선택) · 보완 요청이면 무엇을 보완할지" : "무엇을 보완할지"} />
        <div className="work-buttons">
          <button type="button" disabled={busy || review.trim().length < 2} onClick={() => void run("return", { note: review, targets })}>보완 요청</button>
          {item.status === "review" ? <button type="button" className="is-primary" disabled={busy} onClick={() => void run("approve", { note: review })}>승인 · 마감</button> : null}
        </div>
      </div>,
    );
  }
  if (open && requester) {
    parts.push(<div key="cancel" className="work-buttons is-quiet"><button type="button" disabled={busy} onClick={() => { if (window.confirm("이 업무 요청을 취소할까요? 담당자의 보고는 기록에 남습니다.")) void run("cancel", { note: review }); }}>요청 취소</button></div>);
  }
  const notice = done ? <p className="work-done" role="status">{done}</p> : null;
  if (!parts.length) return <>{notice}{error ? <p className="work-error" role="alert">{error}</p> : null}{open ? <p className="drawer-note">{item.status === "review" ? "모든 담당자가 보고했습니다. 검토자가 승인하면 마감됩니다." : "담당자의 보고를 기다리는 중입니다."}</p> : null}</>;
  return <div className="work-acts">{notice}{parts}{error ? <p className="work-error" role="alert">{error}</p> : null}</div>;
}
