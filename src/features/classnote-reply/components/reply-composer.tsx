"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * 답글 쓰기 — 본문 + **미리보기**(학부모가 ClassNote에서 볼 이름표 + 본문) + 확인 창 + 보내는 동안 잠금.
 * 🔒 재클릭 방어 두 겹: ① 보내는 동안 입력·버튼 잠금 ② **같은 본문**을 쓰는 동안 같은 `clientKey`(서버 유니크 — 두 번 눌러도 한 행).
 *    성공하면 키를 새로 만든다(다음 답글은 다른 행). 실패하면 키를 유지한다 — 서버가 받았는지 모르는 재시도도 한 행으로 모인다.
 *    🔴 키는 본문에 묶인다 — 응답이 끊긴 뒤 글을 고쳐 다시 보내는데 옛 키를 그대로 쓰면, 서버는 "이미 접수"로 답하고
 *       화면은 고친 글이 나간 줄 아는데 실제로 나가는 건 **고치기 전 글**이다. 본문이 바뀌면 새 키(새 요청)다.
 */
export function ReplyComposer({
  authorLabel,
  maxLength,
  pending,
  onSend,
  actions,
  actionPanel,
}: {
  authorLabel: string;
  maxLength: number;
  pending: boolean;
  /** 성공하면 true를 돌려준다(입력을 비운다). */
  onSend: (body: string, clientKey: string) => Promise<boolean>;
  actions?: ReactNode;
  actionPanel?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const body = text.trim();
  const tooLong = body.length > maxLength;

  async function send() {
    setConfirming(false);
    if (keyRef.current?.body !== body) keyRef.current = { key: newKey(), body };
    const ok = await onSend(body, keyRef.current.key);
    if (ok) {
      setText("");
      keyRef.current = null;
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        rows={4}
        placeholder="학부모님께 보낼 답글"
        className="border-line bg-background focus-visible:outline-primary w-full rounded-lg border p-2 text-sm leading-relaxed disabled:opacity-60"
        aria-label="답글 내용"
      />
      {body ? (
        <div className="bg-bg-soft rounded-lg p-3">
          <p className="text-text-faint mb-1 text-xs">학부모에게 이렇게 보입니다</p>
          <p className="text-foreground text-xs font-bold">{authorLabel}</p>
          <p className="text-foreground mt-1 text-sm leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{body}</p>
        </div>
      ) : null}
      {actionPanel}
      <div className="flex min-w-0 items-center gap-2" aria-label="답글 조작">
        {actions}
        <span className={`ml-auto shrink-0 text-xs tabular-nums ${tooLong ? "text-danger" : "text-text-faint"}`}>
          {body.length}/{maxLength}
        </span>
        <Button type="button" size="sm" className="shrink-0" disabled={pending || !body || tooLong} onClick={() => setConfirming(true)} aria-busy={pending}>
          {pending ? "보내는 중…" : "보내기"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="ClassNote에 답글 올리기"
        message={`'${authorLabel}' 이름으로 이 글에 댓글을 올립니다. 학부모에게 바로 알림이 갑니다.`}
        confirmLabel="올리기"
        onConfirm={() => void send()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function newKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
