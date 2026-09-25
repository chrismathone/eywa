"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { subscribeMutations } from "@/lib/realtime/mutation-signal";
import { useWindowStore, type Win } from "./window-store";
import { applyFrameVisibility } from "./frame-visibility";
import { postWindowRefresh } from "./window-bridge";
import { withEmbed } from "./embed-context";
import {
  clearDirtyForNewDocument,
  hasPainted,
  isWindowHidden,
  mayTakeFocus,
  REFRESH_STAGGER_MS,
  refreshRank,
  SLOW_LOAD_MS,
  STALE_AFTER_MS,
} from "./window-signals-core";

/**
 * 라우트 창(iframe)의 부모 쪽 신호 다섯 — RouteWindow가 부른다(판정은 window-signals-core.ts).
 * ① **첫 페인트에서 스켈레톤을 걷는다** — `load`는 스트림 끝 + 이미지·폰트까지 기다려서, 그동안 창 안 `loading.tsx`와 먼저
 *    도착한 본문이 한 번도 안 보였다(B7이 창에선 무효였다). `load`는 그대로 안전망으로 남는다(RouteWindow onLoad).
 * ② **숨김을 창 문서에 알린다**(frame-visibility) — 폴링이 스스로 멈춘다.
 * ③ **숨어 있던 사이 바뀐 창은 다시 보일 때 소프트 새로고침**(mutation-signal + 10분). 미저장·녹음 중이면 안 한다.
 * ④ **첫 화면이 12초 넘게 안 그려지면** '다시 시도'를 보인다(지금까진 스켈레톤이 영원히 돌았다).
 * ⑤ **창이 앞으로 오면 키보드도 그 창으로** — 메뉴·스위처·팰릿으로 연 창에 바로 타이핑·스크롤이 들어가게(mayTakeFocus).
 */
export function useWindowSignals({
  win,
  iframeRef,
  activated,
  loaded,
  setLoaded,
  isFocused,
}: {
  win: Win;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  activated: boolean;
  loaded: boolean;
  setLoaded: (v: boolean) => void;
  isFocused: boolean;
}): { slow: boolean; retry: () => void } {
  const id = win.id;
  const hidden = useWindowStore((s) => isWindowHidden(s, id));
  const hiddenRef = useRef(hidden);
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  // "숨어 있던 사이 바뀜" 표식(③). 새 문서가 뜨면 그 자체로 최신이니 지운다 — 안 지우면 되살린 창이 다음 복원에 한 번 더 돈다.
  const staleRef = useRef(false);
  // 마지막으로 보여 준 문서 — 덮개를 다시 올린 뒤 이 문서를 새 문서로 오인하지 않게(hasPainted).
  const shownDocRef = useRef<Document | null>(null);

  /** 새 문서가 보이기 시작했다(첫 페인트·load) — 한 곳에서 같은 정리를 한다. */
  const onNewDocument = (el: HTMLIFrameElement, doc: Document | null) => {
    shownDocRef.current = doc;
    clearDirtyForNewDocument(id, doc);
    applyFrameVisibility(el, hiddenRef.current);
    staleRef.current = false;
    setSlow(false);
  };
  const onNewDocumentRef = useRef(onNewDocument);
  useEffect(() => {
    onNewDocumentRef.current = onNewDocument;
  });

  // ① 첫 페인트 감시 — 덮여 있는 동안만 프레임마다 확인(querySelector 한 번 — 비용 무시 수준).
  useEffect(() => {
    if (!activated || loaded) return;
    const el = iframeRef.current;
    if (!el) return;
    // 덮개가 막 올라온 지금 붙어 있는 문서 = 떠날 문서다 — 기준으로 삼는다. 덮개 없이 창 안에서 하드 이동해 온 문서(아직 load 전)나
    // 멈춘 문서(다시 시도)도 이렇게 해야 '새 문서'로 오인되지 않는다(재리뷰 2026-09-25). 이동은 비동기라 새 문서는 아직 안 붙었다
    // (붙었으면 제외돼 load가 걷는다 — 종전과 같다).
    try {
      shownDocRef.current = el.contentDocument;
    } catch {
      return;
    }
    let raf = 0;
    const tick = () => {
      let doc: Document | null = null;
      try {
        doc = el.contentDocument;
      } catch {
        return;
      }
      if (hasPainted(doc, shownDocRef.current)) {
        onNewDocumentRef.current(el, doc);
        setLoaded(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activated, loaded, iframeRef, setLoaded, attempt]);

  // ② 숨김 → 창 문서. 새 문서가 뜰 때마다(load) 다시 건다(덮은 속성은 문서 객체에 붙어 있다).
  useEffect(() => {
    applyFrameVisibility(iframeRef.current, hidden);
  }, [hidden, loaded, iframeRef]);
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    const onLoad = () => {
      let doc: Document | null = null;
      try {
        doc = el.contentDocument;
      } catch {
        /* 접근 불가 — 표식 정리만 건너뛴다 */
      }
      onNewDocumentRef.current(el, doc);
    };
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  }, [iframeRef]);

  // ③ 숨어 있는 동안의 "바뀜"을 기억했다가 다시 보일 때 새로고침.
  const hiddenSinceRef = useRef<number | null>(null); // 처음부터 숨어 있으면 아래 effect 첫 실행이 채운다
  useEffect(() => {
    return subscribeMutations(() => {
      if (hiddenRef.current) staleRef.current = true;
    });
  }, []);
  useEffect(() => {
    const was = hiddenRef.current;
    hiddenRef.current = hidden;
    if (hidden) {
      if (!was || hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
      return;
    }
    if (!was) return;
    const since = hiddenSinceRef.current;
    hiddenSinceRef.current = null;
    const due = staleRef.current || (since !== null && Date.now() - since > STALE_AFTER_MS);
    if (!due) return;
    // 한 박자 기다린다 — 같은 순간 창이 다른 화면으로 옮겨지면(첫 화면 되살리기·면 전환) 그쪽이 덮개를 먼저 올려
    // 새로고침이 필요 없어진다. 여러 창이 한꺼번에 드러나면(최대화 해제) 위 창부터 차례로(B6).
    const delay = 150 + refreshRank(useWindowStore.getState().order, id) * REFRESH_STAGGER_MS;
    const t = setTimeout(() => {
      const st = useWindowStore.getState();
      if (hiddenRef.current || !loadedRef.current || st.dirty[id] || st.busy[id]) return;
      if (postWindowRefresh(iframeRef.current)) staleRef.current = false;
    }, delay);
    return () => clearTimeout(t);
  }, [hidden, id, iframeRef]);

  // ④ 느린 첫 화면. 걷히는 쪽(첫 페인트·load)이 같이 내린다 — 표시는 `!loaded`일 때만이라 늦게 내려도 안 보인다.
  useEffect(() => {
    if (!activated || loaded) return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [activated, loaded, attempt]);
  const retry = () => {
    const el = iframeRef.current;
    if (!el) return;
    const stack = useWindowStore.getState().nav[id] ?? [];
    const target = withEmbed(stack[stack.length - 1] ?? win.params.href ?? "/");
    setSlow(false);
    setAttempt((n) => n + 1);
    try {
      el.contentWindow?.location.replace(target);
    } catch {
      el.src = target;
    }
  };

  // ⑤ 앞으로 온 창에 키보드 초점.
  useEffect(() => {
    if (!isFocused || !loaded || !activated) return;
    const el = iframeRef.current;
    if (!el || !mayTakeFocus(document.activeElement, el, document.body)) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* 무시 */
    }
  }, [isFocused, loaded, activated, iframeRef]);

  return { slow: slow && activated && !loaded, retry };
}
