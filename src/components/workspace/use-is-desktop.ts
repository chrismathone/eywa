"use client";

import { useSyncExternalStore } from "react";

// 데스크톱 = 넓은 폭 + 정밀 포인터(마우스). 모바일/태블릿 터치는 false → Stage Manager 미마운트.
const QUERY = "(min-width: 1024px) and (pointer: fine)";

/**
 * 🔑 `MediaQueryList`는 **문서당 하나**만 만든다.
 *
 * 이 훅은 `WindowLink`마다 불린다 — 시간표 격자 한 창이 학생·반 링크 수백 개를 그리므로, 구독마다
 * `window.matchMedia()`를 새로 만들면 그 수만큼 MQL 객체와 네이티브 리스너가 쌓이고 `getSnapshot`이
 * **렌더마다** 쿼리 문자열을 다시 파싱한다. 값은 문서 전체가 공유하는 하나뿐이라 인스턴스를 나눌
 * 이유가 없다 — MQL 1개 + 네이티브 리스너 1개로 접고, 구독자는 Set으로 모아 한 번에 깨운다.
 */
let mql: MediaQueryList | null = null;
function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  if (!mql) mql = window.matchMedia(QUERY);
  return mql;
}

/** 임베드 iframe 안에서는 아래 스냅샷이 **항상 false**라 값이 바뀔 일이 없다(구독 자체가 낭비). */
function inFrame(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}

const listeners = new Set<() => void>();
let attached = false;
function notify() {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void) {
  const mq = mediaQuery();
  if (!mq) return () => {};
  // 창(iframe) 안에선 값이 false로 고정 — 리스너를 달면 수백 개가 그냥 쌓이기만 한다.
  if (inFrame()) return () => {};
  listeners.add(cb);
  if (!attached) {
    mq.addEventListener("change", notify);
    attached = true;
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && attached) {
      mq.removeEventListener("change", notify);
      attached = false;
    }
  };
}
function getSnapshot() {
  // 임베드 iframe 안에서는 Stage Manager 캔버스가 없으므로 false(창 열기 트리거는 Sheet 폴백).
  if (inFrame()) return false;
  return mediaQuery()?.matches ?? false;
}
function getServerSnapshot() {
  return false; // SSR/모바일 우선 — hydration 후 데스크톱이면 확정
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
