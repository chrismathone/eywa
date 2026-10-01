"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { useShellMode } from "@/components/workspace/shell-mode";
import { setMyPageMaximized } from "@/features/page-maximize/server/actions";
import { PageMaximizeContext } from "./page-maximize-context";
import {
  INTERACTIVE_SELECTOR,
  RESTORE_INSET,
  cornerRect,
  pickCorner,
  samplePoints,
  type RestoreCorner,
} from "./restore-corner";

/**
 * 화면 최대화(원장 2026-10-01) — 관리자 풀셸 전체를 감싸 **표식 하나**(`data-page-maximize`)만 단다.
 *
 * 숨기는 일은 전부 globals.css 한 곳이 한다(`[data-page-maximize="on"] …`): 왼쪽 사이드바(`data-maximize-hide`) ·
 * 페이지 헤더(`data-page-header` — PageHeader와 그 스켈레톤) · 헤더만 감싼 래퍼(`data-page-header-slot`) · 본문 위·좌우 여백.
 * 사이드바·헤더 컴포넌트에 prop을 내리지 않는다(표식만 직접 단다 — `:has(> …)`는 dev CSS에서 사라진다, [[#127]]).
 *
 * - **첫 페인트부터** 정해진다 — `initial`은 셸 레이아웃(서버)이 계정 설정에서 읽어 넘긴다. 클라에서 읽으면
 *   사이드바가 잠깐 보였다 사라지고, localStorage를 렌더 초기값으로 읽으면 하이드레이션이 깨진다([[#75]]).
 * - **데스크톱 셸에서만** 효과가 있다 — CSS가 `desk`와 같은 미디어쿼리 안에 있다. 창을 좁혀 모바일 셸이 되면 최대화는
 *   잠들고(상단 바·헤더가 그대로), 다시 넓히면 돌아온다. 버튼 둘도 같은 조건으로 숨는다.
 * - **창 모드가 켜진 지점에선 없다**(`useWorkspaceEnabled`) — 메뉴마다 플로팅 창이고 창마다 제 최대화가 있다.
 *   여기서 사이드바를 감추면 창을 여는 입구가 사라진다. 저장값이 켜져 있어도 무시한다(지점이 창 모드를 다시 끄면 돌아온다).
 * - 해제는 **'화면 원래대로' 버튼으로만**(원장 *"후에 '화면 원래대로' 버튼을 눌러야 돌아옴"*) — 메뉴를 옮겨도 그대로다.
 *   Esc는 쓰지 않는다(다이얼로그·팝오버가 먼저 쓴다).
 */
export function PageMaximizeRoot({ initial, children }: { initial: boolean; children: ReactNode }) {
  // 🔴 **창 모드만** 최대화가 없다 — 이전 화면 유지 방식은 창 엔진이 있어도(enabled) 한 화면씩이라 사이드바를 감춰도 입구를 잃지 않는다
  //    (화면은 iframe이지만 눌림·상태는 이 문서가 갖는다 — 화면과의 메시지는 `KeepaliveMaximizeSync`).
  const engine = useWorkspaceEnabled();
  const shellMode = useShellMode();
  const windowMode = engine && shellMode !== "keepalive";
  const [maximized, setState] = useState(initial);
  // 저장은 누른 순서대로(빠르게 두 번 누르면 나중 값이 이겨야 한다) — 앞 저장이 끝난 뒤 다음을 보낸다.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // 사람이 누른 전환인가(첫 렌더·서버 초기값은 아니다) — 아래 effect가 이때만 뒤처리를 한다.
  const toggled = useRef(false);
  const setMaximized = useCallback((on: boolean) => {
    toggled.current = true;
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
  // ② 포커스를 반대쪽 버튼으로 — 누른 버튼이 숨어 포커스가 화면 밖으로 빠진다(키보드로 쓰는 사람이 길을 잃는다).
  useEffect(() => {
    if (!toggled.current) return;
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      const next = document.querySelector<HTMLElement>(active ? "[data-maximize-restore]" : "[data-page-maximize-button]");
      next?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <PageMaximizeContext.Provider value={value}>
      {/* display:contents — 상자를 만들지 않는다(셸의 h-screen flex 배치가 그대로). 표식만 단다. */}
      <div data-page-maximize={active ? "on" : "off"} className="contents">
        {children}
        {active ? <RestoreButton onRestore={() => setMaximized(false)} /> : null}
      </div>
    </PageMaximizeContext.Provider>
  );
}

const CORNER_STYLE: Record<RestoreCorner, CSSProperties> = {
  "top-right": { top: RESTORE_INSET.y, right: RESTORE_INSET.x },
  "bottom-right": { bottom: RESTORE_INSET.bottom, right: RESTORE_INSET.x },
  "bottom-left": { bottom: RESTORE_INSET.bottom, left: RESTORE_INSET.x },
  "top-left": { top: RESTORE_INSET.y, left: RESTORE_INSET.x },
};

/**
 * '화면 원래대로' — 최대화 중 유일한 출구라 **항상 보여야** 하고, 본문 위에 떠 있으니 **무엇도 가리지 말아야** 한다.
 * 오른쪽 위(원장 지정)에 서되 그 밑에 누를 것이 있으면 다른 모서리로 비킨다(`restore-corner.ts`). 판정은 메뉴를 옮길 때·
 * 창 크기가 바뀔 때·그리고 1.5초마다(편집 모드처럼 주소 없이 바뀌는 화면, 늦게 도착하는 본문) 한 번씩 — 점 다섯 개를
 * 찍어 보는 것이라 비용은 없다시피 하다.
 * ⚠️ z-[46] = 셸 내용(sticky 머리 z-10~30)보다 위 · 팝오버·다이얼로그·검색 팰릿(z-50)과 공지 팝업(z-55)보다 아래.
 */
function RestoreButton({ onRestore }: { onRestore: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const inFrame = useInFrame();
  const pathname = usePathname();
  const [corner, setCorner] = useState<RestoreCorner>("top-right");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof document.elementsFromPoint !== "function") return;
    let raf = 0;
    const evaluate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 숨은 탭·데스크톱이 아닐 때(CSS로 숨어 상자가 없다)는 재지 않는다.
        if (document.hidden || el.getClientRects().length === 0) return;
        // 무언가 버튼 **위에** 떠 있으면(다이얼로그 배경·팝오버·토스트) 이번엔 재지 않는다 — 그 아래에선 네 모서리가 다
        // "비어 있다"로 보여 버튼이 오른쪽 위로 돌아갔다가, 닫힌 뒤 다음 판정까지 '편집' 같은 컨트롤을 가렸다(적대 리뷰).
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
        if (top && !el.contains(top)) return;
        const size = { width: el.offsetWidth, height: el.offsetHeight };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const collides = (c: RestoreCorner) =>
          samplePoints(cornerRect(c, size, viewport)).some(([x, y]) => {
            const below = document.elementsFromPoint(x, y).find((n) => !el.contains(n));
            return !!below?.closest(INTERACTIVE_SELECTOR);
          });
        setCorner((cur) => pickCorner(cur, collides));
      });
    };
    evaluate();
    const settle = window.setTimeout(evaluate, 400);
    const timer = window.setInterval(evaluate, 1500);
    window.addEventListener("resize", evaluate);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.clearInterval(timer);
      window.removeEventListener("resize", evaluate);
    };
  }, [pathname]);

  if (inFrame) return null;
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="sm"
      data-maximize-restore=""
      // 셸 크롬 층 — 이용 분석이 이 버튼 위 입력을 화면 활동으로 세지 않게(결정 tenant.md "새 크롬 층을 만들면 표식").
      data-usage-chrome=""
      data-corner={corner}
      style={CORNER_STYLE[corner]}
      onClick={onRestore}
      className="fixed z-[46] hidden print:hidden opacity-70 hover:opacity-100 focus-visible:opacity-100 desk:inline-flex"
    >
      <EyIcon name="copy" />
      화면 원래대로
    </Button>
  );
}
