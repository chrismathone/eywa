"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { REACTION_LABELS, REACTION_TYPES, type ReactionType } from "../reaction-policy";
import type { ReactionActionResult, ReactionView } from "../reply-types";
import { getParentReactionState, requestParentReaction, requestParentReactionRemove } from "../server/reaction-actions";

/** 연동 PC가 처리 중이면 이 간격으로 다시 읽는다(답글 창과 같은 10초). 2분 안에 안 끝나면 그만 묻는다(다음에 열 때 보인다). */
const POLL_MS = 10_000;
const POLL_MAX = 12;
const ACTION_TIMEOUT_MS = 30_000;

const BTN = "focus-visible:outline-primary rounded-md px-2 py-1 text-xs font-bold disabled:opacity-60";

/**
 * 학부모 글·댓글 **공감**(0319a) 조작 — 버튼(`trigger`)과 그 아래 펼침 줄(`panel`)을 따로 돌려준다(벨 행은 둘을 다른 자리에 놓는다).
 *   안 눌림: '공감' → 종류 여섯 개가 펼쳐진다 → 고르면 요청(연동 PC가 ClassNote에 누른다). 종류를 고르는 한 단계가 확인을 겸한다.
 *   눌림: '확인했어요 · 공감함' — 누른 사람 본인·관리자급은 눌러서 푼다. 처리 중에는 잠근다(재클릭 방어 — 서버는 메시지당 한 행).
 * 서버가 다시 내려준 값(`initial`)이 바뀌면 그 값을 따른다(이 화면에서 받은 결과는 그 전까지만 덮는다).
 */
export function useReactionControl(initial: ReactionView | null): { trigger: ReactNode; panel: ReactNode } {
  const [local, setLocal] = useState<{ base: ReactionView | null; view: ReactionView } | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const polls = useRef(0);
  const view = local && local.base === initial ? local.view : initial;
  const messageId = view?.messageId ?? null;
  const busy = view?.busy === true;

  useEffect(() => {
    if (!messageId || !busy) return;
    polls.current = 0;
    const t = setInterval(() => {
      if (++polls.current > POLL_MAX) return clearInterval(t);
      void getParentReactionState(messageId).then((v) => { if (v) setLocal({ base: initial, view: v }); }, () => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [messageId, busy, initial]);

  if (!view) return { trigger: null, panel: null };

  async function run(fn: () => Promise<ReactionActionResult>) {
    if (pending) return;
    setPending(true);
    setNote(null);
    try {
      const res = await Promise.race([fn(), new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ACTION_TIMEOUT_MS))]);
      if (res === "timeout") setNote("응답이 늦습니다 — 잠시 뒤 다시 확인하세요");
      else {
        if (res.reaction) setLocal({ base: initial, view: res.reaction });
        if (!res.ok) setNote(res.error);
      }
    } catch {
      setNote("요청하지 못했습니다 — 잠시 뒤 다시 시도하세요");
    } finally {
      setPending(false);
      setOpen(false);
    }
  }
  const press = (type: ReactionType) => void run(() => requestParentReaction({ messageId: view.messageId, type }));
  const remove = () => void run(() => requestParentReactionRemove({ messageId: view.messageId }));

  let trigger: ReactNode;
  if (view.busy || pending) {
    trigger = <span className="text-text-dim px-2 py-1 text-xs" role="status">{view.busy ? `${view.statusLabel}…` : "공감 요청 중…"}</span>;
  } else if (view.pressed) {
    const label = `${view.typeLabel ?? "공감"} · 공감함`;
    trigger = view.canRemove ? (
      <button type="button" aria-pressed="true" onClick={remove} title={`${view.by ?? ""} 명의로 공감함 — 누르면 풉니다`} className={`bg-primary-soft text-primary ${BTN}`}>
        {label}
      </button>
    ) : (
      <span className="text-text-dim px-2 py-1 text-xs" title={view.by ? `${view.by} 명의로 공감함` : undefined}>{label}</span>
    );
  } else if (view.canPress) {
    trigger = (
      <button type="button" aria-expanded={open} onClick={() => { setNote(null); setOpen((o) => !o); }} className={`text-primary hover:bg-primary-soft ${BTN}`}>
        공감
      </button>
    );
  } else trigger = null;

  const failed = !view.busy && !view.pressed && view.error ? view.error : null;
  const panel = open || note || failed ? (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {open
        ? REACTION_TYPES.map((t) => (
            <button key={t} type="button" disabled={pending} onClick={() => press(t)}
              className="border-line text-foreground hover:bg-bg-soft focus-visible:outline-primary rounded-full border px-2.5 py-1 text-xs disabled:opacity-60">
              {REACTION_LABELS[t]}
            </button>
          ))
        : null}
      {note || failed ? (
        <p role="status" className="text-danger basis-full text-right text-xs break-keep" title={!note ? (view.errorRaw ?? undefined) : undefined}>{note ?? failed}</p>
      ) : null}
    </div>
  ) : null;
  return { trigger, panel };
}

/** 버튼과 펼침 줄을 세로로 쌓은 기본 배치(수업보고서 '학부모 글·답글' 면 · 답글 창). 공감 기능이 없으면 아무것도 그리지 않는다. */
export function ReactionControl({ view }: { view: ReactionView | null }) {
  const { trigger, panel } = useReactionControl(view);
  if (!trigger && !panel) return null;
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      {trigger}
      {panel}
    </div>
  );
}
