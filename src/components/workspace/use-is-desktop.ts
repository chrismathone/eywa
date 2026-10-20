"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_MIN_WIDTH, DESK_CHANGE_EVENT } from "./desk-detect";

// 값은 일반 모듈(desk-detect.ts)에 산다 — 서버 루트 레이아웃도 읽어야 해서(`"use client"` 모듈 상수는 서버에서 undefined, [[#81]]).
export { DESKTOP_MIN_WIDTH };

// 데스크톱 = 넓은 폭 + 마우스·터치패드가 **하나라도**(`any-pointer`) — 주 입력만 보는 `pointer: fine`이면 터치스크린 PC가 마우스를
// 꽂아도 모바일 셸이 됐다(원장 2026-10-15). 모바일/태블릿 터치(정밀 포인터 없음)는 false → Stage Manager 미마운트.
const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px) and (any-pointer: fine)`;

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
    // 실제 마우스 움직임으로 데스크톱이 된 순간(desk-detect.ts 스크립트가 보낸다) — 미디어쿼리는 안 바뀐다.
    window.addEventListener(DESK_CHANGE_EVENT, notify);
    attached = true;
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && attached) {
      mq.removeEventListener("change", notify);
      window.removeEventListener(DESK_CHANGE_EVENT, notify);
      attached = false;
    }
  };
}
function getSnapshot() {
  // 임베드 iframe 안에서는 Stage Manager 캔버스가 없으므로 false(창 열기 트리거는 Sheet 폴백).
  if (inFrame()) return false;
  // 미디어쿼리 또는 실제 마우스 움직임 표시(`data-desk`, desk-detect.ts) — 터치 모니터 PC는 브라우저가 마우스를 못 알아본다(2026-10-16).
  return (mediaQuery()?.matches ?? false) || document.documentElement.hasAttribute("data-desk");
}
function getServerSnapshot() {
  return false; // SSR/모바일 우선 — hydration 후 데스크톱이면 확정
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * 지금 이 문서가 데스크톱 셸인가 — **효과 안에서 한 번 묻는 자리**용(필터 기록기 `filter-seen-tracker.tsx`).
 * 훅은 하이드레이션 첫 렌더에 서버 스냅샷(false)을 돌려줘서, 그 렌더의 효과는 잠깐 틀린 값을 본다.
 */
export function isDesktopNow(): boolean {
  return getSnapshot();
}
