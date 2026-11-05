"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { createStudentMemo, type CreateMemoState } from "@/features/students/server/actions";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
// 분류는 단일 소스 — 화면 파일에 목록·라벨·색을 다시 적지 말 것.
import { MEMO_CATEGORIES } from "@/features/students/detail/memo-category";
import { writeLockedPlaceholder } from "@/lib/write-lock";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      특이사항 추가
    </Button>
  );
}

/**
 * canWrite = 서버 `createStudentMemo`와 같은 판정(`canWriteTenant(role, "students")`) — page.tsx가 계산해 내린다.
 * 읽기 권한이면 칸은 비활성 + 안내 placeholder, '특이사항 추가'는 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export function MemoForm({ studentId, canWrite }: { studentId: string; canWrite: boolean }) {
  const [state, formAction] = useActionState<CreateMemoState, FormData>(
    createStudentMemo,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // 로컬 초안 자동저장 — 작성 중 메모를 새로고침/창닫기에서 지킨다. 저장 성공 시 초안 삭제(reset과 함께).
  // 읽기 권한이면 끈다 — 쓸 수 없는 칸에 '작성하던 내용이 있습니다'를 띄우지 않게.
  const draft = useFormDraft({
    scope: `student-memo:${studentId}`,
    formRef,
    enabled: canWrite,
    exclude: ["studentId"],
    ignoreForBanner: ["category"],
  });
  const clearDraft = draft.clear;

  // ⚠️ 성공 판정은 state?.ok(액션이 성공 시 {ok:true} 반환) + 의존성은 state 객체 —
  //    boolean 파생값에 걸면 연속 저장부터 effect가 안 돌아 reset·초안 삭제가 죽는다(리뷰 지적).
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      clearDraft();
    }
  }, [state, clearDraft]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-bg-soft/30 border-border space-y-2 rounded-2xl border p-3"
    >
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex items-center gap-2">
        <select
          name="category"
          defaultValue="general"
          disabled={!canWrite}
          className="border-border bg-card text-foreground rounded-lg border px-2 py-1 text-xs disabled:opacity-60"
        >
          {MEMO_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">분류</span>
        {/* 검색 허용(원장 2026-09-08) — 켜 두면 학생 검색이 이 메모 내용으로도 그 학생을 찾는다.
            🔴 기본은 켜짐이다: 메모를 적는 대부분의 이유가 "나중에 찾기"라서(민감한 메모만 끈다). */}
        <label className={`text-muted-foreground ml-auto flex items-center gap-1.5 text-xs ${canWrite ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" name="searchable" defaultChecked disabled={!canWrite} className="size-3.5 accent-[var(--primary)]" />
          검색 허용
        </label>
      </div>
      <textarea
        name="content"
        required
        rows={3}
        disabled={!canWrite}
        placeholder={canWrite ? "특이사항을 입력하세요..." : writeLockedPlaceholder("students")}
        className="border-border bg-card text-foreground w-full rounded-lg border px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      />
      {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Submit />
        </div>
      ) : null}
    </form>
  );
}
