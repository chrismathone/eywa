"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 풀셸의 **첫 화면(홈) 주소** — 대시보드 권한이 있으면 `/dashboard`, 원장이 꺼 둔 역할이면 `/menu`.
 * 값은 (shell) 레이아웃이 사용자 유효 매트릭스로 한 번 계산해 내려준다(`WorkspaceCanvas`의 homeHref와 같은 값).
 *
 * 🔴 로고·'바탕 보기'처럼 "처음으로" 가는 자리는 `/dashboard`를 **직접 적지 말고** 이 값을 쓸 것(2026-10-01,
 *    gotchas #137). 권한 없는 사람이 `/dashboard`로 가면 매번 튕기고, 그 튕김이 Next 기본 오류 화면의 입구였다.
 * 기본값 `/dashboard` = 제공자 밖(창 안·미니셸)에서도 종전 동작 그대로.
 */
const ShellHomeCtx = createContext("/dashboard");

export function ShellHomeProvider({ href, children }: { href: string; children: ReactNode }) {
  return <ShellHomeCtx.Provider value={href}>{children}</ShellHomeCtx.Provider>;
}

export function useShellHome(): string {
  return useContext(ShellHomeCtx);
}
