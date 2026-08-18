"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyFormValues,
  clearDraft,
  DRAFT_DEBOUNCE_MS,
  DRAFT_MAX_PENDING_MS,
  hasMeaningfulValues,
  loadDraft,
  readFormValues,
  saveDraft,
  saveDraftOnHide,
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
  maxAgeMs,
}: {
  scope: string;
  formRef: React.RefObject<HTMLFormElement | null>;
  enabled?: boolean;
  onRestore?: (values: Record<string, string>) => void;
  /** 캡처·복원에서 제외할 필드(비밀번호·서버 prop·봇 트랩 등 IDB에 남으면 안 되는 값). */
  exclude?: string[];
  /** 캡처는 하되 "의미 있는 입력" 판정에선 무시할 필드(기본값이 항상 채워지는 select/시각 등 → 빈 폼 오탐 방지). */
  ignoreForBanner?: string[];
  /** 초안 유효 시간(ms) — 지나면 복구 제안 없이 폐기. 공용 기기에서 남의 초안이 오래 남으면 안 되는 폼(QR 접수 등)에. */
  maxAgeMs?: number;
}) {
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftRef = useRef<Record<string, string> | null>(null);
  // 대기 중 디바운스 저장 타이머 — clear/discard가 취소할 수 있게 ref로 보관.
  // (저장 성공 직후 700ms 안에 남은 타이머가 발화하면 방금 지운 초안이 되살아나 stale 배너가 뜬다.)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 첫 미저장 입력 시각 — 연속 타이핑 중 강제 저장(MAX_PENDING) 판정 + 언로드 플러시 필요 여부.
  const pendingSinceRef = useRef<number | null>(null);
  // 옵션 배열은 렌더마다 새 참조라 effect 재실행을 막기 위해 키로 안정화.
  const excludeKey = (exclude ?? []).join(",");
  const ignoreKey = (ignoreForBanner ?? []).join(",");

  // 마운트 시 기존 초안 확인 → 의미 있는 값이 있으면 복구 배너 노출.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ignore = ignoreKey ? ignoreKey.split(",") : [];
    const excl = excludeKey ? excludeKey.split(",") : [];
    void loadDraft(scope).then((d) => {
      if (cancelled || !d) return;
      // 유효 시간 초과 초안은 폐기(공용 기기에서 남의 초안이 며칠씩 남는 것 방지 — QR 접수 등).
      if (maxAgeMs && Date.now() - d.savedAt > maxAgeMs) {
        void clearDraft(scope);
        return;
      }
      // exclude가 생기기 전에 저장된 레거시 초안이 민감값을 품고 있으면 복구하지 않고 **즉시 폐기**한다.
      // (이력서 주민번호·계좌처럼 애초에 IDB에 남으면 안 되는 값 — 배포 후 첫 열기에 자동 정리)
      if (excl.some((k) => k in d.values)) {
        void clearDraft(scope);
        return;
      }
      if (hasMeaningfulValues(d.values, ignore)) {
        draftRef.current = d.values;
        setDraftSavedAt(d.savedAt);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scope, enabled, ignoreKey, excludeKey, maxAgeMs]);

  // 디바운스 자동저장 — 폼 input/change에서 값 캡처 → IDB(의미 있는 값일 때만).
  // ⚠️ 디바운스만으로는 부족하다: 연속 타이핑 중엔 타이머가 계속 뒤로 밀려 **한 번도 저장이 안 될 수 있고**,
  // 배포 스큐 강제 리로드(회의록 녹음 사고 2026-08-18)가 그 사이에 오면 전부 유실된다. 그래서
  // ① 미저장 입력이 DRAFT_MAX_PENDING_MS를 넘으면 타이핑 중에도 강제 저장, ② pagehide/탭 숨김 순간
  // 동기 백스톱(saveDraftOnHide)으로 마지막 타이핑까지 플러시.
  useEffect(() => {
    if (!enabled) return;
    const form = formRef.current;
    if (!form) return;
    const excl = excludeKey ? excludeKey.split(",") : [];
    const ignore = ignoreKey ? ignoreKey.split(",") : [];
    const write = () => {
      pendingSinceRef.current = null;
      const values = readFormValues(form, excl);
      if (hasMeaningfulValues(values, ignore)) void saveDraft(scope, values);
    };
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingSinceRef.current === null) pendingSinceRef.current = Date.now();
      if (Date.now() - pendingSinceRef.current >= DRAFT_MAX_PENDING_MS) {
        write();
        return;
      }
      timerRef.current = setTimeout(write, DRAFT_DEBOUNCE_MS);
    };
    const flushOnHide = () => {
      if (pendingSinceRef.current === null) return; // 미저장 입력 없음 — clear() 직후 초안 부활 방지
      pendingSinceRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      const values = readFormValues(form, excl);
      if (hasMeaningfulValues(values, ignore)) saveDraftOnHide(scope, values);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushOnHide();
    };
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVisibility);
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
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingSinceRef.current = null;
    void clearDraft(scope);
    draftRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  // 서버 저장 성공 시 호출 — 초안 비움(다음 열기 때 stale 복구 방지). 대기 중 저장 타이머도 취소.
  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingSinceRef.current = null;
    void clearDraft(scope);
    draftRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  return { draftSavedAt, restore, discard, clear };
}
