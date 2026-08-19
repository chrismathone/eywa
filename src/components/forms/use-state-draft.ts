"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  DRAFT_DEBOUNCE_MS,
  DRAFT_MAX_PENDING_MS,
  loadDraft,
  saveDraft,
  saveDraftOnHide,
} from "@/lib/form-draft";

/**
 * `clear()`(서버 저장 성공) 직후 재기준선을 받아 주는 창(ms). 프로그램적 상태 변화는 같은 커밋에서
 * 오므로 이 정도면 충분하고, 사람의 편집을 삼키기엔 짧다.
 */
const REBASE_WINDOW_MS = 1000;

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
  // 대기 중 디바운스 저장 타이머 — clear/discard가 취소할 수 있게 ref로 보관.
  // (저장 성공 직후 700ms 안에 남은 타이머가 발화하면 방금 지운 초안이 되살아나 stale 배너가 뜬다.)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // clear() 직후 재기준선 대기 — 저장 성공이 유발한 상태 변화(선택 해제 등)로 json이 바뀌면
  // 그 첫 스냅샷을 **저장하지 않고 새 기준선으로** 삼는다. 안 그러면 "발송 후 선택만 초기화하고
  // 본문은 남기는" 화면에서 방금 지운 초안이 즉시 다시 저장돼 배너가 되살아난다(대량 발송 실측).
  //
  // 🔴 **시간 상한이 안전장치다**(적대 리뷰 2026-08-18 HIGH). 불리언 플래그로 두면, 저장 뒤 그런
  //    프로그램적 변화가 **끝내 오지 않는** 화면에서 플래그가 무장한 채 남는다 — 회의 메모장은
  //    저장 성공 시 `hasContent`가 false가 되어(값=서버값) 아무 effect도 플래그를 소비하지 않는다.
  //    그러면 한참 뒤 사용자가 처음 붙여넣은 편집이 "새 기준선"으로 삼켜지고, 그 순간 디바운스·
  //    강제 저장·언로드 플러시가 **셋 다** pendingSince를 못 받아 붙여넣기가 통째로 사라진다
  //    (사고가 났던 그 화면 그대로). 프로그램적 변화는 clear()와 같은 커밋에서 오므로 창은 짧아도 된다.
  const rebaseUntilRef = useRef(0);

  // enabled가 꺼지면(편집기 닫힘 등) 남은 대기를 즉시 해소한다 — 창이 살아 있는 동안 재오픈하면
  // 그 세션의 첫 편집이 삼켜질 수 있다(적대 리뷰 중-2: 화자 하나만 고치러 재오픈한 편집).
  useEffect(() => {
    if (!enabled) rebaseUntilRef.current = 0;
  }, [enabled]);

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
  // 첫 미저장 변경 시각 — 연속 타이핑 중 강제 저장(MAX_PENDING) 판정 + 언로드 플러시 필요 여부.
  const pendingSinceRef = useRef<number | null>(null);
  // 언로드 플러시가 읽을 최신 스냅샷(pagehide는 렌더 사이클 밖에서 온다).
  const latestRef = useRef({ json, has });
  useEffect(() => {
    latestRef.current = { json, has };
  });
  useEffect(() => {
    if (!enabled) return;
    if (json === initialJsonRef.current) return;
    // 저장 직후 창 안에서 스냅샷이 바뀌었으면 그게 프로그램적 변화다 — 새 기준선으로 삼고 저장하지 않는다.
    // (창 밖의 변화는 사람이 친 것이므로 아래 저장 경로로 내려간다.)
    if (Date.now() < rebaseUntilRef.current) {
      rebaseUntilRef.current = 0;
      initialJsonRef.current = json;
      return;
    }
    if (!has) return;
    const write = () => {
      pendingSinceRef.current = null;
      void saveDraft(scope, { __json: json });
    };
    if (pendingSinceRef.current === null) pendingSinceRef.current = Date.now();
    // 연속 타이핑 중엔 디바운스가 계속 뒤로 밀린다 — 미저장이 MAX_PENDING을 넘으면 즉시 저장
    // (배포 스큐 강제 리로드·크래시가 와도 최대 그 간격만 잃는다).
    if (Date.now() - pendingSinceRef.current >= DRAFT_MAX_PENDING_MS) {
      write();
      return;
    }
    timerRef.current = setTimeout(write, DRAFT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scope, enabled, json, has]);

  // 언로드/탭 숨김 순간 마지막 타이핑까지 플러시 — 미저장 변경이 있을 때만(동기 백스톱 포함).
  useEffect(() => {
    if (!enabled) return;
    const flushOnHide = () => {
      if (pendingSinceRef.current === null) return; // 미저장 없음 — clear() 직후 초안 부활 방지
      pendingSinceRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      const { json: j, has: h } = latestRef.current;
      if (h && j !== initialJsonRef.current) saveDraftOnHide(scope, { __json: j });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushOnHide();
    };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scope, enabled]);

  const restore = useCallback(() => {
    setDraftSavedAt(null);
    return loadedRef.current;
  }, []);

  const discard = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingSinceRef.current = null;
    void clearDraft(scope);
    loadedRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  // 서버 저장 성공 시 호출 — 초안 비움. 대기 중 저장 타이머 취소 + 곧바로 이어지는 프로그램적
  // 상태 변화만 재기준선으로 흡수(창은 REBASE_WINDOW_MS — 위 rebaseUntilRef 주석 참조).
  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingSinceRef.current = null;
    rebaseUntilRef.current = Date.now() + REBASE_WINDOW_MS;
    void clearDraft(scope);
    loadedRef.current = null;
    setDraftSavedAt(null);
  }, [scope]);

  return { draftSavedAt, restore, discard, clear };
}
