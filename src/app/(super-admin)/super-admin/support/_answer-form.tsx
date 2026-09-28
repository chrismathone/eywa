"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { answerSupportRequest } from "@/features/support/server/admin-actions";
import { SUPPORT_STATUSES, SUPPORT_STATUS_META, type SupportStatus } from "@/features/support/types";

/**
 * 운영자 처리 폼 — 처리상태 · 처리완료 예정일 · 답변을 **한 번에** 저장한다(makeedu 운영자가 채우는 세 칸).
 * 상태가 바뀌거나 답변이 달리면 요청자에게 벨이 간다(서버 액션이 판정).
 */
export function SupportAnswerForm({
  requestId,
  initial,
}: {
  requestId: string;
  initial: { status: SupportStatus; dueDate: string; answer: string };
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SupportStatus>(initial.status);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [answer, setAnswer] = useState(initial.answer);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="bg-card shadow-card space-y-4 rounded-2xl p-5 lg:sticky lg:top-0"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const res = await answerSupportRequest(requestId, { status, dueDate, answer });
          if ("error" in res) {
            setMsg({ ok: false, text: res.error });
            return;
          }
          setMsg({ ok: true, text: "저장했습니다" });
          router.refresh();
        });
      }}
    >
      <h2 className="text-foreground text-base font-bold">처리</h2>
      <div className="space-y-1.5">
        <span className="text-sm font-bold">처리상태</span>
        <ToolbarSegment wrap>
          {SUPPORT_STATUSES.map((s) => (
            <ToolbarSegmentItem key={s} active={status === s} onClick={() => setStatus(s)}>
              {SUPPORT_STATUS_META[s].label}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </div>
      <label className="block">
        <span className="text-sm font-bold">처리완료 예정일</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="border-line mt-1 h-(--control-h) w-full rounded-lg border px-3 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">답변</span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={8000}
          rows={10}
          placeholder="안녕하세요. 에이와 운영팀입니다."
          className="border-line mt-1 w-full rounded-lg border px-3 py-2 text-sm leading-relaxed"
        />
      </label>
      {msg ? <p className={`text-sm ${msg.ok ? "text-foreground" : "text-danger"}`}>{msg.text}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </Button>
    </form>
  );
}
