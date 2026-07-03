"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWindowStore, type Win } from "./window-store";
import { withEmbed } from "./embed-context";

/**
 * 라우트 창의 iframe 엘리먼트 레지스트리(런타임·모듈 전역). 타이틀바 뒤로(←) 버튼이
 * 해당 창 iframe의 history.back()을 호출할 수 있게 RouteWindow가 자기 iframe을 등록한다.
 */
export const iframeRegistry = new Map<string, HTMLIFrameElement>();

/** 문서 제목에서 " — eywa" 류 접미사 제거(크롬 타이틀 표시용). */
function cleanTitle(raw: string) {
  return raw.replace(/\s*[—–-]\s*eywa\s*$/i, "").trim();
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // autoClose 창이 이미 닫힘을 1회만 트리거(navigate-away 관찰이 여러 번 들어와도 중복 close 방지).
  const autoClosedRef = useRef(false);
  const href = win.params.href;
  const fallbackTitle = win.params.title;

  // 복원 시 창 최대 6개가 iframe src를 동시에 로드하면 셸+페이지가 6× 동시 렌더(인증·DB 라운드트립
  // 폭발)된다. 포커스 창만 즉시 로드하고 나머지는 z순서대로 stagger 마운트 → 동시 부하 분산.
  // 한 번 활성화되면 유지(activated). 포커스되면 즉시(0ms) 활성화.
  const [activated, setActivated] = useState(isFocused);
  useEffect(() => {
    if (activated) return;
    const delay = isFocused ? 0 : 250 + Math.max(0, order.indexOf(win.id)) * 250;
    const t = setTimeout(() => setActivated(true), delay);
    return () => clearTimeout(t);
  }, [activated, isFocused, order, win.id]);

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
    setLoaded(false);
    try {
      el.contentWindow?.location.reload();
    } catch {
      if (href) el.src = withEmbed(href); // same-origin 접근 막히면 src 재설정 폴백
    }
  }, [reloadNonce, activated, href]);

  // iframe 등록 + 제목/URL 관찰 → 타이틀바 제목 + 창별 nav 스택 갱신(Idea A: 창 크롬이 제목·뒤로 소유).
  // 같은 창 안에서 서브라우트로 드릴인하면 document.title·location이 바뀌고 MutationObserver/popstate가
  // 잡아 갱신한다. same-origin이라 contentDocument/contentWindow 접근 가능. canBack은 스택 깊이로 판정.
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    iframeRegistry.set(win.id, el);
    let obs: MutationObserver | null = null;
    const sync = () => {
      try {
        const doc = el.contentDocument;
        const cw = el.contentWindow;
        if (!doc || !cw) return;
        // iframe이 아직 라우트를 로드하기 전엔 about:blank(pathname="blank") — 실제 라우트(절대경로)가
        // 들어오기 전까지는 스택을 건드리지 않는다(로딩 스켈레톤엔 ← 미표시, 닫기는 X가 담당).
        const path = cw.location.pathname;
        if (cw.location.href === "about:blank" || !path.startsWith("/")) return;
        // autoClose("새 X" 폼) 창: iframe이 초기 /X/new 경로를 벗어나면(제출 성공 → redirect/push)
        // 창을 닫고 배경 라우트를 새로고침(우측 패널의 닫기+목록 갱신을 창 패러다임으로 대체).
        if (win.params.autoClose && !autoClosedRef.current) {
          const initialPath = (href ?? "").split("?")[0];
          if (initialPath && path !== initialPath) {
            autoClosedRef.current = true;
            close(win.id);
            router.refresh(); // 배경(최상위 프레임) 목록 갱신
            // 소스가 플로팅 창(iframe 안 "새 X")이면 그 창은 별도 문서라 router.refresh가 안 닿음 → 직접 reload
            // (신규 항목이 소스 리스트 창에 즉시 보이게). 이미 닫힌 창이면 no-op.
            if (win.params.spawnedBy) reloadWindow(win.params.spawnedBy);
            return;
          }
        }
        const url = path + cw.location.search;
        const title = cleanTitle(doc.title || "") || fallbackTitle;
        observeIframe(win.id, { title, url });
      } catch {
        /* same-origin이라 정상 도달; 만약 막히면 무시(타이틀=params 유지) */
      }
    };
    const onLoad = () => {
      // 전체 문서 로드(하드 리로드·⟳·브라우저 back)는 iframe React 컨텍스트를 파괴하며 언마운트 cleanup(미저장
      // 가드의 send(false))을 못 돌린다 → 부모에 stale dirty=true가 남아 리로드된 pristine 폼을 거짓 잠금.
      // 새 문서는 항상 clean에서 시작하므로 로드 시 dirty 해제(편집하면 새 폼의 가드가 다시 dirty를 올림).
      // (소프트 client nav[드릴인/백]은 load가 안 떠 이 경로를 안 타고, 폼 언마운트 cleanup이 이미 처리.)
      useWindowStore.getState().setWindowDirty(win.id, false);
      sync();
      try {
        // head 서브트리 관찰 — <title> 텍스트 변경뿐 아니라 client-side nav 시 title 엘리먼트
        // 교체(Next 메타)까지 포착. popstate도 함께 들어 history.back() 후 즉시 동기화.
        const head = el.contentDocument?.head;
        obs?.disconnect();
        if (head) {
          obs = new MutationObserver(sync);
          obs.observe(head, { childList: true, characterData: true, subtree: true });
        }
        el.contentWindow?.addEventListener("popstate", sync);
      } catch {
        /* ignore */
      }
    };
    el.addEventListener("load", onLoad);
    sync(); // 이미 로드된 경우 대비
    return () => {
      el.removeEventListener("load", onLoad);
      obs?.disconnect();
      iframeRegistry.delete(win.id);
    };
  }, [win.id, fallbackTitle, observeIframe, href, win.params.autoClose, win.params.spawnedBy, close, reloadWindow, router]);

  if (!href) return null;

  return (
    <div className="bg-card relative h-full w-full">
      <iframe
        ref={iframeRef}
        src={activated ? withEmbed(href) : undefined}
        title={win.params.title}
        // 창 안 폼이 브라우저 마이크로 바로 녹음(회의록·등록상담·학생상담)할 수 있게 권한 위임.
        // same-origin이라도 일부 브라우저는 getUserMedia에 iframe allow를 요구 → 명시.
        allow="microphone"
        className="h-full w-full border-0"
        style={{ visibility: dragging ? "hidden" : "visible" }}
        // 활성화 전(src 미설정) about:blank load는 무시 — 활성화 후 실제 콘텐츠 로드만 스켈레톤 해제.
        onLoad={() => { if (activated) setLoaded(true); }}
      />
      {(!activated || !loaded) && !dragging ? (
        <div className="bg-card absolute inset-0 p-5" aria-hidden="true">
          <div className="animate-pulse space-y-3">
            <div className="bg-bg-soft h-6 w-40 rounded" />
            <div className="bg-bg-soft h-24 w-full rounded" />
            <div className="bg-bg-soft h-4 w-3/4 rounded" />
            <div className="bg-bg-soft h-4 w-2/3 rounded" />
          </div>
        </div>
      ) : null}
      {dragging ? (
        <div className="bg-card absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="text-text-faint text-[13px] font-medium">{win.params.title}</span>
        </div>
      ) : null}
    </div>
  );
}
