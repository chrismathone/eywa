import type { ReactNode } from "react";
import { KeepalivePageMaximize } from "@/components/page-maximize/keepalive-page-maximize";
import { KeepaliveFrameProvider } from "./shell-mode";
import { KEEPALIVE_RAIL_SCRIPT, KEEPALIVE_RAIL_VAR, KEEPALIVE_ROOT_ATTR } from "./keepalive-frame";

/**
 * 이전 화면 유지 화면(iframe 문서)의 **바깥 껍데기** — 창 안 문서(embed 분기)의 `<main>`을 감싼다.
 * `active`가 아니면(창 모드 · 창이 아닌 문서) 아무것도 안 더한다 — 창 모드의 창 문서는 한 글자도 안 바뀐다.
 *  · 사이드바 폭만큼 왼쪽을 비운다 — 이 문서는 뷰포트 전체를 깔고 사이드바가 그 위를 덮는다(`keepalive-stage.tsx`). 폭은 인라인 스크립트가
 *    첫 페인트 전에 싣고 브리지가 따라간다(`keepalive-frame-bridge.tsx`).
 *  · '화면 최대화'를 부모와 맞추는 공급자(`KeepalivePageMaximize`)와 창 크롬 없음 표식(`KeepaliveFrameProvider` — 인페이지 '← 뒤로'가 서야 한다).
 */
export function KeepaliveFrameShell({
  active,
  maximized,
  children,
}: {
  active: boolean;
  /** 계정에 저장된 '화면 최대화' — 첫 HTML부터 맞는 모양으로(부모가 이후 바뀜을 알려 준다). */
  maximized: boolean;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <KeepaliveFrameProvider>
      <KeepalivePageMaximize initial={maximized}>
        {/* suppressHydrationWarning — 아래 인라인 스크립트가 이 div의 style에 변수를 먼저 단다(서버 HTML엔 없는 속성 하나). */}
        <div
          {...{ [KEEPALIVE_ROOT_ATTR]: "" }}
          className="h-screen"
          style={{ paddingLeft: `var(${KEEPALIVE_RAIL_VAR}, 0px)` }}
          suppressHydrationWarning
        >
          {/* 문서 파싱 중 실행 — 하이드레이션을 기다리면 본문이 한 번 왼쪽으로 쏠렸다 밀린다. */}
          <script dangerouslySetInnerHTML={{ __html: KEEPALIVE_RAIL_SCRIPT }} />
          {children}
        </div>
      </KeepalivePageMaximize>
    </KeepaliveFrameProvider>
  );
}
