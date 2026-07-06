"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { saveOwnerSection, type OwnerSaveState } from "@/features/owner/server/actions";
import type { SectionKey } from "@/features/owner/settings-types";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";

/**
 * 섹션 폼 공통 래퍼 — 편집 상태(payload)를 hidden JSON으로 직렬화해 saveOwnerSection 호출.
 * 섹션 컴포넌트는 로컬 state만 관리하고 그 객체를 payload로 넘긴다. 저장 결과(저장됨/오류) 표시.
 */
export function SectionForm({
  section,
  payload,
  savedNonce,
  children,
}: {
  section: SectionKey;
  payload: unknown;
  /** 폼 밖에서 서버 확정된 변경(과목 흡수 삭제 등) 신호 — baseline 재스냅샷(거짓 '미저장' 확인 방지). */
  savedNonce?: number;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<OwnerSaveState, FormData>(
    saveOwnerSection,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope: `tenant-settings:${section}`, formRef });
  const { markSaved } = useUnsavedGuard({ formRef });

  // 저장 성공 확정(nonce) 후 동시편집 신호 발화(in-window — 이동 없음). 연속 저장마다 1회씩.
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      notifySaved();
      markSaved();
    }
  }, [state, notifySaved, markSaved]);

  // 버튼→state→hidden input 경로(행 추가/삭제 등)는 native input 이벤트가 없어 useUnsavedGuard가
  // dirty를 못 본다(적대리뷰 2026-07-06) → payload가 바뀔 때마다 폼에 input 이벤트를 쏴 재계산 유도.
  // 마운트 시 1회 발화는 baseline과 동일해 no-op(무해). 가드는 setTimeout(0)으로 커밋 후 스냅샷을 읽음.
  const serialized = JSON.stringify(payload);
  useEffect(() => {
    formRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [serialized]);

  // 폼 밖 서버 확정(과목 흡수/미사용 삭제 = 즉시 저장) 후엔 로컬 payload가 곧 서버 상태 — baseline을
  // 재스냅샷해 창 닫기 시 거짓 '미저장' 확인이 뜨지 않게 한다. ⚠️ 그 시점의 다른 미저장 편집도 함께
  // 저장됨으로 간주되는 트레이드오프(삭제-후-닫기 단독 경로가 지배적이라 수용, 병합 적대리뷰 2026-07-06).
  const handledExternal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (savedNonce && savedNonce !== handledExternal.current) {
      handledExternal.current = savedNonce;
      markSaved();
      notifySaved();
    }
  }, [savedNonce, markSaved, notifySaved]);

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="data" value={JSON.stringify(payload)} />
      {children}
      <FormActionBar>
        {state?.ok ? <span className="text-primary mr-1 text-[12px] font-semibold">저장됨 · 테넌트 전체 적용</span> : null}
        {state?.error ? <span className="text-danger mr-1 text-[12px]">{state.error}</span> : null}
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center rounded-md px-4 py-2 text-[12px] font-bold disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </FormActionBar>
    </form>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  span2,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  // 내용이 큰 카드(약관·셔틀 등)는 2열 그리드에서 한 줄 전체를 차지해 빈 열·ragged를 방지.
  span2?: boolean;
}) {
  return (
    <section className={`border-border bg-card rounded-lg border p-5 ${span2 ? "xl:col-span-2" : ""}`}>
      <h3 className="text-foreground text-sm font-bold">{title}</h3>
      {description ? <p className="text-text-dim mt-1 text-[12px]">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
