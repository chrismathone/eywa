"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SHELL_MODE_COOKIE, type ShellMode } from "@/lib/license/shell-mode";
import { useIsDesktop } from "./use-is-desktop";
import { useWorkspaceEnabled } from "./workspace-enabled";

/**
 * 이 셸의 **화면 방식**(창 모드 / 단일 화면(이전 화면 유지) / 단일 화면) — 관리자 풀셸 레이아웃이 지점 라이선스에서 정해 내려 준다
 * (판정은 [`shell-mode.ts`](../../lib/license/shell-mode.ts)).
 *
 * 🔴 `WorkspaceEnabledProvider`(창 엔진이 있나)와 **별개 축**이다 — 이전 화면 유지도 창 엔진을 쓰므로 enabled=true다.
 *    기본값 `windows` = 공급자가 없는 곳(창 안 문서·미니셸·테스트)은 종전 그대로.
 */
const ShellModeCtx = createContext<ShellMode>("windows");
/** 방식의 판(epoch) — 방식 행이 마지막으로 바뀐 시각. null = 모른다(조회 실패 · 공급자 없음) → 창 배치를 그 값으로 초기화하지 않는다. */
const ShellEpochCtx = createContext<string | null>(null);

/**
 * 🔴 **문서 하나 동안 방식은 고정**이다 — 처음 받은 값(방식·판)을 끝까지 쓴다. 바탕이 다시 그려지며(`router.refresh`·재검증) 새 값이
 * 내려와도 따르지 않는다: 따르면 캔버스가 창 트리 ↔ 화면 트리를 갈아 끼우며 iframe이 전부 다시 마운트돼 **입력·녹음이 말없이 끊기고**,
 * 판만 바뀐 경우에도 창이 그 자리에서 다 닫혔다(적대 리뷰). 바뀐 방식은 **다음에 페이지를 열 때** 적용된다(슈퍼관리자 카드 문구와 같다).
 * 처음 그릴 때 화면(iframe) 문서용 쿠키도 적는다(`SHELL_MODE_COOKIE` — 화면 모양을 부모와 같게). 렌더 중 부작용이지만 첫 렌더 한 번·멱등이고,
 * 캔버스가 하이드레이션 뒤에야 iframe을 만들므로 어떤 화면 요청보다 먼저다.
 */
export function ShellModeProvider({
  mode,
  epoch,
  children,
}: {
  mode: ShellMode;
  epoch: string | null;
  children: ReactNode;
}) {
  const [frozen] = useState(() => {
    // 쿠키는 브라우저 전체가 같이 쓴다 — 권위 없는 문서는 적지 않는다(재리뷰): 판을 모르는 문서(라이선스 조회 실패 → fail-open 창 모드)와
    // iframe 안에서 그려진 풀셸(embed가 떨어진 문서 [[#133]])이 적으면 다른 탭의 새 화면이 엉뚱한 모양으로 열린다.
    if (typeof document !== "undefined" && epoch !== null && window.parent === window) {
      try {
        document.cookie = `${SHELL_MODE_COOKIE}=${mode}; path=/; SameSite=Lax`;
      } catch {
        /* 쿠키를 못 쓰면 화면 문서는 서버 판정을 쓴다 */
      }
    }
    return { mode, epoch };
  });
  return (
    <ShellModeCtx.Provider value={frozen.mode}>
      <ShellEpochCtx.Provider value={frozen.epoch}>{children}</ShellEpochCtx.Provider>
    </ShellModeCtx.Provider>
  );
}

export function useShellMode(): ShellMode {
  return useContext(ShellModeCtx);
}

export function useShellModeEpoch(): string | null {
  return useContext(ShellEpochCtx);
}

/**
 * **이전 화면 유지 방식인가** — 데스크톱 ∧ 창 엔진이 있는 셸 ∧ 방식이 keepalive.
 * (`useWindowMode()`가 창 엔진 판정이고, 이것은 그 안에서 "한 화면씩·크롬 없이"를 고르는 판정이다.)
 */
export function useKeepaliveMode(): boolean {
  const isDesktop = useIsDesktop();
  const enabled = useWorkspaceEnabled();
  const mode = useShellMode();
  return isDesktop && enabled && mode === "keepalive";
}

/** 창(iframe) 문서 안에서 "이 문서는 이전 화면 유지 방식의 한 화면"임을 알린다 — 창 크롬(← 뒤로)이 없으니 인페이지 뒤로 링크가 서야 한다. */
const KeepaliveFrameCtx = createContext(false);

export function KeepaliveFrameProvider({ children }: { children: ReactNode }) {
  return <KeepaliveFrameCtx.Provider value>{children}</KeepaliveFrameCtx.Provider>;
}

export function useKeepaliveFrame(): boolean {
  return useContext(KeepaliveFrameCtx);
}
