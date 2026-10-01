"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSelectedLayoutSegments } from "next/navigation";
import { KEEPALIVE_SWEEP_MS } from "./keepalive-rules";
import { followLocation, here } from "./keepalive-follow-location";
import { isHomePath, renderedPathOf, visibleId, visibleUrl } from "./keepalive-url";
import { iframeRegistry } from "./route-window";
import { useWindowStore } from "./window-store";

/**
 * 이전 화면 유지 방식의 **주소 ↔ 화면 동기화 + 규칙 구동** — 한 곳에서 한다.
 *
 * 주소창 = 보이는 화면(원장 2026-10-01). 화면이 바뀌면 `pushState`(화면 전환 = 기록 한 칸 — 뒤로가기가 이전 화면으로),
 * 같은 화면 안 이동(드릴인)은 `replaceState`. 반대로 **주소가 바뀌면**(뒤로·앞으로·주소 직접 열기·맨 Link 이동) 그 화면을 연다 —
 * 새로고침하면 같은 화면이 다시 열리고, 공유 링크도 같은 화면으로 열린다(딥링크 = 창 모드와 같은 규칙).
 * 🔴 Next가 `pushState`/`replaceState`를 가로채 라우터와 맞춰 주므로(usePathname 갱신, RSC 요청 없음 — 렌더된 트리는 그대로) 네이티브
 *    history를 그대로 쓴다.
 * 🔴 **스토어 → 주소는 '보이는 화면이 바뀐 때만'** 쓴다 — 뒤로가기로 주소가 먼저 바뀐 직후 다른 스토어 변경이 그 주소를 되돌리지 않게.
 *
 * 🔑 **바탕(<main>)이 실제로 그리고 있는 화면**은 주소가 아니라 라우터 트리(`useSelectedLayoutSegments`)로 안다. 주소만 바꾸는 이동은
 *    트리를 안 바꾸므로 바탕은 보통 첫 화면이지만, 주소를 직접 열어 들어왔거나(딥링크) 바탕에서 `router.refresh()`·재검증 액션이
 *    돌았으면 그 주소의 화면이 바탕에 렌더돼 있다. 그래서 **첫 화면으로 돌아갈 때** 바탕이 첫 화면이 아니면 주소만 바꾸지 않고 라우터로
 *    첫 화면을 연다(그때만 한 번 — 미리 옮겨 두지 않는다: 첫 화면을 안 볼 사람에게 운영실 렌더 비용을 치르게 하지 않는다).
 *
 * 부가 일 둘:
 *  · 규칙(`applyKeepalive`: 하나만 보임·상한·2시간 만료)을 시작할 때 한 번, 스토어가 바뀔 때마다, 1분마다 구동한다.
 *  · 탭 제목 = 보이는 화면의 제목(단일 화면과 같게 · 뒤로가기 목록의 이름). 첫 화면으로 돌아오면 바탕의 제목으로 되돌린다.
 */
export function useKeepaliveFollow(active: boolean, home: string) {
  const router = useRouter();
  const pathname = usePathname();
  const rendered = renderedPathOf(useSelectedLayoutSegments());
  const st = useRef({
    ready: false,
    lastUrl: "",
    lastId: null as string | null,
    /**
     * 주소에서 출발한 동기화 중인가(뒤로·앞으로·주소 직접 열기) — 그 사이 생긴 화면 변화는 **기록을 새로 쌓지 않는다**(replace).
     * 쌓으면 앞으로 가기 기록이 잘린다(입력 중이라 옮기지 못하고 보이게만 한 화면처럼 주소가 기준과 다를 때 — 적대 리뷰).
     */
    following: false,
    /** 화면 제목으로 덮기 직전의 바탕 제목 — 그 제목을 단 바탕 경로와 함께(바탕이 바뀌면 Next가 제목을 새로 단다). */
    mainTitle: null as { path: string; title: string } | null,
  });
  // 라우터·렌더 경로는 ref로 — 효과 의존성에 넣으면 바뀔 때마다 시작 절차(만료 판정·딥링크 열기)가 처음부터 다시 돈다.
  const routerRef = useRef(router);
  const renderedRef = useRef(rendered);
  useEffect(() => {
    routerRef.current = router;
    renderedRef.current = rendered;
  });

  useEffect(() => {
    if (!active) return;
    const store = useWindowStore;
    const s = st.current;
    let unsub: (() => void) | null = null;
    let sweep: ReturnType<typeof setInterval> | null = null;
    let off: (() => void) | null = null;

    const follow = (h: string) => followWith(s, h);

    /** 탭 제목 — 보이는 화면 문서의 제목. 첫 화면이면 덮기 전 바탕 제목(바탕이 그대로일 때만). */
    const syncTitle = () => {
      const id = visibleId(store.getState());
      if (id) {
        let t = "";
        try {
          t = iframeRegistry.get(id)?.contentDocument?.title ?? "";
        } catch {
          /* 접근 불가 — 그대로 둔다 */
        }
        if (!t) return; // 아직 문서가 안 떴다 — 뜨면 제목 관찰(observeIframe)이 스토어를 바꿔 다시 온다
        if (!s.mainTitle) s.mainTitle = { path: renderedRef.current, title: document.title };
        if (document.title !== t) document.title = t;
        return;
      }
      const saved = s.mainTitle;
      if (!saved) return;
      s.mainTitle = null;
      if (saved.path === renderedRef.current && document.title !== saved.title) document.title = saved.title;
    };

    /** 화면 → 주소: 보이는 화면이 바뀐 때만. 화면 전환 = push, 같은 화면 안 이동 = replace. */
    const syncUrl = () => {
      const g = store.getState();
      const id = visibleId(g);
      const url = visibleUrl(g, home);
      if (id === s.lastId && url === s.lastUrl) return;
      const push = id !== s.lastId && !s.following;
      s.lastId = id;
      s.lastUrl = url;
      if (here() === url) return;
      if (id === null && !isHomePath(renderedRef.current, home)) {
        // 첫 화면으로 — 바탕이 다른 화면을 그리고 있다(딥링크·바탕 재렌더). 주소만 바꾸면 그 화면이 '첫 화면'으로 보인다.
        routerRef.current.push(home, { scroll: false });
        return;
      }
      window.history[push ? "pushState" : "replaceState"](null, "", url);
    };

    const onStore = () => {
      store.getState().applyKeepalive(Date.now());
      syncTitle();
      syncUrl();
    };

    const start = () => {
      store.getState().applyKeepalive(Date.now(), { expireVisible: true });
      follow(home);
      store.getState().applyKeepalive(Date.now()); // 방금 연 화면의 도장·나머지 숨김까지 한 번에 정리
      const g = store.getState();
      s.lastId = visibleId(g);
      s.lastUrl = visibleUrl(g, home);
      s.ready = true;
      syncTitle();
      unsub = store.subscribe(onStore);
      sweep = setInterval(onStore, KEEPALIVE_SWEEP_MS);
      const onPop = () => follow(home); // 이후 스토어 변경이 syncUrl을 거쳐 기준값을 맞춘다(replace로)
      window.addEventListener("popstate", onPop);
      off = () => window.removeEventListener("popstate", onPop);
    };

    if (store.persist.hasHydrated()) start();
    else {
      const un = store.persist.onFinishHydration(() => {
        un();
        start();
      });
      off = un;
    }
    return () => {
      unsub?.();
      if (sweep) clearInterval(sweep);
      off?.();
      s.ready = false;
      // 꺼질 때 화면 제목을 남기지 않는다(바탕이 그대로면 바탕 제목으로).
      const saved = s.mainTitle;
      s.mainTitle = null;
      if (saved && saved.path === renderedRef.current) document.title = saved.title;
    };
  }, [active, home]);

  // 폭이 좁아져 이 방식이 꺼지면(모바일 셸) 본문이 실제로 그 주소의 화면을 그리게 한다 — 주소는 보이던 화면인데 본문은 첫 화면인
  // 어긋남을 막는다. 주소와 바탕이 둘 다 첫 화면이면 옮길 것이 없다(쿼리만 다른 같은 경로도 다시 받는다 — 서버가 그린 쿼리가 다를 수 있다).
  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    if (!was || active) return;
    if (isHomePath(window.location.pathname, home) && isHomePath(renderedRef.current, home)) return;
    routerRef.current.replace(here(), { scroll: false });
  }, [active, home]);

  // 맨 Link·router.push 같은 **라우터 이동**(뒤로가기는 위 popstate가 이미 처리) — 주소가 우리 기준값과 다르면 그 화면을 연다.
  useEffect(() => {
    const s = st.current;
    if (!active || !s.ready) return;
    if (here() === s.lastUrl) return;
    followWith(s, home);
  }, [active, pathname, home]);
}

/** 주소 → 화면 동기화를 '주소에서 출발'로 표시하고 돈다(그 사이 스토어 → 주소는 replace). */
function followWith(s: { following: boolean }, home: string): void {
  s.following = true;
  try {
    followLocation(home);
  } finally {
    s.following = false;
  }
}
