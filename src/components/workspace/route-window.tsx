"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWindowStore, type Win } from "./window-store";
import { withEmbed } from "./embed-context";
import { WINDOW_BUSY_MESSAGE } from "./use-recording-lock";
import { useWindowSignals } from "./use-window-signals";
import { useShellMode } from "./shell-mode";
import { clearDirtyForNewDocument } from "./window-signals-core";
import { Button } from "@/components/ui/button";
import { useWindowPresentation } from "@/features/owner/navigation-context";

/**
 * 라우트 창의 iframe 엘리먼트 레지스트리(런타임·모듈 전역). 타이틀바 뒤로(←) 버튼이
 * 해당 창 iframe의 history.back()을 호출할 수 있게 RouteWindow가 자기 iframe을 등록한다.
 */
export const iframeRegistry = new Map<string, HTMLIFrameElement>();

/**
 * 창 iframe을 다른 주소로 **통째로** 옮긴다 — 창 크롬(← 뒤로·메뉴의 '첫 화면으로')의 단일 경로.
 * 🔴 **언제나 `withEmbed`를 거친다.** 뒤로 기록은 iframe의 실제 주소를 그대로 적는데, 창 안에서 한 이동(기간 이동 등)이
 *    embed=1을 떨어뜨린 주소가 거기 섞인다 — 그걸 그대로 열면 창 안에 **풀 셸**이 뜬다(전수검사 2026-09-11: ←만 embed를
 *    안 붙였고 메뉴 재클릭은 붙였다). 첫 로드·복제(`src`)와 ⟳(`reloadTarget`)도 같은 규칙이다.
 * `location.replace` = 창들이 공유하는 joint session history를 건드리지 않는다(다른 창이 되감기지 않게).
 */
export function navigateWindow(id: string, url: string): void {
  iframeRegistry.get(id)?.contentWindow?.location.replace(withEmbed(url));
}

/**
 * ⟳(이 창만 새로고침)이 갈 주소 — 지금 문서에 embed=1이 있으면 null(그대로 `reload()` — 스크롤 보존), 없으면 embed를
 * 붙인 같은 주소. `reload()`는 지금 주소 그대로라, embed가 떨어진 문서를 새로고침하면 창 안에 풀 셸이 떴다.
 * 아직 라우트를 싣기 전(about:blank)이면 null — 종전대로 둔다.
 */
export function reloadTarget(loc: { pathname: string; search: string; hash: string }): string | null {
  if (!loc.pathname.startsWith("/")) return null;
  if (new URLSearchParams(loc.search).get("embed") === "1") return null;
  return withEmbed(loc.pathname + loc.search + loc.hash);
}

/**
 * 창 iframe의 지금 문서와 `url`이 **해시만 다른** 같은 문서인가 — 그런 이동은 새 문서가 뜨지 않는다(해시로 스크롤만).
 * 스켈레톤을 걸면 걷어 줄 load가 오지 않아 영영 덮인다(재리뷰 2026-09-11). 아직 라우트를 싣기 전이면 false.
 */
function isSameDocument(frame: HTMLIFrameElement, url: string): boolean {
  try {
    const loc = frame.contentWindow?.location;
    if (!loc || !loc.pathname.startsWith("/")) return false;
    const target = new URL(url, "http://same-document.invalid");
    return target.pathname === loc.pathname && target.search === loc.search;
  } catch {
    return false;
  }
}

/** 문서 제목에서 " — aywa" 류 접미사 제거(크롬 타이틀 표시용). 옛 이름(eywa) 배포본의 창도 함께 뗀다(2026-09-21 개명). */
function cleanTitle(raw: string) {
  return raw.replace(/\s*[—–-]\s*(?:[ae]ywa|에이와)\s*$/i, "").trim();
}

/**
 * 메뉴 풀화면 창 — 크롬리스 라우트를 same-origin iframe으로 임베드.
 * 별도 문서/정상 네비게이션이라 "RSC 트리 명령형 마운트"(Next16 부재) 제약을 우회하고,
 * 쿠키가 그대로 실려 RLS가 iframe마다 독립 적용된다. 드래그/리사이즈는 setPointerCapture라
 * iframe이 포인터를 가로채도 정상 동작. onLoad까지 라이트 스켈레톤.
 */
export function RouteWindow({ win }: { win: Win }) {
  const [loaded, setLoaded] = useState(false);
  // 드래그/리사이즈 중에는 iframe을 숨겨 매 프레임 재페인트를 막아 부드럽게 이동.
  const dragging = useWindowStore((s) => s.draggingId === win.id);
  const observeIframe = useWindowStore((s) => s.observeIframe);
  const close = useWindowStore((s) => s.close);
  const reloadWindow = useWindowStore((s) => s.reloadWindow);
  const isFocused = useWindowStore((s) => s.focusedId === win.id);
  const order = useWindowStore((s) => s.order);
  const router = useRouter();
  // 이전 화면 유지 방식: 바탕 문서의 주소가 보이는 화면을 따라가므로 `router.refresh()`는 **그 화면을 바탕에 또 렌더**해 첫 화면 자리에 남긴다 —
  // 생성폼이 끝날 때의 바탕 갱신은 하지 않는다(소스 목록 창은 아래 reloadWindow가 따로 새로 연다).
  const keepalive = useShellMode() === "keepalive";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // autoClose 창이 이미 닫힘을 1회만 트리거(navigate-away 관찰이 여러 번 들어와도 중복 close 방지).
  const autoClosedRef = useRef(false);
  const href = win.params.href;
  const fallbackTitle = win.params.title;
  const present = useWindowPresentation();
  const currentHref = useWindowStore((s) => s.nav[win.id]?.at(-1));
  const liveTitle = useWindowStore((s) => s.live[win.id]?.title);
  const displayTitle = present(win, currentHref, liveTitle).title;
  // 메뉴가 이 창의 첫 화면을 바꾸면(open-menu-window) 새 문서의 첫 로드에서 nav 스택을 새로 시작한다 — 아래 effect.
  const prevHrefRef = useRef(href);
  const resetOnLoadRef = useRef(false);

  // 복원 시 창 최대 6개가 iframe src를 동시에 로드하면 셸+페이지가 6× 동시 렌더(인증·DB 라운드트립
  // 폭발)된다. 포커스 창만 즉시 로드하고 나머지는 z순서대로 stagger 마운트 → 동시 부하 분산.
  // 한 번 활성화되면 유지(activated). 포커스되면 즉시(0ms) 활성화.
  // 🔴 **최소화된 창은 활성화하지 않는다** — 최소화는 언마운트가 아니라 `display:none`(floating-window.tsx)이라
  //    문서를 로드해도 레이아웃이 0이다: 셸·인증·DB 쿼리를 전부 치르고 글리프는 한 자도 안 그린다.
  //    그 탓에 2MB Pretendard preload가 창 수만큼 "preloaded but not used" 경고를 찍었다
  //    (2026-09-10 실측: 최소화 창 문서는 폰트를 받고도 FontFace가 `unloaded`). 복원될 때 로드한다.
  //    ⚠️ 이미 활성화된 창은 activated가 유지돼 최소화해도 문서·스크롤이 보존된다(BL3 warm 풀 포함) —
  //    보존 대상은 "열어봤던 창"이고, 여기서 막는 건 "한 번도 안 연 채 최소화로 복원된 창"이다.
  const [activated, setActivated] = useState(isFocused && !win.minimized);
  // 이전 화면 유지 방식: iframe의 `src` 속성은 **처음 실은 주소로 고정**한다. src를 바꾸면 그 이동이 탭의 합동 세션 기록에 한 칸을 쌓아
  // 뒤로가기를 두 번 눌러야 이전 화면으로 갔다(적대 리뷰) — 이 방식에선 뒤로가기 = 이전 화면이라 그 칸이 죽은 칸이 된다. 이미 연 화면을
  // 다른 주소로 옮기는 것은 아래 주소 변경 효과가 `location.replace`로 한다(창 크롬 ←·첫 화면과 같은 길). 창 모드는 종전대로 src가 따라간다.
  const [pinnedHref, setPinnedHref] = useState<string | undefined>(() => (isFocused && !win.minimized ? href : undefined));
  useEffect(() => {
    if (activated || win.minimized) return;
    const delay = isFocused ? 0 : 250 + Math.max(0, order.indexOf(win.id)) * 250;
    const t = setTimeout(() => {
      setActivated(true);
      setPinnedHref((p) => p ?? href);
    }, delay);
    return () => clearTimeout(t);
  }, [activated, win.minimized, isFocused, order, win.id, href]);
  const frameSrc = activated ? withEmbed((keepalive ? pinnedHref : undefined) ?? href ?? "/") : undefined;
  // 아래 주소 변경 효과가 '이미 문서를 실었나'를 본다(그 효과의 의존성을 늘리면 활성화될 때마다 iframe 등록이 다시 돈다).
  const activatedRef = useRef(activated);
  useEffect(() => {
    activatedRef.current = activated;
  }, [activated]);

  // 타이틀바 새로고침 버튼 → 이 창 iframe만 현재 URL로 reload(전체 F5 대신 = 셸·다른 창 재실행 없음).
  // nonce가 bump되면 스켈레톤을 다시 띄우고(리로드 중 빈 깜빡임 방지) 현재 문서를 reload(드릴인 URL 보존).
  const reloadNonce = useWindowStore((s) => s.reloadNonce[win.id] ?? 0);
  const prevReload = useRef(reloadNonce);
  useEffect(() => {
    if (reloadNonce === prevReload.current) return; // 초기 마운트/무변경
    const el = iframeRef.current;
    // 아직 비활성(stagger 복원 중)이면 nonce를 소비하지 말 것 — 소비하면 활성화 후 재실행 때 무변경으로
    // 걸러져 reload가 영구 유실된다. 활성화돼 실제 reload를 수행할 때만 nonce 소비.
    if (!el || !activated) return;
    prevReload.current = reloadNonce;
    // 🔴 미저장 창은 떠나기 확인이 뜬다 — '머무르기'면 문서가 그대로인데 스켈레톤을 먼저 띄우면 폼을 영구히 덮는다
    //    (리뷰 2026-09-11). 그런 창은 지금 덮지 않고(loaded 그대로) 문서가 **실제로 내려갈 때**(pagehide) 덮는다.
    //    깨끗한 창은 종전대로 바로 덮는다(누른 느낌).
    const holdCover = useWindowStore.getState().dirty[win.id] ?? false;
    setLoaded((prev) => (holdCover ? prev : false));
    try {
      const cw = el.contentWindow;
      if (cw) {
        if (holdCover) cw.addEventListener("pagehide", () => setLoaded(false), { once: true });
        // 창 안 이동이 embed=1을 떨어뜨린 문서면 붙여서 다시 연다(reload()는 지금 주소 그대로라 창 안에 풀 셸이 뜬다).
        const target = reloadTarget(cw.location);
        if (target) cw.location.replace(target);
        else cw.location.reload();
      }
    } catch {
      if (href) el.src = withEmbed(href); // same-origin 접근 막히면 src 재설정 폴백
    }
  }, [reloadNonce, activated, href, win.id]);

  // 보관(닫힌) 창을 첫 화면 주소로 되살렸다(open()이 표식을 올림) — 그 창 iframe만 첫 화면으로 옮긴다.
  // 보관 창은 미저장·녹음 중일 수 없다(그런 창은 보관하지 않고, 녹음 중엔 닫기가 잠긴다) — 떠나기 확인이 안 뜨니
  // 스켈레톤을 먼저 띄워도 폼을 덮을 일이 없다. 덮어야 새 문서가 뜨기 전 옛 상세가 보이거나 눌리지 않는다(리뷰 2026-09-11).
  const homeNonce = useWindowStore((s) => s.homeNonce[win.id] ?? 0);
  const prevHome = useRef(homeNonce);
  useEffect(() => {
    if (homeNonce === prevHome.current) return;
    prevHome.current = homeNonce;
    const el = iframeRef.current;
    // 아직 문서를 싣지 않은 창이면 옮길 것이 없다 — 활성화되면 src(첫 화면)로 뜬다(표식은 소비해 두 번 부르지 않는다).
    if (!el || !activated || !href) return;
    const target = withEmbed(href);
    // 해시만 다른 이동이면 새 문서가 뜨지 않는다(해시로 스크롤만) — 덮지 않고 기록도 새로 시작하지 않는다(재리뷰 2026-09-11).
    const sameDoc = isSameDocument(el, target);
    setLoaded((prev) => (sameDoc ? prev : false));
    if (!sameDoc) resetOnLoadRef.current = true; // 새 문서의 첫 로드에서 기록을 그 주소 하나로 다시 시작
    try {
      el.contentWindow?.location.replace(target);
    } catch {
      el.src = target;
    }
  }, [homeNonce, activated, href]);

  // 녹음 잠금(use-recording-lock) — **이 창의 iframe이 보낸 것만** 받아 이 창 id에 싣는다. 창 id를 경로로 추측하면
  // 드릴인(상세 → 수정)에서 없는 창을 잠가, 녹음 중인 진짜 창이 닫기·창 개수 한도의 축출에 노출됐다([[#69]] ①).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const el = iframeRef.current;
      if (!el || !e.source || e.source !== el.contentWindow) return;
      const data = e.data as { type?: string; active?: boolean } | null;
      if (data?.type !== WINDOW_BUSY_MESSAGE) return;
      useWindowStore.getState().setWindowBusy(win.id, data.active === true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [win.id]);

  // 창이 사라지면(폭이 1024 아래로 줄어 캔버스가 창을 전부 내림 등) iframe도 함께 파괴돼, 녹음 잠금을 풀 신호(pagehide의
  // active:false)를 받을 리스너가 없다 — 그대로 두면 잠금이 영영 남아, 폭을 되돌려도 그 창의 닫기·새로고침·뒤로·다른 화면
  // 이동이 잠기고 창 개수 한도의 축출에서도 빠진다(재리뷰 2026-09-11). 그래서 언마운트 때 푼다.
  // 🔴 **언마운트 전용** — 의존성은 창 id 하나(창마다 불변)다. 녹음이 계속되는 중에 다른 이유로(주소·제목 변경) cleanup이
  //    돌면 안 된다. 창이 닫혀 이미 파괴됐으면 스토어가 없는 창의 잠금 보고를 버린다(무해).
  useEffect(() => {
    const id = win.id;
    return () => useWindowStore.getState().setWindowBusy(id, false);
  }, [win.id]);

  // iframe 등록 + 제목/URL 관찰 → 타이틀바 제목 + 창별 nav 스택 갱신(Idea A: 창 크롬이 제목·뒤로 소유).
  // 같은 창 안에서 서브라우트로 드릴인하면 document.title·location이 바뀌고 MutationObserver/popstate가
  // 잡아 갱신한다. same-origin이라 contentDocument/contentWindow 접근 가능. canBack은 스택 깊이로 판정.
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    iframeRegistry.set(win.id, el);
    // 메뉴가 이 창의 첫 화면(`params.href`)을 바꿨다 — **새 문서의 첫 로드**에서 nav 스택을 새로 시작한다
    // (open-menu-window: 면 전환·필터 주소). 아래 즉시 sync()는 아직 **옛 문서**를 보고하므로 초기화에 쓰지 않는다.
    if (prevHrefRef.current !== href) {
      prevHrefRef.current = href;
      // 해시만 다른 주소면 새 문서가 뜨지 않는다(해시로 스크롤만) — 덮지 않고 기록도 새로 시작하지 않는다. 덮으면 걷어 줄
      // load가 없어 스켈레톤이 영영 남는다(재리뷰 2026-09-11).
      const sameDoc = !!href && isSameDocument(el, withEmbed(href));
      if (!sameDoc) resetOnLoadRef.current = true;
      // 다른 화면으로 옮긴다 — 새 문서가 뜰 때까지 옛 화면이 보이고 눌리면 그 클릭이 고른 화면을 취소한다. 스켈레톤으로 덮는다.
      // ⚠️ 미저장 창은 떠나기 확인이 뜰 수 있어 지금 덮지 않는다('머무르기'면 폼이 영구히 가려진다) — ⟳와 같이 문서가
      //    **실제로 내려갈 때**(pagehide) 덮는다. '떠나기' 뒤 새 문서가 뜨기 전까지 옛 폼이 보이고 눌리지 않게(재리뷰 2026-09-11).
      const dirtyNow = useWindowStore.getState().dirty[win.id] ?? false;
      const holdCover = sameDoc || dirtyNow;
      setLoaded((prev) => (holdCover ? prev : false));
      if (!sameDoc && dirtyNow) {
        el.contentWindow?.addEventListener("pagehide", () => setLoaded(false), { once: true });
      }
      // 이전 화면 유지: src는 고정이라(위 pinnedHref) 여기서 직접 옮긴다 — replace라 합동 세션 기록에 칸이 안 생긴다.
      // 아직 실린 문서가 없으면(활성화 전) 활성화 때 이 주소로 뜬다(pinnedHref가 그때의 href).
      if (keepalive && href && activatedRef.current) {
        try {
          el.contentWindow?.location.replace(withEmbed(href));
        } catch {
          /* 접근 불가 — 무시(같은 출처라 정상 도달) */
        }
      }
    }
    let obs: MutationObserver | null = null;
    // 새 문서의 첫 로드 보고인가 — onLoad만 켠다. 미저장 창의 이동 의도(← · 첫 화면)는 이 보고에서만 소비된다
    // (같은 문서의 보고 — 제목 변경 등 — 가 의도를 먹으면 '머무르기' 뒤 기록이 사라진다, 재리뷰 2026-09-11).
    let fromLoad = false;
    /** 관찰해서 스택에 보고했으면 true(아직 about:blank·autoClose로 닫힘이면 false). */
    const sync = (reset = false): boolean => {
      try {
        const doc = el.contentDocument;
        const cw = el.contentWindow;
        if (!doc || !cw) return false;
        // iframe이 아직 라우트를 로드하기 전엔 about:blank(pathname="blank") — 실제 라우트(절대경로)가
        // 들어오기 전까지는 스택을 건드리지 않는다(로딩 스켈레톤엔 ← 미표시, 닫기는 X가 담당).
        const path = cw.location.pathname;
        if (cw.location.href === "about:blank" || !path.startsWith("/")) return false;
        // autoClose("새 X" 폼) 창: iframe이 초기 /X/new 경로를 벗어나면(제출 성공 → redirect/push)
        // 창을 닫고 배경 라우트를 새로고침(우측 패널의 닫기+목록 갱신을 창 패러다임으로 대체).
        if (win.params.autoClose && !autoClosedRef.current) {
          const initialPath = (href ?? "").split("?")[0];
          if (initialPath && path !== initialPath) {
            autoClosedRef.current = true;
            // 🔴 녹음 중인 창은 닫지 않는다 — 닫으면 iframe째 녹음이 끝난다(원생상담 창에서 수기 상담만 저장해도 그랬다,
            //    재리뷰 2026-10-16). 그 창은 보통 창으로 남아 옮겨 간 화면을 기록하고, 목록만 새로 그린다.
            const recording = !!useWindowStore.getState().busy[win.id];
            if (!recording) close(win.id);
            if (!keepalive) router.refresh(); // 배경(최상위 프레임) 목록 갱신
            // 소스가 플로팅 창(iframe 안 "새 X")이면 그 창은 별도 문서라 router.refresh가 안 닿음 → 직접 reload
            // (신규 항목이 소스 리스트 창에 즉시 보이게). 이미 닫힌 창이면 no-op.
            if (win.params.spawnedBy) reloadWindow(win.params.spawnedBy);
            if (!recording) return false;
          }
        }
        const url = path + cw.location.search;
        const title = cleanTitle(doc.title || "") || fallbackTitle;
        observeIframe(win.id, { title, url, ...(reset ? { reset: true } : {}), ...(fromLoad ? { load: true } : {}) });
        return true;
      } catch {
        /* same-origin이라 정상 도달; 만약 막히면 무시(타이틀=params 유지) */
        return false;
      }
    };
    // 관찰자·popstate용 — 인자를 넘기는 콜백(MutationObserver는 레코드 배열, popstate는 이벤트)이 `reset`으로 읽히지 않게.
    const syncPlain = () => {
      sync();
    };
    const onLoad = () => {
      // 전체 문서 로드(하드 리로드·⟳·브라우저 back)는 iframe React 컨텍스트를 파괴하며 언마운트 cleanup(미저장
      // 가드의 send(false))을 못 돌린다 → 부모에 stale dirty=true가 남아 리로드된 pristine 폼을 거짓 잠금.
      // 새 문서는 항상 clean에서 시작하므로 로드 시 dirty 해제(편집하면 새 폼의 가드가 다시 dirty를 올림).
      // (소프트 client nav[드릴인/백]은 load가 안 떠 이 경로를 안 타고, 폼 언마운트 cleanup이 이미 처리.)
      // 🔴 **떠난 문서의 표식만** — 지금 문서가 load 전에 올린 표식(첫 페인트·덮개 없는 이동 뒤 입력)은 남긴다(window-signals-core).
      clearDirtyForNewDocument(win.id, el.contentDocument);
      // 메뉴가 첫 화면을 바꾼 뒤의 첫 로드면 스택을 새로 시작한다(실제로 보고한 뒤에만 표식을 내린다 —
      // 아직 about:blank인 로드가 표식을 먹어 버리면 진짜 새 문서가 옛 스택 위에 쌓인다).
      fromLoad = true;
      if (sync(resetOnLoadRef.current)) resetOnLoadRef.current = false;
      fromLoad = false;
      try {
        // head 서브트리 관찰 — <title> 텍스트 변경뿐 아니라 client-side nav 시 title 엘리먼트
        // 교체(Next 메타)까지 포착. popstate도 함께 들어 history.back() 후 즉시 동기화.
        const head = el.contentDocument?.head;
        obs?.disconnect();
        if (head) {
          obs = new MutationObserver(syncPlain);
          obs.observe(head, { childList: true, characterData: true, subtree: true });
        }
        el.contentWindow?.addEventListener("popstate", syncPlain);
      } catch {
        /* ignore */
      }
    };
    el.addEventListener("load", onLoad);
    // 이미 로드된 경우 대비 — 단 주소가 막 바뀌었으면(위) 지금 문서는 **옛 문서**라 보고하지 않는다. 보고하면 옛 상세가
    // 기록에 다시 쌓여 ←가 되살아나고, 누르면 고른 화면이 취소됐다(리뷰 2026-09-11). 새 문서는 첫 로드(onLoad)에서 보고한다.
    if (!resetOnLoadRef.current) sync();
    return () => {
      el.removeEventListener("load", onLoad);
      obs?.disconnect();
      iframeRegistry.delete(win.id);
    };
  }, [win.id, fallbackTitle, observeIframe, href, win.params.autoClose, win.params.spawnedBy, close, reloadWindow, router, keepalive]);

  // 첫 페인트에서 스켈레톤 걷기 · 숨김을 창 문서에 · 다시 보일 때 새로고침 · 느린 첫 화면 · 키보드 초점(use-window-signals.ts).
  const { slow, retry } = useWindowSignals({ win, iframeRef, activated, loaded, setLoaded, isFocused });

  if (!href) return null;

  return (
    <div className="bg-card relative h-full w-full">
      <iframe
        ref={iframeRef}
        src={frameSrc}
        title={displayTitle}
        // 창 안 녹음·원스크린 연속 촬영에 필요한 기기 권한 위임(실제 사용 시 브라우저가 허용을 묻는다).
        // same-origin이라도 일부 브라우저는 getUserMedia에 iframe allow를 요구 → 명시.
        allow="microphone; camera"
        className="h-full w-full border-0"
        // 🔴 숨길 때만 값을 준다 — `visible`을 못박으면 조상이 `visibility:hidden`(이전 화면 유지 방식의 숨은 화면)이어도 이 iframe만
        //    남아 그려진다(자식의 visible이 이긴다). 안 줘도 기본은 상속이라 종전 모양은 그대로다.
        style={dragging ? { visibility: "hidden" } : undefined}
        // 활성화 전(src 미설정) about:blank load는 무시 — 활성화 후 실제 콘텐츠 로드만 스켈레톤 해제.
        onLoad={() => { if (activated) setLoaded(true); }}
      />
      {(!activated || !loaded) && !dragging ? (
        // paddingLeft = 이전 화면 유지 방식의 창은 사이드바 밑까지 깔려 있어 그 폭만큼 비켜 그린다(창 모드엔 변수가 없어 p-5 그대로).
        <div className="bg-card absolute inset-0 p-5" style={{ paddingLeft: "calc(var(--keepalive-rail-parent, 0px) + 1.25rem)" }} aria-hidden={slow ? undefined : true}>
          <div className="animate-pulse space-y-3">
            <div className="bg-bg-soft h-6 w-40 rounded" />
            <div className="bg-bg-soft h-24 w-full rounded" />
            <div className="bg-bg-soft h-4 w-3/4 rounded" />
            <div className="bg-bg-soft h-4 w-2/3 rounded" />
          </div>
          {slow ? (
            // 12초가 지나도 첫 화면이 안 그려졌다 — 영원히 도는 스켈레톤 대신 이유와 출구를 준다.
            <div className="mt-6 flex flex-col items-start gap-2" role="status">
              <p className="text-text-dim text-sm">화면을 불러오는 데 시간이 오래 걸리고 있어요.</p>
              <Button type="button" variant="outline" onClick={retry}>
                다시 시도
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {dragging ? (
        <div className="bg-card absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="text-text-faint text-sm font-medium">{displayTitle}</span>
        </div>
      ) : null}
    </div>
  );
}
