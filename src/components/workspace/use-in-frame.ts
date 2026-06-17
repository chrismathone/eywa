"use client";

import { useSyncExternalStore } from "react";

/**
 * 현재 문서가 iframe(플로팅 창) 안에서 렌더되는가 = `window.self !== window.top`.
 * embed=1 쿼리(URL 기반)와 달리 **물리적 프레임 여부**라, 서버액션 redirect·router.push·일반 Link로
 * embed 파라미터가 떨어진 하위 네비게이션에서도 항상 참 → 셸 크롬 이중 노출을 확실히 막는 기준.
 * 런타임에 바뀌지 않으므로 구독은 no-op, SSR/최상위 프레임은 false.
 */
function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // cross-origin 접근 차단 = iframe 안이라는 뜻(보수적으로 true).
    return true;
  }
}

const noopSubscribe = () => () => {};
const getSnapshot = () => inFrame();
const getServerSnapshot = () => false;

export function useInFrame(): boolean {
  return useSyncExternalStore(noopSubscribe, getSnapshot, getServerSnapshot);
}
