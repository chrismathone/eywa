"use client";

import { useEffect } from "react";
import {
  KEEPALIVE_ACTIVITY_MESSAGE,
  KEEPALIVE_FRAME_ATTR,
  KEEPALIVE_RAIL_VAR,
  KEEPALIVE_ROOT_ATTR,
} from "./keepalive-frame";

/** 입력 신호를 이 간격으로만 보낸다(부모가 받아 도장을 찍는 비용이 스크롤마다 들지 않게). */
const ACTIVITY_THROTTLE_MS = 10_000;

/**
 * 이전 화면 유지 화면(iframe 문서)의 **부모와의 연결 둘** — 아무것도 그리지 않는다.
 *  ① 사이드바 폭 → 왼쪽 안쪽 여백(CSS 변수). 이 화면은 뷰포트 전체를 깔고 사이드바가 그 위를 덮으므로(keepalive-stage), 본문이 사이드바 밑으로
 *     들어가지 않게 폭만큼 비운다. 사이드바를 접고 펴거나(전환 중 매 프레임) '화면 최대화'로 숨기면 따라간다 — 값이 바뀌면 `resize`를 한 번 쏴
 *     창 크기로 행 수를 정하는 목록이 새 폭을 읽게 한다.
 *  ② 사용 신호 — 클릭·키·휠·스크롤을 부모에 알린다(2시간 만료는 '사용 없이'라 클릭만으로는 읽고 치는 사람을 놓친다).
 * 🔴 창 문서 안에서만 돈다(부모가 없으면 no-op).
 */
export function KeepaliveFrameBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    const cleanups: (() => void)[] = [];

    // body로 포털되는 고정 위치 레이어(다이얼로그 등)를 위한 문서 표식 — 하이드레이션 뒤라 `<html>` 속성 불일치 경고가 없다.
    const html = document.documentElement;
    html.setAttribute(KEEPALIVE_FRAME_ATTR, "");
    cleanups.push(() => {
      html.removeAttribute(KEEPALIVE_FRAME_ATTR);
      html.style.removeProperty(KEEPALIVE_RAIL_VAR);
    });

    try {
      const parentWin = window.parent as Window & { ResizeObserver?: typeof ResizeObserver };
      const aside = parentWin.document.querySelector<HTMLElement>("[data-shell-sidebar]");
      const root = document.querySelector<HTMLElement>(`[${KEEPALIVE_ROOT_ATTR}]`);
      let last = -1;
      let raf = 0;
      const apply = () => {
        const w = aside ? Math.round(aside.getBoundingClientRect().width) : 0;
        if (w === last) return;
        last = w;
        root?.style.setProperty(KEEPALIVE_RAIL_VAR, `${w}px`);
        html.style.setProperty(KEEPALIVE_RAIL_VAR, `${w}px`);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      };
      apply();
      if (aside && parentWin.ResizeObserver) {
        // 부모 realm의 옵저버가 부모 DOM을 본다(문서가 다른 요소를 다른 realm 옵저버로 보는 것은 브라우저마다 달라 안전하게 부모 것을 쓴다).
        const ro = new parentWin.ResizeObserver(apply);
        ro.observe(aside);
        cleanups.push(() => ro.disconnect());
      }
      window.addEventListener("resize", apply);
      cleanups.push(() => {
        window.removeEventListener("resize", apply);
        cancelAnimationFrame(raf);
      });
    } catch {
      /* 부모 접근 불가 — 여백 0(인라인 스크립트가 넣은 값 그대로) */
    }

    const origin = window.location.origin;
    let lastSent = 0;
    const signal = () => {
      const now = Date.now();
      if (now - lastSent < ACTIVITY_THROTTLE_MS) return;
      lastSent = now;
      try {
        window.parent.postMessage({ type: KEEPALIVE_ACTIVITY_MESSAGE }, origin);
      } catch {
        /* 무시 */
      }
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const ev of ["pointerdown", "keydown", "wheel"] as const) document.addEventListener(ev, signal, opts);
    cleanups.push(() => {
      for (const ev of ["pointerdown", "keydown", "wheel"] as const) document.removeEventListener(ev, signal, opts);
    });

    // 문서가 내려갈 때 부모 realm 옵저버가 남지 않게.
    window.addEventListener("pagehide", () => cleanups.forEach((c) => c()), { once: true });
    return () => cleanups.forEach((c) => c());
  }, []);
  return null;
}
