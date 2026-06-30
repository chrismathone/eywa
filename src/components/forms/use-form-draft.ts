"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyFormValues,
  clearDraft,
  hasMeaningfulValues,
  loadDraft,
  readFormValues,
  saveDraft,
} from "@/lib/form-draft";

/**
 * 폼 로컬 초안 자동저장 훅 — 입력 중 폼 값을 디바운스로 IndexedDB에 보관하고, 다시 열면 복구 배너를 제공한다.
 * "실제 저장"(서버 커밋)은 호출부 그대로 — 성공 시 `clear()`를 불러 초안을 비운다(다음에 stale 복구 방지).
 *
 * @param scope  폼/레코드 식별자(예: "consultation:new", "consultation:<id>").
 * @param formRef 대상 `<form>` ref.
 * @param enabled false면 자동저장·배너 비활성(수정 모드만 켜는 등).
 * @param onRestore 복구 시 컨트롤드(React state) 필드 rehydrate용(예: 과목점수 jsonb). DOM 필드는 자동 복원.
 */
export function useFormDraft({
  scope,
  formRef,
  enabled = true,
  onRestore,
  exclude,
  ignoreForBanner,
}: {
  scope: string;
  formRef: React.RefObject<HTMLFormElement | null>;
  enabled?: boolean;
  onRestore?: (values: Record<string, string>) => void;
  /** 캡처·복원에서 제외할 필드(비밀번호·서버 prop·봇 트랩 등 IDB에 남으면 안 되는 값). */
  exclude?: string[];
  /** 캡처는 하되 "의미 있는 입력" 판정에선 무시할 필드(기본값이 항상 채워지는 select/시각 등 → 빈 폼 오탐 방지). */
  ignoreForBanner?: string[];
}) {
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftRef = useRef<Record<string, string> | null>(null);
  // 옵션 배열은 렌더마다 새 참조라 effect 재실행을 막기 위해 키로 안정화.
  const excludeKey = (exclude ?? []).join(",");
  const ignoreKey = (ignoreForBanner ?? []).join(",");

  // 마운트 시 기존 초안 확인 → 의미 있는 값이 있으면 복구 배너 노출.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ignore = ignoreKey ? ignoreKey.split(",") : [];
    void loadDraft(scope).then((d) => {
      if (cancelled || !d) return;
      if (hasMeaningfulValues(d.values, ignore)) {
        draftRef.current = d.values;
        setDraftSavedAt(d.savedAt);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, enabled, ignoreKey]);

  // 디바운스 자동저장 — 폼 input/change에서 값 캡처 → IDB(의미 있는 값일 때만).
  useEffect(() => {
    if (!enabled) return;
    const form = formRef.current;
    if (!form) return;
    const excl = excludeKey ? excludeKey.split(",") : [];
    const ignore = ignoreKey ? ignoreKey.split(",") : [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const values = readFormValues(form, excl);
        if (hasMeaningfulValues(values, ignore)) void saveDraft(scope, values);
      }, 700);
    };
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
    };
  }, [scope, enabled, formRef, excludeKey, ignoreKey]);

  const restore = useCallback(() => {
    const form = formRef.current;
    const values = draftRef.current;
    if (form && values) {
      applyFormValues(form, values, excludeKey ? excludeKey.split(",") : []);
      onRestore?.(values);
    }
    setDraftSavedAt(null);
  }, [formRef, onRestore, excludeKey]);

  const discard = useCallback(() => {
    void clearDraft(scope);
    draftRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  // 서버 저장 성공 시 호출 — 초안 비움(다음 열기 때 stale 복구 방지).
  const clear = useCallback(() => {
    void clearDraft(scope);
    draftRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  return { draftSavedAt, restore, discard, clear };
}
