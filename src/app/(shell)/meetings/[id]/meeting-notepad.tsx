"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FileText, Loader2, Save } from "lucide-react";
import { updateMeetingNotepad, type UpdateNotepadState } from "@/features/meetings/server/actions";
import { useEditPresence } from "@/features/presence/edit-presence";

function SaveBtn({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !dirty}
      className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
      메모 저장
    </button>
  );
}

/**
 * 회의 메모장 — 회의 중/후 직접 작성한 메모를 편집·저장(content 컬럼). AI 호출 없음(저장만).
 * 저장한 메모는 "AI로 정리"(헤더) 시 전사와 **함께** 분석 입력이 된다(녹음이 없어도 메모만으로 정리 가능).
 *
 * dirty(수정됨)는 **파생값** — 현재 입력값 vs 마지막 저장값(액션 반환 content, 없으면 초기 prop).
 * ref를 render에서 읽거나 effect에서 setState하지 않는다(react-hooks/refs·set-state-in-effect 회피).
 */
export function MeetingNotepad({
  meetingId,
  content,
  hasAudio,
}: {
  meetingId: string;
  content: string;
  hasAudio: boolean;
}) {
  const [value, setValue] = useState(content);
  const [state, action] = useActionState<UpdateNotepadState, FormData>(
    updateMeetingNotepad,
    undefined,
  );

  // 마지막 저장값 = 액션이 되돌려준 content(저장 성공 후) 아니면 초기 prop. dirty·저장됨을 여기서 파생.
  const savedValue = state?.ok ? (state.content ?? "") : content;
  const dirty = value !== savedValue;
  const justSaved = !!state?.ok && !dirty;

  // "수정중" presence — 저장 안 한 편집이 있는 동안 track.
  useEditPresence(`meeting:${meetingId}`, dirty);

  return (
    <section className="bg-card border-border space-y-3 rounded-lg border p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <FileText className="text-text-dim size-4 shrink-0" />
          <h2 className="text-foreground text-sm font-semibold">메모장</h2>
        </div>
        {justSaved ? <span className="text-primary text-[11px] font-medium">저장됨</span> : null}
      </header>
      <p className="text-text-dim text-[12px]">
        회의 중 메모를 적어두면 {hasAudio ? "녹음 전사와 함께 " : ""}‘AI로 정리’ 때 함께 분석됩니다. 저장한 뒤 상단 ‘AI로
        정리’를 누르세요.
      </p>
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={meetingId} />
        <textarea
          name="content"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          placeholder="예: 6/5까지 교재 재고 확인 — 박부장 / 신규 상담 유입 논의 / 다음 회의 5월 4주차"
          className="border-input bg-background text-foreground focus:ring-ring min-h-[9rem] w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1"
        />
        <div className="flex items-center justify-end gap-2">
          {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
          <SaveBtn dirty={dirty} />
        </div>
      </form>
    </section>
  );
}
