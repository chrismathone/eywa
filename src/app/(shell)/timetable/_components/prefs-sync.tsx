"use client";

import { useEffect } from "react";

export const EMPTY_DAYS_COOKIE = "eywa-tt-emptydays";

/**
 * 강사뷰 '미사용 요일' 토글을 **기기에 기억**한다.
 *
 * 이 토글은 URL 파라미터(`emptydays=hide`)로만 살아 있었는데, eywa는 메뉴를 창(iframe)으로 열고 창은
 * 항상 깨끗한 URL로 열리므로 **열 때마다 기본값(전 요일 표시)으로 초기화**됐다. 강사뷰 기본이 월~토
 * 전 컬럼이라, 주 2일만 가르치는 강사도 매번 가로로 넓은 표를 다시 접어야 했다(적대 감사 UX).
 *
 * localStorage가 아니라 **쿠키**인 이유: 서버 컴포넌트가 첫 렌더에서 읽어야 깜빡임(잘못된 상태로
 * 그렸다가 클라에서 교정)이 없다. localStorage를 lazy state 초기값으로 읽는 패턴은 hydration 크래시
 * 전례(#75)도 있다. URL 파라미터가 있으면 그쪽이 우선(공유 링크 존중), 없을 때만 이 값이 기본이 된다.
 */
export function EmptyDaysPrefSync({ hide }: { hide: boolean }) {
  useEffect(() => {
    document.cookie = `${EMPTY_DAYS_COOKIE}=${hide ? "hide" : "show"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [hide]);
  return null;
}
