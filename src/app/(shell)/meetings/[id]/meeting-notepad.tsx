"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { FileText, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { updateMeetingNotepad, type UpdateNotepadState } from "@/features/meetings/server/actions";
import { useEditPresence } from "@/features/presence/edit-presence";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

function SaveBtn({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !dirty}
      className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-50"
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
 *
 * `canWrite`(페이지가 updateMeetingNotepad와 같은 canWriteTenant("meetings")로 계산)가 거짓이면 글상자는 비활성 +
 * 권한 안내(빈 칸은 placeholder, 차 있으면 위 한 줄)이고, '메모 저장'·초안 복구 배너는 그리지 않는다.
 */
export function MeetingNotepad({
  meetingId,
  content,
  canWrite,
}: {
  meetingId: string;
  content: string;
  canWrite: boolean;
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

  // 로컬 초안 자동저장 — 수동 '메모 저장' 전 새로고침/창닫기로 미저장 메모가 날아가는 것 방지.
  // 미저장 변경(dirty)일 때만 IDB에 보관, 서버 저장 성공 시 삭제(use-state-draft).
  const localDraft = useStateDraft({
    scope: `meeting-notepad:${meetingId}`,
    snapshot: value,
    enabled: canWrite, // 읽기 권한이면 잠긴 칸에 되살릴 초안을 찾지 않는다

    hasContent: (s) => s.trim() !== "" && s !== savedValue,
  });
  const clearLocalDraft = localDraft.clear;
  useEffect(() => {
    if (state?.ok) clearLocalDraft();
  }, [state, clearLocalDraft]);

  return (
    <section className="bg-card border-border space-y-3 rounded-2xl border p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <FileText className="text-text-dim size-4 shrink-0" />
          <h2 className="text-foreground text-sm font-bold">메모장</h2>
        </div>
        {justSaved ? <span className="text-primary text-xs font-medium">저장됨</span> : null}
      </header>
      {/* 안내 문장("회의 중 메모를 적어두면 … 상단 'AI로 정리'를 누르세요")은 뺐다(디자인 v5 13단계 — 지시서 §4 설명 문장 금지).
          제목 '메모장'과 머리의 Primary 'AI로 정리'가 이미 그 사실을 말한다. */}
      {canWrite ? (
        <DraftBanner
          savedAt={localDraft.draftSavedAt}
          onRestore={() => {
            const d = localDraft.restore();
            if (d !== null) setValue(d);
          }}
          onDiscard={localDraft.discard}
        />
      ) : value.trim() ? (
        <p className="text-text-dim text-xs">{writeLockedNote("meetings")}</p>
      ) : null}
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={meetingId} />
        <textarea
          name="content"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canWrite}
          rows={6}
          placeholder={
            canWrite
              ? "예: 6/5까지 교재 재고 확인 — 박부장 / 신규 상담 유입 논의 / 다음 회의 5월 4주차"
              : writeLockedPlaceholder("meetings")
          }
          className="border-input bg-background text-foreground focus:ring-ring min-h-[9rem] w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {canWrite ? (
          <div className="flex items-center justify-end gap-2">
            {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
            <SaveBtn dirty={dirty} />
          </div>
        ) : null}
      </form>
    </section>
  );
}
