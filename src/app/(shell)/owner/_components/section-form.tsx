"use client";

import { startTransition, useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { saveOwnerSection, type OwnerSaveState } from "@/features/owner/server/actions";
import type { SectionKey } from "@/features/owner/settings-types";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useNavigationSettings } from "@/features/owner/navigation-context";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { serializeForm } from "@/lib/realtime/form-snapshot";
import { OWNER_SECTION_MENU } from "@/lib/settings-role-catalog";
import type { MenuKey } from "@/lib/permissions";
import { writeLockedNote } from "@/lib/write-lock";
import { WriteLockProvider } from "./write-lock-context";

/** 섹션의 쓰기 권한 키 — 저장 액션(`saveOwnerSection`)과 같은 표다(설정별 권한이 없는 섹션은 학원 설정). */
function sectionMenu(section: SectionKey): MenuKey {
  return section in OWNER_SECTION_MENU ? OWNER_SECTION_MENU[section as keyof typeof OWNER_SECTION_MENU] : "owner";
}

/**
 * 섹션 폼 공통 래퍼 — 편집 상태(payload)를 hidden JSON으로 직렬화해 saveOwnerSection 호출.
 * 섹션 컴포넌트는 로컬 state만 관리하고 그 객체를 payload로 넘긴다. 저장 결과(저장됨/오류) 표시.
 * 🔴 `readOnly`(읽기 권한) = 저장 바를 **그리지 않고** 입력을 잠그며, 안에 든 목록 편집기·설정 칸은 쓰기 잠금 문맥을 받아
 *    추가·삭제 단추를 숨기고 빈 칸 placeholder를 권한 안내로 바꾼다(원장 2026-11-05, `write-lock-context.tsx`).
 */
export function SectionForm({
  section,
  payload,
  savedNonce,
  navigationBaseline,
  extraFields,
  onSubmit,
  onSaved,
  onSaveFailed,
  rebaselineNonce,
  footer,
  header,
  readOnly = false,
  lockMenu,
  lockNote = true,
  children,
}: {
  section: SectionKey;
  payload: unknown;
  /** 폼 밖에서 서버 확정된 변경(과목 흡수 삭제 등) 신호 — baseline 재스냅샷(거짓 '미저장' 확인 방지). */
  savedNonce?: number;
  navigationBaseline?: string;
  /** 저장 요청에 함께 싣는 칸(운영 섹션의 면·기준 token 등). 값이 없는 칸은 싣지 않는다. */
  extraFields?: Record<string, string | undefined>;
  /** 제출 직전 — 면이 "지금 값이 제출한 값"임을 적어 둔다(useSectionDraft.noteSubmitted). */
  onSubmit?: () => void;
  /** 저장 성공 확정 — 서버가 돌려준 상태(새 기준 token 등)를 면에 넘긴다. */
  onSaved?: (state: NonNullable<OwnerSaveState>) => void;
  /** 저장 실패(오류 응답) — 면이 제출 중 상태를 푼다(useSectionDraft.noteSaveFailed). */
  onSaveFailed?: () => void;
  /** 면이 서버 값으로 폼을 갈아끼웠다는 신호 — 미저장 가드의 기준을 지금 폼으로 다시 잡는다(다른 창엔 알리지 않는다). */
  rebaselineNonce?: number;
  /** 폼 밖 즉시저장 카드(예: 강의실 CRUD). 폼과 저장 바 사이에 렌더 — 중첩 <form> 없이 저장 바를 창 하단에 고정. */
  footer?: ReactNode;
  /** 읽기 전용에서도 분류 탭은 이동할 수 있도록 폼 밖에 둔다. */
  header?: ReactNode;
  readOnly?: boolean;
  /** 읽기 전용 안내에 적을 권한 키 — 기본은 섹션의 저장 권한 키. */
  lockMenu?: MenuKey;
  /**
   * readOnly일 때 폼 위 안내 한 줄을 적을지(기본 true). 바깥(면 위)이 같은 안내를 이미 적는 자리에서만 false —
   * 예: 연동 면 전체가 잠긴 때의 오늘 수학 카드(두 번 뜨지 않게, 2026-11-05 리뷰).
   */
  lockNote?: boolean;
  children: ReactNode;
}) {
  const formId = useId();
  const { tenantId } = useNavigationSettings();
  const [state, formAction, pending] = useActionState<OwnerSaveState, FormData>(
    saveOwnerSection,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved, rebaseline } = useConcurrentEditGuard({ scope: `tenant-settings:${section}`, formRef });
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
  // 제출 시점의 폼 스냅샷 — 저장이 도는 동안 더 고친 내용까지 '저장됨'으로 치지 않기 위해 따로 잡아 둔다.
  const submittedSnapshot = useRef<string | undefined>(undefined);
  const onSavedRef = useRef(onSaved);
  const onSaveFailedRef = useRef(onSaveFailed);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onSaveFailedRef.current = onSaveFailed;
  });
  // 오류 응답마다 한 번(응답은 매번 새 객체다) — 면이 "제출 중"에서 풀려 미뤄 둔 서버 값을 다시 본다.
  useEffect(() => {
    if (state?.error) onSaveFailedRef.current?.();
  }, [state]);
  const submit = () => {
    // 저장이 도는 중의 재제출(Enter)은 받지 않는다 — 응답과 제출분의 짝이 어긋난다.
    if (readOnly || pending) return;
    onSubmit?.();
    submittedSnapshot.current = formRef.current ? serializeForm(formRef.current) : undefined;
    const fd = new FormData();
    fd.set("section", section);
    fd.set("data", JSON.stringify(payload));
    for (const [name, value] of Object.entries(extraFields ?? {})) if (value !== undefined) fd.set(name, value);
    if (navigationBaseline !== undefined) fd.set("navigationBaseline", navigationBaseline);
    startTransition(() => formAction(fd));
  };

  // 저장 성공 확정(nonce) 후 동시편집 신호 발화(in-window — 이동 없음). 연속 저장마다 1회씩.
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      onSavedRef.current?.(state);
      // 두 가드 모두 **제출한 스냅샷**을 기준으로 — 저장 도중 더 고친 것은 계속 '미저장'으로 남는다.
      notifySaved(submittedSnapshot.current);
      markSaved(submittedSnapshot.current);
      if (section === "navigation" && tenantId) publishRecordSaved(`navigation:${tenantId}`);
    }
  }, [state, notifySaved, markSaved, section, tenantId]);

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

  // 면이 서버 값으로 폼을 갈아끼운 뒤(저장이 아니다) — 그 값이 곧 서버 상태라 가드의 기준을 다시 잡는다.
  const handledRebaseline = useRef(rebaselineNonce);
  useEffect(() => {
    if (rebaselineNonce !== handledRebaseline.current) {
      handledRebaseline.current = rebaselineNonce;
      markSaved();
      rebaseline();
    }
  }, [rebaselineNonce, markSaved, rebaseline]);

  const menu = lockMenu ?? sectionMenu(section);
  return (
    <WriteLockProvider locked={readOnly} menu={menu}>
    <div className="space-y-4">
      {header}
      {readOnly && lockNote ? <p className="text-text-faint text-xs">{writeLockedNote(menu)}</p> : null}
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
        <fieldset disabled={pending || readOnly} className="min-w-0 space-y-6 border-0 p-0 disabled:opacity-70">
          {children}
        </fieldset>
      </form>
      {/* 폼 밖 즉시저장 카드(예: 강의실 CRUD)는 폼과 저장 바 사이에 둔다 — 중첩 <form> 방지 + 저장 바가
          전체 콘텐츠의 맨 아래(창 하단)에 sticky로 붙도록. 저장 버튼은 form 속성으로 위 폼과 연결. */}
      {footer}
      {!readOnly ? <FormActionBar>
        {state?.ok ? <span className="text-primary mr-1 text-xs font-bold">저장됨 · 학원 전체에 적용</span> : null}
        {state?.error ? <span className="text-danger mr-1 text-xs">{state.error}</span> : null}
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </FormActionBar> : null}
    </div>
    </WriteLockProvider>
  );
}

// 카드는 그림만 그리는 부품이라 제 파일에 둔다 — 여기서는 종전 가져오기 경로를 지키려고 다시 내보낸다.
export { SettingsCard } from "./settings-card";
