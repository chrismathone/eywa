"use client";

import { useState, useEffect, useActionState } from "react";
import { toast } from "sonner";
import { buildParentMessage, TONE_LABELS, type MessageTone, type MessageInput } from "../message";
import { logRetentionAction, type LogActionState } from "../server/actions";

const TONES: MessageTone[] = ["soft", "firm", "result", "reassure"];

/**
 * 학부모 메시지 초안 — 말투 토글 + 클립보드 복사 + 조치 기록(student_consultations). 실발송 없음.
 * `canWrite` = 서버 게이트(`logRetentionAction`)와 같은 `canWriteTenant(…,"retention")`를 page가 계산 — 읽기 권한이면
 * '발송 조치 기록'을 그리지 않는다(초안 보기·복사는 저장이 아니라 그대로 둔다, 원장 2026-11-05).
 */
export function MessageComposer({ studentId, input, canWrite }: { studentId: string; input: MessageInput; canWrite: boolean }) {
  const [tone, setTone] = useState<MessageTone>("soft");
  const [state, formAction, pending] = useActionState<LogActionState, FormData>(
    logRetentionAction,
    undefined,
  );
  const draft = buildParentMessage(input, tone);

  useEffect(() => {
    if (state?.ok) toast.success("조치를 기록했습니다 (학생상담에 저장)");
    else if (state?.error) toast.error(state.error);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("메시지를 복사했습니다");
    } catch {
      toast.error("복사에 실패했습니다");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="micro mr-1">말투</span>
        {TONES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTone(t)}
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              tone === t
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "border-line text-text-dim hover:bg-bg-soft"
            }`}
          >
            {TONE_LABELS[t]}
          </button>
        ))}
      </div>

      <pre className="bg-bg-soft text-foreground max-h-64 overflow-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {draft}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          메시지 복사
        </button>
        {canWrite ? (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="summary" value={`학부모 ${TONE_LABELS[tone]} 메시지 발송`} />
            <button
              type="submit"
              disabled={pending}
              className="border-line hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "기록 중…" : "발송 조치 기록"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
