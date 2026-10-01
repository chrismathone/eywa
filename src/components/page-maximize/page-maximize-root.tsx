"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { setMyPageMaximized } from "@/features/page-maximize/server/actions";
import { PageMaximizeContext } from "./page-maximize-context";

/**
 * 화면 최대화(원장 2026-10-01) — 관리자 풀셸 전체를 감싸 **표식 하나**(`data-page-maximize`)만 단다.
 *
 * 숨기는 일은 전부 globals.css 한 곳이 한다(`[data-page-maximize="on"] …`): 왼쪽 사이드바(`data-maximize-hide`) ·
 * 머리글의 eyebrow·구분자·설명(`data-page-header-extra`) · 머리글 구분선·아래 여백 · 본문 위·좌우 여백.
 * 🔴 **머리글 한 줄(제목 + 동작 + '화면 원래대로')은 남는다** — 원장 *"화면 최대화 버튼과 최소화 버튼을 같은 위치에 놔둬야지"*.
 *    켜고 끄는 버튼은 하나([`PageMaximizeButton`](./page-maximize-button.tsx))이고 최대화 전후 같은 줄 오른쪽 끝이다.
 * 🔴 **출구 보장** — PageHeader가 없는 화면(자체 머리)에서 최대화 상태면 본문 위에 출구 줄(`PageMaximizeFallbackBar`)이 선다
 *    (머리글 버튼이 있으면 CSS가 끈다). 떠 있는 모서리 버튼은 없앴다(원장 *"위치 못찾겠는데"*).
 * 사이드바·헤더 컴포넌트에 prop을 내리지 않는다(표식만 직접 단다 — `:has(> …)`는 dev CSS에서 사라진다, [[#127]]).
 *
 * - **첫 페인트부터** 정해진다 — `initial`은 셸 레이아웃(서버)이 계정 설정에서 읽어 넘긴다. 클라에서 읽으면
 *   사이드바가 잠깐 보였다 사라지고, localStorage를 렌더 초기값으로 읽으면 하이드레이션이 깨진다([[#75]]).
 * - **데스크톱 셸에서만** 효과가 있다 — CSS가 `desk`와 같은 미디어쿼리 안에 있다. 창을 좁혀 모바일 셸이 되면 최대화는
 *   잠들고(상단 바·헤더가 그대로), 다시 넓히면 돌아온다. 버튼도 같은 조건으로 숨는다.
 * - **창 모드가 켜진 지점에선 없다**(`useWorkspaceEnabled`) — 메뉴마다 플로팅 창이고 창마다 제 최대화가 있다.
 *   여기서 사이드바를 감추면 창을 여는 입구가 사라진다. 저장값이 켜져 있어도 무시한다(지점이 창 모드를 다시 끄면 돌아온다).
 * - 해제는 **'화면 원래대로' 버튼으로만**(원장 *"후에 '화면 원래대로' 버튼을 눌러야 돌아옴"*) — 메뉴를 옮겨도 그대로다.
 *   Esc는 쓰지 않는다(다이얼로그·팝오버가 먼저 쓴다).
 */
export function PageMaximizeRoot({ initial, children }: { initial: boolean; children: ReactNode }) {
  const windowMode = useWorkspaceEnabled();
  const [maximized, setState] = useState(initial);
  // 저장은 누른 순서대로(빠르게 두 번 누르면 나중 값이 이겨야 한다) — 앞 저장이 끝난 뒤 다음을 보낸다.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // 사람이 누른 전환인가(첫 렌더·서버 초기값은 아니다) — 아래 effect가 이때만 뒤처리를 한다. 값 = 누른 버튼.
  const toggled = useRef<{ from: HTMLElement | null } | null>(null);
  const setMaximized = useCallback((on: boolean, from?: HTMLElement | null) => {
    toggled.current = { from: from ?? null };
    setState(on);
    queue.current = queue.current
      .then(() => setMyPageMaximized(on))
      .then(
        (r) => {
          if (!r.ok) toast.error("화면 최대화 설정을 저장하지 못했습니다 — 새로고침하면 이전 상태로 돌아갑니다");
        },
        () => toast.error("화면 최대화 설정을 저장하지 못했습니다 — 새로고침하면 이전 상태로 돌아갑니다"),
      );
  }, []);
  const value = useMemo(() => (windowMode ? null : { maximized, setMaximized }), [windowMode, maximized, setMaximized]);
  const active = !windowMode && maximized;
  // 전환 뒤처리 둘(적대 리뷰):
  // ① `resize`를 한 번 쏜다 — 본문 폭·높이가 바뀌었는데 창 크기 이벤트가 없어서, 창 크기로 행 수를 정하는 목록
  //    (`AutoPageSize` — 직원·퇴원·원생상담)이 최대화 전 값에 굳고, 되돌린 뒤엔 "방금 청한 값의 역방향" 흔들림 방지에 막혀
  //    늘어난 행 수로 남았다(그 차단은 창 크기 변경 이벤트가 와야 풀린다 — 최대화→복원도 같은 경우).
  // ② 포커스를 누른 그 버튼에 — 같은 자리 토글이라 대개 그대로 있다. 출구 줄에서 되돌려 그 줄이 사라졌으면 화면에 보이는
  //    다른 토글로(없으면 그대로 둔다).
  useEffect(() => {
    const t = toggled.current;
    if (!t) return;
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      const target =
        t.from && t.from.isConnected
          ? t.from
          : [...document.querySelectorAll<HTMLElement>("[data-page-maximize-toggle]")].find((el) => el.getClientRects().length > 0);
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <PageMaximizeContext.Provider value={value}>
      {/* display:contents — 상자를 만들지 않는다(셸의 h-screen flex 배치가 그대로). 표식만 단다. */}
      <div data-page-maximize={active ? "on" : "off"} className="contents">
        {children}
      </div>
    </PageMaximizeContext.Provider>
  );
}
