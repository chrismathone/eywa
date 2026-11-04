"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { isRichBody, richBodyText } from "@/features/work-requests/rich-body";
import { EVENT_LABEL, OUTCOME_LABEL, WORK_CATEGORY_LABEL, closeBasis, isLate, linksByAssignee, myTurn, reviewerOf, seesAll, stageOf, statusText, studentCount, type WorkItem, type WorkLink, type WorkStep } from "@/features/work-requests/model";
import { RecipientPreview } from "./recipient-preview";
import { WorkActions } from "./work-actions";
import { useWork } from "./work-context";
import { WorkPanel, hm, md } from "./work-panel";

const STEP_TEXT = { ready: "확인 전", acked: "처리 중", reported: "보고함" } as const;
/**
 * 긴 내용은 접어 두고 '내용 모두 보기'로 편다(담당자 · 보고 칸이 밀려 내려가지 않게).
 * 길이 = 글자 수 또는 줄 수(서식 글은 문단 · 제목 · 목록 줄을 센다 — 짧은 줄이 많은 담당자별 목록도 접힌다).
 */
const isLongBody = (body: string, rich: boolean) => rich
  ? (body.match(/<(p|h[1-6]|li)[\s>]/gi) ?? []).length > 10 || richBodyText(body).length > 420
  : body.split("\n").length > 10 || body.length > 420;

/**
 * 요청 내용 — 서식 글은 서식대로(전자결재와 같은 `.rich-content`), 옛 요청(글자만)은 글자대로.
 * 🔴 서식 글은 서버가 읽을 때 `sanitizeRichHtml`로 거른 값이다(queries.ts — 저장 때 한 번 · 읽을 때 한 번).
 */
function WorkBody({ body }: { body: string }) {
  const rich = isRichBody(body);
  const long = isLongBody(body, rich);
  const [open, setOpen] = useState(false);
  return (
    <div className={`work-body-wrap${long && !open ? " is-clipped" : ""}`}>
      {rich ? <div className="work-body rich-content" dangerouslySetInnerHTML={{ __html: body }} /> : <p className="work-body">{body}</p>}
      {long ? <button type="button" className="work-body-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "내용 접기" : "내용 모두 보기"}</button> : null}
    </div>
  );
}

function StudentLinks({ links, onNavigate }: { links: readonly WorkLink[]; onNavigate: () => void }) {
  return <div className="work-links">{links.map((l) => <WindowLink key={`${l.id}|${l.assigneeId ?? ""}`} href={`/students/${l.id}`} onNavigate={onNavigate}>{l.label || "이름 없음"}</WindowLink>)}</div>;
}

function Step({ step, links, onNavigate }: { step: WorkStep; links: readonly WorkLink[]; onNavigate: () => void }) {
  return (
    <div className={`work-step is-${step.state}`}>
      <div className="work-step-head">
        <b>{step.user.name}</b><small>{step.user.role}</small>
        <span className="work-chip">{step.state === "reported" && step.outcome ? `보고함 · ${OUTCOME_LABEL[step.outcome]}` : STEP_TEXT[step.state]}{step.reportedAt ? ` · ${hm(step.reportedAt)}` : step.ackedAt ? ` · ${hm(step.ackedAt)} 확인` : ""}</span>
      </div>
      {step.returnedNote && step.state !== "reported" ? <p className="work-returned">보완 요청: {step.returnedNote}</p> : null}
      {links.length ? <div className="work-step-students"><small>맡은 학생 {links.length}명</small><StudentLinks links={links} onNavigate={onNavigate} /></div> : null}
      {step.note && step.state === "reported" ? <p className="work-note">{step.note}</p> : null}
    </div>
  );
}

/** 업무 하나 — 맨 위 지금 단계와 내 차례, 담당자별 보고, 근거(학생), 사건 기록. */
export function WorkDrawer({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const { board, today, open } = useWork();
  const stage = stageOf(item.status);
  const basis = closeBasis(item);
  const byAssignee = linksByAssignee(item.links, item.steps.map((s) => s.user.id));
  // 담당 미정 = 어느 담당자도 맡지 않은 학생만 · 같은 학생은 한 번(직원을 지워 미정 줄이 겹쳐도).
  const owned = new Set([...byAssignee].flatMap(([key, list]) => (key ? list.map((l) => l.id) : [])));
  const loose = [...new Map((byAssignee.get(null) ?? []).filter((l) => !owned.has(l.id)).map((l) => [l.id, l])).values()];
  // 처리하고 나면 다음 내 차례로 바로 넘어갈 수 있게 — 지금 업무는 빼고 기한이 급한 순.
  const next = board.items.filter((i) => i.id !== item.id && myTurn(i, board.me)).sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"))[0];
  return (
    <WorkPanel eyebrow={`업무 요청 · ${WORK_CATEGORY_LABEL[item.category]}`} title={item.title} onClose={onClose}>
      <dl className="drawer-stats">
        <div><dt>상태</dt><dd>{statusText(item)}</dd></div>
        <div><dt>요청</dt><dd>{item.requester?.name ?? "—"}</dd></div>
        <div className={isLate(item, today) ? "is-alert" : undefined}><dt>기한</dt><dd>{md(item.dueOn)}</dd></div>
        <div><dt>검토</dt><dd>{reviewerOf(item)?.name ?? "—"}</dd></div>
      </dl>
      {item.body ? <WorkBody body={item.body} /> : null}
      {/* 담당자는 자기 몫만 받는다(서버가 가른다) — 전체를 보는 사람에게만 선생님마다 받은 글을 보여 준다. */}
      {item.body && seesAll(item, board.me, board.canMonitor)
        ? <RecipientPreview body={item.body} people={item.steps.map((s) => s.user)} owns={(id) => item.links.some((l) => l.assigneeId === id)} />
        : null}
      {item.criteria ? <div className="work-criteria"><b>완료 기준</b><p>{item.criteria}</p></div> : null}
      <ol className="work-stages">
        {["담당자 확인 · 처리 보고", "관리자 검토", "마감"].map((label, i) => <li key={label} className={i < stage ? "done" : i === stage ? "now" : undefined}><b>{label}</b><small>{i === 0 ? "모두 보고하면 다음 단계" : i === 1 ? "승인하면 마감 · 보완 요청은 사유와 함께 되돌림" : "처리 근거(무엇으로 · 누가 · 언제)가 남음"}</small></li>)}
      </ol>
      {basis ? <div className="work-closed"><b>마감 근거</b><p>{basis}{item.closedAt ? ` · ${hm(item.closedAt)}` : ""}</p>{item.reviewNote ? <p>“{item.reviewNote}”</p> : null}</div> : null}
      {item.status === "cancelled" ? <div className="work-closed is-off"><b>요청 취소</b><p>{item.closedBy ?? "요청자"}{item.closedAt ? ` · ${hm(item.closedAt)}` : ""}{item.reviewNote ? ` · ${item.reviewNote}` : ""}</p></div> : null}
      <WorkActions item={item} me={board.me} links={byAssignee.get(board.me) ?? []} />
      {next && !myTurn(item, board.me) ? <button type="button" className="work-next" onClick={() => open(next.id)}>다음 내 차례 · {next.title} ›</button> : null}
      <section className="drawer-table">
        <h3>담당자 <small>{item.steps.length}</small></h3>
        {item.links.length ? <p className="drawer-note">근거 학생 {studentCount(item)}명 · 담당자마다 맡은 학생만 보입니다 · 학생 기록은 바꾸지 않습니다</p> : null}
        <div className="work-steps">{item.steps.map((s) => <Step key={s.user.id} step={s} links={byAssignee.get(s.user.id) ?? []} onNavigate={onClose} />)}</div>
      </section>
      {loose.length ? (
        <section className="drawer-table">
          <h3>담당 미정 학생 <small>{loose.length}</small></h3>
          <p className="drawer-note">근거로만 남은 학생입니다 · 이름을 누르면 원생 화면</p>
          <StudentLinks links={loose} onNavigate={onClose} />
        </section>
      ) : null}
      <section className="drawer-table">
        <h3>사건 기록 <small>사람이 한 일과 상태가 바뀐 일</small></h3>
        <ol className="work-events">
          {[...item.events].reverse().map((e, i) => <li key={`${e.at}-${i}`}><time>{hm(e.at)}</time><b>{e.actor ?? "시스템"}</b><span>{EVENT_LABEL[e.kind]}{e.note ? ` — ${e.note}` : ""}</span></li>)}
        </ol>
      </section>
    </WorkPanel>
  );
}
