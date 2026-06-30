"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "@/lib/form-draft";

/**
 * 상태 기반 로컬 초안 자동저장 — 입력이 `<form>` DOM이 아니라 React state(객체·동적 배열)인 폼용.
 * useFormDraft(DOM 이벤트 기반)와 짝. 직렬화 가능한 `snapshot`을 통째로 JSON으로 IDB에 디바운스 저장하고,
 * 복구는 `restore()`가 파싱된 스냅샷을 돌려주면 호출부가 setState로 rehydrate한다(동적 행·배열도 그대로 복원).
 *
 * @param snapshot   현재 직렬화 가능한 상태 스냅샷(예: { student, courses, extras, discounts }).
 * @param hasContent 빈 폼 판정 — true일 때만 저장·배너(아무것도 안 친 초기값 오탐 방지).
 */
export function useStateDraft<T>({
  scope,
  snapshot,
  enabled = true,
  hasContent,
}: {
  scope: string;
  snapshot: T;
  enabled?: boolean;
  hasContent: (s: T) => boolean;
}) {
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const loadedRef = useRef<T | null>(null);

  // 마운트 시 기존 초안 로드 → 있으면 배너 노출. (저장은 hasContent일 때만 일어나므로 로드된 초안은 항상 의미 있음.)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadDraft(scope).then((d) => {
      if (cancelled || !d?.values?.__json) return;
      try {
        loadedRef.current = JSON.parse(d.values.__json) as T;
        setDraftSavedAt(d.savedAt);
      } catch {
        /* 손상 초안 무시 */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, enabled]);

  // 스냅샷 변경을 디바운스 저장(의미 있는 내용일 때만). json/has는 렌더에서 계산.
  const json = JSON.stringify(snapshot);
  const has = hasContent(snapshot);
  // 마운트 시점 스냅샷 — 사용자가 아직 안 건드렸으면(현재=초기) 저장 보류. 편집 모드에서 마운트 직후
  // 저장이 같은 scope의 '복구 대기 초안'을 서버 초기값으로 덮어쓰던 클로버 방지(사용자가 restore 누르기 전).
  const initialJsonRef = useRef(json);
  useEffect(() => {
    if (!enabled || !has) return;
    if (json === initialJsonRef.current) return;
    const t = setTimeout(() => void saveDraft(scope, { __json: json }), 700);
    return () => clearTimeout(t);
  }, [scope, enabled, json, has]);

  const restore = useCallback(() => {
    setDraftSavedAt(null);
    return loadedRef.current;
  }, []);

  const discard = useCallback(() => {
    void clearDraft(scope);
    loadedRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  // 서버 저장 성공 시 호출 — 초안 비움.
  const clear = useCallback(() => {
    void clearDraft(scope);
    loadedRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  return { draftSavedAt, restore, discard, clear };
}
