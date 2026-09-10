"use client";

import { startTransition, useActionState, useEffect, useId, useRef, type ReactNode } from "react";
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
  footer,
  children,
}: {
  section: SectionKey;
  payload: unknown;
  /** 폼 밖에서 서버 확정된 변경(과목 흡수 삭제 등) 신호 — baseline 재스냅샷(거짓 '미저장' 확인 방지). */
  savedNonce?: number;
  /** 폼 밖 즉시저장 카드(예: 강의실 CRUD). 폼과 저장 바 사이에 렌더 — 중첩 <form> 없이 저장 바를 창 하단에 고정. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<OwnerSaveState, FormData>(
    saveOwnerSection,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope: `tenant-settings:${section}`, formRef });
  const { markSaved } = useUnsavedGuard({ formRef });

  /**
   * ⚠️ **`action={formAction}`(네이티브 제출)을 쓰지 않는다** — React 19는 액션 폼을 제출하면 액션 실행 직전에
   * `requestFormReset`을 걸어 **폼을 자동 리셋**한다(react-dom `startHostTransition`). 컨트롤드 입력은 그 순간
   * DOM이 *마운트 시점* 값으로 되돌아가고, React는 자기 prop이 안 바뀌었으니 DOM을 다시 쓰지 않는다 →
   * **"저장은 됐는데 화면만 옛 값"**(새로고침하면 정상). 2026-07-21 실측: 보고서 '사진/파일 첨부'를 켜고
   * 저장하면 체크가 다시 꺼진 것처럼 보였다. 더 위험한 2차 증상은 hidden `data`도 함께 리셋되는 것 —
   * 아무것도 안 고치고 저장을 한 번 더 누르면 **직전 저장이 되돌아간다**.
   * → payload를 그 자리에서 FormData로 만들어 액션을 직접 디스패치한다(리셋 없음, 항상 최신 state 제출).
   */
  const submit = () => {
    const fd = new FormData();
    fd.set("section", section);
    fd.set("data", JSON.stringify(payload));
    startTransition(() => formAction(fd));
  };

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
    <div className="space-y-4">
      {/* onSubmit 경유(액션 폼 아님) — 위 submit() 주석 참조. Enter 저장은 그대로 살고, 자동 리셋만 안 생긴다.
          hidden 두 칸은 이제 제출에 안 쓰이지만 **useUnsavedGuard의 dirty 감지 캐리어**라 유지한다
          (버튼→state로만 바뀌는 편집은 폼 안에 대응 input이 없어 hidden 없이는 '미저장'을 못 본다). */}
      <form
        id={formId}
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="data" value={JSON.stringify(payload)} />
        {children}
      </form>
      {/* 폼 밖 즉시저장 카드(예: 강의실 CRUD)는 폼과 저장 바 사이에 둔다 — 중첩 <form> 방지 + 저장 바가
          전체 콘텐츠의 맨 아래(창 하단)에 sticky로 붙도록. 저장 버튼은 form 속성으로 위 폼과 연결. */}
      {footer}
      <FormActionBar>
        {state?.ok ? <span className="text-primary mr-1 text-xs font-bold">저장됨 · 테넌트 전체 적용</span> : null}
        {state?.error ? <span className="text-danger mr-1 text-xs">{state.error}</span> : null}
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </FormActionBar>
    </div>
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
    <section data-span-all={span2 ? "" : undefined} className={`bg-card shadow-card rounded-2xl p-5 ${span2 ? "xl:col-span-2" : ""}`}>
      <h3 className="text-foreground text-sm font-bold">{title}</h3>
      {description ? <p className="text-text-dim mt-1 text-xs">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
