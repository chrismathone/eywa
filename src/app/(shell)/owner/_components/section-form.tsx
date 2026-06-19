"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { saveOwnerSection, type OwnerSaveState } from "@/features/owner/server/actions";
import type { SectionKey } from "@/features/owner/settings-types";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";

/**
 * 섹션 폼 공통 래퍼 — 편집 상태(payload)를 hidden JSON으로 직렬화해 saveOwnerSection 호출.
 * 섹션 컴포넌트는 로컬 state만 관리하고 그 객체를 payload로 넘긴다. 저장 결과(저장됨/오류) 표시.
 */
export function SectionForm({
  section,
  payload,
  children,
}: {
  section: SectionKey;
  payload: unknown;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<OwnerSaveState, FormData>(
    saveOwnerSection,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope: `tenant-settings:${section}`, formRef });

  // 저장 성공 확정(nonce) 후 동시편집 신호 발화(in-window — 이동 없음). 연속 저장마다 1회씩.
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      notifySaved();
    }
  }, [state, notifySaved]);

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="data" value={JSON.stringify(payload)} />
      {children}
      <div className="border-border flex items-center gap-3 border-t pt-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center rounded-md px-4 py-2 text-[12px] font-bold disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {state?.ok ? <span className="text-primary text-[12px] font-semibold">저장됨 · 테넌트 전체 적용</span> : null}
        {state?.error ? <span className="text-danger text-[12px]">{state.error}</span> : null}
      </div>
    </form>
  );
}

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <h3 className="text-foreground text-sm font-bold">{title}</h3>
      {description ? <p className="text-text-dim mt-1 text-[12px]">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
