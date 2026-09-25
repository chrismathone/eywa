"use client";

import { useIsDesktop } from "./use-is-desktop";
import { useWorkspaceEnabled } from "./workspace-enabled";

/**
 * **창 모드인가** — 메뉴·링크를 플로팅 창(iframe)으로 여는가, 일반 웹앱처럼 본문을 바꾸는가.
 *
 * = 데스크톱(`useIsDesktop` — ≥lg + 마우스) **그리고** 이 셸에 워크스페이스가 켜져 있음(`WorkspaceEnabledProvider`).
 * 워크스페이스는 두 곳에서 꺼진다: ① 강사·학생 미니셸(창 캔버스 자체가 없다) ② **지점 설정으로 창 모드를 끈 지점**
 * (원장 2026-09-25 *"iframe 모드를 켜고 끌수 잇게 … 모드를 켜면 일반적인 웹앱처럼 단일창으로"* → *"지점별 세팅"* →
 * *"admin에서 토글가능하게"* — 슈퍼관리자 라이선스 카드의 `window_mode`, 읽는 곳은 `(shell)/layout.tsx`).
 *
 * 🔴 **"창을 여나"를 판정하는 곳은 전부 이 훅**을 쓴다 — `useIsDesktop()`만 보면 창 모드를 끈 지점에서도 창을 띄운다
 *    (가드 `window-mode.test.ts`). 반대로 **보여 주는 모양**(사이드바냐 상단 바냐, 알림 벨을 어디 달까)은 창과 무관하게
 *    화면 폭이 정하므로 `useIsDesktop()` 그대로 둔다 — 벨을 이 훅으로 바꾸면 창 모드를 끈 PC에서 벨이 통째로 사라진다
 *    (상단 바 벨은 `!useIsDesktop()`일 때만 달린다).
 */
export function useWindowMode(): boolean {
  const isDesktop = useIsDesktop();
  const enabled = useWorkspaceEnabled();
  return isDesktop && enabled;
}
