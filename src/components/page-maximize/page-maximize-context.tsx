"use client";

import { createContext, useContext } from "react";

/**
 * 화면 최대화 상태 — 관리자 풀셸의 [`PageMaximizeRoot`](./page-maximize-root.tsx)만 공급한다.
 *
 * `null` = **이 화면엔 최대화가 없다**: 창(iframe) 안 · 강사·학생 미니셸 · 슈퍼관리자 화면(공급자가 없다) ·
 * 창 모드가 켜진 지점(플로팅 창마다 제 최대화가 이미 있다). 버튼은 이 값만 보고 숨는다 — 화면 파일이 따로 판정하지 않는다.
 */
export type PageMaximizeState = {
  maximized: boolean;
  setMaximized: (on: boolean) => void;
};

export const PageMaximizeContext = createContext<PageMaximizeState | null>(null);

export function usePageMaximize(): PageMaximizeState | null {
  return useContext(PageMaximizeContext);
}
